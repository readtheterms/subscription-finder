// JavaScript port of main.py. Function names match main.py (snake_case -> camelCase).
// Dates are stored as UTC milliseconds so daylight saving never changes a day count.

const SKIP = ["discover", "capitalone", "chasecredit", "zelle", "onlinetransfer"];
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function makeKey(description) {
  const letters = description.toLowerCase().replace(/[^a-z]/g, "");
  return letters.slice(0, 15);
}

// Accepts 10/13/2026, 10/13/26, 10-13-2026 and 2026-10-13 -> milliseconds
function parseDate(text) {
  const t = text.trim();
  let match = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (match) return Date.UTC(+match[1], +match[2] - 1, +match[3]);

  match = t.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4}|\d{2})/);
  if (!match) return NaN;
  const year = match[3].length === 2 ? 2000 + +match[3] : +match[3];
  return Date.UTC(year, +match[1] - 1, +match[2]);
}

function formatDate(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

function daysBetween(dates) {
  const parsed = dates.map(parseDate).sort((a, b) => a - b);
  const gaps = [];
  for (let i = 1; i < parsed.length; i++) {
    gaps.push(Math.round((parsed[i] - parsed[i - 1]) / MS_PER_DAY));
  }
  return gaps;
}

function median(numbers) {
  const sorted = [...numbers].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

// Turn raw CSV rows (arrays, from Papa Parse with header: false) into objects.
// If the first row has no date in it, it is a header row. Otherwise the file has
// no header (some banks do this), so guess the columns from what the values look like.
function rowsFromArrays(arrays) {
  const data = arrays.filter((row) => row.some((cell) => cell.trim() !== ""));
  if (data.length === 0) throw new Error("The file has no rows.");

  const first = data[0];
  const hasHeader = !first.some((cell) => !Number.isNaN(parseDate(cell)));
  if (hasHeader) {
    return data.slice(1).map((row) =>
      Object.fromEntries(first.map((name, i) => [name, row[i] === undefined ? "" : row[i]]))
    );
  }

  const width = Math.max(...data.map((row) => row.length));
  const share = (col, test) => data.filter((row) => test((row[col] || "").trim())).length / data.length;
  const isDate = (text) => !Number.isNaN(parseDate(text));
  const isNumber = (text) => /^\(?-?\$?[\d,]*\.?\d+\)?$/.test(text);

  let dateCol = -1;
  let amountCol = -1;
  for (let col = 0; col < width; col++) {
    if (dateCol === -1 && share(col, isDate) >= 0.8) dateCol = col;
    else if (amountCol === -1 && share(col, isNumber) >= 0.8) amountCol = col;
  }

  let descCol = -1;
  let longest = 0;
  for (let col = 0; col < width; col++) {
    if (col === dateCol || col === amountCol) continue;
    const average = data.reduce((sum, row) => sum + (row[col] || "").trim().length, 0) / data.length;
    if (average > longest) {
      longest = average;
      descCol = col;
    }
  }

  if (dateCol === -1 || amountCol === -1 || descCol === -1) {
    throw new Error("Could not tell which columns hold the date, description and amount.");
  }
  return data.map((row) => ({
    Date: row[dateCol] || "",
    Description: row[descCol] || "",
    Amount: row[amountCol] || "",
  }));
}

// Find which column holds what, by looking at the header names.
// "exact" names win over headers that merely contain the word.
function findColumn(headers, exact, contains) {
  const lower = headers.map((h) => h.trim().toLowerCase());
  for (const name of exact) {
    const i = lower.indexOf(name);
    if (i !== -1) return headers[i];
  }
  for (const word of contains) {
    const i = lower.findIndex((h) => h.includes(word));
    if (i !== -1) return headers[i];
  }
  return null;
}

function detectColumns(headers) {
  const date = findColumn(
    headers,
    ["posting date", "post date", "posted date", "transaction date", "trans date", "date"],
    ["date"]
  );
  const description = findColumn(
    headers,
    ["description", "merchant", "payee", "name", "memo", "details", "transaction"],
    ["descr", "merchant", "payee", "memo"]
  );
  const amount = findColumn(headers, ["amount", "amt"], ["amount"]);
  const debit = findColumn(headers, ["debit", "withdrawal", "withdrawals", "money out", "paid out"], []);

  if (!date || !description || (!amount && !debit)) {
    throw new Error(
      "Could not find the columns. Need a date, a description and an amount (or debit) column. Found: " +
        headers.join(", ")
    );
  }
  return { date, description, amount, debit };
}

// "$1,234.50" -> 1234.5, "(12.00)" -> -12, "" -> NaN
function parseAmount(text) {
  if (text === undefined || text === null) return NaN;
  let t = String(text).trim();
  const negative = /^\(.*\)$/.test(t) || t.startsWith("-");
  t = t.replace(/[^0-9.]/g, "");
  if (t === "") return NaN;
  return negative ? -parseFloat(t) : parseFloat(t);
}

// rows: array of objects from Papa Parse (header: true)
// Returns charges with spending stored as negative amounts, like the Chase export.
function loadCharges(rows) {
  const groups = new Map();
  const names = new Map();
  if (rows.length === 0) throw new Error("The file has no rows.");

  const cols = detectColumns(Object.keys(rows[0]));

  // Turn every row into {date, description, amount}
  let entries = [];
  for (const row of rows) {
    const date = (row[cols.date] || "").trim();
    if (Number.isNaN(parseDate(date))) continue;

    let amount = cols.amount ? parseAmount(row[cols.amount]) : NaN;
    if (Number.isNaN(amount) && cols.debit) {
      const debit = parseAmount(row[cols.debit]);
      if (!Number.isNaN(debit) && debit !== 0) amount = -Math.abs(debit);
    }
    if (Number.isNaN(amount)) continue;

    entries.push({ date, description: row[cols.description] || "", amount });
  }

  // Some banks (often credit cards) list purchases as positive numbers.
  // If almost nothing is negative, flip the signs so spending is negative.
  if (cols.amount && !cols.debit) {
    const negatives = entries.filter((e) => e.amount < 0).length;
    if (negatives < entries.length * 0.25) {
      entries = entries.map((e) => ({ ...e, amount: -e.amount }));
    }
  }

  for (const { date, description: raw, amount } of entries) {
    let description = raw.split(/\s+/).filter(Boolean).join(" ");
    description = description.replace(/ \d\d\/\d\d$/, "");
    description = description.replace(/^POS DEBIT /, "");

    if (amount >= 0) continue;

    const key = makeKey(description);
    if (!groups.has(key)) {
      groups.set(key, []);
      names.set(key, description);
    }
    groups.get(key).push([date, amount]);
  }

  if (groups.size === 0) throw new Error("No purchases found in that file.");
  return { groups, names };
}

function looksMonthly(charges) {
  if (charges.length < 3) return false;

  const gaps = daysBetween(charges.map(([date]) => date));
  let skipped = 0;
  for (const gap of gaps) {
    if (gap >= 25 && gap <= 35) continue;
    if (gap >= 55 && gap <= 70) {
      skipped++;
      continue;
    }
    return false;
  }
  if (skipped > gaps.length * 0.2) return false;

  const amounts = charges.map(([, amount]) => Math.abs(amount));
  const usual = median(amounts);
  let close = 0;
  for (const a of amounts) {
    if (Math.abs(a - usual) <= usual * 0.25) close++;
  }
  if (close < amounts.length * 0.8) return false;

  return true;
}

function looksYearly(charges) {
  if (charges.length < 2) return false;

  for (const gap of daysBetween(charges.map(([date]) => date))) {
    if (gap < 350 || gap > 380) return false;
  }

  const amounts = charges.map(([, amount]) => Math.abs(amount));
  const usual = median(amounts);
  for (const a of amounts) {
    if (Math.abs(a - usual) > usual * 0.25) return false;
  }

  return true;
}

function isSkipped(key) {
  return SKIP.some((word) => key.startsWith(word));
}

function classify(charges) {
  if (looksMonthly(charges)) return "monthly";
  if (looksYearly(charges)) return "yearly";
  return null;
}

function splitByPrice(charges) {
  const byPrice = new Map();
  for (const [date, amount] of charges) {
    if (!byPrice.has(amount)) byPrice.set(amount, []);
    byPrice.get(amount).push([date, amount]);
  }
  return [...byPrice.values()];
}

function latestDate(groups) {
  let latest = -Infinity;
  for (const charges of groups.values()) {
    for (const [date] of charges) {
      latest = Math.max(latest, parseDate(date));
    }
  }
  return latest;
}

function findSubscriptions(groups, names) {
  const latest = latestDate(groups);
  const found = [];

  for (const [key, charges] of groups) {
    if (isSkipped(key)) continue;

    const candidates = classify(charges) ? [charges] : splitByPrice(charges);

    for (const part of candidates) {
      const period = classify(part);
      if (period === null) continue;
      if (period === "yearly" && part.length < 3 && charges.length > 40) continue;

      const [cycle, grace] = period === "monthly" ? [30, 40] : [365, 380];

      // sort by date, then price, like Python sorting (date, price) tuples
      const pairs = part
        .map(([d, a]) => [parseDate(d), Math.abs(a)])
        .sort((x, y) => x[0] - y[0] || x[1] - y[1]);
      const [last, price] = pairs[pairs.length - 1];
      const active = Math.round((latest - last) / MS_PER_DAY) <= grace;

      found.push({
        name: names.get(key),
        price,
        period,
        last,
        next: last + cycle * MS_PER_DAY,
        active,
      });
    }
  }

  return found;
}

function monthlyTotal(subscriptions) {
  let total = 0;
  for (const sub of subscriptions) {
    if (!sub.active) continue;
    total += sub.period === "yearly" ? sub.price / 12 : sub.price;
  }
  return Math.round(total * 100) / 100;
}

if (typeof module !== "undefined") {
  module.exports = { rowsFromArrays, makeKey, parseDate, daysBetween, loadCharges, findSubscriptions, monthlyTotal, formatDate };
}
