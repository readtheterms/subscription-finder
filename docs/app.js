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
const FINE = "Yearly plans count as 1/12 of their price. Dates are estimates.";
const yearlyEl = document.getElementById("yearly-total");

let current = []; // the active subscriptions on screen
let hidden = new Set(); // the ones the user clicked to leave out of the total

function updateTotal() {
  const counted = current.filter((s) => !hidden.has(s));
  totalEl.textContent = "$" + monthlyTotal(counted).toFixed(2);
  yearlyEl.textContent = "$" + yearlyTotal(counted).toFixed(2);
  fineEl.textContent = hidden.size ? FINE + " " + hidden.size + " hidden." : FINE;
}

function tipText(s) {
  return hidden.has(s) ? "Click to include in monthly total" : "Click to hide from monthly total";
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

function addActiveRow(s) {
  const tr = document.createElement("tr");
  tr.tabIndex = 0;
  tr.setAttribute("role", "button");
  tr.setAttribute("aria-pressed", String(hidden.has(s)));
  tr.classList.toggle("hidden", hidden.has(s));
  const dueSoon = isDueSoon(s);
  tr.classList.toggle("due-soon", dueSoon && !hidden.has(s));

  for (const text of [s.displayName, "$" + s.price.toFixed(2), s.period, formatDateUS(s.next)]) {
    const td = document.createElement("td");
    td.textContent = text;
    tr.appendChild(td);
  }
  if (s.overdue) {
    const tag = document.createElement("span");
    tag.className = "overdue";
    tag.textContent = "overdue";
    tr.lastChild.appendChild(tag);
  }

  const toggle = () => {
    if (hidden.has(s)) hidden.delete(s);
    else hidden.add(s);
    tr.classList.toggle("hidden", hidden.has(s));
    tr.classList.toggle("due-soon", dueSoon && !hidden.has(s));
    tr.setAttribute("aria-pressed", String(hidden.has(s)));
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
    noteEl.textContent = duplicates
      ? "Skipped " + duplicates + " transaction" + (duplicates === 1 ? "" : "s") + " that appear in more than one file."
      : "";
    const { groups, names } = groupCharges(entries);
    show(findSubscriptions(groups, names));
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
