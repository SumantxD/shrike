/* global React, ReactDOM */
const e = React.createElement;
const results = (window.__results = {});
const CROSS = window.__CROSS_ORIGIN;

function App() {
  const [text, setText] = React.useState("");

  async function add() {
    results.adds = (results.adds ?? 0) + 1;
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 100));
    console.log("adding todo", { title: text });
    console.log("cart", new Map([["cart", 3]]), new Set(["a", "b"]), { err: new Error("boom") });
    const res = await fetch("/api/todos", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: text }),
    });
    results.add = { status: res.status, body: await res.json() };
  }
  async function fail500() {
    const r = await fetch("/api/fail");
    results.fail500 = { status: r.status, body: await r.text() };
  }
  async function netError() {
    try {
      await fetch("/api/destroy");
      results.net = "resolved";
    } catch (err) {
      results.net = err.name;
    }
  }
  async function cross() {
    const r = await fetch(CROSS + "/api/cors");
    results.cross = await r.text();
  }
  async function stream() {
    const r = await fetch("/api/stream");
    const reader = r.body.getReader();
    const dec = new TextDecoder();
    let s = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      s += dec.decode(value);
    }
    results.stream = s;
  }
  async function abort() {
    const c = new AbortController();
    const p = fetch("/api/slow", { signal: c.signal });
    setTimeout(() => c.abort(), 30);
    try {
      await p;
      results.abort = "resolved";
    } catch (err) {
      results.abort = err.name;
    }
  }
  function xhr() {
    const x = new XMLHttpRequest();
    x.open("POST", "/api/echo");
    x.setRequestHeader("content-type", "text/plain");
    x.onload = () => (results.xhr = { status: x.status, body: JSON.parse(x.responseText) });
    x.send("hello xhr");
  }
  async function req() {
    const r = await fetch(new Request("/api/echo", { method: "POST", headers: { "x-test": "1" }, body: "from request" }));
    results.req = await r.json();
  }
  function beacon() {
    results.beacon = navigator.sendBeacon("/api/echo", "x");
  }
  function bigBeacon() {
    results.bigBeacon = navigator.sendBeacon("/api/echo", "x".repeat(70_000)); // over the 64 KB queue limit: the browser refuses it
  }
  function onSubmit(ev) {
    ev.preventDefault();
    fetch("/api/echo", { method: "POST", body: "form" })
      .then((r) => r.json())
      .then((j) => (results.form = j));
  }

  const src = { fileName: "/abs/project/src/TodoForm.tsx", lineNumber: 31, columnNumber: 7 };
  return e(
    "div",
    null,
    e("input", { "aria-label": "New todo", value: text, onChange: (ev) => setText(ev.target.value) }),
    e("button", { onClick: add, __source: src }, "  Add\n   Todo "),
    e("button", { onClick: fail500 }, "Fail"),
    e("button", { onClick: netError }, "Network fail"),
    e("button", { onClick: cross }, "Cross"),
    e("button", { onClick: stream }, "Stream"),
    e("button", { onClick: abort }, "Abort"),
    e("button", { onClick: xhr }, "Xhr"),
    e("button", { onClick: req }, "Req"),
    e("button", { onClick: beacon }, "Beacon"),
    e("button", { onClick: bigBeacon }, "Big beacon"),
    e("label", null, e("input", { type: "checkbox" }), " Buy milk"),
    e("form", { onSubmit }, e("input", { "aria-label": "Search", defaultValue: "" }), e("button", { type: "submit" }, "Go")),
    e("p", { id: "echo" }, text),
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(e(App));
fetch("/api/initial")
  .then((r) => r.json())
  .then((j) => (results.initial = j));
