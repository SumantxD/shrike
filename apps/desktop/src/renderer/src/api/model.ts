import type { ApiKv, ApiRequest, Route } from "@shrike/schema";

// AP: the editor's request model (rows carry ids for React) and its pure helpers. Main builds and sends (main/api).

export interface Row {
  id: string;
  name: string;
  value: string;
  on: boolean;
  secret?: boolean;
  file?: string; // multipart: the absolute path the user picked
}
export type BodyMode = "none" | "json" | "text" | "xml" | "form" | "multipart" | "graphql";
export interface Body {
  mode: BodyMode;
  text: string; // json, text, xml, the graphql query
  form: Row[];
  gqlVars: string;
}
export type AuthType = "inherit" | "none" | "bearer" | "basic" | "apikey";
export interface Auth {
  type: AuthType;
  token?: string;
  username?: string;
  password?: string;
  key?: string;
  value?: string;
  placement?: "header" | "query";
}
export interface Assertion {
  id: string;
  expr: string;
  op: string;
  value: string;
  on: boolean;
}
export interface PostVar {
  id: string;
  name: string;
  selector: string;
  on: boolean;
}
export interface Req {
  id: string;
  path: string; // collection-relative file; "" until saved
  name: string;
  method: string;
  url: string;
  params: Row[]; // query only; path params come from the URL
  pathVals: Record<string, string>;
  headers: Row[];
  body: Body;
  auth: Auth;
  vars: Row[];
  post: PostVar[];
  asserts: Assertion[];
  docs: string;
  scripts: ApiRequest["scripts"];
  settings: ApiRequest["settings"];
  seq?: number;
}

export const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];
export const hasBody = (m: string): boolean => !["GET", "HEAD"].includes(m.toUpperCase());

let n = 0;
export const uid = (): string => `${Date.now().toString(36)}${(++n).toString(36)}${Math.random().toString(36).slice(2, 6)}`;
export const row = (name = "", value = "", on = true): Row => ({ id: uid(), name, value, on });

export function blankReq(p: Partial<Req> = {}): Req {
  return {
    id: uid(),
    path: "",
    name: "New request",
    method: "GET",
    url: "",
    params: [],
    pathVals: {},
    headers: [],
    body: { mode: "none", text: "", form: [], gqlVars: "" },
    auth: { type: "inherit" },
    vars: [],
    post: [],
    asserts: [],
    docs: "",
    scripts: {},
    settings: {},
    ...p,
  };
}

// ---------- URL and params, both ways ----------

export function splitUrl(url: string): { base: string; query: string } {
  const i = url.indexOf("?");
  return i < 0 ? { base: url, query: "" } : { base: url.slice(0, i), query: url.slice(i + 1) };
}

export function parseQuery(q: string): { name: string; value: string }[] {
  return q
    .split("&")
    .filter(Boolean)
    .map((p) => {
      const i = p.indexOf("=");
      return i < 0 ? { name: p, value: "" } : { name: p.slice(0, i), value: p.slice(i + 1) };
    });
}

const queryText = (rows: Row[]) =>
  rows
    .filter((r) => r.on && r.name)
    .map((r) => (r.value === "" ? r.name : `${r.name}=${r.value}`))
    .join("&");

/** The table changed: rebuild the URL's query from the rows that are on. */
export function urlWithParams(url: string, params: Row[]): string {
  const q = queryText(params);
  return splitUrl(url).base + (q ? `?${q}` : "");
}

/** The URL changed: the rows that are on follow it (ids kept by position), rows switched off stay. */
export function paramsFromUrl(url: string, prev: Row[]): Row[] {
  const on = prev.filter((r) => r.on);
  const parsed = parseQuery(splitUrl(url).query).map((p, i) => ({ ...(on[i] ?? row()), name: p.name, value: p.value, on: true }));
  return [...parsed, ...prev.filter((r) => !r.on)];
}

/** ":id" segments of the path (not the ":3001" of a port). */
export function pathParams(url: string): string[] {
  const path = splitUrl(url).base.replace(/^[a-z]+:\/\/[^/]*/i, "");
  return [...new Set([...path.matchAll(/\/:([A-Za-z_]\w*)/g)].map((m) => m[1]!))];
}

// ---------- {{vars}} ----------

export interface Segment {
  text: string;
  name?: string;
}

/** "{{baseUrl}}/todos" -> [{ text: "{{baseUrl}}", name: "baseUrl" }, { text: "/todos" }] */
export function segments(text: string): Segment[] {
  const out: Segment[] = [];
  let at = 0;
  for (const m of text.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)) {
    if (m.index! > at) out.push({ text: text.slice(at, m.index) });
    out.push({ text: m[0], name: m[1]! });
    at = m.index! + m[0].length;
  }
  if (at < text.length) out.push({ text: text.slice(at) });
  return out;
}

export const BUILTINS = ["$timestamp", "$isoTimestamp", "$randomUUID", "$randomInt"];

export type Scope = Record<string, string>;

/** Bruno's order, highest first: runtime (saved from responses), the request's vars, the environment. */
export function makeScope(o: { env?: Row[]; vars?: Row[]; runtime?: Scope }): Scope {
  const on = (rows?: Row[]) => Object.fromEntries((rows ?? []).filter((r) => r.on && r.name).map((r) => [r.name, r.value]));
  return { ...on(o.env), ...on(o.vars), ...o.runtime };
}

export const isKnown = (name: string, scope: Scope): boolean => name in scope || BUILTINS.includes(name);
export const varValue = (name: string, scope: Scope): string | undefined => scope[name] ?? (BUILTINS.includes(name) ? `(${name.slice(1)}, made fresh on send)` : undefined);

// ---------- Bulk edit ----------

/** "name: value" per line; a leading "//" switches the row off. */
export function bulkText(rows: Row[]): string {
  return rows.map((r) => `${r.on ? "" : "//"}${r.name}: ${r.value}`).join("\n");
}

export function bulkParse(text: string, prev: Row[] = []): Row[] {
  const out: Row[] = [];
  for (const raw of text.split("\n")) {
    let line = raw.trim();
    if (!line) continue;
    const on = !line.startsWith("//");
    if (!on) line = line.slice(2).trim();
    const i = line.indexOf(":");
    const name = (i < 0 ? line : line.slice(0, i)).trim();
    const value = i < 0 ? "" : line.slice(i + 1).trim();
    const old = prev.find((r) => r.name === name && !out.some((o) => o.id === r.id));
    out.push({ ...(old ?? row()), name, value, on });
  }
  return out;
}

export const looksLikeCurl = (s: string): boolean => /^\s*curl\s/i.test(s);

const safeDecode = (s: string) => {
  try {
    return decodeURIComponent(s.replace(/\+/g, " "));
  } catch {
    return s;
  }
};
export function tryJson(s: string | undefined): unknown {
  if (!s || !/^\s*[[{]/.test(s)) return undefined;
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
}

/** "GET /api/todos/:id" -> "Get todos :id"-ish names a person would give. */
export function nameFor(method: string, url: string): string {
  const path = splitUrl(url).base.replace(/^\{\{[^}]+\}\}/, "").replace(/^[a-z]+:\/\/[^/]*/i, "") || "/";
  return `${method.toUpperCase()} ${path}`;
}

// ---------- Response ----------

/** ["items", 0, "id"] -> "res.body.items[0].id" */
export function pathOf(keys: (string | number)[]): string {
  return keys.reduce<string>((p, k) => (typeof k === "number" ? `${p}[${k}]` : /^[A-Za-z_$][\w$]*$/.test(k) ? `${p}.${k}` : `${p}["${k}"]`), "res.body");
}

export const OPERATORS = ["eq", "neq", "gt", "gte", "lt", "lte", "in", "notIn", "contains", "notContains", "startsWith", "endsWith", "matches", "notMatches", "between", "length", "isEmpty", "isNotEmpty", "isNull", "isDefined", "isUndefined", "isTruthy", "isFalsy", "isNumber", "isString", "isBoolean", "isArray", "isJson"];
export const UNARY = new Set(["isEmpty", "isNotEmpty", "isNull", "isDefined", "isUndefined", "isTruthy", "isFalsy", "isNumber", "isString", "isBoolean", "isArray", "isJson"]);

export function cookiesOf(headers: Record<string, string>): { name: string; value: string; attrs: string }[] {
  const raw = Object.entries(headers).filter(([k]) => k.toLowerCase() === "set-cookie").map(([, v]) => v).join(", ");
  if (!raw) return [];
  // "a=1; Path=/, b=2; Expires=Wed, 21 Oct 2026 07:28:00 GMT": split only on commas that start a new name=
  return raw.split(/,(?=\s*[^;,\s]+=)/).map((c) => {
    const [pair = "", ...attrs] = c.trim().split(";");
    const i = pair.indexOf("=");
    return { name: pair.slice(0, i).trim(), value: pair.slice(i + 1).trim(), attrs: attrs.map((a) => a.trim()).join("; ") };
  });
}

/** Find all non-overlapping start indices of query in text (case-insensitive). */
export function findMatches(text: string, query: string, preLowerText?: string): number[] {
  if (!query || !text) return [];
  const lowerText = preLowerText ?? text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const qLen = lowerQuery.length;
  if (qLen === 0) return [];
  const indices: number[] = [];
  let pos = 0;
  while ((pos = lowerText.indexOf(lowerQuery, pos)) !== -1) {
    indices.push(pos);
    pos += qLen;
  }
  return indices;
}

/** Step to the next or previous match index, wrapping around. */
export function stepMatch(current: number, total: number, direction: "next" | "prev"): number {
  if (total <= 0) return 0;
  if (direction === "prev") {
    return (current - 1 + total) % total;
  }
  return (current + 1) % total;
}

// ---------- From what the app already did ----------

const DROP = new Set(["host", "content-length", "connection", "traceparent", "tracestate", "accept-encoding", "keep-alive", "transfer-encoding", "upgrade", "x-shrike-trace"]);

export interface Captured {
  method: string;
  url: string;
  reqHeaders?: Record<string, string>;
  reqBody?: string;
}

/** AP1: a captured call as an editable request. Values Shrike redacted stay redacted. */
export function fromCapture(c: Captured): Req {
  const headers = Object.entries(c.reqHeaders ?? {})
    .filter(([k]) => !DROP.has(k.toLowerCase()) && !k.toLowerCase().startsWith("sec-"))
    .map(([k, v]) => row(k, v));
  const bearer = headers.find((h) => h.name.toLowerCase() === "authorization" && /^bearer\s/i.test(h.value));
  if (bearer) headers.splice(headers.indexOf(bearer), 1);
  const json = tryJson(c.reqBody);
  const ct = headers.find((h) => h.name.toLowerCase() === "content-type")?.value ?? "";
  const mode: BodyMode = !c.reqBody ? "none" : json !== undefined ? "json" : ct.includes("x-www-form-urlencoded") ? "form" : ct.includes("xml") ? "xml" : "text";
  const body: Body =
    mode === "form"
      ? { mode, text: "", form: parseQuery(c.reqBody!).map((p) => row(safeDecode(p.name), safeDecode(p.value))), gqlVars: "" }
      : { mode, text: json !== undefined ? JSON.stringify(json, null, 2) : (c.reqBody ?? ""), form: [], gqlVars: "" };
  const method = c.method.toUpperCase();
  return blankReq({
    name: nameFor(method, c.url),
    method,
    url: c.url,
    params: paramsFromUrl(c.url, []),
    headers,
    body,
    auth: bearer ? { type: "bearer", token: bearer.value.replace(/^bearer\s+/i, "") } : { type: "inherit" },
  });
}

export const isRedacted = (v: string | undefined): boolean => !!v && v.includes("[redacted");
/** "[redacted:token]" -> "token", the var the "Use {{token}}" fill suggests. */
export const redactedVar = (v: string): string => /\[redacted:([\w-]+)\]/.exec(v)?.[1] ?? "token";

export function routePattern(path: string): RegExp {
  const src = path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\/:([A-Za-z_]\w*)/g, "/(?<$1>[^/?#]+)");
  return new RegExp(`^${src}/?(?:[?#].*)?$`);
}

/** AP2: a scanner route as a request: its path (relative, so it goes to the running app), path params from the last call seen, the last real body. */
export function fromRoute(route: Route, seen: Captured[] = []): Req {
  const method = route.method.toUpperCase();
  const re = routePattern(route.path);
  const last = [...seen].reverse().find((c) => c.method.toUpperCase() === method && re.test(c.url.replace(/^[a-z]+:\/\/[^/]*/i, "")));
  const pathVals: Record<string, string> = { ...(last ? re.exec(last.url.replace(/^[a-z]+:\/\/[^/]*/i, ""))?.groups : {}) };
  for (const k of pathParams(route.path)) pathVals[k] ??= "";
  const json = tryJson(last?.reqBody);
  const body: Body = !hasBody(method)
    ? { mode: "none", text: "", form: [], gqlVars: "" }
    : { mode: last?.reqBody && json === undefined ? "text" : "json", text: json !== undefined ? JSON.stringify(json, null, 2) : (last?.reqBody ?? "{\n  \n}"), form: [], gqlVars: "" };
  return blankReq({ name: nameFor(method, route.path), method, url: route.path, pathVals, body });
}

export const sameReq = (a: Req, b: Req): boolean => JSON.stringify(a) === JSON.stringify(b);

const SECRET_NAMES = /^(authorization|proxy-authorization|cookie|x-api-key|api-key|apikey|x-auth-token|token|password|secret)$/i;
export const looksSecret = (name: string): boolean => SECRET_NAMES.test(name.trim());
const isVarOnly = (v: string) => /^\s*\{\{[^{}]+\}\}\s*$/.test(v);
const hide = (label: string, v: string | undefined) => (v && !isVarOnly(v) && !isRedacted(v) ? `[redacted:${label}]` : v);

/** The tab as it's kept on disk between restarts: secret values hidden, {{vars}} kept. */
export function scrubReq(r: Req): Req {
  const rows = (list: Row[]) => list.map((x) => (x.secret || looksSecret(x.name) ? { ...x, value: hide(x.name.toLowerCase() || "secret", x.value) ?? "" } : x));
  return { ...r, headers: rows(r.headers), vars: rows(r.vars), auth: { ...r.auth, token: hide("token", r.auth.token), password: hide("password", r.auth.password), value: hide(r.auth.key?.toLowerCase() || "key", r.auth.value) } };
}

/** A secret field still holding Shrike's placeholder: saving it would overwrite the real value in the file. */
export const hiddenSecret = (r: Req): boolean => [r.auth.token, r.auth.password, r.auth.value, ...r.headers.filter((h) => looksSecret(h.name)).map((h) => h.value)].some(isRedacted);

// ---------- To and from main's ApiRequest ----------

const kv = (r: Row): ApiKv => ({ name: r.name, value: r.value, enabled: r.on, ...(r.secret ? { secret: true } : {}) });
const unkv = (k: ApiKv): Row => ({ ...row(k.name, k.value, k.enabled), ...(k.secret ? { secret: true } : {}) });

export function fromApi(a: ApiRequest): Req {
  const b = a.body;
  const body: Body =
    b.type === "json" || b.type === "text" || b.type === "xml" ? { mode: b.type, text: b.data, form: [], gqlVars: "" }
    : b.type === "form-urlencoded" ? { mode: "form", text: "", form: b.fields.map(unkv), gqlVars: "" }
    : b.type === "multipart" ? { mode: "multipart", text: "", form: b.fields.map((f) => ({ ...unkv(f), ...(f.file ? { file: f.value, value: "" } : {}) })), gqlVars: "" }
    : b.type === "graphql" ? { mode: "graphql", text: b.query, form: [], gqlVars: b.variables }
    : { mode: "none", text: "", form: [], gqlVars: "" };
  const fromUrl = paramsFromUrl(a.url, []);
  return blankReq({
    path: a.path,
    name: a.name,
    method: a.method.toUpperCase(),
    url: a.url,
    params: [...(fromUrl.length ? fromUrl : a.params.filter((p) => p.enabled).map(unkv)), ...a.params.filter((p) => !p.enabled).map(unkv)],
    pathVals: Object.fromEntries(a.pathParams.map((p) => [p.name, p.value])),
    headers: a.headers.map(unkv),
    body,
    auth: { ...a.auth },
    vars: a.vars.pre.map(unkv),
    post: a.vars.post.map((p) => ({ id: uid(), name: p.name, selector: p.value, on: p.enabled })),
    asserts: a.assertions.map((x) => ({ id: uid(), expr: x.expr, op: x.op, value: x.value, on: x.enabled })),
    docs: a.docs ?? "",
    scripts: { ...a.scripts },
    settings: { ...a.settings },
    ...(a.seq === undefined ? {} : { seq: a.seq }),
  });
}

export function toApi(r: Req): ApiRequest {
  const b = r.body;
  const fields = b.form.map(kv);
  const auth: ApiRequest["auth"] =
    r.auth.type === "bearer" ? { type: "bearer", token: r.auth.token ?? "" }
    : r.auth.type === "basic" ? { type: "basic", username: r.auth.username ?? "", password: r.auth.password ?? "" }
    : r.auth.type === "apikey" ? { type: "apikey", key: r.auth.key ?? "", value: r.auth.value ?? "", placement: r.auth.placement ?? "header" }
    : { type: r.auth.type };
  return {
    path: r.path,
    name: r.name,
    method: r.method,
    url: r.url,
    params: r.params.map(kv),
    pathParams: pathParams(r.url).map((k) => ({ name: k, value: r.pathVals[k] ?? "", enabled: true })),
    headers: r.headers.map(kv),
    body:
      b.mode === "json" || b.mode === "text" || b.mode === "xml" ? { type: b.mode, data: b.text }
      : b.mode === "form" ? { type: "form-urlencoded", fields }
      : b.mode === "multipart" ? { type: "multipart", fields: b.form.map((f) => (f.file ? { ...kv(f), value: f.file, file: true } : kv(f))) }
      : b.mode === "graphql" ? { type: "graphql", query: b.text, variables: b.gqlVars }
      : { type: "none" },
    auth,
    vars: { pre: r.vars.map(kv), post: r.post.map((p) => ({ name: p.name, value: p.selector, enabled: p.on })) },
    assertions: r.asserts.map((a) => ({ expr: a.expr, op: a.op, value: a.value, enabled: a.on })),
    scripts: r.scripts,
    settings: r.settings,
    ...(r.docs ? { docs: r.docs } : {}),
    ...(r.seq === undefined ? {} : { seq: r.seq }),
  };
}

const BODY_EXTS: Record<string, string> = { json: "json", html: "html", xml: "xml", plain: "txt", csv: "csv", javascript: "js", css: "css", png: "png", jpeg: "jpg", gif: "gif", webp: "webp", "svg+xml": "svg", pdf: "pdf", zip: "zip", "octet-stream": "" };

/** AP-res: the default file name for a saved response body: the URL's last path part plus an extension from the content type, falling back to response.txt. */
export function defaultResponseName(url: string, contentType: string | undefined): string {
  let base = "";
  try {
    const parts = new URL(url).pathname.split("/").filter(Boolean);
    base = parts[parts.length - 1] ?? "";
  } catch {
    base = "";
  }
  base = base.replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "");
  const typePart = (contentType ?? "").split(";")[0] ?? "";
  const sub = typePart.split("/")[1]?.trim() ?? "";
  const ext = BODY_EXTS[sub] ?? (/^[a-z0-9]+$/.test(sub) && sub.length <= 10 ? sub : "");
  if (!base && !ext) return "response.txt";
  if (!base) return `response.${ext}`;
  if (ext && !base.endsWith(`.${ext}`)) return `${base}.${ext}`;
  return base;
}
