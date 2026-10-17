// Card payments: finds the payments someone makes toward their credit cards in a checking account CSV.
// Pure logic with no page code, like finder.js. It uses parseDate and formatDateUS from finder.js, which is loaded with it.

// Each rule names an issuer and the phrases that identify its payments. Descriptions are compared after
// collapsing spaces and uppercasing. `any` is a list of alternatives, and each alternative is a list of
// phrases that must ALL appear, so ["COMENITY", "AUTO PAY"] needs both words.
// Only the autopay line of Capital One is listed. Its "MOBILE PMT" lines are one-off manual payments on
// scattered days in odd amounts, not the regular payment, so they are left out by default.
const CARD_RULES = [
  { issuer: "Apple Card", any: [["APPLECARD GSBANK PAYMENT"]] },
  { issuer: "Chase", any: [["CHASE CREDIT CRD AUTOPAY"], ["PAYMENT TO CHASE CARD ENDING IN"]] },
  { issuer: "Credit One", any: [["CREDIT ONE BANK PAYMENT"]] },
  { issuer: "Capital One", any: [["CAPITAL ONE CRCARDPMT"]] },
  { issuer: "Citi", any: [["CITI AUTOPAY PAYMENT"], ["CITI CARD ONLINE PAYMENT"], ["CITI PAYMENT"]] },
  { issuer: "Comenity", any: [["COMENITY", "AUTO PAY"], ["COMN CAP", "AUTO PAY"]] },
];

// Payments that look similar but are not credit cards. These are checked first and always win.
const NOT_CARDS = [
  { label: "Pay in 4", any: [["PAY IN 4"]] }, // buy now, pay later
  { label: "Toyota", any: [["TOYOTA"]] }, // car loan
  { label: "Zelle", any: [["ZELLE"]] },
];

// Descriptions are padded with long runs of spaces, so collapse them and uppercase before matching.
function normalizeDescription(raw) {
  return String(raw).split(/\s+/).filter(Boolean).join(" ").toUpperCase();
}

function matchesAny(description, any) {
  return any.some((phrases) => phrases.every((phrase) => description.includes(phrase)));
}

// the reason a payment is deliberately left out ("Zelle"), or null
function notCardLabel(raw) {
  const description = normalizeDescription(raw);
  const rule = NOT_CARDS.find((r) => matchesAny(description, r.any));
  return rule ? rule.label : null;
}

// which card issuer a payment is for ("Citi"), or null if it is not a card payment
function cardIssuerFor(raw) {
  const description = normalizeDescription(raw);
  if (NOT_CARDS.some((r) => matchesAny(description, r.any))) return null;
  const rule = CARD_RULES.find((r) => matchesAny(description, r.any));
  return rule ? rule.issuer : null;
}

// today's calendar day (local time) as UTC milliseconds, the same units the dates in this app use
function localToday() {
  const now = new Date();
  return Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
}

// ---- payees: the same company paid again and again, however the bank words each line ----

// Words where the reference numbers and bank codes start. A label stops at the first word with a digit in it
// or at one of these, so "CREDIT ONE BANK PAYMENT 38315861 WEB ID: WEB000004" becomes "CREDIT ONE BANK PAYMENT"
// and every Credit One card ends up under one payee even though each description carries a different number.
const LABEL_STOPS = new Set(["WEB", "PPD", "CCD", "TEL", "ID", "ID:"]);
const LABEL_MAX_WORDS = 5;

function payeeLabel(raw) {
  const words = normalizeDescription(raw).replace(/^POS DEBIT /, "").split(" ");
  const kept = [];
  for (const word of words) {
    if (/\d/.test(word) || LABEL_STOPS.has(word)) break;
    kept.push(word);
    if (kept.length === LABEL_MAX_WORDS) break;
  }
  if (kept.length > 0) return kept.join(" ");
  // it starts with a number or a code: fall back to whatever letters there are
  const letters = words.map((w) => w.replace(/[^A-Z]/g, "")).filter(Boolean).slice(0, 3);
  return letters.join(" ") || "OTHER";
}

// Words that describe how a payment was made, not who it went to.
const FILLER_WORDS = new Set(["ACH", "RTL", "WEB", "PPD", "CCD", "TEL", "PMT", "PMTS", "PYMT", "AUTOPAY", "APY"]);

// A readable issuer name for a payee that has no built-in rule ("TOYOTA ACH RTL" -> "Toyota").
function issuerNameFor(label) {
  const name = displayName(label);
  const words = name.split(" ").filter((w) => !FILLER_WORDS.has(w.toUpperCase()));
  return words.join(" ") || name || label;
}

// Signs that a line is a payment rather than a purchase: payment words, or the codes banks put on pulled payments.
const PAYMENT_LOOK = /\b(PAYMENT|PAYMENTS|PYMT|PMT|PMTS|AUTOPAY|AUTO PAY|APY|REPAYMENT|BILL PAY)\b|\b(WEB|PPD|CCD|TEL) ID\b/;
const PAYMENT_TYPES = /ACH|LOAN|PAYMENT|BILL/;

// The payees in a file that the user might mark as credit cards: every payee that was paid in at least two
// different months, plus any payee the built-in rules recognize even if it only shows up once. Zelle, transfers
// and ATM cash are never listed. `choices` is a Map of payee label -> true/false for what the user decided.
// Each entry says whether it is checked: the user's choice if there is one, otherwise whether a built-in rule matches.
function findPayees(entries, today, choices) {
  const picks = choices || new Map();
  const groups = new Map();

  for (const entry of entries) {
    if (!(entry.amount < 0)) continue;
    const ms = parseDate(entry.date);
    if (Number.isNaN(ms) || ms > today) continue;
    const label = payeeLabel(entry.description);
    let group = groups.get(label);
    if (!group) {
      group = { label, sample: normalizeDescription(entry.description), count: 0, months: new Set(), amounts: [], types: new Set(), rule: null };
      groups.set(label, group);
    }
    group.count++;
    group.months.add(monthKey(ms));
    group.amounts.push(-entry.amount);
    if (entry.type) group.types.add(String(entry.type).toUpperCase());
    const issuer = cardIssuerFor(entry.description);
    if (issuer) group.rule = issuer;
  }

  const payees = [];
  for (const group of groups.values()) {
    if (isSkipped(makeKey(group.sample))) continue;
    const defaultOn = group.rule !== null;
    if (group.months.size < 2 && !defaultOn) continue;
    const likely = defaultOn || PAYMENT_LOOK.test(group.sample) || [...group.types].some((t) => PAYMENT_TYPES.test(t));
    payees.push({
      label: group.label,
      count: group.count,
      months: group.months.size,
      typical: round2(median(group.amounts)),
      defaultOn,
      checked: picks.has(group.label) ? picks.get(group.label) : defaultOn,
      issuer: group.rule || issuerNameFor(group.label),
      likely,
    });
  }
  payees.sort((a, b) => Number(b.likely) - Number(a.likely) || b.months - a.months || b.count - a.count || a.label.localeCompare(b.label));
  return payees;
}

// entries: [{date, description, amount}] with spending negative (from entriesFromRows).
// `today` is passed in so tests do not depend on the real date.
// `choices` is an optional Map of payee label -> true/false. A payee the user has decided on follows that choice;
// every other payee is counted only if a built-in rule recognizes it.
// Returns the card payments (newest first); how many outgoing rows were ignored for being dated after today
// (pending); how many rows were left out on purpose, by reason; and the period the file covers
// (its first and last dated row, up to today), which says which months are complete.
function matchCardPayments(entries, today, choices) {
  const picks = choices || new Map();
  const matched = [];
  const leftOut = {};
  let pending = 0;
  let start = Infinity;
  let end = -Infinity;

  for (const entry of entries) {
    const ms = parseDate(entry.date);
    if (Number.isNaN(ms)) continue;
    if (ms > today) {
      if (entry.amount < 0) pending++;
      continue;
    }
    // every row up to today shows what period the file covers, whatever kind of row it is
    start = Math.min(start, ms);
    end = Math.max(end, ms);

    if (!(entry.amount < 0)) continue; // only money going out

    const label = payeeLabel(entry.description);
    const rule = cardIssuerFor(entry.description); // null when no rule matches, or when the payment is on the not-a-card list
    const counted = picks.has(label) ? picks.get(label) : rule !== null;
    if (!counted) {
      // the user's own choice is not a "left out on purpose" case, only the built-in exclusions are
      const reason = picks.has(label) ? null : notCardLabel(entry.description);
      if (reason) leftOut[reason] = (leftOut[reason] || 0) + 1;
      continue;
    }
    matched.push({
      date: entry.date,
      ms,
      issuer: rule || issuerNameFor(label),
      amount: -entry.amount,
      description: normalizeDescription(entry.description),
    });
  }

  matched.sort((a, b) => b.ms - a.ms || a.issuer.localeCompare(b.issuer) || b.amount - a.amount);
  const coverage = start === Infinity ? null : { start, end };
  return { matched, pending, leftOut, coverage };
}

// ---- months ----

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September",
  "October", "November", "December"];

// A file that starts a few days into a month, or stops a few days short of its end, is probably still a
// whole month (nothing happened on the 1st). More than this many days off and the month is called partial.
const MONTH_SLACK_DAYS = 3;

const round2 = (n) => Math.round(n * 100) / 100;

function monthKey(ms) {
  const d = new Date(ms);
  return d.getUTCFullYear() + "-" + String(d.getUTCMonth() + 1).padStart(2, "0");
}

// "2026-09" -> "September 2026"
function monthName(key) {
  const [year, month] = key.split("-");
  return MONTH_NAMES[Number(month) - 1] + " " + year;
}

function daysInMonth(year, monthIndex) {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

// Splits the card payments into one block per calendar month, newest first. Every month between the first and
// last date in the file gets a block, even one with no card payments, so a missing month is visible instead of
// silently skipped. Each block says if the file does not cover the whole month.
function groupByMonth(result, today) {
  const { matched, coverage } = result;
  if (!coverage) return [];

  const byKey = new Map();
  for (const payment of matched) {
    const key = monthKey(payment.ms);
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(payment);
  }

  const first = new Date(coverage.start);
  const last = new Date(coverage.end);
  const firstKey = monthKey(coverage.start);
  const lastKey = monthKey(coverage.end);
  const todayKey = monthKey(today);

  const blocks = [];
  let year = first.getUTCFullYear();
  let month = first.getUTCMonth();
  while (year < last.getUTCFullYear() || (year === last.getUTCFullYear() && month <= last.getUTCMonth())) {
    const key = year + "-" + String(month + 1).padStart(2, "0");
    const payments = byKey.get(key) || []; // already newest first

    const notes = [];
    if (key === firstKey && first.getUTCDate() > MONTH_SLACK_DAYS) notes.push("file starts " + formatDateUS(coverage.start));
    if (key === lastKey) {
      if (key === todayKey) notes.push("so far");
      else if (last.getUTCDate() < daysInMonth(year, month) - MONTH_SLACK_DAYS) notes.push("file ends " + formatDateUS(coverage.end));
    }

    const perIssuer = new Map();
    for (const p of payments) {
      const entry = perIssuer.get(p.issuer) || { issuer: p.issuer, count: 0, total: 0 };
      entry.count++;
      entry.total += p.amount;
      perIssuer.set(p.issuer, entry);
    }
    const byIssuer = [...perIssuer.values()]
      .map((e) => ({ issuer: e.issuer, count: e.count, total: round2(e.total) }))
      .sort((a, b) => b.total - a.total || a.issuer.localeCompare(b.issuer));

    blocks.push({
      key,
      name: monthName(key),
      count: payments.length,
      total: round2(payments.reduce((sum, p) => sum + p.amount, 0)),
      byIssuer,
      payments,
      note: notes.join(" \u00b7 "),
      complete: notes.length === 0,
    });

    month++;
    if (month === 12) {
      month = 0;
      year++;
    }
  }
  return blocks.reverse();
}

// The average monthly total over the most recent complete months, up to `size` of them. A month the file only
// partly covers is left out, so a half month never drags the average down. With fewer than `size` complete months
// it averages the ones there are (the result says how many), and with none it returns null.
function recentAverage(blocks, size) {
  const full = blocks.filter((b) => b.complete).slice(0, size);
  if (full.length === 0) return null;
  const total = full.reduce((sum, b) => sum + b.total, 0);
  return {
    months: full.length,
    average: round2(total / full.length),
    from: full[full.length - 1].name,
    to: full[0].name,
  };
}

// ---- the count check ----
// The user says how many card payments to expect each month. A month with fewer gets flagged, and the page says
// which issuers paid less than they usually do, judged against the few complete months just before it.

// how many earlier complete months a month is compared with
const COMPARE_MONTHS = 3;

// The most card payments a month the user can ask to expect. The box takes two digits at most.
const MAX_EXPECTED_PAYMENTS = 99;
const EXPECTED_COUNT_MESSAGE = "Number must be between 1-" + MAX_EXPECTED_PAYMENTS;

// What the box lets the user type: up to two digits and nothing else. Anything that would break that (a third digit,
// a letter, a sign, a pasted sentence) is refused as it is typed, so a number above 99 can never be entered.
function acceptsExpectedInput(text) {
  return /^\d{0,2}$/.test(String(text));
}

// "10" -> 10. Anything that is not a whole number from 1 to MAX_EXPECTED_PAYMENTS means "no check" (null).
function parseExpectedCount(text) {
  const trimmed = String(text).trim();
  if (!/^\d{1,2}$/.test(trimmed)) return null; // digits only, so "1.5x" or "10 payments" are rejected, not half-read
  const n = Number(trimmed);
  return n >= 1 && n <= MAX_EXPECTED_PAYMENTS ? n : null;
}

// What to tell the user about what is in the box ("" when it is empty or a good number). Only "0" or "00" can still
// get in that is not a good number, since the box refuses everything else.
function expectedCountProblem(text) {
  const trimmed = String(text).trim();
  if (trimmed === "" || parseExpectedCount(trimmed) !== null) return "";
  return EXPECTED_COUNT_MESSAGE;
}

// How many payments a month usually has: the middle value of the last few complete months. Offered as a suggestion.
function usualCount(blocks) {
  const full = blocks.filter((b) => b.complete).slice(0, COMPARE_MONTHS);
  if (full.length === 0) return null;
  return Math.round(median(full.map((b) => b.count)));
}

function issuerCount(block, issuer) {
  const found = block.byIssuer.find((i) => i.issuer === issuer);
  return found ? found.count : 0;
}

// The issuers that paid fewer times in `block` than their usual number in the `earlier` months. "Usual" is the
// middle value, rounded down, so one odd month does not set off a false alarm. An issuer that did not pay in the
// earlier months is not expected now.
function missingIssuers(block, earlier) {
  const issuers = new Set();
  for (const month of earlier) for (const entry of month.byIssuer) issuers.add(entry.issuer);

  const missing = [];
  for (const issuer of issuers) {
    const usual = Math.floor(median(earlier.map((month) => issuerCount(month, issuer))));
    const count = issuerCount(block, issuer);
    if (count < usual) missing.push({ issuer, count, usual });
  }
  return missing.sort((a, b) => b.usual - b.count - (a.usual - a.count) || a.issuer.localeCompare(b.issuer));
}

// Returns a Map from month key ("2026-09") to a warning, for the complete months that have fewer payments than
// expected. A month the file only partly covers is never flagged, since it is not finished. With no expected
// number there is nothing to check and the Map is empty. `blocks` is newest first, as groupByMonth returns it.
function checkMonths(blocks, expected) {
  const checks = new Map();
  if (!(expected >= 1)) return checks;

  blocks.forEach((block, index) => {
    if (!block.complete || block.count >= expected) return;
    const earlier = blocks.slice(index + 1).filter((b) => b.complete).slice(0, COMPARE_MONTHS);
    checks.set(block.key, {
      expected,
      count: block.count,
      earlierMonths: earlier.length,
      missing: missingIssuers(block, earlier),
    });
  });
  return checks;
}
