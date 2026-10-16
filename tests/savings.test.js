// "What if I cancel": the savings must always agree with the receipt's own totals.
const test = require("node:test");
const assert = require("node:assert/strict");
const { finder, analyze, readDoc } = require("./helpers");

function sample() {
  const { subscriptions } = analyze([readDoc("sample_transactions.csv")]);
  const active = Array.from(subscriptions.filter((s) => s.active));
  const named = (name) => active.find((s) => s.displayName === name);
  return { active, named };
}

const money = (n) => n.toFixed(2);

test("canceling a monthly plan and a yearly plan gives the expected savings", () => {
  const { active, named } = sample();
  const result = finder.savingsFor(active, [named("Spotify"), named("Dropbox")]);
  // Spotify is $11.99 a month. Dropbox is $119.88 a year, which is $9.99 a month.
  assert.equal(money(result.perMonth), "21.98");
  // per year: 11.99 x 12 for the monthly plan, plus the yearly plan once at its real price
  assert.equal(money(result.perYear), "263.76");
  assert.equal(money(result.newMonthly), "182.23");
  assert.equal(money(result.newYearly), "2186.75");
});

test("what you save plus what you keep adds back up to the full totals", () => {
  const { active, named } = sample();
  const picks = [[named("Netflix")], [named("Apple"), named("Gamestore")], active];
  for (const picked of picks) {
    const result = finder.savingsFor(active, picked);
    assert.ok(Math.abs(result.perMonth + result.newMonthly - finder.monthlyTotal(active)) < 0.011);
    assert.ok(Math.abs(result.perYear + result.newYearly - finder.yearlyTotal(active)) < 0.011);
  }
});

test("canceling nothing saves nothing", () => {
  const { active } = sample();
  const result = finder.savingsFor(active, []);
  assert.equal(result.perMonth, 0);
  assert.equal(result.perYear, 0);
  assert.equal(result.newMonthly, finder.monthlyTotal(active));
});

test("canceling everything leaves nothing", () => {
  const { active } = sample();
  const result = finder.savingsFor(active, active);
  assert.equal(result.newMonthly, 0);
  assert.equal(result.newYearly, 0);
  assert.equal(result.perMonth, finder.monthlyTotal(active));
});

test("a hidden row is not counted, so the page only offers savings on rows that count", () => {
  // the page passes only the rows that count toward the totals (not hidden ones)
  const { active, named } = sample();
  const counted = active.filter((s) => s !== named("Chase Credit Card"));
  const result = finder.savingsFor(counted, [named("Netflix")]);
  assert.equal(money(result.newMonthly), money(finder.monthlyTotal(counted) - 17.99));
});
