// Step 3 of the Card payments feature: the setup checklist. Payees are the same company paid again and again;
// the user can tick which ones are credit cards, and those choices win over the built-in rules.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { finder, parseCsv } = require("./helpers");

const TODAY = Date.UTC(2026, 9, 16); // 10/16/2026
const plain = (value) => JSON.parse(JSON.stringify(value));

function fixtureEntries() {
  const text = fs.readFileSync(path.join(__dirname, "fixtures", "card-payments-checking.csv"), "utf8");
  return finder.entriesFromRows(finder.rowsFromArrays(parseCsv(text)));
}

const entry = (date, description, amount, type) => ({ date, description, amount, type: type || "" });
const payees = (entries, choices) => plain(finder.findPayees(entries, TODAY, choices));

// ---- payee labels ----

test("reference numbers and bank codes are dropped from a payee label", () => {
  const cases = {
    "CREDIT ONE BANK PAYMENT 38315861 WEB ID: WEB000004": "CREDIT ONE BANK PAYMENT",
    "CAPITAL ONE CRCARDPMT CA01CEC12EE5E49 WEB ID: 9541719318": "CAPITAL ONE CRCARDPMT",
    "CHASE CREDIT CRD AUTOPAY PPD ID: 4760039224": "CHASE CREDIT CRD AUTOPAY",
    "CITI AUTOPAY PAYMENT 292140074640074 WEB ID: CITICARDAP": "CITI AUTOPAY PAYMENT",
    "COMENITY APY F2 AUTO PAY P26265093212626 WEB ID: 1133163498": "COMENITY APY",
    "PAYMENT TO CHASE PAY IN 4 (...0530) 09/29": "PAYMENT TO CHASE PAY IN",
    "STATER BROS #112 REDLANDS CA": "STATER BROS",
    "POS DEBIT TOKYO RESTAURANT REDLANDS CA 3102": "TOKYO RESTAURANT REDLANDS CA",
  };
  for (const [description, label] of Object.entries(cases)) {
    assert.equal(finder.payeeLabel(description), label, description);
  }
});

test("padding and letter case do not change a label", () => {
  assert.equal(finder.payeeLabel("Credit One Bank    Payment    5550001        WEB ID: WEB000004"), "CREDIT ONE BANK PAYMENT");
});

test("every Credit One card is one payee even though each description carries a different number", () => {
  const labels = new Set(["38315861", "11111111", "5550002"].map((n) => finder.payeeLabel("Credit One Bank Payment " + n + " WEB ID: WEB000004")));
  assert.equal(labels.size, 1);
});

test("a description that starts with a number still gets a label", () => {
  assert.equal(finder.payeeLabel("7-ELEVEN 12345"), "ELEVEN");
  assert.equal(finder.payeeLabel("123456"), "OTHER");
});

test("an issuer name is made readable for a payee that has no rule", () => {
  assert.equal(finder.issuerNameFor("TOYOTA ACH RTL"), "Toyota");
  assert.equal(finder.issuerNameFor("CAPITAL ONE MOBILE PMT"), "Capital One");
  assert.equal(finder.issuerNameFor("PAYMENT TO CHASE PAY IN"), "Chase Pay in 4");
});

// ---- the list of payees ----

test("the made-up checking export lists its recurring payees, with the built-in matches ticked", () => {
  const list = payees(fixtureEntries());
  const ticked = list.filter((p) => p.checked).map((p) => p.label).sort();
  assert.deepEqual(ticked, [
    "APPLECARD GSBANK PAYMENT", "CAPITAL ONE CRCARDPMT", "CHASE CREDIT CRD AUTOPAY", "CITI AUTOPAY PAYMENT",
    "COMENITY APY", "CREDIT ONE BANK PAYMENT", "PAYMENT TO CHASE CARD ENDING",
  ]);
  assert.ok(list.filter((p) => p.checked).every((p) => p.defaultOn));
});

test("payments that are not cards are listed but not ticked, so the user can see why they are left out", () => {
  const list = payees(fixtureEntries());
  for (const label of ["TOYOTA ACH RTL", "AUTOPAY TO CHASE PAY IN", "PAYMENT TO CHASE PAY IN"]) {
    const found = list.find((p) => p.label === label);
    assert.ok(found, label + " should be listed");
    assert.equal(found.checked, false, label);
    assert.equal(found.likely, true, label);
  }
});

test("Zelle and transfers are never listed", () => {
  const list = payees(fixtureEntries());
  assert.ok(!list.some((p) => /ZELLE|TRANSFER/.test(p.label)));
});

test("a one-off payment is not listed, but a recurring shop is, behind the likely ones", () => {
  const list = payees(fixtureEntries());
  assert.ok(!list.some((p) => p.label === "CAPITAL ONE MOBILE PMT")); // paid in one month only
  const shop = list.find((p) => p.label === "STATER BROS");
  assert.ok(shop);
  assert.equal(shop.likely, false);
  assert.ok(list.indexOf(shop) > list.findIndex((p) => p.label === "TOYOTA ACH RTL"));
});

test("a payee needs two different months to be listed, unless a built-in rule recognizes it", () => {
  const rows = [
    entry("09/05/2026", "SOME GYM CLUB PAYMENT 111 WEB ID: 1", -20), // one month only: not listed
    entry("08/05/2026", "OTHER LOAN PAYMENT 111 WEB ID: 1", -50),
    entry("09/05/2026", "OTHER LOAN PAYMENT 111 WEB ID: 1", -50), // two months: listed
    entry("09/10/2026", "CITI AUTOPAY PAYMENT 111 WEB ID: CITICARDAP", -80), // one month, but a built-in match: listed
  ];
  assert.deepEqual(plain(finder.findPayees(rows, TODAY).map((p) => p.label)).sort(), ["CITI AUTOPAY PAYMENT", "OTHER LOAN PAYMENT"]);
});

test("a payee in two payments of the same month still counts as one month", () => {
  const rows = [entry("09/05/2026", "ODD LENDER PAYMENT 1 WEB ID: 1", -50), entry("09/20/2026", "ODD LENDER PAYMENT 2 WEB ID: 2", -50)];
  assert.equal(finder.findPayees(rows, TODAY).length, 0);
});

test("a payee that does not look like a payment is found through the bank's type column", () => {
  const rows = [entry("08/05/2026", "FRIENDLY FINANCE", -50, "LOAN_PMT"), entry("09/05/2026", "FRIENDLY FINANCE", -50, "LOAN_PMT")];
  assert.equal(finder.findPayees(rows, TODAY)[0].likely, true);
  const plainRows = rows.map((r) => ({ ...r, type: "DEBIT_CARD" }));
  assert.equal(finder.findPayees(plainRows, TODAY)[0].likely, false);
});

test("each listed payee says how many payments, how many months, and the usual amount", () => {
  const credit = payees(fixtureEntries()).find((p) => p.label === "CREDIT ONE BANK PAYMENT");
  assert.equal(credit.count, 29);
  assert.equal(credit.months, 10);
  assert.ok(credit.typical > 30 && credit.typical < 60);
  assert.equal(credit.issuer, "Credit One");
});

test("rows dated after today are not counted toward a payee", () => {
  const citi = payees(fixtureEntries()).find((p) => p.label === "CITI AUTOPAY PAYMENT");
  assert.equal(citi.count, 19); // the pending 10/21 row is not one of them
});

test("the Type column is carried through to each row as a hint", () => {
  const types = new Set(fixtureEntries().map((e) => e.type));
  assert.ok(types.has("ACH_DEBIT") && types.has("LOAN_PMT"));
});

// ---- the user's choices ----

test("ticking a payee that is not a card counts its payments, labeled with a readable name", () => {
  const choices = new Map([["TOYOTA ACH RTL", true]]);
  const { matched, leftOut } = finder.matchCardPayments(fixtureEntries(), TODAY, choices);
  assert.equal(matched.length, 102 + 10);
  assert.equal(matched.filter((m) => m.issuer === "Toyota").length, 10);
  assert.equal(leftOut.Toyota, undefined); // it is no longer left out
  assert.equal(plain(leftOut)["Pay in 4"], 18); // the others still are
});

test("ticking a payee changes the monthly totals", () => {
  const entries = fixtureEntries();
  const before = finder.groupByMonth(finder.matchCardPayments(entries, TODAY), TODAY).find((b) => b.key === "2026-09");
  const choices = new Map([["TOYOTA ACH RTL", true]]);
  const after = finder.groupByMonth(finder.matchCardPayments(entries, TODAY, choices), TODAY).find((b) => b.key === "2026-09");
  assert.equal(after.total, Math.round((before.total + 420) * 100) / 100);
  assert.equal(after.count, before.count + 1);
});

test("unticking a built-in payee stops counting it", () => {
  const choices = new Map([["CREDIT ONE BANK PAYMENT", false]]);
  const { matched, leftOut } = finder.matchCardPayments(fixtureEntries(), TODAY, choices);
  assert.equal(matched.length, 102 - 29);
  assert.ok(!matched.some((m) => m.issuer === "Credit One"));
  assert.equal(Object.keys(plain(leftOut)).includes("Credit One"), false); // the user's own choice is not "left out on purpose"
});

test("the checklist and the totals agree about what is ticked", () => {
  const entries = fixtureEntries();
  const choices = new Map([["TOYOTA ACH RTL", true], ["CITI AUTOPAY PAYMENT", false]]);
  const tickedPayments = finder.findPayees(entries, TODAY, choices).filter((p) => p.checked).reduce((sum, p) => sum + p.count, 0);
  assert.equal(finder.matchCardPayments(entries, TODAY, choices).matched.length, tickedPayments);
});

test("with no choices the result is exactly what the built-in rules found", () => {
  const entries = fixtureEntries();
  const none = finder.matchCardPayments(entries, TODAY);
  const empty = finder.matchCardPayments(entries, TODAY, new Map());
  assert.equal(none.matched.length, 102);
  assert.deepEqual(plain(empty.matched), plain(none.matched));
});

test("choices only affect the payee they name", () => {
  const entries = fixtureEntries();
  const choices = new Map([["STATER BROS", true]]);
  const { matched } = finder.matchCardPayments(entries, TODAY, choices);
  assert.equal(matched.filter((m) => m.issuer === "Stater Bros.").length, 10);
  assert.equal(matched.length, 112);
});
