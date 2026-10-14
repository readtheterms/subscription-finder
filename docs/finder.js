// JavaScript port of main.py. Function names match main.py (snake_case -> camelCase).
// Dates are stored as UTC milliseconds so daylight saving never changes a day count.

const SKIP = ["discover", "capitalone", "chasecredit", "zelle", "onlinetransfer"];
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function makeKey(description) {
  const letters = description.toLowerCase().replace(/[^a-z]/g, "");
  return letters.slice(0, 15);
}

// "10/13/2026" -> milliseconds
function parseDate(text) {
  const [month, day, year] = text.split("/").map(Number);
  return Date.UTC(year, month - 1, day);
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

// rows: array of objects from Papa Parse (header: true)
function loadCharges(rows) {
  const groups = new Map();
  const names = new Map();

  for (const row of rows) {
    const date = row["Posting Date"];
    let description = row["Description"].split(/\s+/).filter(Boolean).join(" ");
    description = description.replace(/ \d\d\/\d\d$/, "");
    description = description.replace(/^POS DEBIT /, "");
    const amount = parseFloat(row["Amount"]);

    if (amount >= 0) continue;

    const key = makeKey(description);
    if (!groups.has(key)) {
      groups.set(key, []);
      names.set(key, description);
    }
    groups.get(key).push([date, amount]);
  }

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
  module.exports = { makeKey, parseDate, daysBetween, loadCharges, findSubscriptions, monthlyTotal, formatDate };
}
