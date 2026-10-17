// Step 4 of the Card payments feature: the count check. The user says how many card payments to expect each month;
// months with fewer get flagged, naming the issuers that paid less than usual.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { finder, parseCsv } = require("./helpers");

const TODAY = Date.UTC(2026, 9, 16); // 10/16/2026
const plain = (value) => JSON.parse(JSON.stringify(value));

function fixtureBlocks() {
  const text = fs.readFileSync(path.join(__dirname, "fixtures", "card-payments-checking.csv"), "utf8");
  const entries = finder.entriesFromRows(finder.rowsFromArrays(parseCsv(text)));
  return finder.groupByMonth(finder.matchCardPayments(entries, TODAY), TODAY);
}

// a month block with just what the check looks at (newest first when put in a list)
function month(key, issuers, complete = true) {
  const byIssuer = Object.entries(issuers).map(([issuer, count]) => ({ issuer, count, total: count * 100 }));
  return { key, name: key, complete, count: byIssuer.reduce((sum, i) => sum + i.count, 0), byIssuer };
}

const checksFor = (blocks, expected) => plain([...finder.checkMonths(blocks, expected)]);

// ---- the expected number ----

test("the expected number must be a whole number from 1 to 99, anything else means no check", () => {
  assert.equal(finder.parseExpectedCount("10"), 10);
  assert.equal(finder.parseExpectedCount(" 7 "), 7);
  assert.equal(finder.parseExpectedCount("1"), 1);
  assert.equal(finder.parseExpectedCount("99"), 99);
  assert.equal(finder.parseExpectedCount("05"), 5);
  for (const bad of ["", "   ", "0", "00", "-3", "100", "999", "1000000", "abc", "1.5x", "10 payments", "1e1", null, undefined]) {
    assert.equal(finder.parseExpectedCount(bad), null, String(bad));
  }
});

test("the box only accepts up to two digits, so a number above 99 can never be entered", () => {
  for (const fine of ["", "0", "1", "9", "10", "42", "99", "05", "00"]) assert.equal(finder.acceptsExpectedInput(fine), true, JSON.stringify(fine));
  for (const refused of ["100", "123", "999", "1000000", "a", "1a", "-1", "1.5", "1e1", " 1", "1 ", "+5", "10 payments"]) {
    assert.equal(finder.acceptsExpectedInput(refused), false, JSON.stringify(refused));
  }
});

test("the only entries that can get in but are not a good number say so", () => {
  for (const bad of ["0", "00"]) assert.equal(finder.expectedCountProblem(bad), "Number must be between 1-99", bad);
});

test("an empty box or a good number is not a problem", () => {
  for (const fine of ["", "   ", "1", "10", "99"]) assert.equal(finder.expectedCountProblem(fine), "", JSON.stringify(fine));
});

test("the page box refuses input before it appears, and shows the message in red", () => {
  const dir = path.join(__dirname, "..", "docs");
  const html = fs.readFileSync(path.join(dir, "index.html"), "utf8");
  const code = fs.readFileSync(path.join(dir, "app.js"), "utf8");
  const css = fs.readFileSync(path.join(dir, "style.css"), "utf8");
  assert.match(html, /id="cards-expected"[^>]*inputmode="numeric"/);
  assert.ok(!/id="cards-expected"[^>]*type="number"/.test(html), "a number box would let a third digit appear");
  assert.ok(code.includes('addEventListener("beforeinput"'));
  assert.ok(code.includes("event.preventDefault()"));
  assert.match(css, /\.check-status\.error\s*\{[^}]*#b00020/);
});

test("with no expected number nothing is flagged", () => {
  assert.equal(finder.checkMonths(fixtureBlocks(), null).size, 0);
});

// ---- the made-up checking export: Apple Card does not pay in September ----

test("September is flagged, and Apple Card is named as the missing issuer", () => {
  const checks = finder.checkMonths(fixtureBlocks(), 11);
  const september = checks.get("2026-09");
  assert.equal(september.expected, 11);
  assert.equal(september.count, 10);
  assert.equal(september.earlierMonths, 3);
  assert.deepEqual(plain(september.missing), [{ issuer: "Apple Card", count: 0, usual: 1 }]);
});

test("only the months that really have fewer than expected are flagged", () => {
  // counts are Jan 10, Feb 10, Mar to Aug 11, Sep 10; October is still in progress
  const flagged = [...finder.checkMonths(fixtureBlocks(), 11).keys()].sort();
  assert.deepEqual(flagged, ["2026-01", "2026-02", "2026-09"]);
});

test("the month in progress is never flagged, even though it has far fewer payments", () => {
  const checks = finder.checkMonths(fixtureBlocks(), 11);
  assert.equal(checks.has("2026-10"), false);
});

test("a month with no earlier complete month to compare says so, with nobody named", () => {
  const january = finder.checkMonths(fixtureBlocks(), 11).get("2026-01");
  assert.equal(january.earlierMonths, 0);
  assert.deepEqual(plain(january.missing), []);
});

test("a month that has fewer payments but no issuer short is flagged without naming anyone", () => {
  // February matches January issuer for issuer; the shortfall against the expected 11 is not any one issuer
  const february = finder.checkMonths(fixtureBlocks(), 11).get("2026-02");
  assert.equal(february.earlierMonths, 1);
  assert.deepEqual(plain(february.missing), []);
});

test("an expected number the data already meets flags nothing", () => {
  assert.equal(finder.checkMonths(fixtureBlocks(), 10).size, 0);
});

test("the suggested number is what the last full months usually have", () => {
  // Jul 11, Aug 11, Sep 10: the middle value is 11
  assert.equal(finder.usualCount(fixtureBlocks()), 11);
  assert.equal(finder.usualCount([]), null);
  assert.equal(finder.usualCount([month("2026-10", { Citi: 2 }, false)]), null); // only a partial month
});

// ---- comparing with earlier months ----

test("the biggest shortfall is listed first", () => {
  const blocks = [
    month("2026-02", { Citi: 0, Chase: 1 }),
    month("2026-01", { Citi: 3, Chase: 2 }),
  ];
  assert.deepEqual(plain(finder.checkMonths(blocks, 9).get("2026-02").missing), [
    { issuer: "Citi", count: 0, usual: 3 },
    { issuer: "Chase", count: 1, usual: 2 },
  ]);
});

test("an issuer is flagged only when it paid fewer times than its usual number", () => {
  const blocks = [
    month("2026-04", { Citi: 1, Chase: 2, "Credit One": 2 }), // this month: Credit One paid 2 of its usual 3, Citi 1 of 2
    month("2026-03", { Citi: 2, Chase: 2, "Credit One": 3 }),
    month("2026-02", { Citi: 2, Chase: 2, "Credit One": 3 }),
    month("2026-01", { Citi: 2, Chase: 2, "Credit One": 3 }),
  ];
  const april = finder.checkMonths(blocks, 8).get("2026-04");
  // both are one payment short, so they are listed alphabetically
  assert.deepEqual(plain(april.missing), [
    { issuer: "Citi", count: 1, usual: 2 },
    { issuer: "Credit One", count: 2, usual: 3 },
  ]);
  // Chase paid its usual two, so it is not named
  assert.ok(!april.missing.some((m) => m.issuer === "Chase"));
});

test("one odd earlier month does not change what is usual", () => {
  // Citi paid 2, 2, then once: the usual is still 2
  const blocks = [
    month("2026-04", { Citi: 1 }),
    month("2026-03", { Citi: 1 }),
    month("2026-02", { Citi: 2 }),
    month("2026-01", { Citi: 2 }),
  ];
  const april = finder.checkMonths(blocks, 2).get("2026-04");
  assert.deepEqual(plain(april.missing), [{ issuer: "Citi", count: 1, usual: 2 }]);
});

test("with two earlier months and a split between them, the lower number is used so there is no false alarm", () => {
  const blocks = [month("2026-03", { Citi: 1 }), month("2026-02", { Citi: 2 }), month("2026-01", { Citi: 1 })];
  // earlier for March are Feb and Jan: counts 2 and 1, middle 1.5 rounds down to 1, and March has 1, so Citi is not short
  const march = finder.checkMonths(blocks, 3).get("2026-03");
  assert.deepEqual(plain(march.missing), []);
});

test("an issuer that was not paying in the earlier months is not expected now", () => {
  const blocks = [month("2026-03", { Citi: 2 }), month("2026-02", { Citi: 2, Chase: 0 }), month("2026-01", { Citi: 2 })];
  const march = finder.checkMonths(blocks, 3).get("2026-03");
  assert.deepEqual(plain(march.missing), []);
});

test("only the three most recent earlier complete months are compared", () => {
  const blocks = [
    month("2026-05", { Citi: 1 }),
    month("2026-04", { Citi: 1 }),
    month("2026-03", { Citi: 1 }),
    month("2026-02", { Citi: 1 }),
    month("2026-01", { Citi: 5 }), // too old to count
  ];
  const may = finder.checkMonths(blocks, 2).get("2026-05");
  assert.equal(may.earlierMonths, 3);
  assert.deepEqual(plain(may.missing), []);
});

test("a partial month earlier on is skipped when comparing", () => {
  const blocks = [
    month("2026-03", { Citi: 1 }),
    month("2026-02", { Citi: 0 }, false), // a partial month: not used
    month("2026-01", { Citi: 2 }),
  ];
  const march = finder.checkMonths(blocks, 2).get("2026-03");
  assert.equal(march.earlierMonths, 1);
  assert.deepEqual(plain(march.missing), [{ issuer: "Citi", count: 1, usual: 2 }]);
});

test("checking does not change the blocks it is given", () => {
  const blocks = fixtureBlocks();
  const before = JSON.stringify(blocks);
  finder.checkMonths(blocks, 11);
  assert.equal(JSON.stringify(blocks), before);
});
