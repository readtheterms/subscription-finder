const input = document.getElementById("csv-input");
const message = document.getElementById("message");
const results = document.getElementById("results");
const activeBody = document.getElementById("active-body");
const endedBody = document.getElementById("ended-body");
const endedSummary = document.getElementById("ended-summary");
const totalEl = document.getElementById("total");
const fileNames = document.getElementById("file-names");
const clearButton = document.getElementById("clear-files");
const sampleLine = document.getElementById("sample-line");
const noteEl = document.getElementById("note");
const sampleButton = document.getElementById("sample-button");
const cardNote = document.getElementById("card-note");
const cardNoteText = document.getElementById("card-note-text");
const cardToggle = document.getElementById("card-toggle");
const savingsEl = document.getElementById("savings");
const savingsCount = document.getElementById("savings-count");
const saveMonth = document.getElementById("save-month");
const saveYear = document.getElementById("save-year");
const newMonthly = document.getElementById("new-monthly");
const clearCancel = document.getElementById("clear-cancel");
const modeButtons = document.querySelectorAll(".modebar button");
const viewButtons = document.querySelectorAll(".viewbar button");
const subsView = document.getElementById("subs-view");
const cardsView = document.getElementById("cards-view");
const cardsEmpty = document.getElementById("cards-empty");
const cardsAverage = document.getElementById("cards-average");
const cardsMonths = document.getElementById("cards-months");
const cardsToggleAll = document.getElementById("cards-toggle-all");
const cardsSetup = document.getElementById("cards-setup");
const cardsSetupSummary = document.getElementById("cards-setup-summary");
const cardsSetupLikely = document.getElementById("cards-setup-likely");
const cardsSetupOther = document.getElementById("cards-setup-other");
const cardsSetupMore = document.getElementById("cards-setup-more");
const cardsSetupMoreSummary = document.getElementById("cards-setup-more-summary");
const cardsReset = document.getElementById("cards-reset");
const cardsExpected = document.getElementById("cards-expected");
const cardsUseUsual = document.getElementById("cards-use-usual");
const cardsCheckSummary = document.getElementById("cards-check-summary");

function parseFile(file) {
  return new Promise((resolve, reject) => {
    try {
      checkFileSize(file.size); // refuse a huge file before reading any of it
    } catch (err) {
      reject(err);
      return;
    }
    Papa.parse(file, {
      skipEmptyLines: true,
      complete: (parsed) => {
        try {
          resolve(rowsFromArrays(parsed.data));
        } catch (err) {
          reject(err);
        }
      },
      error: reject,
    });
  });
}

function addRow(body, cells) {
  const tr = document.createElement("tr");
  for (const text of cells) {
    const td = document.createElement("td");
    td.textContent = text;
    tr.appendChild(td);
  }
  body.appendChild(tr);
}

const fineEl = document.getElementById("fine");
const tip = document.getElementById("tip");
const FINE = "Yearly plans count as 1/12 of their price. Dates are estimates: the last charge plus 30 days (365 for yearly).";
const yearlyEl = document.getElementById("yearly-total");

let current = []; // the active subscriptions on screen
let hidden = new Set(); // the ones the user clicked to leave out of the total
let canceled = new Set(); // the ones the user picked for "what if I cancel"
let clickMode = "hide"; // what clicking a row does: "hide" it from the total, or "cancel" it to see savings

// the payments toward a credit card or loan that are on screen
const cardPayments = () => current.filter((s) => s.cardPayment);

function updateCardNote() {
  const rows = cardPayments();
  cardNote.hidden = rows.length === 0;
  if (rows.length === 0) return;
  const allHidden = rows.every((s) => hidden.has(s));
  cardNoteText.textContent = "Card payments may repeat purchases already on that card.";
  cardToggle.textContent = (allHidden ? "Show" : "Hide") + " card payments (" + rows.length + ")";
}

function updateTotal() {
  const counted = current.filter((s) => !hidden.has(s));
  totalEl.textContent = "$" + monthlyTotal(counted).toFixed(2);
  yearlyEl.textContent = "$" + yearlyTotal(counted).toFixed(2);
  fineEl.textContent = hidden.size ? FINE + " " + hidden.size + " hidden." : FINE;
  updateCardNote();
  updateSavings(counted);
}

// What the picked subscriptions would save. A row that is hidden is not in the totals, so canceling it saves nothing.
function updateSavings(counted) {
  const picked = counted.filter((s) => canceled.has(s));
  savingsEl.hidden = picked.length === 0;
  if (picked.length === 0) return;
  const result = savingsFor(counted, picked);
  savingsCount.textContent = picked.length + (picked.length === 1 ? " subscription" : " subscriptions");
  saveMonth.textContent = "$" + result.perMonth.toFixed(2);
  saveYear.textContent = "$" + result.perYear.toFixed(2);
  newMonthly.textContent = "$" + result.newMonthly.toFixed(2);
}

const NEWLINE = String.fromCharCode(10);

// What the page saw (so the user can judge it), then what a click does
function clickText(s) {
  if (clickMode === "cancel") {
    return canceled.has(s) ? "Click to keep it" : "Click to cancel it and see what you would save";
  }
  return hidden.has(s) ? "Click to include in monthly total" : "Click to hide from monthly total";
}

function tipText(s) {
  return [
    "Seen " + s.count + " times, about every " + s.typicalGap + " days. Last charge " + formatDateUS(s.last) + ".",
    "The next date is an estimate: last charge + " + s.cycle + " days.",
    clickText(s),
  ].join(NEWLINE);
}

function moveTip(event) {
  tip.style.left = Math.min(event.clientX + 12, window.innerWidth - tip.offsetWidth - 8) + "px";
  tip.style.top = event.clientY + 16 + "px";
}

// Whole calendar days from today (local time) to a date. Dates in this app are stored as UTC
// midnight built from the year, month and day, so today is built the same way from the local calendar
// day. That keeps a Pacific-time evening from counting as tomorrow.
function daysFromToday(ms) {
  const now = new Date();
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((ms - today) / MS_PER_DAY);
}

// next charge is today or within the next 7 days
function isDueSoon(s) {
  const days = daysFromToday(s.next);
  return days >= 0 && days <= 7;
}

// grays out a hidden row, strikes through a canceled one, and tells screen readers which choice a click toggles
function applyRowState(tr, s) {
  tr.classList.toggle("hidden", hidden.has(s));
  tr.classList.toggle("cancel", canceled.has(s));
  const on = clickMode === "cancel" ? canceled.has(s) : hidden.has(s);
  tr.setAttribute("aria-pressed", String(on));
}

function addActiveRow(s) {
  const tr = document.createElement("tr");
  tr.tabIndex = 0;
  tr.setAttribute("role", "button");
  applyRowState(tr, s);
  tr.classList.toggle("due-soon", isDueSoon(s)); // stays when the row is hidden; the row is just grayed out

  for (const text of [s.displayName, "$" + s.price.toFixed(2), s.period, formatDateUS(s.next)]) {
    const td = document.createElement("td");
    td.textContent = text;
    tr.appendChild(td);
  }
  if (s.cardPayment) {
    const tag = document.createElement("span");
    tag.className = "cardtag";
    tag.textContent = "card payment";
    tr.firstChild.appendChild(tag);
  }
  if (s.overdue) {
    const tag = document.createElement("span");
    tag.className = "overdue";
    tag.textContent = "overdue";
    tr.lastChild.appendChild(tag);
  }

  const toggle = () => {
    const picked = clickMode === "cancel" ? canceled : hidden;
    if (picked.has(s)) picked.delete(s);
    else picked.add(s);
    applyRowState(tr, s);
    tip.textContent = tipText(s);
    updateTotal();
  };
  tr.addEventListener("click", toggle);
  tr.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      toggle();
    }
  });
  tr.addEventListener("mouseenter", () => {
    tip.textContent = tipText(s);
    tip.hidden = false;
  });
  tr.addEventListener("mousemove", moveTip);
  tr.addEventListener("mouseleave", () => {
    tip.hidden = true;
  });

  activeBody.appendChild(tr);
}

const sortButtons = document.querySelectorAll(".sortbar button");

let ended = []; // the ended subscriptions on screen
let sortBy = null; // "date", "price", or null for the order they were found in
let sortDown = false; // true = largest or latest first

// date sorts by the next charge (active) or the last charge (ended); price by the charge amount
const sortValue = (s, kind) => (kind === "price" ? s.price : s.active ? s.next : s.last);

function sorted(list) {
  if (!sortBy) return list;
  const direction = sortDown ? -1 : 1;
  return [...list].sort((a, b) => direction * (sortValue(a, sortBy) - sortValue(b, sortBy)));
}

function render() {
  activeBody.replaceChildren();
  endedBody.replaceChildren();
  tip.hidden = true;

  for (const s of sorted(current)) addActiveRow(s);
  for (const s of sorted(ended)) {
    addRow(endedBody, [s.displayName, "$" + s.price.toFixed(2), s.period, formatDateUS(s.last)]);
  }

  for (const button of sortButtons) {
    const on = button.dataset.sort === sortBy;
    button.setAttribute("aria-pressed", String(on));
    const label = button.dataset.sort === "date" ? "Date" : "Price";
    button.textContent = on ? label + (sortDown ? " \u25BC" : " \u25B2") : label;
  }
}

// first click sorts soonest date / cheapest price first, clicking the same button again reverses it
for (const button of sortButtons) {
  button.addEventListener("click", () => {
    if (sortBy === button.dataset.sort) {
      sortDown = !sortDown;
    } else {
      sortBy = button.dataset.sort;
      sortDown = sortBy === "price"; // price starts with the biggest charge, date with the soonest
    }
    render();
  });
}

function show(subscriptions) {
  current = subscriptions.filter((s) => s.active);
  ended = subscriptions.filter((s) => !s.active);
  hidden = new Set();
  canceled = new Set();

  render();
  updateTotal();
  endedSummary.textContent = "Ended (" + ended.length + ")";
  results.hidden = false;
}

// Every file the user has added so far. The browser's file picker forgets the old choice each time
// it opens, so the page keeps its own list and adds to it.
let chosen = [];

// Hides an account number in a file name: "Chase1234_Activity_20261014.csv" shows as "Chase" + four
// bullet dots + "_Activity_20261014.csv". Only a 4-digit number directly after the bank name at the
// start is masked, so the 8-digit date is left alone.
const maskName = (name) => name.replace(/^([A-Za-z]+)\d{4}(?!\d)/, "$1" + "\u2022".repeat(4));

const sameFile = (a, b) => a.name === b.name && a.size === b.size && a.lastModified === b.lastModified;

async function showChosen() {
  message.textContent = "";
  noteEl.textContent = "";
  clearButton.hidden = chosen.length === 0;
  sampleLine.hidden = chosen.length > 0;
  fileNames.textContent = chosen.length ? chosen.map((f) => maskName(f.name)).join(", ") : "No file chosen";
  if (chosen.length === 0) {
    results.hidden = true;
    return;
  }

  try {
    const perFile = [];
    for (const file of chosen) {
      try {
        perFile.push(entriesFromRows(await parseFile(file)));
      } catch (err) {
        throw new Error(maskName(file.name) + ": " + err.message);
      }
    }
    const { entries, duplicates } = mergeEntries(perFile);
    allEntries = entries;
    noteEl.textContent = duplicates
      ? "Skipped " + duplicates + " transaction" + (duplicates === 1 ? "" : "s") + " that appear in more than one file."
      : "";
    const { groups, names } = groupCharges(entries);
    show(findSubscriptions(groups, names));
    renderCards();
  } catch (err) {
    results.hidden = true;
    message.textContent = err.message || "Could not read that file.";
  }
}

input.addEventListener("change", () => {
  for (const file of input.files) {
    if (!chosen.some((c) => sameFile(c, file))) chosen.push(file);
  }
  input.value = ""; // so picking the same file again still counts as a change
  showChosen();
});

clearButton.addEventListener("click", () => {
  chosen = [];
  choices = new Map();
  expectedCount = null;
  cardsExpected.value = "";
  lastGoodExpected = "";
  showChosen();
});

// loads the made-up sample from the site itself, so a visitor without a bank CSV can see how it works
sampleButton.addEventListener("click", async () => {
  try {
    const response = await fetch("sample_transactions.csv");
    if (!response.ok) throw new Error("not found");
    const text = await response.text();
    chosen.push(new File([text], "sample_transactions.csv", { type: "text/csv" }));
    showChosen();
  } catch (err) {
    message.textContent = "Could not load the sample. Open the page from a web server, not as a file, to use it.";
  }
});

// hides every card payment at once, or shows them all again if they are all hidden
cardToggle.addEventListener("click", () => {
  const rows = cardPayments();
  const allHidden = rows.every((s) => hidden.has(s));
  for (const s of rows) {
    if (allHidden) hidden.delete(s);
    else hidden.add(s);
  }
  render();
  updateTotal();
});

// switch what a row click does: hide it from the total, or pick it to see what canceling would save
for (const button of modeButtons) {
  button.addEventListener("click", () => {
    clickMode = button.dataset.mode;
    for (const other of modeButtons) other.setAttribute("aria-pressed", String(other === button));
    render();
  });
}

clearCancel.addEventListener("click", () => {
  canceled = new Set();
  render();
  updateTotal();
});

// ---- Card payments view ----

let allEntries = []; // every transaction from the chosen files (after combining them)
let view = "subs"; // "subs" or "cards"
// What the user decided about each payee (label -> true or false). Nothing is saved: these choices live only in this
// tab, like everything else, and are gone when the page is closed or refreshed.
let choices = new Map();
// How many card payments the user expects each month, or null for no check. Like the choices above, it is not saved.
let expectedCount = null;
let usualSuggestion = null; // what the last few full months usually had, offered as a one-click answer
let lastGoodExpected = ""; // what was in the box before something was refused
let limitFlash = false; // true while the red "between 1-99" message is showing after a refused key
let limitFlashTimer = null;

function plural(n, word) {
  return n + " " + word + (n === 1 ? "" : "s");
}

const money = (n) => "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// what the count check found for one month, in plain words
function checkText(check) {
  let text = check.count + " of " + check.expected + " expected payments.";
  if (check.earlierMonths === 0) {
    text += " There are no earlier complete months in the file to compare with.";
  } else if (check.missing.length > 0) {
    const months = check.earlierMonths === 1 ? "month" : check.earlierMonths + " months";
    text += " Compared with the " + months + " before it, these paid less than usual: " +
      check.missing.map((m) => m.issuer + " (" + m.count + ", usually " + m.usual + ")").join(", ") + ".";
  } else {
    text += " No single issuer paid less than usual, so it may be a payee that is not ticked yet.";
  }
  return text;
}

// the line under the input, and the one-click suggestion
function updateCheckStatus(blocks, checks) {
  usualSuggestion = usualCount(blocks);
  if (usualSuggestion !== null && usualSuggestion > MAX_EXPECTED_PAYMENTS) usualSuggestion = null;
  cardsUseUsual.hidden = usualSuggestion === null || usualSuggestion === expectedCount;
  cardsUseUsual.textContent = "Use " + usualSuggestion + " (usual lately)";

  // the box refuses a number above 99, so the message is also shown for a moment after a refused key
  const problem = limitFlash ? EXPECTED_COUNT_MESSAGE : expectedCountProblem(cardsExpected.value);
  cardsExpected.setAttribute("aria-invalid", String(problem !== ""));
  cardsCheckSummary.classList.toggle("error", problem !== "");

  if (problem !== "") {
    cardsCheckSummary.textContent = problem;
  } else if (expectedCount === null) {
    cardsCheckSummary.textContent = "Optional. Months with fewer payments than this number are marked as fewer than expected.";
  } else if (!blocks.some((b) => b.complete)) {
    cardsCheckSummary.textContent = "There is no complete month in the file to check yet.";
  } else if (checks.size === 0) {
    cardsCheckSummary.textContent = "Every complete month has at least " + expectedCount + " payments.";
  } else {
    const names = blocks.filter((b) => checks.has(b.key)).map((b) => b.name);
    cardsCheckSummary.textContent =
      plural(checks.size, "month") + (checks.size === 1 ? " has" : " have") + " fewer than " + expectedCount + " payments: " + names.join(", ") + ".";
  }
}

// one block per month with its total, so the user can check what was counted
function renderCardResults() {
  const today = localToday();
  const result = matchCardPayments(allEntries, today, choices);
  const blocks = groupByMonth(result, today);
  const { matched } = result;
  const checks = checkMonths(blocks, expectedCount);
  updateCheckStatus(blocks, checks);
  // every month starts collapsed; remember which ones the user opened, so ticking a payee does not close them again
  const wasOpen = new Map([...cardsMonths.querySelectorAll("details.month")].map((d) => [d.dataset.key, d.open]));
  cardsMonths.replaceChildren();

  cardsEmpty.hidden = matched.length > 0;

  // the average of the most recent complete months, since a payment near the 1st can land in the wrong month
  const average = recentAverage(blocks, 3);
  if (!average) {
    cardsAverage.textContent = "";
  } else {
    const span = average.months === 1 ? average.to : average.from + " to " + average.to;
    const label = average.months === 3 ? "3-month average" : average.months + "-month average (only " + plural(average.months, "full month") + " in the file)";
    cardsAverage.textContent = label + ": " + money(average.average) + " a month (" + span + ").";
  }

  blocks.forEach((block) => {
    const details = document.createElement("details");
    details.className = "month";
    details.dataset.key = block.key;
    details.open = wasOpen.has(block.key) && wasOpen.get(block.key);

    const summary = document.createElement("summary");
    const total = document.createElement("span");
    total.className = "month-total";
    total.textContent = money(block.total);
    const name = document.createElement("span");
    name.className = "month-name";
    name.textContent = block.name;
    const meta = document.createElement("span");
    meta.className = "month-meta";
    meta.textContent = " \u00b7 " + plural(block.count, "payment") + (block.note ? " \u00b7 " + block.note : "");
    summary.append(total, name, meta);
    const check = checks.get(block.key);
    if (check) {
      const flag = document.createElement("span");
      flag.className = "month-flag";
      flag.textContent = check.expected - check.count + " fewer than expected";
      summary.appendChild(flag);
    }
    details.appendChild(summary);
    if (check) {
      const why = document.createElement("p");
      why.className = "month-check";
      why.textContent = checkText(check);
      details.appendChild(why);
    }

    if (block.count === 0) {
      const none = document.createElement("p");
      none.className = "month-issuers";
      none.textContent = "No card payments found this month.";
      details.appendChild(none);
    } else {
      const issuers = document.createElement("p");
      issuers.className = "month-issuers";
      issuers.textContent = block.byIssuer.map((i) => i.issuer + " (" + i.count + ") " + money(i.total)).join(" \u00b7 ");
      details.appendChild(issuers);

      const table = document.createElement("table");
      table.className = "cardtable";
      const body = document.createElement("tbody");
      for (const m of block.payments) addRow(body, [formatDateUS(m.ms), m.issuer, money(m.amount)]);
      table.appendChild(body);
      details.appendChild(table);
    }
    cardsMonths.appendChild(details);
  });

  cardsToggleAll.hidden = blocks.length === 0;
  const months = [...cardsMonths.querySelectorAll("details.month")];
  cardsToggleAll.textContent = months.length > 0 && months.every((m) => m.open) ? "Collapse all months" : "Expand all months";
}

// ---- the setup checklist: which payees are credit cards ----

function updateSetupSummary() {
  const boxes = cardsSetup.querySelectorAll("input[type=checkbox]");
  const ticked = [...boxes].filter((b) => b.checked).length;
  cardsSetupSummary.textContent = "Choose which payees are credit cards (" + ticked + " of " + boxes.length + " ticked)";
}

function payeeRow(payee) {
  const row = document.createElement("label");
  row.className = "payee";
  const box = document.createElement("input");
  box.type = "checkbox";
  box.checked = payee.checked;
  const text = document.createElement("span");
  const name = document.createElement("span");
  name.className = "payee-name";
  name.textContent = payee.label;
  const meta = document.createElement("span");
  meta.className = "payee-meta";
  meta.textContent = plural(payee.count, "payment") + " in " + plural(payee.months, "month") + ", usually " + money(payee.typical);
  text.append(name, meta);
  row.append(box, text);

  box.addEventListener("change", () => {
    if (box.checked === payee.defaultOn) choices.delete(payee.label);
    else choices.set(payee.label, box.checked);
    updateSetupSummary();
    renderCardResults();
  });
  return row;
}

// lists the payees that could be credit cards: the likely ones, and the other recurring ones behind a fold
function renderChecklist() {
  const payees = findPayees(allEntries, localToday(), choices);
  cardsSetupLikely.replaceChildren();
  cardsSetupOther.replaceChildren();
  cardsSetup.hidden = payees.length === 0;
  const likely = payees.filter((p) => p.likely);
  const other = payees.filter((p) => !p.likely);
  for (const payee of likely) cardsSetupLikely.appendChild(payeeRow(payee));
  for (const payee of other) cardsSetupOther.appendChild(payeeRow(payee));
  cardsSetupMore.hidden = other.length === 0;
  cardsSetupMoreSummary.textContent = "Other recurring payees (" + other.length + ")";
  updateSetupSummary();
}

function renderCards() {
  renderChecklist();
  renderCardResults();
}

// go back to what the page recognizes on its own
cardsReset.addEventListener("click", () => {
  choices = new Map();
  renderCards();
});

// open every month, or close them all again
cardsToggleAll.addEventListener("click", () => {
  const months = [...cardsMonths.querySelectorAll("details.month")];
  const open = months.some((m) => !m.open);
  for (const m of months) m.open = open;
  cardsToggleAll.textContent = open ? "Collapse all months" : "Expand all months";
});

// the switch at the top of the results: the subscription receipt, or the card payments view
for (const button of viewButtons) {
  button.addEventListener("click", () => {
    view = button.dataset.view;
    for (const other of viewButtons) other.setAttribute("aria-pressed", String(other === button));
    subsView.hidden = view !== "subs";
    cardsView.hidden = view !== "cards";
  });
}

// shows the red message for a few seconds
function flashLimitError() {
  limitFlash = true;
  clearTimeout(limitFlashTimer);
  limitFlashTimer = setTimeout(() => {
    limitFlash = false;
    renderCardResults();
  }, 3000);
  renderCardResults();
}

// The box stops taking input that would not be a number from 1 to 99: a third digit, a letter, a pasted sentence.
// It is refused before it appears, and the red message says why. Deleting is always allowed.
cardsExpected.addEventListener("beforeinput", (event) => {
  if (!event.inputType.startsWith("insert")) return;
  const typed = event.data || (event.dataTransfer ? event.dataTransfer.getData("text") : "") || "";
  const start = cardsExpected.selectionStart;
  const end = cardsExpected.selectionEnd;
  const result = cardsExpected.value.slice(0, start) + typed + cardsExpected.value.slice(end);
  if (!acceptsExpectedInput(result)) {
    event.preventDefault();
    flashLimitError();
  }
});

// the expected number: typing it checks every month right away
cardsExpected.addEventListener("input", () => {
  if (!acceptsExpectedInput(cardsExpected.value)) {
    // something got past the check above (autofill, drag and drop): put back what was there
    cardsExpected.value = lastGoodExpected;
    flashLimitError();
    return;
  }
  lastGoodExpected = cardsExpected.value;
  expectedCount = parseExpectedCount(cardsExpected.value);
  renderCardResults();
});

cardsUseUsual.addEventListener("click", () => {
  if (usualSuggestion === null) return;
  expectedCount = usualSuggestion;
  cardsExpected.value = String(usualSuggestion);
  lastGoodExpected = cardsExpected.value;
  renderCardResults();
});
