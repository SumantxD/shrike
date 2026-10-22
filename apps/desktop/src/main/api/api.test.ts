import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createServer as createHttps } from "node:https";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { gzipSync } from "node:zlib";
import type { ApiRequest } from "@shrike/schema";
import { Store } from "../store.ts";
import { runAssertions } from "./assert.ts";
import { bruToDefaults, bruToEnv, bruToRequest, defaultsToBru, envToBru, parseBru, requestToBru, serializeBru } from "./bru.ts";
import { toCode } from "./codegen.ts";
import { blankRequest, createCollections, safeJoin } from "./collections.ts";
import { CookieJar, execute, prepare } from "./exec.ts";
import { createHistory, redactRequest } from "./history.ts";
import { importOpenApi, importPostman, importRoutes, parseCurl } from "./import.ts";
import { createApi } from "./index.ts";
import { ocToRequest, requestToOc } from "./oc.ts";
import { runScript } from "./script.ts";
import { interpolate, scopeOf } from "./vars.ts";
import { parseYaml, stringifyYaml } from "./yaml.ts";

const FIX = new URL("../../../../../fixtures/bruno/", import.meta.url).pathname;
const files = (dir: string, ext: RegExp): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(dir, e.name), ext) : ext.test(e.name) ? [join(dir, e.name)] : []));
const keychain = { encrypt: (s: string) => `enc:${Buffer.from(s).toString("base64")}`, decrypt: (s: string) => Buffer.from(s.slice(4), "base64").toString() };
const tmp = () => mkdtempSync(join(tmpdir(), "shrike-api-"));

// ---- formats ----

test("bru: every fixture file round-trips byte for byte, and edits touch only their block", () => {
  for (const f of files(FIX + "bru-sample", /\.bru$/)) {
    const src = readFileSync(f, "utf8");
    assert.equal(serializeBru(parseBru(src)), src, f);
    if (/collection\.bru$|folder\.bru$/.test(f)) assert.equal(defaultsToBru(bruToDefaults(src), src), src, f);
    else if (f.includes("/environments/")) assert.equal(envToBru(bruToEnv("Local", src)), src, f);
    else assert.equal(requestToBru(bruToRequest(parseBru(src), "x.bru"), src), src, f);
  }
  const src = readFileSync(FIX + "bru-sample/users/Get user.bru", "utf8");
  const r = bruToRequest(parseBru(src));
  assert.equal(r.method, "GET");
  assert.deepEqual(r.params[1], { name: "verbose", value: "1", enabled: false });
  assert.deepEqual(r.assertions[2], { expr: "res.body.name", op: "isString", value: "", enabled: false });
  assert.equal(r.docs, "Reads one user.\n\nUses the folder headers.");
  assert.match(r.scripts.pre!, /bru\.setVar/);
  const edited = requestToBru({ ...r, headers: [...r.headers, { name: "x-new", value: "1", enabled: true }] }, src);
  const changed = edited.split("\n").filter((l, k) => l !== src.split("\n")[k]);
  assert.deepEqual(changed.slice(0, 1), ["  x-new: 1"]);
  assert.equal(edited.replace("  x-new: 1\n", ""), src);
  // unknown auth (oauth2) stays in the file through an edit
  const oauth = readFileSync(FIX + "bru-sample/users/Create user.bru", "utf8");
  const o = bruToRequest(parseBru(oauth));
  assert.equal(o.auth.type, "none");
  const o2 = requestToBru({ ...o, url: "{{baseUrl}}/api/v2/users" }, oauth);
  assert.match(o2, /auth:oauth2 \{\n {2}grant_type: client_credentials/);
  assert.match(o2, /url: \{\{baseUrl\}\}\/api\/v2\/users/);
  // a new request reads back the same
  const fresh: ApiRequest = blankRequest({ name: "New", seq: 9, method: "PATCH", url: "/x", headers: [{ name: "a", value: "b:c", enabled: true }], body: { type: "json", data: '{\n  "a": 1\n}' }, auth: { type: "bearer", token: "{{t}}" }, assertions: [{ expr: "res.status", op: "in", value: "200,201", enabled: true }], scripts: { post: "bru.setVar('a', 1);" }, docs: "Line one\nLine two" });
  assert.deepEqual(bruToRequest(parseBru(requestToBru(fresh)), ""), { ...fresh, path: "" });
});

test("bru: environments keep secret values out of the file", () => {
  const text = envToBru({ name: "Prod", vars: [{ name: "baseUrl", value: "https://x", enabled: true }, { name: "token", value: "real-secret", enabled: true, secret: true }] });
  assert.doesNotMatch(text, /real-secret/);
  assert.deepEqual(bruToEnv("Prod", text).vars[1], { name: "token", value: "", enabled: true, secret: true });
});

test("yaml: OpenCollection fixtures round-trip and edits keep unknown keys", () => {
  for (const f of files(FIX + "yaml-sample", /\.yml$/)) {
    const src = readFileSync(f, "utf8");
    assert.deepEqual(parseYaml(stringifyYaml(parseYaml(src))), parseYaml(src), f);
    if (!/opencollection|folder/.test(f)) assert.equal(requestToOc(ocToRequest(src, "x.yml"), src), src, f);
  }
  const src = readFileSync(FIX + "yaml-sample/users/Create user.yml", "utf8");
  const r = ocToRequest(src);
  assert.equal(r.method, "POST");
  assert.deepEqual(r.vars.post, [{ name: "userId", value: "res.body.id", enabled: true }]);
  assert.match(r.scripts.post!, /setVar/);
  const out = requestToOc({ ...r, url: "{{baseUrl}}/api/v2/users" }, src);
  assert.match(out, /type: oauth2/); // auth Shrike can't send is kept
  assert.match(out, /method: post/); // untouched values keep their spelling
  assert.equal(ocToRequest(out).url, "{{baseUrl}}/api/v2/users");
  assert.deepEqual({ ...ocToRequest(out), url: r.url }, r);
  const list = ocToRequest(readFileSync(FIX + "yaml-sample/users/List users.yml", "utf8"));
  assert.deepEqual(list.headers[1], { name: "X-Debug", value: "1", enabled: false });
  assert.deepEqual(parseYaml("a: |\n  x\n  # not a comment\n\n  y\nb: 'it''s'\nc: [1, \"two\"]\nd: {e: f}\n"), { a: "x\n# not a comment\n\ny\n", b: "it's", c: [1, "two"], d: { e: "f" } });
});

// Read-only check against a real Bruno workspace: SHRIKE_BRUNO_DIR=~/Desktop/Bruno node --test ...
test("real Bruno collections parse without writing anything", { skip: !process.env.SHRIKE_BRUNO_DIR && "set SHRIKE_BRUNO_DIR to run" }, async () => {
  const dir = process.env.SHRIKE_BRUNO_DIR!;
  const all = files(dir, /\.(ya?ml|bru|json)$/);
  const hash = () => all.map((f) => `${f}:${statSync(f).mtimeMs}:${createHash("sha1").update(readFileSync(f)).digest("hex")}`).join("\n");
  const before = hash();
  const state = tmp();
  const cols = createCollections({ stateDir: () => state, projectRoot: () => "/project", keychain });
  let requests = 0;
  for (const name of readdirSync(dir)) {
    const root = join(dir, name);
    if (!statSync(root).isDirectory()) continue;
    const c = await cols.link(root);
    assert.deepEqual(c.warnings.filter((w) => /couldn't be read/.test(w)), [], name);
    const walk = async (ns: typeof c.tree): Promise<void> => {
      for (const n of ns) {
        if (n.type === "folder") await walk(n.children);
        else {
          const r = await cols.readRequest(c.id, n.path);
          const src = readFileSync(join(root, n.path), "utf8");
          assert.equal(c.format === "yaml" ? requestToOc(r, src) : requestToBru(r, src), src, n.path);
          requests++;
        }
      }
    };
    await walk(c.tree);
  }
  assert.ok(requests > 0);
  assert.equal(hash(), before);
  rmSync(state, { recursive: true, force: true });
});

// ---- vars, assertions, scripts ----

test("vars: Bruno precedence and built-ins", () => {
  const scope = scopeOf([{ name: "a", value: "collection", enabled: true }, { name: "base", value: "http://h", enabled: true }], { a: "env", b: "env" }, [{ name: "b", value: "folder", enabled: true }], [{ name: "url", value: "{{base}}/x", enabled: true }, { name: "off", value: "no", enabled: false }], { c: "runtime" });
  assert.equal(interpolate("{{a}} {{b}} {{c}} {{url}} {{missing}} {{off}}", scope), "env folder runtime http://h/x {{missing}} {{off}}");
  assert.match(interpolate("{{$randomUUID}}", {}), /^[0-9a-f-]{36}$/);
  assert.match(interpolate("{{$timestamp}}", {}), /^\d{10}$/);
});

test("assertions: Bruno operators over status, body paths and headers", () => {
  const res = { status: 201, headers: { "Content-Type": "application/json" }, body: { id: 7, name: "Ada", tags: ["a", "b"], nil: null, nested: { "a.b": true } }, responseTime: 12 };
  const ok = (expr: string, op: string, value = "") => runAssertions([{ expr, op, value, enabled: true }], res, { want: "201" })[0]!;
  for (const [e, op, v] of [
    ["res.status", "eq", "201"], ["res.status", "eq", "{{want}}"], ["res.status", "neq", "200"], ["res.status", "in", "200,201"], ["res.status", "between", "200, 299"],
    ["res.body.id", "isNumber"], ["res.body.id", "gt", "5"], ["res.body.id", "lte", "7"], ["res.body.name", "startsWith", "A"], ["res.body.name", "matches", "/^ad/i"],
    ["res.body.tags", "length", "2"], ["res.body.tags", "contains", '"b"'], ["res.body.tags[0]", "eq", '"a"'], ["res.body.nil", "isNull"], ["res.body.missing", "isUndefined"],
    ["res.body", "isJson"], ["res.headers.content-type", "contains", "json"], ["res.responseTime", "lt", "1000"], ['res.body.nested["a.b"]', "isTruthy"], ["res.body.tags", "isNotEmpty"],
  ] as const) assert.equal(ok(e, op, v).ok, true, `${e} ${op} ${v}`);
  assert.equal(ok("res.status", "eq", "200").ok, false);
  assert.equal(ok("res.status", "eq", "200").actual, "201");
  assert.match(ok("res.status", "nope").error!, /Unknown check/);
  assert.equal(runAssertions([{ expr: "res.status", op: "eq", value: "0", enabled: false }], res, {}).length, 0);
});

test("scripts: bru, req and res work; escapes are refused; runaway code is stopped", async () => {
  const base = { req: { method: "GET", url: "http://h/x", headers: { a: "1" }, body: undefined }, vars: { v: "1" }, env: { e: "2" } };
  const out = await runScript({ ...base, code: 'bru.setVar("x", bru.getVar("v") + bru.getEnvVar("e")); req.setHeader("B", "2"); req.setUrl(req.getUrl() + "?y=1"); console.log("hi", {n: 1});' });
  assert.equal(out.error, undefined);
  assert.deepEqual(out.setVars, { x: "12" });
  assert.deepEqual(out.req.headers, { a: "1", B: "2" });
  assert.equal(out.req.url, "http://h/x?y=1");
  assert.deepEqual(out.logs, ['hi {"n":1}']);
  const post = await runScript({ ...base, res: { status: 200, statusText: "OK", headers: {}, body: { id: 3 }, responseTime: 5 }, code: 'test("id", () => expect(res.getBody().id).to.equal(3)); test("bad", () => expect(res.status).to.equal(500)); bru.setVar("id", res.body.id);' });
  assert.deepEqual(post.tests.map((t) => t.ok), [true, false]);
  assert.equal(post.setVars.id, "3");
  for (const code of [
    'bru.setVar("p", typeof process + typeof require + typeof fetch + typeof setTimeout + typeof globalThis.process);',
    'bru.setVar("p", this === undefined ? "strict" : typeof this.process);',
  ]) assert.match(Object.values((await runScript({ ...base, code })).setVars).join(""), /^(undefined)+$|^strict$/, code);
  for (const code of [
    'return this.constructor.constructor("return process")().pid;',
    'return bru.setVar.constructor("return process")();',
    'return (function(){}).constructor("return process")();',
    "return eval('process');",
    'return import("node:fs");',
    'return res.constructor.constructor("return globalThis.process.mainModule")();',
  ]) {
    const r = await runScript({ ...base, code });
    assert.ok(r.error, code);
    assert.doesNotMatch(JSON.stringify(r), /"pid"|\d{3,}/, code);
  }
  const t0 = Date.now();
  assert.match((await runScript({ ...base, code: "while (true) {}" }, 300)).error!, /longer than 0.3s/);
  assert.match((await runScript({ ...base, code: "await Promise.resolve(); while (true) {}" }, 300)).error!, /longer than 0.3s/);
  assert.match((await runScript({ ...base, code: "})(); throw { get message() { while (true) {} } }; (async function () {" }, 300)).error!, /stopped|longer/);
  assert.match((await runScript({ ...base, code: "this is not js" })).error!, /syntax error/);
  assert.ok(Date.now() - t0 < 3000);
});

// ---- the executor, against a local server ----

let srv: ReturnType<typeof createServer>;
let base = "";
const seen: { method: string; url: string; headers: IncomingMessage["headers"]; body: Buffer }[] = [];
before(async () => {
  srv = createServer((req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks);
      seen.push({ method: req.method!, url: req.url!, headers: req.headers, body });
      const u = new URL(req.url!, "http://x");
      if (u.pathname === "/redirect") return void res.writeHead(302, { location: "/echo?from=redirect" }).end();
      if (u.pathname === "/away") return void res.writeHead(302, { location: `http://localhost:${(srv.address() as AddressInfo).port}/echo` }).end();
      if (u.pathname === "/cookie") return void res.writeHead(200, { "set-cookie": "sid=abc; Path=/; HttpOnly" }).end("ok");
      if (u.pathname === "/slow") return void setTimeout(() => res.writeHead(200).end("late"), 1500);
      if (u.pathname === "/drip") return void (res.writeHead(200), res.on("close", clearInterval.bind(null, setInterval(() => res.write("x"), 50))));
      if (u.pathname === "/bin") return void res.writeHead(200, { "content-type": "image/png" }).end(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2]));
      if (u.pathname === "/gzip") return void res.writeHead(200, { "content-type": "application/json", "content-encoding": "gzip" }).end(gzipSync('{"zipped":true}'));
      if (u.pathname === "/login") return void res.writeHead(200, { "content-type": "application/json" }).end('{"token":"t-123","user":{"id":7}}');
      res.writeHead(u.pathname === "/fail" ? 500 : 200, { "content-type": "application/json" }).end(JSON.stringify({ method: req.method, url: req.url, headers: req.headers, body: body.toString() }));
    });
  }).listen(0, "127.0.0.1");
  await new Promise((r) => srv.once("listening", r));
  base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
});
after(() => srv.close());
const last = () => seen[seen.length - 1]!;
const req = (over: Partial<ApiRequest>) => blankRequest({ name: "t", ...over });

test("exec: url, params, path params, headers, auth inheritance and every body type", async () => {
  const ctx = {
    baseUrl: base,
    collection: { headers: [{ name: "x-col", value: "c", enabled: true }], auth: { type: "bearer" as const, token: "{{token}}" }, vars: [{ name: "v", value: "collection", enabled: true }] },
    folders: [{ headers: [{ name: "x-col", value: "folder", enabled: true }], auth: { type: "inherit" as const }, vars: [] }],
    env: { token: "env-token", host: base },
  };
  let r = await execute(req({ method: "POST", url: "{{host}}/echo/:id?old=1", params: [{ name: "q", value: "{{v}}", enabled: true }, { name: "off", value: "x", enabled: false }], pathParams: [{ name: "id", value: "a b", enabled: true }], body: { type: "json", data: '{"v":"{{v}}"}' } }), ctx);
  assert.equal(r.response?.status, 200);
  assert.equal(last().url, "/echo/a%20b?q=collection");
  assert.equal(last().headers.authorization, "Bearer env-token");
  assert.equal(last().headers["x-col"], "folder");
  assert.equal(last().headers["content-type"], "application/json");
  assert.equal(last().body.toString(), '{"v":"collection"}');
  assert.equal(r.sent.headers.Authorization, "Bearer env-token");

  await execute(req({ method: "POST", url: "/echo", auth: { type: "basic", username: "u", password: "p" }, body: { type: "form-urlencoded", fields: [{ name: "a", value: "1 2", enabled: true }, { name: "b", value: "x", enabled: false }] } }), { baseUrl: base });
  assert.equal(last().headers.authorization, `Basic ${Buffer.from("u:p").toString("base64")}`);
  assert.equal(last().body.toString(), "a=1+2");
  assert.equal(last().headers["content-type"], "application/x-www-form-urlencoded");

  await execute(req({ url: "/echo", auth: { type: "apikey", key: "k", value: "secret", placement: "query" } }), { baseUrl: base });
  assert.equal(last().url, "/echo?k=secret");
  await execute(req({ url: "/echo", auth: { type: "apikey", key: "x-api-key", value: "s2", placement: "header" } }), { baseUrl: base });
  assert.equal(last().headers["x-api-key"], "s2");
  await assert.rejects(execute(req({ url: "/echo", auth: { type: "bearer", token: "[redacted:token]" } }), { baseUrl: base }), /Type the real value for \[redacted:token\] first/, "a hidden value from a resend is never sent");

  const dir = tmp();
  writeFileSync(join(dir, "a.txt"), "file-bytes");
  await execute(req({ method: "POST", url: "/echo", body: { type: "multipart", fields: [{ name: "title", value: "T", enabled: true }, { name: "f", value: join(dir, "a.txt"), enabled: true, file: true }] } }), { baseUrl: base });
  assert.match(String(last().headers["content-type"]), /^multipart\/form-data; boundary=/);
  assert.match(last().body.toString(), /name="title"\r\n\r\nT\r\n/);
  assert.match(last().body.toString(), /name="f"; filename="a.txt"[\s\S]*file-bytes/);
  rmSync(dir, { recursive: true, force: true });

  await execute(req({ method: "POST", url: "/echo", body: { type: "graphql", query: "{ me { id } }", variables: '{"a":1}' } }), { baseUrl: base });
  assert.deepEqual(JSON.parse(last().body.toString()), { query: "{ me { id } }", variables: { a: 1 } });
  for (const [type, ct] of [["xml", "application/xml"], ["text", "text/plain"]] as const) {
    await execute(req({ method: "PUT", url: "/echo", body: { type, data: "<a/>" } }), { baseUrl: base });
    assert.equal(last().headers["content-type"], ct);
  }
  r = await execute(req({ method: "DELETE", url: "/echo", body: { type: "none" } }), { baseUrl: base });
  assert.equal(last().body.length, 0);
  assert.equal(r.response?.timings.totalMs !== undefined && r.response.timings.ttfbMs !== undefined, true);
});

test("exec: redirects, cookies, gzip, binary, timeouts, cancel, unreachable", async () => {
  let r = await execute(req({ url: "/redirect" }), { baseUrl: base });
  assert.equal(r.response?.status, 200);
  assert.equal(r.response?.redirects, 1);
  assert.match(r.response!.url, /\/echo\?from=redirect$/);
  r = await execute(req({ url: "/redirect", settings: { followRedirects: false } }), { baseUrl: base });
  assert.equal(r.response?.status, 302);
  r = await execute(req({ url: "/away" }), { baseUrl: base, trigger: "agent" });
  assert.equal(r.response?.status, 302, "agent sends never follow a redirect to another origin");
  const fdir = mkdtempSync(join(tmpdir(), "shrike-mp-"));
  writeFileSync(join(fdir, "a.txt"), "from-collection");
  await execute(req({ url: "/echo", method: "POST", body: { type: "multipart", fields: [{ name: "f", value: "a.txt", enabled: true, file: true }] } }), { baseUrl: base, root: fdir });
  assert.match(last().body.toString(), /from-collection/, "Bruno @file() paths resolve against the collection folder");
  rmSync(fdir, { recursive: true });

  const jar = new CookieJar();
  await execute(req({ url: "/cookie" }), { baseUrl: base, jar });
  await execute(req({ url: "/echo" }), { baseUrl: base, jar });
  assert.equal(last().headers.cookie, "sid=abc");

  r = await execute(req({ url: "/gzip" }), { baseUrl: base });
  assert.equal(r.response?.body, '{"zipped":true}');
  r = await execute(req({ url: "/bin" }), { baseUrl: base });
  assert.equal(r.response?.bodyEncoding, "base64");
  assert.deepEqual([...Buffer.from(r.response!.body, "base64")], [0x89, 0x50, 0x4e, 0x47, 0, 1, 2]);

  r = await execute(req({ url: "/slow", settings: { timeoutMs: 200 } }), { baseUrl: base });
  assert.match(r.error!, /No answer from 127\.0\.0\.1:\d+ after 200ms/);
  r = await execute(req({ url: "/drip", settings: { timeoutMs: 300 } }), { baseUrl: base }); // before: a body that never ends hung the send forever
  assert.match(r.error!, /127\.0\.0\.1:\d+ was still sending after 300ms, so Shrike stopped waiting/);
  const ac = new AbortController();
  setTimeout(() => ac.abort(), 100);
  r = await execute(req({ url: "/slow" }), { baseUrl: base, signal: ac.signal });
  assert.equal(r.error, "Cancelled.");
  r = await execute(req({ url: "http://127.0.0.1:1/x" }), {});
  assert.match(r.error!, /Nothing is listening on 127\.0\.0\.1:1/);
  await assert.rejects(execute(req({ url: "file:///etc/passwd" }), {}), /Only http and https/);
  await assert.rejects(execute(req({ url: "/x" }), {}), /Run your app first/);
});

test("exec: TLS check on by default, off when asked, with a TLS timing", async (t) => {
  const dir = tmp();
  try {
    execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", join(dir, "k.pem"), "-out", join(dir, "c.pem"), "-days", "1", "-subj", "/CN=localhost"], { stdio: "ignore" });
  } catch {
    t.skip("no openssl");
    return;
  }
  const s = createHttps({ key: readFileSync(join(dir, "k.pem")), cert: readFileSync(join(dir, "c.pem")) }, (_q, r) => r.writeHead(200).end("secure")).listen(0, "127.0.0.1");
  await new Promise((r) => s.once("listening", r));
  const url = `https://127.0.0.1:${(s.address() as AddressInfo).port}/`;
  try {
    assert.match((await execute(req({ url }), {})).error!, /certificate Shrike doesn't trust/);
    const ok = await execute(req({ url, settings: { verifyTls: false } }), {});
    assert.equal(ok.response?.body, "secure");
    assert.equal(typeof ok.response?.timings.tlsMs, "number");
  } finally {
    s.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("exec: post-response vars, assertions, scripts and the trip on the Thread", async () => {
  const store = new Store({ projectRoot: () => "/p", onUpdate: () => {} });
  const r = await execute(
    req({
      method: "POST",
      url: "/login",
      vars: { pre: [], post: [{ name: "token", value: "res.body.token", enabled: true }, { name: "uid", value: "res.body.user.id", enabled: true }] },
      assertions: [{ expr: "res.status", op: "eq", value: "200", enabled: true }, { expr: "res.body.token", op: "startsWith", value: "nope", enabled: true }],
      scripts: { pre: 'req.setHeader("x-pre", bru.getVar("who"));', post: 'bru.setVar("upper", res.getBody().token.toUpperCase());', tests: 'test("has token", () => expect(bru.getVar("token")).to.equal("t-123"));' },
    }),
    { baseUrl: base, store, runScripts: true, env: { who: "ada" } },
  );
  assert.equal(last().headers["x-pre"], "ada");
  assert.deepEqual(r.setVars, { token: "t-123", uid: "7", upper: "T-123" });
  assert.deepEqual(r.assertions.map((a) => [a.op, a.ok]), [["eq", true], ["startsWith", false], ["test", true]]);
  const view = await store.waitForAction(r.actionId!, 2000);
  assert.equal(view?.label, "Sent POST /login");
  assert.equal(view?.trigger, "explorer");
  assert.equal(last().headers.traceparent, `00-${view?.traceId}-${view?.tree[0]?.event.id}-01`);
  // scripts don't run unless asked (agent sends)
  const quiet = await execute(req({ url: "/echo", scripts: { pre: 'req.setHeader("x-pre", "1")' } }), { baseUrl: base });
  assert.equal(quiet.response?.status, 200);
  assert.equal(last().headers["x-pre"], undefined);
});

// ---- imports and code ----

test("import: Chrome's Copy as cURL, Postman v2.1, OpenAPI 3 YAML and scanned routes", () => {
  const chrome = String.raw`curl 'https://api.example.com/v1/todos?page=2&q=a%20b' \
  -H 'accept: application/json' \
  -H 'authorization: Bearer abc.def' \
  -H 'content-type: application/json' \
  -b 'sid=1; theme=dark' \
  --data-raw $'{"title":"it\'s","done":false}' \
  --compressed`;
  const c = parseCurl(chrome);
  assert.equal(c.method, "POST");
  assert.equal(c.url, "https://api.example.com/v1/todos?page=2&q=a%20b");
  assert.deepEqual(c.params, [{ name: "page", value: "2", enabled: true }, { name: "q", value: "a b", enabled: true }]);
  assert.equal(c.body.type, "json");
  assert.equal(JSON.parse((c.body as { data: string }).data).title, "it's");
  assert.deepEqual(c.headers.map((h) => h.name), ["accept", "authorization", "Cookie"]);
  const f = parseCurl("curl -XPUT -u ada:pw -F 'avatar=@/tmp/a.png' -F name=Ada http://localhost:3000/u/:id");
  assert.equal(f.method, "PUT");
  assert.deepEqual(f.auth, { type: "basic", username: "ada", password: "pw" });
  assert.deepEqual(f.body, { type: "multipart", fields: [{ name: "avatar", value: "/tmp/a.png", enabled: true, file: true }, { name: "name", value: "Ada", enabled: true }] });
  assert.deepEqual(f.pathParams, [{ name: "id", value: "", enabled: true }]);
  assert.deepEqual(parseCurl("curl -d a=1 -d b=2 localhost:3000/f").body, { type: "form-urlencoded", fields: [{ name: "a", value: "1", enabled: true }, { name: "b", value: "2", enabled: true }] });
  assert.throws(() => parseCurl("wget x"), /curl command/);

  const pm = importPostman(JSON.stringify({
    info: { name: "PM", schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json" },
    variable: [{ key: "baseUrl", value: "http://localhost:3000" }],
    auth: { type: "bearer", bearer: [{ key: "token", value: "{{token}}" }] },
    item: [
      { name: "Users", item: [{ name: "Get", request: { method: "GET", url: { raw: "{{baseUrl}}/users/:id?x=1", query: [{ key: "x", value: "1" }], variable: [{ key: "id", value: "5" }] }, header: [{ key: "a", value: "b", disabled: true }] }, event: [{ listen: "test", script: { exec: ["pm.test('ok')"] } }] }] },
      { name: "Create", request: { method: "POST", url: "{{baseUrl}}/users", body: { mode: "raw", raw: '{"a":1}', options: { raw: { language: "json" } } }, auth: { type: "oauth2" } } },
    ],
  }));
  assert.deepEqual(pm.folders, ["Users"]);
  assert.equal(pm.requests[0]!.folder, "Users");
  assert.deepEqual(pm.requests[0]!.req.pathParams, [{ name: "id", value: "5", enabled: true }]);
  assert.equal(pm.requests[0]!.req.headers[0]!.enabled, false);
  assert.match(pm.requests[0]!.req.scripts.tests!, /^\/\/ From Postman/);
  assert.deepEqual(pm.requests[1]!.req.body, { type: "json", data: '{"a":1}' });
  assert.equal(pm.auth.type, "bearer");
  assert.equal(pm.notes.length, 2);

  const oa = importOpenApi(`openapi: 3.0.3
info:
  title: Pets
servers:
  - url: http://localhost:4000/v1
components:
  securitySchemes:
    bearer:
      type: http
      scheme: bearer
  schemas:
    Pet:
      type: object
      properties:
        name:
          type: string
        age:
          type: integer
paths:
  /pets/{petId}:
    parameters:
      - name: petId
        in: path
        required: true
        schema:
          type: string
          example: p1
    get:
      tags: [pets]
      summary: Get a pet
      parameters:
        - name: verbose
          in: query
          schema:
            type: boolean
    put:
      tags: [pets]
      operationId: updatePet
      requestBody:
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/Pet"
`);
  assert.deepEqual(oa.vars, [{ name: "baseUrl", value: "http://localhost:4000/v1", enabled: true }]);
  assert.equal(oa.auth.type, "bearer");
  assert.deepEqual(oa.requests.map((r) => [r.folder, r.req.name, r.req.method, r.req.url]), [["pets", "Get a pet", "GET", "{{baseUrl}}/pets/:petId"], ["pets", "updatePet", "PUT", "{{baseUrl}}/pets/:petId"]]);
  assert.deepEqual(oa.requests[0]!.req.pathParams, [{ name: "petId", value: "p1", enabled: true }]);
  assert.deepEqual(JSON.parse((oa.requests[1]!.req.body as { data: string }).data), { name: "name", age: 1 });

  const rt = importRoutes([{ method: "GET", path: "/api/todos" }, { method: "DELETE", path: "/api/todos/:id" }, { method: "GET", path: "/api/users/[id]" }], "http://localhost:5173", "Routes");
  assert.deepEqual(rt.requests.map((r) => r.req.url), ["{{baseUrl}}/api/todos", "{{baseUrl}}/api/todos/:id", "{{baseUrl}}/api/users/:id"]);
  assert.equal(rt.environments[0]!.vars[0]!.value, "http://localhost:5173");
});

test("code: curl, fetch, axios, python and httpie from the prepared request", async () => {
  const p = await prepare(req({ method: "POST", url: "{{b}}/x", headers: [{ name: "a", value: "it's", enabled: true }], body: { type: "json", data: '{"k":1}' } }), { env: { b: "http://localhost:3000" } });
  assert.equal(toCode(p, "curl"), "curl -X POST http://localhost:3000/x \\\n  -H 'a: it'\\''s' \\\n  -H content-type:\\ application/json \\\n  --data-raw '{\"k\":1}'".replace("content-type:\\ application/json", "'content-type: application/json'"));
  assert.match(toCode(p, "fetch"), /await fetch\("http:\/\/localhost:3000\/x", \{\n {2}method: "POST"/);
  assert.match(toCode(p, "axios"), /data: "\{\\"k\\":1\}"/);
  assert.match(toCode(p, "python"), /requests\.request\("POST", "http:\/\/localhost:3000\/x", headers=headers, data=data\.encode\(\)\)/);
  assert.match(toCode(p, "httpie"), /^printf %s '\{"k":1\}' \| http POST/);
});

// ---- collections on disk, secrets, history, edit and resend ----

test("collections: create, save, rename, environments with keychain secrets, links and path safety", async () => {
  const project = tmp();
  const state = tmp();
  const cols = createCollections({ stateDir: () => state, projectRoot: () => project, keychain });
  const c = await cols.create("My API");
  assert.equal(c.format, "bru");
  assert.ok(existsSync(join(project, ".shrike/api/My API/bruno.json")));
  await cols.createFolder(c.id, "Users");
  const { path } = await cols.saveRequest(c.id, req({ name: "Get user", url: "{{baseUrl}}/users/:id", pathParams: [{ name: "id", value: "1", enabled: true }] }), "Users");
  assert.equal(path, "Users/Get user.bru");
  const second = await cols.saveRequest(c.id, req({ name: "Get user" }), "Users");
  assert.equal(second.path, "Users/Get user 2.bru");
  const r = await cols.readRequest(c.id, path);
  assert.equal(r.seq, 1);
  assert.equal((await cols.readRequest(c.id, second.path)).seq, 2);
  const unchanged = readFileSync(join(project, ".shrike/api/My API", path), "utf8");
  await cols.saveRequest(c.id, r);
  assert.equal(readFileSync(join(project, ".shrike/api/My API", path), "utf8"), unchanged);
  let view = await cols.renameItem(c.id, path, "Read user");
  const folder = view.tree.find((n) => n.type === "folder");
  assert.equal(folder?.type === "folder" && folder.children.map((n) => n.path).join(","), "Users/Read user.bru,Users/Get user 2.bru");

  view = await cols.saveEnvironment(c.id, { name: "Local", vars: [{ name: "baseUrl", value: "http://localhost:3000", enabled: true }, { name: "token", value: "s3cret", enabled: true, secret: true }] });
  assert.deepEqual(view.environments, ["Local"]);
  assert.doesNotMatch(readFileSync(join(project, ".shrike/api/My API/environments/Local.bru"), "utf8"), /s3cret/);
  assert.doesNotMatch(readFileSync(join(state, "api-secrets.json"), "utf8"), /s3cret/);
  assert.equal((await cols.readEnvironment(c.id, "Local")).vars[1]!.value, "s3cret");
  assert.deepEqual(await cols.envScope(c.id, "Local"), { baseUrl: "http://localhost:3000", token: "s3cret" });

  // a linked Bruno folder (a copy of the fixture) is read and written in place
  const linked = join(tmp(), "bru-sample");
  cpSync(FIX + "bru-sample", linked, { recursive: true });
  const l = await cols.link(linked);
  assert.equal(l.owned, false);
  assert.equal(l.name, "Sample API");
  assert.deepEqual(l.environments, ["Local"]);
  assert.deepEqual(cols.layers(l.id, "users/Get user.bru").folders[0]!.headers, [{ name: "x-folder", value: "users", enabled: true }]);
  const y = await cols.link(join(FIX, "yaml-sample"));
  assert.equal(y.format, "yaml");
  assert.deepEqual(y.environments, ["Local"]);
  assert.equal(y.defaults.auth.type, "bearer");
  assert.equal(cols.list().length, 3);
  await cols.unlink(y.id);
  assert.equal(cols.list().length, 2);

  await assert.rejects(cols.deleteItem(c.id, "."), /Pick a request/);
  assert.ok(existsSync(join(project, ".shrike/api/My API/bruno.json")));
  assert.throws(() => safeJoin(project, "../x"), /isn't allowed/);
  assert.throws(() => safeJoin(project, ".claude/settings.json"), /isn't allowed/);
  symlinkSync(tmpdir(), join(linked, "escape"));
  assert.throws(() => safeJoin(linked, "escape/x.bru"), /link to somewhere else/);
  await assert.rejects(cols.saveRequest(l.id, req({ name: "x" }), "escape"), /link to somewhere else/);
  assert.match(l.warnings.join(" "), /^$|token saved/);
  for (const d of [project, state, linked]) rmSync(d, { recursive: true, force: true });
});

test("history: redacted before it's written, newest first, capped", async () => {
  const state = tmp();
  const h = createHistory({ stateDir: () => state, projectRoot: () => "/p" });
  const r = req({ url: "/x?api_key=abcdef0123456789abcdef0123456789", headers: [{ name: "Authorization", value: "Bearer real-token", enabled: true }, { name: "x-trace", value: "{{token}}", enabled: true }], auth: { type: "bearer", token: "literal-token" }, body: { type: "json", data: '{"password":"hunter2hunter2"}' } });
  const red = redactRequest(r);
  assert.equal(red.headers[0]!.value, "[redacted:authorization]");
  assert.equal(red.headers[1]!.value, "{{token}}");
  assert.deepEqual(red.auth, { type: "bearer", token: "[redacted:token]" });
  for (let k = 0; k < 205; k++) void h.add({ id: String(k), at: k, method: "GET", url: r.url, request: r });
  await h.add({ id: "last", at: 999, method: "GET", url: r.url, request: r });
  const list = await h.list();
  assert.equal(list.length, 200);
  assert.equal(list[0]!.id, "last");
  assert.doesNotMatch(readFileSync(join(state, "api-history", `${createHash("sha1").update("/p").digest("hex").slice(0, 16)}.json`), "utf8"), /real-token|literal-token|hunter2/);
  // clear() empties this project's history on disk and leaves other projects alone
  const h2 = createHistory({ stateDir: () => state, projectRoot: () => "/p2" });
  await h2.add({ id: "p2-1", at: 1, method: "GET", url: r.url, request: r });
  await h.clear();
  assert.deepEqual(await h.list(), []);
  assert.equal((await h2.list()).length, 1);
  rmSync(state, { recursive: true, force: true });
});

test("service: edit and resend a captured trip, send with a collection's env, agent sends skip scripts", async () => {
  const project = tmp();
  const state = tmp();
  const store = new Store({ projectRoot: () => project, onUpdate: () => {} });
  const api = createApi({ stateDir: () => state, projectRoot: () => project, keychain, store, baseUrl: () => base, routes: () => [{ method: "GET", path: "/echo" }], getAction: (id) => store.getAction(id) });
  const first = await api.send(req({ method: "POST", url: "/echo?a=1", headers: [{ name: "x-a", value: "1", enabled: true }], body: { type: "json", data: '{"t":1}' } }));
  await store.waitForAction(first.actionId!, 2000);
  const again = await api.fromTrip(first.actionId!);
  assert.equal(again.method, "POST");
  assert.equal(again.url, "/echo?a=1");
  assert.deepEqual(again.params, [{ name: "a", value: "1", enabled: true }]);
  assert.deepEqual(again.body, { type: "json", data: '{"t":1}' });
  assert.ok(!again.headers.some((h) => /traceparent/i.test(h.name)));
  assert.ok(again.headers.some((h) => h.name === "x-a"));

  const col = (await api.import("routes", undefined, "Routes")) as { id: string };
  const r = await api.send(req({ url: "{{baseUrl}}/echo" }), { collectionId: col.id, environment: "Local" });
  assert.equal(r.response?.status, 200);
  assert.equal((await api.history()).length, 2);
  const agent = await api.host.send({ method: "GET", url: `${base}/echo?z=1` });
  assert.equal(agent.response.status, 200);
  assert.equal(last().url, "/echo?z=1");
  assert.match(await api.code(req({ url: "/echo" }), "curl"), new RegExp(`^curl ${base.replace(/[.]/g, "\\.")}/echo`));
  const saved = await api.host.save({ name: "From agent", method: "GET", url: "{{baseUrl}}/echo?x=1" });
  assert.match(saved, /From agent\.bru$/);
  assert.equal((await api.host.list()).some((x) => x.name === "From agent"), true);
  for (const d of [project, state]) rmSync(d, { recursive: true, force: true });
});
