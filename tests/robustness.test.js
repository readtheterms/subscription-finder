// A user can pick any file, including a huge or deliberately nasty one. The page must not freeze
// or crash on it. These tests use inputs a hostile file could contain.
const test = require("node:test");
const assert = require("node:assert/strict");
const { finder } = require("./helpers");

function seconds(fn) {
  const start = Date.now();
  try {
    fn();
  } catch (err) {
    // an error is fine here; what matters is how long it took
  }
  return (Date.now() - start) / 1000;
}

test("a long run of digits in a headerless file does not make the page hang", () => {
  // this used to take time proportional to the square of the length (200,000 digits = many seconds)
  const rows = [["10/13/2026", "-5.00", "COFFEE"], ["10/12/2026", "1".repeat(200000) + "x", "TEA"]];
  assert.ok(seconds(() => finder.rowsFromArrays(rows)) < 1.5);
});

test("number-looking cells are still recognized", () => {
  const rows = ["1,234.50", "(12.00)", "-$5", "$5", ".5", "12"].map((amount, i) => [
    "10/" + String(10 + i) + "/2026",
    amount,
    "SHOP " + i,
  ]);
  const result = finder.rowsFromArrays(rows);
  assert.equal(result.length, 6);
  assert.equal(result[0].Amount, "1,234.50");
});

test("number-looking check rejects text", () => {
  const rows = [["10/13/2026", "abc", "COFFEE"], ["10/12/2026", "12x", "TEA"]];
  assert.throws(() => finder.rowsFromArrays(rows), /Could not tell which columns/);
});

test("a huge description is cut short", () => {
  const entries = finder.entriesFromRows([{ Date: "10/13/2026", Description: "A".repeat(100000), Amount: "-5.00" }]);
  assert.equal(entries[0].description.length, 500);
});

test("a huge date cell is ignored instead of parsed", () => {
  const entries = finder.entriesFromRows([
    { Date: "10/13/2026" + " ".repeat(10) + "9".repeat(100000), Description: "X", Amount: "-5.00" },
    { Date: "10/13/2026", Description: "Y", Amount: "-5.00" },
  ]);
  assert.equal(entries.length, 1);
});

test("a file with too many rows is refused", () => {
  const rows = Array.from({ length: 200001 }, () => ({ Date: "10/13/2026", Description: "X", Amount: "-1.00" }));
  assert.throws(() => finder.entriesFromRows(rows), /too many rows/);
  const arrays = [["Date", "Description", "Amount"], ...Array.from({ length: 200001 }, () => ["10/13/2026", "X", "-1.00"])];
  assert.throws(() => finder.rowsFromArrays(arrays), /too many rows/);
});

test("a file over 20 MB is refused before it is read", () => {
  assert.doesNotThrow(() => finder.checkFileSize(20 * 1024 * 1024));
  assert.throws(() => finder.checkFileSize(20 * 1024 * 1024 + 1), /too large/);
});

test("a large file of normal rows is processed quickly", () => {
  const rows = [];
  for (let i = 0; i < 100000; i++) {
    rows.push({ Date: "10/" + String(1 + (i % 28)).padStart(2, "0") + "/2026", Description: "SHOP " + (i % 500), Amount: "-" + (1 + (i % 97)) + ".00" });
  }
  assert.ok(
    seconds(() => {
      const { entries } = finder.mergeEntries([finder.entriesFromRows(rows)]);
      const { groups, names } = finder.groupCharges(entries);
      finder.findSubscriptions(groups, names);
    }) < 5
  );
});

test("column names like __proto__ or constructor cannot change how the page works", () => {
  const rows = [
    ["Date", "Description", "Amount", "__proto__", "constructor", "polluted"],
    ["10/13/2026", "SHOP", "-5.00", "x", "y", "z"],
    ["09/13/2026", "SHOP", "-5.00", "x", "y", "z"],
    ["08/13/2026", "SHOP", "-5.00", "x", "y", "z"],
  ];
  const entries = finder.entriesFromRows(finder.rowsFromArrays(rows));
  assert.equal(entries.length, 3);
  assert.equal(({}).polluted, undefined);
  assert.equal(Object.getPrototypeOf({}), Object.prototype);
});

test("an error message built from a hostile header row stays short", () => {
  const hostile = [["<img src=x onerror=alert(1)>".repeat(100), "b"], ["1", "2"]];
  try {
    finder.entriesFromRows(finder.rowsFromArrays(hostile));
    assert.fail("expected an error");
  } catch (err) {
    assert.ok(err.message.length < 400, "message length " + err.message.length);
  }
});
