// Shared helpers for the tests. The page's scripts are plain browser scripts, so they are loaded the
// same way a browser loads them: companies.js first, then finder.js, into one shared context.
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const docs = path.join(__dirname, "..", "docs");

function loadFinder() {
  const context = vm.createContext({});
  for (const file of ["companies.js", "finder.js"]) {
    vm.runInContext(fs.readFileSync(path.join(docs, file), "utf8"), context, { filename: file });
  }
  return context;
}

// a small CSV reader (handles quoted fields), so the tests need no packages
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') {
        quoted = false;
      } else {
        field += c;
      }
    } else if (c === '"') {
      quoted = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((cell) => cell !== "")) rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }
  row.push(field);
  if (row.some((cell) => cell !== "")) rows.push(row);
  return rows;
}

const finder = loadFinder();

// Runs csv texts through the same steps the page uses and returns the subscriptions.
function analyze(csvTexts) {
  const perFile = csvTexts.map((text) => finder.entriesFromRows(finder.rowsFromArrays(parseCsv(text))));
  const { entries, duplicates } = finder.mergeEntries(perFile);
  const { groups, names } = finder.groupCharges(entries);
  const subscriptions = finder.findSubscriptions(groups, names);
  return { subscriptions, duplicates };
}

// One line per subscription, then the totals. Plain strings, so results compare exactly.
function report(csvTexts) {
  const { subscriptions } = analyze(csvTexts);
  const lines = subscriptions.map((s) =>
    [
      s.displayName,
      s.price.toFixed(2),
      s.period,
      s.active ? "next " + finder.formatDate(s.next) : "ended " + finder.formatDate(s.last),
    ].join(" | ")
  );
  lines.push(
    "monthly " + finder.monthlyTotal(subscriptions).toFixed(2) + " | yearly " + finder.yearlyTotal(subscriptions).toFixed(2)
  );
  return Array.from(lines); // a plain array, since the page's scripts run in their own context
}

const readDoc = (...parts) => fs.readFileSync(path.join(docs, ...parts), "utf8");

module.exports = { finder, parseCsv, analyze, report, readDoc, docs };
