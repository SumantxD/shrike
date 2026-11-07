import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const pkg = join(here, "..");
// The real binary, not the .bin wrapper: killing the wrapper would orphan Electron.
const electron = createRequire(join(pkg, "../../apps/desktop/package.json"))("electron");

function runHarness() {
  execFileSync(join(pkg, "node_modules/.bin/esbuild"), [
    "src/index.ts", "--bundle", "--format=iife", "--target=chrome120", "--outfile=dist/browser-agent.js", "--log-level=warning",
  ], { cwd: pkg, stdio: "inherit" });
  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(electron, [join(here, "harness.mjs")], { env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    const timer = setTimeout(() => child.kill("SIGKILL"), 60_000);
    child.on("close", () => {
      clearTimeout(timer);
      const line = stdout.split("\n").find((l) => l.startsWith("@@RESULT@@"));
      if (!line) return reject(new Error(`no result from harness\n${stdout}\n${stderr}`));
      resolve(JSON.parse(line.slice("@@RESULT@@".length)));
    });
  });
}

test("browser-agent end to end in Electron", { timeout: 90_000 }, async () => {
  const out = await runHarness();
  assert.equal(out.error, undefined, out.error);

  const events = out.msgs.flatMap((m) => (m.type === "events" ? m.events : []));
  const ends = out.msgs.filter((m) => m.type === "action_end");
  const versions = (id) => events.filter((e) => e.id === id);
  const finalRoot = (id) => versions(id).at(-1);
  const children = (id) => events.filter((e) => e.parentId === id);
  const http = (id) => children(id).filter((e) => e.kind === "http_request");
  const hex = (n) => new RegExp(`^[0-9a-f]{${n}}$`);

  // Every event matches the schema shape.
  for (const e of events) {
    assert.match(e.id, hex(16));
    assert.match(e.traceId, hex(32));
    if (e.parentId) assert.match(e.parentId, hex(16));
    assert.ok(["user_action", "http_request", "log", "error"].includes(e.kind), e.kind);
    assert.ok(["ok", "slow", "error"].includes(e.status));
    assert.equal(e.origin, "browser");
    assert.ok(e.startMs > 1.6e12 && e.startMs < Date.now() + 1000, `epoch ms: ${e.startMs}`);
    if (e.durationMs !== undefined) assert.ok(e.durationMs >= 0);
  }
  assert.ok(out.msgs.some((m) => m.type === "hello" && m.source === "browser" && m.url.startsWith("http://127.0.0.1:")));

  // Navigation action, and the load-time fetch joined it.
  const nav = finalRoot(out.steps.nav);
  assert.equal(nav.trigger, "navigation");
  assert.equal(nav.name, "Opened /");
  assert.ok(ends.some((m) => m.actionId === nav.id));
  assert.deepEqual(http(nav.id).map((e) => e.name), ["GET /api/initial"]);

  // Idempotent: one user_action per click despite the second injection.
  const roots = events.filter((e) => e.kind === "user_action");
  assert.equal(new Set(roots.map((e) => e.id)).size, 19, roots.map((e) => e.name).join(", ")); // 13 + the background beacon + Enter in Search + 4 from the B1 recording

  // type() drives a React controlled input.
  assert.equal(out.echo, "buy milk");
  assert.equal(out.steps.typeResult, null);
  assert.equal(out.snapshot.elements.find((el) => el.name === "New todo").value, "");

  // Add Todo click.
  const addId = out.steps["Add Todo"];
  assert.match(addId, hex(16));
  const add = finalRoot(addId);
  assert.equal(add.name, 'Clicked "Add Todo"');
  assert.equal(add.trigger, "click");
  assert.deepEqual(add.source, { file: "/abs/project/src/TodoForm.tsx", line: 31, column: 7, precision: "exact" });
  for (const v of versions(addId)) {
    const t = v.target;
    assert.ok(t && t.width > 0 && t.height > 0 && t.x >= 0 && t.y >= 0, `target ${JSON.stringify(t)}`);
    assert.ok(t.viewportWidth >= t.x + t.width && t.viewportHeight > 0);
  }
  assert.equal(nav.target, undefined);
  assert.equal(versions(addId).length, 2, "root emitted at open and again at close");
  assert.equal(versions(addId)[0].durationMs, undefined);
  assert.equal(add.status, "error");
  assert.ok(add.durationMs >= 100, `duration ${add.durationMs}`);
  assert.ok(ends.some((m) => m.actionId === addId));
  const [post] = http(addId);
  assert.equal(post.name, "POST /api/todos");
  assert.equal(post.traceId, add.traceId);
  assert.equal(post.status, "error");
  assert.equal(post.http.method, "POST");
  assert.equal(post.http.url, "/api/todos");
  assert.equal(post.http.status, 500);
  assert.equal(post.http.reqBody, JSON.stringify({ title: "buy milk" }));
  assert.equal(post.http.reqHeaders["content-type"], "application/json");
  assert.equal(post.http.resHeaders["x-served-by"], "harness");
  assert.deepEqual(post.http.serverTiming, [{ name: "db", durMs: 53.2, desc: "Postgres" }, { name: "app", durMs: 47 }], "#59: Server-Timing parsed");
  assert.equal(post.http.serverTraceId, "ab".repeat(16), "#59: the server's trace ID from traceresponse");
  assert.match(post.http.resBody, /NOT NULL constraint failed/);
  assert.match(post.stack, /page\.js/);
  assert.match(post.stack.split("\n")[1], /page\.js/, "first frame is the caller, not the agent");
  const tp = `00-${add.traceId}-${post.id}-01`;
  assert.equal(post.http.reqHeaders.traceparent, tp);
  assert.ok(out.received.some((r) => r.path === "/api/todos" && r.traceparent === tp), "server got traceparent");
  const log = children(addId).find((e) => e.kind === "log");
  assert.equal(log.log.message, 'adding todo {"title":"buy milk"}');
  assert.equal(log.log.level, "info");
  assert.equal(log.traceId, add.traceId);
  // Map, Set and nested Error read as values, not {}.
  assert.equal(children(addId).find((e) => e.kind === "log" && e.log.message.startsWith("cart")).log.message, 'cart Map(1) {"cart" => 3} Set(2) {"a", "b"} {"err":"Error: boom"}');
  assert.deepEqual(out.results.add, { status: 500, body: { error: "NOT NULL constraint failed: todos.user_id", got: { title: "buy milk" } } });

  // 500 and network error mark error; page sees native results.
  assert.equal(finalRoot(out.steps.Fail).status, "error");
  assert.equal(http(out.steps.Fail)[0].http.resBody, "boom");
  assert.deepEqual(out.results.fail500, { status: 500, body: "boom" });
  const net = http(out.steps["Network fail"])[0];
  assert.equal(net.status, "error");
  assert.equal(net.error.type, "TypeError");
  assert.equal(finalRoot(out.steps["Network fail"]).status, "error");
  assert.equal(out.results.net, "TypeError");

  // Cross-origin: no traceparent, no preflight, full URL.
  // Sent at start too, so main can join the other server's side before it answers.
  const [crossStart, crossEv] = http(out.steps.Cross);
  assert.equal(crossStart.id, crossEv.id);
  assert.equal(crossStart.durationMs, undefined);
  assert.equal(crossEv.http.reqHeaders.traceparent, undefined);
  assert.equal(crossEv.http.serverTiming, undefined, "cross-origin Server-Timing the server didn't expose stays hidden");
  assert.match(crossEv.http.url, /^http:\/\/127\.0\.0\.1:\d+\/api\/cors$/);
  const crossReqs = out.received.filter((r) => r.path.startsWith("cross:"));
  assert.deepEqual(crossReqs.map((r) => [r.method, r.traceparent]), [["GET", null]]);
  assert.equal(out.results.cross, "cross ok");
  assert.equal(finalRoot(out.steps.Cross).status, "ok");

  // Streaming body is intact for the page and captured for us.
  assert.equal(out.results.stream, "abc");
  assert.equal(http(out.steps.Stream)[0].http.resBody, "abc");

  // Abort: page still sees AbortError; recorded as cancelled, not a failure.
  assert.equal(out.results.abort, "AbortError");
  const ab = http(out.steps.Abort)[0];
  assert.equal(ab.error.type, "AbortError");
  assert.equal(ab.status, "ok");

  // XHR joins the action with traceparent; page result unchanged.
  const x = http(out.steps.Xhr)[0];
  assert.equal(x.name, "POST /api/echo");
  assert.equal(x.http.status, 200);
  assert.equal(x.http.reqBody, "hello xhr");
  assert.deepEqual(x.http.serverTiming, [{ name: "cache", desc: "miss" }, { name: "total", durMs: 12 }], "#59: XHR reads Server-Timing too");
  assert.equal(out.results.xhr.status, 200);
  assert.equal(out.results.xhr.body.body, "hello xhr");
  assert.equal(out.results.xhr.body.headers.traceparent, `00-${x.traceId}-${x.id}-01`);

  // Request object input keeps its headers and body.
  assert.equal(out.results.req.body, "from request");
  assert.equal(out.results.req.headers["x-test"], "1");
  const r = http(out.steps.Req)[0];
  assert.equal(out.results.req.headers.traceparent, `00-${r.traceId}-${r.id}-01`);

  // #85: a beacon shows on its click's trip as POST with its body, and settles at once (it has no response).
  const [b] = http(out.steps.Beacon);
  assert.equal(b.name, "POST /api/echo");
  assert.equal(b.http.method, "POST");
  assert.equal(b.http.reqBody, "x");
  assert.equal(b.status, "ok");
  assert.equal(b.http.status, undefined, "no response to show");
  assert.ok(b.durationMs >= 0);
  assert.match(b.stack.split("\n")[1], /page\.js/, "first frame is the page's own call");
  assert.equal(out.results.beacon, true, "the page gets the browser's answer");
  assert.equal(finalRoot(out.steps.Beacon).status, "ok");
  assert.ok(out.received.some((r) => r.path === "/api/echo" && r.method === "POST" && r.traceparent === null), "the beacon reached the server, without traceparent");
  // Refused (over the browser's 64 KB queue limit): marked failed, the page still gets false.
  const [big] = http(out.steps["Big beacon"]);
  assert.equal(big.status, "error");
  assert.equal(big.error.type, "BeaconRefused");
  assert.match(big.http.reqBody, /…\[truncated\]$/);
  assert.equal(out.results.bigBeacon, false);
  assert.equal(finalRoot(out.steps["Big beacon"]).status, "error");
  // Outside any click: its own background trip.
  assert.equal(out.bgBeacon, true);
  const bg = events.find((e) => e.http?.reqBody === "background");
  assert.equal(bg.name, "POST /api/echo");
  assert.equal(finalRoot(bg.parentId).name, "Background request");

  // Checkbox through its label text.
  assert.equal(finalRoot(out.steps["Buy milk"]).name, 'Ticked "Buy milk"');

  // type(..., submit) opens a submit action that the form's fetch joins.
  const sub = finalRoot(out.steps.submit);
  assert.equal(sub.trigger, "submit");
  assert.ok(sub.target && sub.target.viewportWidth > 0, `submit target ${JSON.stringify(sub.target)}`);
  assert.equal(sub.name, 'Submitted "Go"');
  assert.deepEqual(out.enterRoots, ['submit Submitted "Go"'], "Enter in the field is the form's submit, not a click on Go");
  assert.equal(http(sub.id)[0].http.reqBody, "form");
  assert.equal(out.results.form.body, "form");
  assert.equal(out.steps.missingRef, null);

  // O1 point mode: labelled outline on hover, the pick carries what and where, and the page never got the click.
  assert.equal(out.point.tag, "button · Add Todo");
  assert.equal(out.point.boxShown, "block");
  const pick = out.point.pick.pick;
  assert.equal(pick.text, "Add Todo");
  assert.equal(pick.role, "button");
  assert.match(pick.selector, /button:nth-of-type\(1\)$/);
  assert.deepEqual(pick.source, { file: "/abs/project/src/TodoForm.tsx", line: 31, column: 7, precision: "exact" });
  assert.ok(pick.rect.width > 0 && pick.rect.viewportWidth >= pick.rect.x + pick.rect.width, JSON.stringify(pick.rect));
  assert.equal(out.point.addsAfter, out.point.addsBefore, "the picked click reached the page");
  assert.equal(out.point.boxAfter, "none");
  assert.deepEqual(out.point.cancel, { type: "point", cancelled: true });

  // B1: clicks by accessible name, typing on commit, the password marked secret, Enter as submit; quiet after stop.
  assert.deepEqual(out.flow.steps, [
    { type: "type", name: "Note", text: "eggs" },
    { type: "click", name: "Abort" },
    { type: "type", name: "Password", text: "hunter2", secret: true },
    { type: "type", name: "Password", text: "hunter2", submit: true, secret: true },
    { type: "click", name: "Buy milk" },
  ]);
  assert.equal(out.flow.after, 0);

  // #54: no page script, top frame or iframe, can reach the binding; nothing forged landed.
  assert.deepEqual(out.forge, ["undefined", "undefined", "undefined"]);
  assert.ok(!events.some((e) => e.name === "forged"), "a forged event landed");
  // #54: traceparent off through the config closure, which the page can't see.
  assert.equal(out.liveEcho.headers.traceparent, undefined);
  assert.equal(out.liveConfig, "undefined");

  // Logs outside a window use the zero trace.
  const outside = events.find((e) => e.log?.message === "outside any action");
  assert.equal(outside.traceId, "0".repeat(32));
  assert.equal(outside.parentId, undefined);
  assert.equal(out.consoleWorks, true);

  // hono-drizzle-pg: a fetch the page's own navigation cut off is cancelled, not broken.
  const left = out.left.find((e) => e.http.url === "/api/slow");
  assert.ok(left, JSON.stringify(out.left));
  assert.equal(left.status, "ok", JSON.stringify(left.error));
  assert.equal(left.error?.type, "AbortError", JSON.stringify(out.left));
});
