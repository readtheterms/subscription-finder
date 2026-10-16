// The page tells users why it flagged something and which rows may be double counted.
const test = require("node:test");
const assert = require("node:assert/strict");
const { finder, analyze, readDoc } = require("./helpers");

test("payments toward a card or loan are recognized", () => {
  const cardPayments = [
    "CHASE CREDIT CRD AUTOPAY PPD ID: 9999999999",
    "CITI PAYMENT PAYMENT 261012 AYRES",
    "CITI AUTOPAY PAYMENT 292137481670104",
    "Credit One Bank Payment 21736895",
    "COMN CAP APY F1 AUTO PAY P26278096956599",
    "CONT FINANCE PAYBYPHONE 043000097843800",
    "CAPITAL ONE MOBILE PMT CA03EEFCC341395",
    "BEST BUY AUTO PYMT 722097685440748",
    "WF Credit Card AUTO PAY 261012",
    "Payment to Chase card ending in 0334",
    "APPLECARD GSBANK PAYMENT 60897442",
    "MERRICK BANK PHONE PMT 262520530430390",
    "DISCOVER E-PAYMENT 7233",
  ];
  for (const description of cardPayments) {
    assert.equal(finder.isCardPayment(description), true, description);
  }
});

test("ordinary charges and bills are not tagged as card payments", () => {
  const others = [
    "SPOTIFY USA 877-778-1161 NY",
    "NETFLIX.COM LOS GATOS CA",
    "AAA INSURANCE PAYMENT PPD ID: 1313338001",
    "SPECTRUM PAYMENT",
    "FRONTIER COMMUNI BILL PAY",
    "BEST BUY #123 PURCHASE",
    "CAPITAL ONE ARENA TICKETS",
    "CITIZENS ELECTRIC PAYMENT", // "citi" inside another word must not match
    "PURCHASE PAYMENT AT SHOP", // "chase" inside "purchase" must not match
    "CHASE ATM FEE",
  ];
  for (const description of others) {
    assert.equal(finder.isCardPayment(description), false, description);
  }
});

test("in the sample only the credit card autopay is tagged as a card payment", () => {
  const { subscriptions } = analyze([readDoc("sample_transactions.csv")]);
  const tagged = Array.from(subscriptions.filter((s) => s.cardPayment).map((s) => s.displayName));
  assert.deepEqual(tagged, ["Chase Credit Card"]);
});

test("each subscription carries the evidence behind it", () => {
  const { subscriptions } = analyze([readDoc("sample_transactions.csv")]);
  const spotify = subscriptions.find((s) => s.displayName === "Spotify");
  assert.ok(spotify.count >= 3, "a monthly subscription needs at least 3 charges");
  assert.ok(spotify.typicalGap >= 28 && spotify.typicalGap <= 32, "gap " + spotify.typicalGap);
  assert.equal(spotify.cycle, 30);

  const dropbox = subscriptions.find((s) => s.displayName === "Dropbox");
  assert.equal(dropbox.cycle, 365);
  assert.ok(dropbox.typicalGap >= 350 && dropbox.typicalGap <= 380, "gap " + dropbox.typicalGap);
});

test("evidence matches the charges that were found", () => {
  const body = [
    "Date,Description,Amount",
    "10/05/2026,STREAMBOX,-9.99",
    "09/05/2026,STREAMBOX,-9.99",
    "08/05/2026,STREAMBOX,-9.99",
    "07/06/2026,STREAMBOX,-9.99",
  ].join(String.fromCharCode(10));
  const { subscriptions } = analyze([body]);
  assert.equal(subscriptions[0].count, 4);
  assert.equal(subscriptions[0].typicalGap, 30); // gaps are 30, 31 and 30 days; the middle value is 30
});
