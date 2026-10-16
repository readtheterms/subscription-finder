// Detection logic for Subscription Finder. It started as a Python script, so the function names follow it (snake_case became camelCase).
// Dates are stored as UTC milliseconds so daylight saving never changes a day count.

// Payments to credit cards and loans, transfers and cash withdrawals repeat too, but they are not subscriptions.
const SKIP = ["discover", "capitalone", "chasecredit", "zelle", "onlinetransfer",
  "citipayment", "citibank", "wfcreditcard", "wellsfargo", "merrickbank", "fortiva", "avant",
  "recurringtransf", "transferto", "transferfrom", "atmwithdrawal", "atmcash"];
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

// month/day/year, for display
function formatDateUS(ms) {
  const [year, month, day] = formatDate(ms).split("-");
  return month + "/" + day + "/" + year;
}

// Known companies: if the description contains the left side (letters only,
// lowercase), show the right side. More specific entries go first.
const BRANDS = [
  ["amazonprime", "Amazon Prime"], ["amzn", "Amazon"], ["amazon", "Amazon"],
  ["spotify", "Spotify"], ["netflix", "Netflix"], ["hulu", "Hulu"],
  ["disneyplus", "Disney+"], ["disney", "Disney"], ["hbomax", "Max"],
  ["paramount", "Paramount+"], ["peacock", "Peacock"], ["crunchyroll", "Crunchyroll"],
  ["appletv", "Apple TV"], ["applemusic", "Apple Music"], ["icloud", "iCloud"],
  ["applecom", "Apple"], ["itunes", "Apple"], ["youtubepremium", "YouTube Premium"],
  ["youtube", "YouTube"], ["googleone", "Google One"], ["googlestorage", "Google One"],
  ["adobe", "Adobe"], ["microsoft", "Microsoft"], ["xbox", "Xbox"],
  ["playstation", "PlayStation"], ["nintendo", "Nintendo"], ["dropbox", "Dropbox"],
  ["openai", "OpenAI"], ["chatgpt", "ChatGPT"], ["anthropic", "Anthropic"],
  ["planetfitness", "Planet Fitness"], ["lafitness", "LA Fitness"],
  ["anytimefitness", "Anytime Fitness"], ["peloton", "Peloton"], ["audible", "Audible"],
  ["patreon", "Patreon"], ["duolingo", "Duolingo"], ["canva", "Canva"],
  ["github", "GitHub"], ["nytimes", "New York Times"], ["siriusxm", "SiriusXM"],
  ["tinder", "Tinder"], ["discord", "Discord"], ["doordash", "DoorDash"],
  ["uber", "Uber"], ["lyft", "Lyft"], ["instacart", "Instacart"],
  ["walmartplus", "Walmart+"], ["costco", "Costco"], ["chegg", "Chegg"],
  ["grammarly", "Grammarly"], ["linkedin", "LinkedIn"], ["tmobile", "T-Mobile"],
  ["verizon", "Verizon"], ["spectrum", "Spectrum"], ["frontiercommuni", "Frontier"],
  ["socaledison", "SoCal Edison"], ["primobrands", "Primo Brands"],
  ["agirenters", "Renters Insurance"],
  // banks, cards and bills that show up in checking accounts
  ["creditonebank", "Credit One Bank"], ["chasepayin", "Chase Pay in 4"],
  ["chasecreditcrd", "Chase Credit Card"], ["tochasecard", "Chase Card"],
  ["citiautopay", "Citi Card"], ["citicardonline", "Citi Card"],
  ["comncap", "Comenity Capital Bank"], ["applecash", "Apple Cash"], ["applecard", "Apple Card"],
  ["contfinance", "Continental Finance"], ["wellsfargocard", "Wells Fargo Card"],
  ["bestbuy", "Best Buy"], ["venmo", "Venmo"], ["aaainsurance", "AAA Insurance"],
  ["cityofredlands", "City of Redlands"], ["socalgas", "SoCal Gas"],
  ["ustorit", "U-Stor-It"], ["tricon", "Tricon"], ["readyrefresh", "ReadyRefresh"],
  // shops and apps
  ["hpinstantink", "HP Instant Ink"], ["eosfitness", "EOS Fitness"], ["tiktok", "TikTok"],
  ["temucom", "Temu"], ["walmart", "Walmart"], ["cvspharmacy", "CVS Pharmacy"],
  ["staterbros", "Stater Bros."], ["burgerking", "Burger King"], ["jackinthebox", "Jack in the Box"],
  ["walgreen", "Walgreens"], ["goodwill", "Goodwill"], ["stofcadmv", "California DMV"],
];

const NOISE = ["bill", "payment", "pmt", "ppd", "id", "inc", "llc", "recurring", "autopay",
  "purchase", "debit", "pos", "online", "www", "the", "club", "fees"];

// Services that sell one thing. Their charges are grouped by company name, since the text around the
// name changes from charge to charge. Big companies (Amazon, Apple, Google...) sell many things, so
// they are not here: grouping them would mix a subscription in with ordinary purchases.
const ONE_PRODUCT = new Set(["Netflix", "Spotify", "Hulu", "Disney+", "Max", "Paramount+", "Peacock",
  "Crunchyroll", "Spectrum", "Frontier", "SoCal Edison", "Primo Brands", "Renters Insurance",
  "Planet Fitness", "Peloton", "Audible", "Duolingo", "SiriusXM", "T-Mobile", "Verizon"]);

// the company name if the description mentions a known one, otherwise null
function brandFor(raw) {
  const letters = raw.toLowerCase().replace(/[^a-z]/g, "");
  for (const [needle, brand] of BRANDS) {
    if (letters.includes(needle)) return brand;
  }
  return companyFor(raw);
}

// The big-company list (companies.js) is matched word by word, not as loose text, so "ross" inside
// "crossroads" does not count. "Wal-Mart" becomes the words wal, mart and must appear in that order.
function words(text) {
  return text.toLowerCase().replace(/['’]/g, "").split(/[^a-z]+/).filter(Boolean);
}

const COMPANY_INDEX = new Map(); // first word -> companies starting with it
if (typeof COMPANIES !== "undefined") {
  for (const name of COMPANIES) {
    const w = words(name);
    if (!COMPANY_INDEX.has(w[0])) COMPANY_INDEX.set(w[0], []);
    COMPANY_INDEX.get(w[0]).push({ name, words: w });
  }
}

function companyFor(raw) {
  const d = words(raw);
  let best = null;
  for (let i = 0; i < d.length; i++) {
    // "WALGREENS" should find "Walgreen", so also try the word without a trailing s
    const candidates = (COMPANY_INDEX.get(d[i]) || []).concat(COMPANY_INDEX.get(d[i].replace(/s$/, "")) || []);
    for (const c of candidates) {
      const last = c.words.length - 1;
      const matches = c.words.every((w, j) => d[i + j] === w || (j === last && d[i + j] === w + "s"));
      if (matches && (!best || c.words.length > best.words.length)) best = c;
    }
    if (best) return best.name;
  }
  return null;
}

// "SPOTIFY USA 877-778-1161 NY" -> "Spotify"
function displayName(raw) {
  const brand = brandFor(raw);
  if (brand) return brand;

  // payment processors put the real merchant after a star: "PAYPAL *GAMESTORE"
  let s = raw.replace(/^paypal inst xfer\s+/i, "");
  s = s.replace(/^(paypal|pp|sq|tst|sp|py|dd)\s*\*\s*/i, "");
  s = s.split(/[*\/#]/)[0];
  s = s.replace(/\s+(WEB|PPD|CCD|TEL)\s+ID:?.*$/i, "");
  s = s.replace(/\.(com|net|org|co)\b.*$/i, "");
  s = s.replace(/([A-Za-z])\d+/g, "$1");
  s = s.replace(/\s+\d.*$/, "");

  let words = s.split(/\s+/).filter(Boolean);
  while (words.length > 1 && /^[A-Z]{2}$/.test(words[words.length - 1])) words.pop();
  const kept = words.filter((w) => !NOISE.includes(w.toLowerCase()));
  if (kept.length > 0) words = kept;

  return words
    .slice(0, 3)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
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

// rows: the objects for ONE file (from rowsFromArrays). Every file is read on its own, because
// two files can come from different banks with different column names and sign conventions.
// Returns [{date, description, amount}] with spending stored as negative amounts, like the Chase export.
function entriesFromRows(rows) {
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
  return entries;
}

// entries: the entries from every file added together. Cleans the descriptions and groups the
// purchases by merchant.
function groupCharges(entries) {
  const groups = new Map();
  const names = new Map();

  for (const { date, description: raw, amount } of entries) {
    let description = raw.split(/\s+/).filter(Boolean).join(" ");
    description = description.replace(/ \d\d\/\d\d$/, "");
    description = description.replace(/^POS DEBIT /, "");
    // some banks start every card line with the same words and put a date, location and card number around the merchant
    description = description.replace(/^(?:PURCHASE|RECURRING PAYMENT)(?: RETURN)? AUTHORIZED ON \d\d\/\d\d /i, "");
    description = description.replace(/ CARD \d{4}$/, "").replace(/ [SP]\d{9,}$/, "");

    if (amount >= 0) continue;

    // a one-product company is grouped by name, since its descriptions change from charge to charge
    const brand = brandFor(description);
    const key = ONE_PRODUCT.has(brand) ? "~" + brand.toLowerCase() : makeKey(description);
    if (!groups.has(key)) {
      groups.set(key, []);
      names.set(key, description);
    }
    groups.get(key).push([date, amount]);
  }

  if (groups.size === 0) throw new Error("No purchases found in that file.");
  return { groups, names };
}

// one file's rows straight to groups
function loadCharges(rows) {
  return groupCharges(entriesFromRows(rows));
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

      // sort by date, then by price, so the highest price on the last day is the one kept
      const pairs = part
        .map(([d, a]) => [parseDate(d), Math.abs(a)])
        .sort((x, y) => x[0] - y[0] || x[1] - y[1]);
      const [last, price] = pairs[pairs.length - 1];
      const daysSince = Math.round((latest - last) / MS_PER_DAY);
      const active = daysSince <= grace;

      found.push({
        name: names.get(key),
        displayName: displayName(names.get(key)),
        price,
        period,
        last,
        next: last + cycle * MS_PER_DAY,
        active,
        // the expected charge date passed (plus a few days of slack) and no new charge showed up
        overdue: active && daysSince > cycle + 3,
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

// Same rows as monthlyTotal (active only), but built as (monthly prices x 12) + yearly prices,
// so a yearly plan is added once at its real price instead of being divided by 12 and multiplied back.
function yearlyTotal(subscriptions) {
  let monthly = 0;
  let yearly = 0;
  for (const sub of subscriptions) {
    if (!sub.active) continue;
    if (sub.period === "yearly") yearly += sub.price;
    else monthly += sub.price;
  }
  return Math.round((monthly * 12 + yearly) * 100) / 100;
}

if (typeof module !== "undefined") {
  module.exports = { yearlyTotal, entriesFromRows, groupCharges, brandFor, displayName, formatDateUS, rowsFromArrays, makeKey, parseDate, daysBetween, loadCharges, findSubscriptions, monthlyTotal, formatDate };
}
