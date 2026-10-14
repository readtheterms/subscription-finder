const input = document.getElementById("csv-input");
const message = document.getElementById("message");
const results = document.getElementById("results");
const activeBody = document.getElementById("active-body");
const endedBody = document.getElementById("ended-body");
const endedSummary = document.getElementById("ended-summary");
const totalEl = document.getElementById("total");

function parseFile(file) {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (parsed) => resolve(parsed.data),
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

function show(subscriptions) {
  activeBody.replaceChildren();
  endedBody.replaceChildren();

  const active = subscriptions.filter((s) => s.active);
  const ended = subscriptions.filter((s) => !s.active);

  for (const s of active) {
    addRow(activeBody, [s.name.slice(0, 30), "$" + s.price.toFixed(2), s.period, formatDate(s.next)]);
  }
  for (const s of ended) {
    addRow(endedBody, [s.name.slice(0, 30), "$" + s.price.toFixed(2), s.period, formatDate(s.last)]);
  }

  totalEl.textContent = "$" + monthlyTotal(subscriptions).toFixed(2);
  endedSummary.textContent = "Ended (" + ended.length + ")";
  results.hidden = false;
}

input.addEventListener("change", async (event) => {
  const files = [...event.target.files];
  if (files.length === 0) return;

  message.textContent = "";
  try {
    let rows = [];
    for (const file of files) {
      rows = rows.concat(await parseFile(file));
    }
    const { groups, names } = loadCharges(rows);
    show(findSubscriptions(groups, names));
  } catch (err) {
    results.hidden = true;
    message.textContent = "Could not read that file. Is it a Chase CSV export?";
  }
});
