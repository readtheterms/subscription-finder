// Detection logic for Subscription Finder. It started as a Python script, so the function names follow it (snake_case became camelCase).
// Dates are stored as UTC milliseconds so daylight saving never changes a day count.

// Things that repeat but are money moving around, not a subscription: transfers, Zelle and ATM cash.
// Credit card and loan payments are NOT skipped. They stay in the list and the user can hide them.
// The words are matched against the start of a merchant key, which is only 15 letters long.
const SKIP = ["zelle", "onlinetransfer", "recurringtransf", "transferto", "transferfrom",
  "atmwithdrawal", "atmcash"];
const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Limits, so a huge or hostile file cannot freeze the page. Real bank exports are far below all of these.
const MAX_FILE_BYTES = 20 * 1024 * 1024; // 20 MB per file
const MAX_ROWS = 200000; // rows per file
const MAX_CELL = 500; // characters kept from any one cell

function checkFileSize(bytes) {
  if (bytes > MAX_FILE_BYTES) {
    throw new Error("That file is too large (over 20 MB). Export a shorter date range.");
  }
}

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
  if (data.length > MAX_ROWS + 1) throw new Error("That file has too many rows (over 200,000). Export a shorter date range.");

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
  // written so no part of the pattern can match the same digits two ways, which keeps it fast
  // even on a hostile cell (a nested pattern like [\d,]*\d+ gets very slow on a long run of digits)
  const isNumber = (text) => text.length <= MAX_CELL && /^\(?-?\$?(?:\d[\d,]*(?:\.\d*)?|\.\d+)\)?$/.test(text);

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
  // only a hint (Chase marks card and loan payments ACH_DEBIT or LOAN_PMT); nothing depends on it being there
  const type = findColumn(headers, ["type", "transaction type"], []);

  if (!date || !description || (!amount && !debit)) {
    throw new Error(
      "Could not find the columns. Need a date, a description and an amount (or debit) column. Found: " +
        headers.join(", ").slice(0, 200)
    );
  }
  return { date, description, amount, debit, type };
}

// "$1,234.50" -> 1234.5, "(12.00)" -> -12, "" -> NaN
function parseAmount(text) {
  if (text === undefined || text === null) return NaN;
  let t = String(text).trim().slice(0, MAX_CELL);
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
  if (rows.length > MAX_ROWS) throw new Error("That file has too many rows (over 200,000). Export a shorter date range.");

  const cols = detectColumns(Object.keys(rows[0]));

  // Turn every row into {date, description, amount}
  let entries = [];
  for (const row of rows) {
    const date = (row[cols.date] || "").trim();
    if (date.length > 40 || Number.isNaN(parseDate(date))) continue;

    let amount = cols.amount ? parseAmount(row[cols.amount]) : NaN;
    if (Number.isNaN(amount) && cols.debit) {
      const debit = parseAmount(row[cols.debit]);
      if (!Number.isNaN(debit) && debit !== 0) amount = -Math.abs(debit);
    }
    if (Number.isNaN(amount)) continue;

    entries.push({
      date,
      description: (row[cols.description] || "").slice(0, MAX_CELL),
      amount,
      type: cols.type ? String(row[cols.type] || "").slice(0, 40) : "",
    });
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

// perFile: one array of entries for each file. Two exports that cover the same dates contain the same
// transactions, which would be counted twice. A transaction is the same if its date, description and
// amount match. Two identical lines inside ONE file are real (two coffees on the same day), so they stay;
// across files only the larger count is kept. Returns the merged entries and how many were skipped.
function mergeEntries(perFile) {
  const kept = new Map(); // transaction key -> how many copies are already kept
  const merged = [];
  let duplicates = 0;

  for (const entries of perFile) {
    const before = new Map(kept); // what the earlier files already supplied
    const seenInThisFile = new Map();
    for (const entry of entries) {
      const key = entry.date + "|" + entry.description.split(/\s+/).filter(Boolean).join(" ") + "|" + entry.amount;
      const n = (seenInThisFile.get(key) || 0) + 1;
      seenInThisFile.set(key, n);
      if (n > (before.get(key) || 0)) {
        merged.push(entry);
        kept.set(key, n);
      } else {
        duplicates++;
      }
    }
  }
  return { entries: merged, duplicates };
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

// A payment toward a credit card or loan. These repeat every month and stay in the list, but the
// purchases behind them may already be counted from the card's own statement, so the page tags them.
// Matched on whole words, so "chase" does not match inside "purchase".
const PAYMENT_WORDS = /\b(payment|pymt|pmts?|autopay|auto pay|apy|repayment)\b/i;
// lenders and card issuers whose name alone means it is a payment toward them
const LENDER_NAMES = ["credit one", "comn cap", "comenity", "cont finance", "continental finance", "merrick",
  "fortiva", "avant", "applecard", "apple card", "wf credit card", "wells fargo card"];
// banks that also sell other things, so they only count when the description also says "payment"
const ISSUER_NAMES = ["citi", "chase", "discover", "capital one", "wells fargo", "best buy", "synchrony",
  "barclays", "amex", "american express"];

function isCardPayment(raw) {
  // the rules in cards.js come first: they know the payments that are NOT cards (Pay in 4, Toyota, Zelle)
  if (notCardLabel(raw)) return false;
  if (cardIssuerFor(raw)) return true;
  // other issuers: a lender name, or a bank name together with a payment word
  const padded = " " + words(raw).join(" ") + " ";
  const named = (list) => list.some((name) => padded.includes(" " + name + " "));
  if (named(LENDER_NAMES)) return true;
  return PAYMENT_WORDS.test(raw) && (named(ISSUER_NAMES) || /\bcard\b/i.test(raw));
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
        cycle,
        active,
        // the evidence behind the match, shown when hovering a row
        count: part.length,
        typicalGap: Math.round(median(daysBetween(part.map(([d]) => d)))),
        cardPayment: isCardPayment(names.get(key)),
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

// What canceling some subscriptions would save. `counted` is every row that counts toward the totals and
// `canceled` is the part of it the user picked. It reuses the receipt's own two totals, so the numbers
// always agree with the rest of the page: saved + kept adds back up to the full total.
function savingsFor(counted, canceled) {
  const kept = counted.filter((s) => !canceled.includes(s));
  return {
    perMonth: monthlyTotal(canceled),
    perYear: yearlyTotal(canceled),
    newMonthly: monthlyTotal(kept),
    newYearly: yearlyTotal(kept),
  };
}

if (typeof module !== "undefined") {
  module.exports = { mergeEntries, yearlyTotal, entriesFromRows, groupCharges, brandFor, displayName, formatDateUS, rowsFromArrays, makeKey, parseDate, daysBetween, loadCharges, findSubscriptions, monthlyTotal, formatDate };
}
