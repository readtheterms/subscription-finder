// Step 2 of the Card payments feature: one block per month, with totals and a recent-months average.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { finder, parseCsv } = require("./helpers");

const TODAY = Date.UTC(2026, 9, 16); // 10/16/2026
const MIDDLE_DOT = String.fromCharCode(0xb7);

const plain = (value) => JSON.parse(JSON.stringify(value)); // a copy that compares equal across the vm boundary
const entry = (date, description, amount) => ({ date, description, amount });
const citi = (date, amount) => entry(date, "CITI AUTOPAY PAYMENT 111 WEB ID: CITICARDAP", -amount);
const other = (date) => entry(date, "STATER BROS #112 REDLANDS CA", -10); // an ordinary row that still shows what the file covers

function blocksFor(entries, today = TODAY) {
  return finder.groupByMonth(finder.matchCardPayments(entries, today), today);
}

function fixtureEntries() {
  const text = fs.readFileSync(path.join(__dirname, "fixtures", "card-payments-checking.csv"), "utf8");
  return finder.entriesFromRows(finder.rowsFromArrays(parseCsv(text)));
}

test("month names read the way people say them", () => {
  assert.equal(finder.monthName("2026-10"), "October 2026");
  assert.equal(finder.monthName("2025-01"), "January 2025");
});

test("the made-up checking export splits into one block per month, newest first", () => {
  const blocks = blocksFor(fixtureEntries());
  assert.deepEqual(plain(blocks.map((b) => b.name)), [
    "October 2026", "September 2026", "August 2026", "July 2026", "June 2026",
    "May 2026", "April 2026", "March 2026", "February 2026", "January 2026",
  ]);
});

test("each month's count and total match the independent count from the fixture", () => {
  // worked out from the rows when the fixture was generated, not from the matcher
  const expected = {
    "2026-01": [10, 1314.3], "2026-02": [10, 1336.3], "2026-03": [11, 1391.3], "2026-04": [11, 1414.3],
    "2026-05": [11, 1437.3], "2026-06": [11, 1460.3], "2026-07": [11, 1483.3], "2026-08": [11, 1506.3],
    "2026-09": [10, 1462.3], "2026-10": [6, 652],
  };
  for (const block of blocksFor(fixtureEntries())) {
    assert.deepEqual([block.count, block.total], expected[block.key], block.key);
  }
});

test("the monthly totals add up to the total of every matched payment", () => {
  const entries = fixtureEntries();
  const result = finder.matchCardPayments(entries, TODAY);
  const everything = result.matched.reduce((sum, p) => sum + p.amount, 0);
  const byMonth = finder.groupByMonth(result, TODAY).reduce((sum, b) => sum + b.total, 0);
  assert.ok(Math.abs(everything - byMonth) < 0.005);
});

test("a month shows each issuer with its count and total, biggest first", () => {
  const september = blocksFor(fixtureEntries()).find((b) => b.key === "2026-09");
  assert.deepEqual(plain(september.byIssuer.map((i) => [i.issuer, i.count])), [
    ["Chase", 2], ["Citi", 2], ["Capital One", 2], ["Credit One", 3], ["Comenity", 1],
  ]);
  // Apple Card did not pay in September, so it is simply absent
  assert.ok(!september.byIssuer.some((i) => i.issuer === "Apple Card"));
});

test("payments inside a month are listed newest first", () => {
  for (const block of blocksFor(fixtureEntries())) {
    for (let i = 1; i < block.payments.length; i++) assert.ok(block.payments[i - 1].ms >= block.payments[i].ms);
  }
});

test("the current month is marked as still in progress", () => {
  const [october] = blocksFor(fixtureEntries());
  assert.equal(october.note, "so far");
  assert.equal(october.complete, false);
});

test("earlier months are complete", () => {
  const blocks = blocksFor(fixtureEntries());
  assert.ok(blocks.slice(1).every((b) => b.complete && b.note === ""));
});

test("a month with no card payments still gets a block, so a gap is visible", () => {
  const blocks = blocksFor([citi("01/10/2026", 50), other("01/01/2026"), other("02/15/2026"), citi("03/10/2026", 60), other("03/31/2026")]);
  assert.deepEqual(plain(blocks.map((b) => [b.name, b.count, b.total])), [
    ["March 2026", 1, 60], ["February 2026", 0, 0], ["January 2026", 1, 50],
  ]);
  assert.equal(blocks[1].complete, true);
});

test("months across a new year are in the right order", () => {
  const blocks = blocksFor([other("12/01/2025"), citi("12/20/2025", 40), citi("01/05/2026", 41), other("01/31/2026")]);
  assert.deepEqual(plain(blocks.map((b) => b.name)), ["January 2026", "December 2025"]);
});

test("a file that starts in the middle of a month says so", () => {
  const blocks = blocksFor([other("10/17/2024"), citi("10/20/2024", 30), other("11/30/2024")]);
  const october = blocks[blocks.length - 1];
  assert.equal(october.note, "file starts 10/17/2024");
  assert.equal(october.complete, false);
});

test("a file that starts a day or two into a month still counts that month as whole", () => {
  const blocks = blocksFor([other("10/02/2024"), citi("10/20/2024", 30), other("11/30/2024")]);
  assert.equal(blocks[blocks.length - 1].complete, true);
});

test("a file that stops well before a month's end says so", () => {
  const blocks = blocksFor([other("08/01/2026"), citi("09/10/2026", 30), other("09/20/2026")]);
  assert.equal(blocks[0].note, "file ends 09/20/2026");
  assert.equal(blocks[0].complete, false);
});

test("a file that stops on the last days of a month is treated as covering it", () => {
  const blocks = blocksFor([other("08/01/2026"), citi("09/10/2026", 30), other("09/29/2026")]);
  assert.equal(blocks[0].complete, true);
});

test("rows dated after today do not stretch the period the file covers", () => {
  // the 10/21 row is pending, so the file only covers up to 10/10
  const blocks = blocksFor([other("09/01/2026"), citi("10/10/2026", 30), other("10/21/2026")]);
  assert.equal(blocks[0].name, "October 2026");
  assert.equal(blocks[0].note, "so far");
  assert.equal(blocks[0].count, 1);
});

test("several cards from one issuer in a month are added together", () => {
  const blocks = blocksFor([other("09/01/2026"), citi("09/05/2026", 10.1), citi("09/12/2026", 20.2), citi("09/21/2026", 30.3), other("09/30/2026")]);
  assert.equal(blocks[0].count, 3);
  assert.equal(blocks[0].total, 60.6);
  assert.deepEqual(plain(blocks[0].byIssuer), [{ issuer: "Citi", count: 3, total: 60.6 }]);
});

test("a file with no dated rows has no months", () => {
  assert.deepEqual(plain(blocksFor([])), []);
});

test("the average covers the last three complete months, and skips the month in progress", () => {
  const average = finder.recentAverage(blocksFor(fixtureEntries()), 3);
  // July 1483.3, August 1506.3, September 1462.3 (October is partial, so it is left out)
  assert.equal(average.months, 3);
  assert.equal(average.average, 1483.97);
  assert.equal(average.from, "July 2026");
  assert.equal(average.to, "September 2026");
});

test("with only two complete months the average uses those two and says how many", () => {
  const blocks = blocksFor([other("07/01/2026"), citi("07/10/2026", 100), citi("08/10/2026", 200), other("08/31/2026"), citi("09/10/2026", 999), other("09/16/2026")]);
  // September is only partly covered here (the file stops on 09/16)
  const average = finder.recentAverage(blocks, 3);
  assert.equal(average.months, 2);
  assert.equal(average.average, 150);
});

test("a half month never counts toward the average", () => {
  const blocks = blocksFor([other("10/17/2024"), citi("10/20/2024", 500), other("11/01/2024"), citi("11/10/2024", 100), other("11/30/2024")]);
  const average = finder.recentAverage(blocks, 3);
  assert.equal(average.months, 1);
  assert.equal(average.average, 100);
});

test("with no complete month there is no average", () => {
  assert.equal(finder.recentAverage(blocksFor([other("10/05/2026"), citi("10/10/2026", 50)]), 3), null);
});

test("the note separator is a middle dot", () => {
  const blocks = blocksFor([other("10/17/2026")].concat([]), Date.UTC(2026, 9, 20));
  assert.ok(blocks[0].note.includes("so far"));
  const both = blocksFor([other("10/17/2026"), citi("10/18/2026", 5)], Date.UTC(2026, 9, 20))[0];
  assert.ok(both.note.includes(MIDDLE_DOT), both.note);
});
