// Step 1 of the Card payments feature: the matcher. The fixture is a made-up Chase checking export. The
// expected numbers were worked out from the rows when the fixture was generated, not from the matcher.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { finder, parseCsv } = require("./helpers");

const TODAY = Date.UTC(2026, 9, 16); // 10/16/2026

function fixtureEntries() {
  const text = fs.readFileSync(path.join(__dirname, "fixtures", "card-payments-checking.csv"), "utf8");
  return finder.entriesFromRows(finder.rowsFromArrays(parseCsv(text)));
}

const entry = (date, description, amount) => ({ date, description, amount });

test("descriptions are cleaned before matching: spaces collapsed, uppercase", () => {
  assert.equal(finder.normalizeDescription("  credit  one   bank     payment\t 123 "), "CREDIT ONE BANK PAYMENT 123");
});

test("each card payment you described is recognized and labeled by issuer", () => {
  const cases = {
    "APPLECARD GSBANK PAYMENT    60897442        WEB ID: 9999999999": "Apple Card",
    "CHASE CREDIT CRD AUTOPAY                    PPD ID: 4760039224": "Chase",
    "PAYMENT TO CHASE CARD ENDING IN 9626 07/22": "Chase",
    "Credit One Bank  Payment    38315861        WEB ID: WEB000004": "Credit One",
    "CAPITAL ONE      CRCARDPMT        CA01CEC12EE5E49 WEB ID: 9541719318": "Capital One",
    "CITI AUTOPAY     PAYMENT    292140074640074 WEB ID: CITICARDAP": "Citi",
    "COMENITY APY F2  AUTO PAY   P26265093212626 WEB ID: 1133163498": "Comenity",
    "COMN CAP APY F1  AUTO PAY   P26278096956599 WEB ID: 1651180275": "Comenity",
  };
  for (const [description, issuer] of Object.entries(cases)) {
    assert.equal(finder.cardIssuerFor(description), issuer, description);
  }
});

test("the number in a Credit One description differs per card but it is the same issuer", () => {
  for (const number of ["38315861", "11111111", "99999999"]) {
    assert.equal(finder.cardIssuerFor("Credit One Bank  Payment    " + number + "        WEB ID: WEB000004"), "Credit One");
  }
});

test("payments that are not credit cards are never matched", () => {
  const notCards = [
    "ZELLE PAYMENT TO SAM 31173454891",
    "TOYOTA ACH RTL    WEB I3PD270XY2G1617 WEB ID: 4953775816",
    "PAYMENT TO CHASE PAY IN 4 (...0530) 09/29",
    "AUTOPAY TO CHASE PAY IN 4 (...7063) 09/23",
  ];
  for (const description of notCards) {
    assert.equal(finder.cardIssuerFor(description), null, description);
    assert.ok(finder.notCardLabel(description), description);
  }
});

test("Capital One MOBILE PMT is a one-off manual payment, so it is not counted by default", () => {
  assert.equal(finder.cardIssuerFor("CAPITAL ONE MOBILE PMT CA03EEFCC341395 WEB ID: 9279744380"), null);
});

test("ordinary purchases are not card payments", () => {
  for (const description of ["STATER BROS #112 REDLANDS CA", "SPOTIFY USA 877-778-1161 NY", "CITIZENS ELECTRIC PAYMENT", "PURCHASE PAYMENT AT SHOP"]) {
    assert.equal(finder.cardIssuerFor(description), null, description);
  }
});

test("on the made-up checking export the matcher finds exactly the card payments", () => {
  const { matched, leftOut, pending } = finder.matchCardPayments(fixtureEntries(), TODAY);
  assert.equal(matched.length, 102);

  const byIssuer = {};
  const total = {};
  for (const m of matched) {
    byIssuer[m.issuer] = (byIssuer[m.issuer] || 0) + 1;
    total[m.issuer] = Math.round(((total[m.issuer] || 0) + m.amount) * 100) / 100;
  }
  assert.deepEqual(JSON.parse(JSON.stringify(byIssuer)), { "Apple Card": 9, Chase: 19, "Credit One": 29, "Capital One": 18, Citi: 19, Comenity: 8 });
  assert.deepEqual(JSON.parse(JSON.stringify(total)), { "Apple Card": 498, Chase: 5870, "Credit One": 1065.7, "Capital One": 1962, Citi: 3770, Comenity: 292 });

  // several cards per issuer are all counted: Credit One has three cards, Chase two, Capital One two, Citi two
  const september = matched.filter((m) => m.date.startsWith("09/"));
  assert.equal(september.length, 10);
  assert.equal(september.filter((m) => m.issuer === "Credit One").length, 3);

  assert.deepEqual(JSON.parse(JSON.stringify(leftOut)), { "Pay in 4": 18, Toyota: 10, Zelle: 10 });
  assert.equal(pending, 2);
});

test("rows dated after today are ignored, even when they look like card payments", () => {
  const { matched, pending } = finder.matchCardPayments(fixtureEntries(), TODAY);
  assert.ok(matched.every((m) => m.ms <= TODAY));
  assert.ok(!matched.some((m) => m.date === "10/21/2026")); // the pending Citi autopay
  assert.equal(pending, 2);
});

test("a payment dated today counts, and one dated tomorrow does not", () => {
  const rows = [
    entry("10/16/2026", "CITI AUTOPAY PAYMENT 111 WEB ID: CITICARDAP", -50),
    entry("10/17/2026", "CITI AUTOPAY PAYMENT 222 WEB ID: CITICARDAP", -60),
  ];
  const { matched, pending } = finder.matchCardPayments(rows, TODAY);
  assert.equal(matched.length, 1);
  assert.equal(matched[0].amount, 50);
  assert.equal(pending, 1);
});

test("money coming in (a refund from the card company) is not a payment", () => {
  const { matched } = finder.matchCardPayments([entry("10/01/2026", "CHASE CREDIT CRD AUTOPAY PPD ID: 4760039224", 25)], TODAY);
  assert.equal(matched.length, 0);
});

test("results are listed newest first, with amounts as positive numbers", () => {
  const { matched } = finder.matchCardPayments(fixtureEntries(), TODAY);
  for (let i = 1; i < matched.length; i++) assert.ok(matched[i - 1].ms >= matched[i].ms);
  assert.ok(matched.every((m) => m.amount > 0));
  assert.equal(matched[0].date, "10/14/2026");
});

test("the CARD PAYMENT tag on the subscription list follows the same rules", () => {
  assert.equal(finder.isCardPayment("CAPITAL ONE CRCARDPMT CA01CEC12EE5E49 WEB ID: 9541719318"), true); // was missed before
  assert.equal(finder.isCardPayment("PAYMENT TO CHASE PAY IN 4 (...0530) 09/29"), false); // was tagged before
  assert.equal(finder.isCardPayment("TOYOTA ACH RTL WEB ID: 4953775816"), false);
});
