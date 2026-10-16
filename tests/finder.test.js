const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { finder, analyze, report, readDoc, docs } = require("./helpers");

// What the made-up sample should produce. Every bank layout in docs/samples holds the same
// transactions, so every one of them must produce exactly this.
const EXPECTED = [
  "Spotify | 11.99 | monthly | next 2026-11-12",
  "Netflix | 17.99 | monthly | next 2026-11-04",
  "Apple | 2.99 | monthly | next 2026-10-21",
  "Chase Credit Card | 150.00 | monthly | next 2026-10-15",
  "Planet Fitness | 24.99 | monthly | ended 2026-06-02",
  "Dropbox | 119.88 | yearly | next 2027-08-14",
  "Gamestore | 134.99 | yearly | next 2027-09-03",
  "monthly 204.21 | yearly 2450.51",
];

// a monthly subscription: three charges 30 days apart ending on `last` (MM/DD/YYYY strings)
const charges = (name, amount, dates) => dates.map((d) => `${d},${name},${amount}`).join("\n");
const csv = (body, header = "Date,Description,Amount") => header + "\n" + body + "\n";

test("the sample file finds the expected subscriptions and totals", () => {
  assert.deepEqual(report([readDoc("sample_transactions.csv")]), EXPECTED);
});

const layouts = fs.readdirSync(path.join(docs, "samples")).filter((f) => f.endsWith(".csv"));
test("there are sample layouts to check", () => {
  assert.ok(layouts.length >= 6, "expected the bank-style layouts in docs/samples");
});
for (const file of layouts) {
  test(`bank layout ${file} gives the same result as the sample`, () => {
    assert.deepEqual(report([readDoc("samples", file)]), EXPECTED);
  });
}

test("a file with no subscription columns is rejected with a clear message", () => {
  assert.throws(() => analyze(["foo,bar\n1,2\n"]), /Could not find the columns/);
});

test("an empty file is rejected", () => {
  assert.throws(() => analyze([""]), /no rows/);
});

// ---- several files ----

test("the same file added twice counts every transaction once", () => {
  const sample = readDoc("sample_transactions.csv");
  const twice = analyze([sample, sample]);
  assert.deepEqual(report([sample, sample]), EXPECTED);
  assert.ok(twice.duplicates > 0);
});

test("two files from different banks are combined", () => {
  const gym = csv(charges("CITY GYM MEMBERSHIP", "-30.00", ["10/03/2026", "09/03/2026", "08/03/2026", "07/03/2026"]));
  const lines = report([readDoc("sample_transactions.csv"), gym]);
  assert.ok(lines.includes("City Gym Membership | 30.00 | monthly | next 2026-11-02"));
  assert.equal(lines.at(-1), "monthly 234.21 | yearly 2810.51");
});

test("each file decides for itself whether purchases are positive or negative", () => {
  // a card that lists purchases as positive numbers, next to the normal sample
  const card = csv(charges("ACME STREAMING SERVICE", "15.00", ["10/09/2026", "09/09/2026", "08/09/2026", "07/09/2026"]), "Transaction Date,Memo,Amount");
  const lines = report([readDoc("sample_transactions.csv"), card]);
  assert.ok(lines.some((l) => l.startsWith("Acme Streaming Service | 15.00 | monthly")));
});

test("overlapping exports do not double count and do not hide a subscription", () => {
  const march = ["03/05/2026", "04/05/2026", "05/05/2026", "06/05/2026"];
  const first = csv(charges("STREAMBOX", "-9.99", march.slice(0, 3)));
  const second = csv(charges("STREAMBOX", "-9.99", march.slice(1))); // shares April and May with the first
  const { subscriptions, duplicates } = analyze([first, second]);
  assert.equal(duplicates, 2);
  assert.equal(subscriptions.length, 1);
  assert.equal(subscriptions[0].displayName, "Streambox");
  // without the fix, April and May would appear on the same day twice and the gaps would break
});

test("two identical charges on one day inside a single file both count", () => {
  const body = ["10/01/2026,COFFEE SHOP,-4.00", "10/01/2026,COFFEE SHOP,-4.00"].join("\n");
  const { entries } = finder.mergeEntries([finder.entriesFromRows(finder.rowsFromArrays(require("./helpers").parseCsv(csv(body))))]);
  assert.equal(entries.length, 2);
});

// ---- detection rules ----

test("a monthly charge needs at least three charges", () => {
  const two = csv(charges("TWO TIMES", "-5.00", ["10/05/2026", "09/05/2026"]));
  assert.equal(analyze([two]).subscriptions.length, 0);
});

test("charges that are not about a month apart are not a subscription", () => {
  const random = csv(charges("RANDOM SHOP", "-5.00", ["10/20/2026", "10/02/2026", "09/25/2026", "07/01/2026"]));
  assert.equal(analyze([random]).subscriptions.length, 0);
});

test("a skipped month is allowed", () => {
  const skipped = csv(charges("GAP SERVICE", "-8.00", ["10/05/2026", "09/05/2026", "08/05/2026", "07/05/2026", "06/05/2026", "05/05/2026", "04/05/2026", "03/05/2026", "02/05/2026", "01/05/2026", "11/05/2025"]));
  // 11/05 to 01/05 is a 61 day gap: one skipped month out of ten gaps, within the 20% allowance
  assert.equal(analyze([skipped]).subscriptions.length, 1);
});

test("a yearly charge needs two charges about a year apart", () => {
  const yearly = csv(charges("ANNUAL PLAN", "-60.00", ["06/01/2026", "06/01/2025"]) + "\n" + charges("OTHER", "-1.00", ["10/01/2026"]));
  const { subscriptions } = analyze([yearly]);
  const plan = subscriptions.find((s) => s.displayName === "Annual Plan");
  assert.equal(plan.period, "yearly");
});

test("a subscription whose last charge is old is listed as ended", () => {
  const body = charges("OLD GYM", "-10.00", ["04/01/2026", "03/01/2026", "02/01/2026", "01/01/2026"]) + "\n10/01/2026,SOMETHING ELSE,-3.00";
  const { subscriptions } = analyze([csv(body)]);
  assert.equal(subscriptions.find((s) => s.displayName === "Old Gym").active, false);
});

test("a charge that did not arrive on time is marked overdue", () => {
  const body =
    charges("LATE GYM", "-10.00", ["08/10/2026", "07/10/2026", "06/10/2026"]) + "\n" + // next expected 09/09
    charges("ON TIME", "-5.00", ["09/17/2026", "08/18/2026", "07/19/2026"]); // newest date is 09/17, 38 days after the last LATE GYM charge
  const { subscriptions } = analyze([csv(body)]);
  assert.equal(subscriptions.find((s) => s.displayName === "Late Gym").overdue, true);
  assert.equal(subscriptions.find((s) => s.displayName === "On Time").overdue, false);
});

test("transfers, Zelle and ATM withdrawals are left out", () => {
  const body = [
    charges("ONLINE TRANSFER TO SAVINGS", "-25.00", ["10/02/2026", "09/02/2026", "08/02/2026"]),
    charges("ZELLE PAYMENT TO SAM", "-20.00", ["10/03/2026", "09/03/2026", "08/03/2026"]),
    charges("ATM WITHDRAWAL 220 MAIN ST", "-100.00", ["10/04/2026", "09/04/2026", "08/04/2026"]),
  ].join("\n");
  assert.equal(analyze([csv(body)]).subscriptions.length, 0);
});

test("credit card and loan payments are kept, so the user can hide them", () => {
  const body = [
    charges("CITI PAYMENT", "-50.00", ["10/01/2026", "09/01/2026", "08/01/2026"]),
    charges("PAYMENT TO CHASE CARD ENDING IN 0334", "-75.00", ["10/05/2026", "09/05/2026", "08/05/2026"]),
  ].join("\n");
  const names = Array.from(analyze([csv(body)]).subscriptions.map((s) => s.displayName + " " + s.price));
  assert.deepEqual(names, ["Citi 50", "Chase Card 75"]);
});

test("deposits are ignored", () => {
  const body = charges("STREAMBOX", "-9.99", ["10/01/2026", "09/01/2026", "08/01/2026"]) + "\n" +
    charges("PAYROLL", "1500.00", ["10/02/2026", "09/02/2026", "08/02/2026"]);
  const names = analyze([csv(body)]).subscriptions.map((s) => s.displayName);
  assert.deepEqual(Array.from(names), ["Streambox"]);
});

test("a file where every amount is positive is read as a card that lists purchases as positive", () => {
  const body = charges("STREAMBOX", "9.99", ["10/01/2026", "09/01/2026", "08/01/2026"]);
  assert.equal(analyze([csv(body)]).subscriptions.length, 1);
});

// ---- totals ----

test("the yearly total is monthly prices times 12 plus yearly prices", () => {
  const subs = [
    { active: true, price: 10, period: "monthly" },
    { active: true, price: 120, period: "yearly" },
    { active: false, price: 99, period: "monthly" }, // ended rows never count
  ];
  assert.equal(finder.monthlyTotal(subs), 20);
  assert.equal(finder.yearlyTotal(subs), 240);
});

// ---- reading files ----

test("dates are read in several formats", () => {
  const same = Date.UTC(2026, 9, 13);
  for (const text of ["10/13/2026", "10/13/26", "10-13-2026", "2026-10-13"]) {
    assert.equal(finder.parseDate(text), same, text);
  }
  assert.ok(Number.isNaN(finder.parseDate("not a date")));
});

test("amounts are read with symbols, commas and brackets", () => {
  assert.equal(finder.parseAmount("$1,234.50"), 1234.5);
  assert.equal(finder.parseAmount("-11.99"), -11.99);
  assert.equal(finder.parseAmount("(12.00)"), -12);
  assert.ok(Number.isNaN(finder.parseAmount("")));
});

test("a file without a header row is understood", () => {
  const body = [
    "10/13/2026,-11.99,*,,SPOTIFY USA 877-778-1161 NY",
    "09/13/2026,-11.99,*,,SPOTIFY USA 877-778-1161 NY",
    "08/13/2026,-11.99,*,,SPOTIFY USA 877-778-1161 NY",
  ].join("\n");
  const { subscriptions } = analyze([body + "\n"]);
  assert.equal(subscriptions[0].displayName, "Spotify");
});

test("a separate Debit column works", () => {
  const body = ["10/05/2026,SOME GYM,12.00,", "09/05/2026,SOME GYM,12.00,", "08/05/2026,SOME GYM,12.00,", "10/06/2026,PAYCHECK,,900.00"].join("\n");
  const { subscriptions } = analyze([csv(body, "Date,Description,Debit,Credit")]);
  assert.equal(subscriptions.length, 1);
  assert.equal(subscriptions[0].price, 12);
});

// ---- names ----

test("descriptions become company names", () => {
  const cases = {
    "SPOTIFY USA 877-778-1161 NY": "Spotify",
    "NETFLIX.COM LOS GATOS CA": "Netflix",
    "APPLE.COM/BILL ONE APPLE PARK": "Apple",
    "GOOGLE *YouTube TV g.co/helppay CA": "YouTube",
    "PAYPAL *GAMESTORE 555-555-0100": "Gamestore",
    "PAYPAL INST XFER NETGEAR INC WEB ID: P123": "Netgear",
    "WALGREENS #1234 REDLANDS CA": "Walgreens",
    "MCDONALD'S F4756 REDLANDS CA": "McDonald's",
    "TARGET T-1869 REDLANDS CA": "Target",
  };
  for (const [raw, expected] of Object.entries(cases)) {
    assert.equal(finder.displayName(raw), expected, raw);
  }
});

test("a company name inside another word is not matched", () => {
  assert.equal(finder.brandFor("CROSSROADS DINER"), null);
  assert.equal(finder.brandFor("SYSTEMUSA INC"), null);
});

test("known services are grouped by name even when the description changes", () => {
  const body = [
    "09/23/2026,NETFLIX.COM Los Gatos CA,-19.99",
    "08/24/2026,Netflix.com netflix.com CA,-19.99",
    "07/24/2026,Netflix.com 408-5403700 CA,-19.99",
    "06/24/2026,Netflix.com 408-5403700 CA,-19.99",
  ].join("\n");
  const { subscriptions } = analyze([csv(body)]);
  assert.equal(subscriptions.length, 1);
  assert.equal(subscriptions[0].displayName, "Netflix");
});

test("bank boilerplate around the merchant is removed", () => {
  const body = [
    "09/10/2026,RECURRING PAYMENT AUTHORIZED ON 09/09 Spotify USA 877-7781161 NY S306253194248614 CARD 6907,-12.99",
    "08/10/2026,RECURRING PAYMENT AUTHORIZED ON 08/09 Spotify USA 877-7781161 NY S306222194242322 CARD 6907,-12.99",
    "07/10/2026,RECURRING PAYMENT AUTHORIZED ON 07/09 Spotify USA 877-7781161 NY S466191194255448 CARD 6907,-12.99",
    "09/08/2026,RECURRING PAYMENT AUTHORIZED ON 09/05 Spectrum 855-707-7328 MO S306248585896982 CARD 6907,-35.00",
    "08/07/2026,RECURRING PAYMENT AUTHORIZED ON 08/06 Spectrum 855-707-7328 MO S306218553879278 CARD 6907,-35.00",
    "07/08/2026,RECURRING PAYMENT AUTHORIZED ON 07/06 Spectrum 855-707-7328 MO S346187821908171 CARD 6907,-35.00",
  ].join("\n");
  const names = Array.from(analyze([csv(body)]).subscriptions.map((s) => s.displayName + " " + s.price));
  assert.deepEqual(names, ["Spotify 12.99", "Spectrum 35"]);
});
