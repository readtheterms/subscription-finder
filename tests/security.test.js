// These tests protect the privacy promise ("nothing is uploaded"). If someone later removes the
// security policy, the integrity hash, or adds code that sends data somewhere, a test fails.
const test = require("node:test");
const assert = require("node:assert/strict");
const { readDoc } = require("./helpers");

const html = readDoc("index.html");
const pageCode = { "app.js": readDoc("app.js"), "finder.js": readDoc("finder.js") };

function policy() {
  const match = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)"/);
  assert.ok(match, "index.html needs a Content-Security-Policy meta tag");
  return Object.fromEntries(
    match[1].split(";").map((part) => {
      const [name, ...sources] = part.trim().split(/\s+/);
      return [name, sources];
    })
  );
}

test("the security policy only lets the page contact its own site", () => {
  const csp = policy();
  assert.deepEqual(csp["default-src"], ["'none'"]);
  assert.deepEqual(csp["connect-src"], ["'self'"]); // blocks sending data anywhere else
  assert.deepEqual(csp["form-action"], ["'none'"]);
  assert.deepEqual(csp["object-src"], ["'none'"]);
});

test("the security policy allows no inline code, eval, or wildcards", () => {
  const allowed = Object.values(policy()).flat().join(" ");
  assert.ok(!allowed.includes("'unsafe-inline'"));
  assert.ok(!allowed.includes("'unsafe-eval'"));
  assert.ok(!/(^|\s)\*(\s|$)/.test(allowed));
  assert.ok(!allowed.includes("http:"));
});

test("only the pinned CSV library may load from another site", () => {
  const external = policy()["script-src"].filter((source) => source.startsWith("https://"));
  assert.deepEqual(external, ["https://cdn.jsdelivr.net/npm/papaparse@5.4.1/papaparse.min.js"]);
});

test("every script from another site has an integrity hash", () => {
  const tags = html.match(/<script[^>]+src="https?:\/\/[^"]+"[^>]*>/g) || [];
  assert.ok(tags.length > 0, "expected the CSV library script tag");
  for (const tag of tags) {
    assert.match(tag, /integrity="sha384-[A-Za-z0-9+/=]{64}"/, tag);
    assert.match(tag, /crossorigin="anonymous"/, tag);
  }
});

test("the page has no inline scripts or inline event handlers", () => {
  assert.ok(!/<script(?![^>]*\ssrc=)[^>]*>/i.test(html), "found an inline <script>");
  assert.ok(!/\son[a-z]+\s*=/i.test(html), "found an inline event handler");
  assert.ok(!/\sstyle\s*=/i.test(html), "found an inline style attribute");
});

test("page code never writes text as HTML or runs text as code", () => {
  for (const [file, code] of Object.entries(pageCode)) {
    for (const bad of ["innerHTML", "outerHTML", "insertAdjacentHTML", "document.write", "eval(", "new Function"]) {
      assert.ok(!code.includes(bad), `${file} must not use ${bad}`);
    }
  }
});

test("the page stores nothing and sends nothing", () => {
  for (const [file, code] of Object.entries(pageCode)) {
    for (const bad of ["localStorage", "sessionStorage", "document.cookie", "indexedDB", "XMLHttpRequest", "sendBeacon", "WebSocket", "postMessage"]) {
      assert.ok(!code.includes(bad), `${file} must not use ${bad}`);
    }
  }
});

test("the only network request is for the sample file on the same site", () => {
  const calls = [...pageCode["app.js"].matchAll(/fetch\(\s*([^)]*)\)/g)].map((m) => m[1].trim());
  assert.deepEqual(calls, ['"sample_transactions.csv"']);
  assert.ok(!pageCode["finder.js"].includes("fetch("));
});

test("links that open a new tab cannot reach back into the page", () => {
  const links = html.match(/<a\s[^>]*target="_blank"[^>]*>/g) || [];
  for (const link of links) assert.match(link, /rel="[^"]*noopener/, link);
});
