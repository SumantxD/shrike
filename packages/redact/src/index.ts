import type { ActionView, Cell, DebugEvent, RedactRules, TimelineNode } from "@shrike/schema";

const SENSITIVE_HEADERS = new Set(["authorization", "cookie", "set-cookie", "proxy-authorization", "x-api-key", "x-vercel-protection-bypass", "x-vercel-set-bypass-cookie"]);
// "auth" and "authorization", but not "author"/"authorId"; Vercel's preview bypass (#51), as a header or query parameter
const KEY = String.raw`pass(?:word)?|passwd|secret|token|api[-_]?key|auth(?!or(?!i[zs]))|session|credential|private[-_]?key|card|cvv|(?<!cla)ssn|vercel-protection-bypass|vercel-set-bypass-cookie`; // not "className"
const NUMERIC_KEY_RE = /card|cvv|ssn/i;

const label = (name: string) => `[redacted:${name}]`;
const isRedacted = (v: string) => v.startsWith("[redacted");

const SHAPES: [RegExp, string][] = [
  [/-----BEGIN ([A-Z0-9 ]{1,40})-----[\s\S]{0,10000}?-----END \1-----/g, "pem"],
  [/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, "aws_key"],
  [/\bsk-ant-[A-Za-z0-9_-]{20,}/g, "anthropic_key"],
  [/\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}/g, "openai_key"],
  [/\b[sr]k_(?:live|test)_[A-Za-z0-9]{10,}/g, "stripe_key"],
  [/\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{22,})/g, "github_token"],
  [/\bxox[abposr]-[A-Za-z0-9-]{10,}/g, "slack_token"],
  [/\bAIza[0-9A-Za-z_-]{35}/g, "google_key"],
  [/\beyJ[\w-]{5,}\.[\w-]{5,}\.[\w-]{5,}/g, "jwt"],
];

// A key pattern's regexes; the identifier run is bounded so long runs stay linear.
function keyRes(key: string) {
  const ident = String.raw`[\w$.-]{0,40}(?:${key})[\w$.-]{0,40}`;
  return {
    re: new RegExp(key, "i"),
    quoted: ["\"", "'", "`"].map((q) => new RegExp(String.raw`(?<![\w$.-])([${q === "`" ? "'\"" : q}]?)(${ident})\1(\s*[:=]\s*)${q}((?:[^${q}\\\n]|\\.)*)${q}`, "gi")),
    unquoted: new RegExp(String.raw`(?<![\w$.-])(["']?)(${ident})\1(\s*[:=]\s*)(?!["'\x60\[{(]|(?:Bearer|Basic)\s)([A-Za-z0-9_\-+/.~%]+)`, "gi"),
  };
}
type KeyRes = ReturnType<typeof keyRes>;
const BUILT_IN = keyRes(KEY);
const KEY_RE = BUILT_IN.re;
// #52: the user's `redact.keys`, matched like the built-in names; compiled once per list
let userKeys: { src: string; res: KeyRes } | undefined;
function userRes(rules?: RedactRules): KeyRes | undefined {
  const names = rules?.keys?.filter(Boolean);
  if (!names?.length) return undefined;
  const src = names.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  if (userKeys?.src !== src) userKeys = { src, res: keyRes(src) };
  return userKeys.res;
}

function byKey(out: string, k: KeyRes): string {
  for (const re of k.quoted) {
    out = out.replace(re, (m, q: string, key: string, sep: string, value: string) => {
      if (!value || isRedacted(value)) return m;
      const quote = m.at(-1)!;
      return `${q}${key}${q}${sep}${quote}${label(key)}${quote}`;
    });
  }
  return out.replace(k.unquoted, (m, q: string, key: string, sep: string, value: string) => {
    if (LITERAL.test(value) && !(NUMERIC_KEY_RE.test(key) && /^\d{3,}$/.test(value))) return m;
    return `${q}${key}${q}${sep}${q === '"' ? `"${label(key)}"` : label(key)}`;
  });
}
const LITERAL = /^(?:true|false|null|undefined|NaN|-?\d+(?:\.\d+)?)$/;

export function entropy(s: string): number {
  const counts = new Map<string, number>();
  for (const ch of s) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  let h = 0;
  for (const c of counts.values()) {
    const p = c / s.length;
    h -= p * Math.log2(p);
  }
  return h;
}

// ponytail: digit + mixed case + entropy keeps words, paths, SQL and hex ids out; a lowercase-only or
// digit-free secret slips through. Upgrade: per-charset thresholds like detect-secrets.
const looksSecret = (v: string): boolean =>
  v.length >= 24 && !v.startsWith("/") && /\d/.test(v) && /[a-z]/.test(v) && /[A-Z]/.test(v) && entropy(v) > 4;

// A quoted string value that is one long letters-and-digits run (a hex or base64url session id) is a
// token handed around as an argument or return value. Unquoted hex (trace ids, commits) stays visible.
// ponytail: UUIDs stay visible because they are usually record ids; a UUID session id slips through.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const looksToken = (v: string): boolean => /^[A-Za-z0-9_-]{32,512}$/.test(v) && /\d/.test(v) && /[a-z]/i.test(v) && !UUID.test(v) && entropy(v) > 3;

export function redactText(s: string, rules?: RedactRules, pii?: PiiSeen): string {
  if (!s) return s;
  let out = s;
  // connection strings: keep the user, mask the password
  out = out.replace(/\b([a-z][a-z0-9+.-]{0,30}:\/\/)([^:/\s@'"]+):([^@\s'"/]+)@/gi, (m, scheme: string, user: string, pass: string) =>
    isRedacted(pass) ? m : `${scheme}${user}:${label("password")}@`,
  );
  out = out.replace(/\b(Bearer|Basic)\s+(?!\[redacted)[A-Za-z0-9._~+/=-]{8,}/g, (_m, kind: string) => `${kind} ${label("token")}`);
  out = byKey(out, BUILT_IN);
  const user = userRes(rules);
  if (user) out = byKey(out, user);
  for (const [re, name] of SHAPES) out = out.replace(re, label(name));
  // high entropy: whole quoted values, and values after = or :
  out = out.replace(/(["'`])([A-Za-z0-9+/_=.-]{24,512})\1/g, (m, q: string, v: string) => (looksSecret(v) || looksToken(v) ? `${q}${label("secret")}${q}` : m));
  out = out.replace(/([=:]\s*)([A-Za-z0-9+/_=.-]{24,512})(?=$|[\s&;,)}\]])/g, (m, sep: string, v: string, at: number, all: string) =>
    looksSecret(v) && !v.startsWith("//") && !/\/\/[^\s/?#@]+$/.test(all.slice(Math.max(0, at - 260), at)) ? `${sep}${label("secret")}` : m, // a URL's scheme or port colon is not a key
  );
  return pii ? redactPii(out, pii) : out;
}

// #51 (docs/07 rule 7): personal data on live trips. Each value becomes a placeholder numbered per kind, and the same
// value gets the same one wherever it appears in the map's trip, so the agent can tell two rows had the same user.
// ponytail: names and street addresses can't be found by pattern; value masking (#52) covers them where data leaves.
export type PiiSeen = Map<string, string>; // "email:ann@shop.com" -> "[email#1]"

// A PostgREST filter's operator stays visible: email=eq.[email#1], not email=[email#1].
// #80: Unicode letters, combining marks (NFD) and digits in the local part and the lookbehinds, so jöhn@ never leaks as jö[email#1].
const EMAIL = /(?:(?<![\p{L}\p{M}\p{N}_.%+-])(?!(?:n?eq|i?like)\.)|(?<=(?<![\p{L}\p{M}\p{N}_.%+-])(?:n?eq|i?like)\.))[\p{L}\p{M}\p{N}._%+-]{1,64}(?:@|%40)[A-Za-z0-9-]{1,63}(?:\.[A-Za-z0-9-]{1,63}){0,8}\.[A-Za-z]{2,24}(?![\w-])/giu;
// A "+" (E.164) or a separator pattern; a bare run of digits is an id, so it stays.
const PHONE = /(?<![\w+%.-])(?:(?:\+|%2B)\d[\d ().-]{5,17}\d\d|\(\d{3}\) ?\d{3}[-. ]\d{4}|\d{3}([-. ])\d{3}\1\d{4})(?![\w-]|\.\d|%| \d{3})/gi; // and not the start of a longer run of digit groups
const IBAN = /(?<![A-Za-z0-9])[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,3})?(?![A-Za-z0-9])/g;

/** ISO 13616: 15 to 34 characters and mod 97 == 1, so ids that only look like an IBAN stay. */
function ibanValid(s: string): boolean {
  const c = s.replace(/ /g, "");
  if (c.length < 15 || c.length > 34) return false;
  let m = 0;
  for (const ch of c.slice(4) + c.slice(0, 4)) for (const d of /\d/.test(ch) ? ch : String(ch.charCodeAt(0) - 55)) m = (m * 10 + Number(d)) % 97;
  return m === 1;
}

function placeholder(seen: PiiSeen, kind: string, value: string): string {
  const key = `${kind}:${value}`;
  let p = seen.get(key);
  if (!p) {
    const n = Number(seen.get(`#${kind}`) ?? 0) + 1; // a counter per kind, so a big trip stays linear
    seen.set(`#${kind}`, String(n));
    seen.set(key, (p = `[${kind}#${n}]`));
  }
  return p;
}

// #78: file names shaped like emails (logo@2x.png, name@1.2.3.tgz) are not
// personal data, so they stay. Only extensions that are not real TLDs are
// listed; .zip and .mov are real domains people use for email. ann@shop.com.png still masks.
const FILE_NOT_EMAIL = /(?<!\.[a-z]{2,24})\.(?:png|jpe?g|webp|gif|svg|avif|ico|bmp|tgz|m?js|cjs|css|map|json|wasm|woff2?)$/i;

/** Emails, phone numbers and IBANs become [email#n], [phone#n] and [iban#n]. Pure; pass one map per trip to keep the numbers stable. */
export function redactPii(s: string, seen: PiiSeen = new Map()): string {
  if (!s) return s;
  return s
    .replace(EMAIL, (m) => (FILE_NOT_EMAIL.test(m) ? m : placeholder(seen, "email", m.replace(/%40/i, "@").toLowerCase()))) // as typed, Ann@ and ann@ are one user
    .replace(PHONE, (m) => {
      const digits = m.replace(/%2B/i, "+").replace(/[^\d+]/g, "");
      const n = digits.replace("+", "").length;
      return n < 8 || n > 15 ? m : placeholder(seen, "phone", digits); // E.164 allows 15 at most
    })
    .replace(IBAN, (m) => (ibanValid(m) ? placeholder(seen, "iban", m.replace(/ /g, "")) : m));
}

const redactHeaders = (h: Record<string, string> | undefined, rules?: RedactRules, pii?: PiiSeen) => {
  if (!h) return h;
  const extra = new Set(rules?.headers?.map((x) => x.toLowerCase()));
  const user = userRes(rules)?.re;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(h)) {
    const name = k.toLowerCase();
    out[k] = SENSITIVE_HEADERS.has(name) || KEY_RE.test(name) || extra.has(name) || user?.test(name) ? label(name) : redactText(v, rules, pii);
  }
  return out;
};

/** I: a value from a database row or cache entry; a column or key that names a secret is masked whole. */
export function redactCell(name: string, v: Cell, rules?: RedactRules, pii?: PiiSeen): Cell {
  const secret = KEY_RE.test(name) || !!userRes(rules)?.re.test(name);
  if (v === null || typeof v !== "string") return v !== null && secret ? label(name.toLowerCase()) : v;
  return secret && !isRedacted(v) ? label(name.toLowerCase()) : redactText(v, rules, pii);
}

export function redactRow(row: Record<string, Cell>, rules?: RedactRules, pii?: PiiSeen): Record<string, Cell> {
  return Object.fromEntries(Object.entries(row).map(([k, v]) => [k, redactCell(k, v, rules, pii)]));
}

/**
 * rules: the user's `redact.keys` and `redact.headers` from .shrike/config.json, redacted like the built-in names.
 * pii: live events only (#51); personal data is replaced too, numbered in this map (one per trip).
 */
export function redactEvent(e: DebugEvent, rules?: RedactRules, pii?: PiiSeen): DebugEvent {
  const t = (s: string) => redactText(s, rules, pii);
  const opt = (s: string | undefined) => (s === undefined ? s : t(s));
  const r: DebugEvent = { ...e, name: t(e.name) };
  if (e.http) {
    r.http = { ...e.http, url: t(e.http.url) };
    if (e.http.reqHeaders) r.http.reqHeaders = redactHeaders(e.http.reqHeaders, rules, pii);
    if (e.http.resHeaders) r.http.resHeaders = redactHeaders(e.http.resHeaders, rules, pii);
    if (e.http.serverTiming !== undefined) r.http.serverTiming = Array.isArray(e.http.serverTiming) ? e.http.serverTiming.filter((x) => typeof x?.name === "string").map(({ name, durMs, desc }) => ({ name: t(name), ...(typeof durMs === "number" && { durMs }), ...(typeof desc === "string" && { desc: t(desc) }) })) : undefined; // page-supplied: never throw
    if (e.http.reqBody !== undefined) r.http.reqBody = t(e.http.reqBody);
    if (e.http.resBody !== undefined) r.http.resBody = t(e.http.resBody);
  }
  if (e.db) {
    r.db = { ...e.db, statement: t(e.db.statement) };
    if (e.db.params !== undefined) r.db.params = t(e.db.params);
  }
  if (e.log) r.log = { ...e.log, message: t(e.log.message) };
  if (e.error) {
    r.error = { ...e.error, message: t(e.error.message) };
    if (e.error.type !== undefined) r.error.type = t(e.error.type);
    if (e.error.stack !== undefined) r.error.stack = t(e.error.stack);
  }
  if (e.cache?.key !== undefined) r.cache = { ...e.cache, key: t(e.cache.key) };
  if (e.cache?.path !== undefined) r.cache = { ...(r.cache ?? e.cache), path: t(e.cache.path) }; // a JSONPath filter can hold values
  if (e.caller) r.caller = { ...e.caller, label: t(e.caller.label), ...(e.caller.command !== undefined ? { command: t(e.caller.command) } : {}) };
  if (e.change?.rows) r.change = { ...e.change, rows: e.change.rows.map((x) => ({ ...x, ...(x.before ? { before: redactRow(x.before, rules, pii) } : {}), ...(x.after ? { after: redactRow(x.after, rules, pii) } : {}) })) };
  if (e.args) r.args = e.args.map(t);
  if (e.returned !== undefined) r.returned = opt(e.returned);
  if (e.stack !== undefined) r.stack = opt(e.stack);
  return r;
}

// #52: value masking where a live trip leaves the screen (REC clips, cards, links, .shriketrace, live agent tool output).
// Never at the store: the local user keeps seeing real values.

export interface MaskOptions {
  keep?: string[]; // keys, columns and query names whose values stay (`redact.keep`)
  seen?: Map<string, number>; // share one across calls to keep [text#n] stable beyond one trip
}

const PII = /[^\s@]+@[^\s@]+\.[a-z]{2,}|^\+\d|\d{3}[-.)]\s?\d{3}[-.]\d{4}/i;
const PLACEHOLDER = /^\[(?:redacted|text#|email#|phone#|iban#)/;

/** A value that stays when masked: empty, a placeholder, a UUID or number, or a short enum-like word ("pending": no spaces, 24 characters or fewer, no email or phone). */
const keepsValue =(v: string): boolean => !v || PLACEHOLDER.test(v) || UUID.test(v) || /^-?\d+(?:\.\d+)?$/.test(v) || (v.length <= 24 && !/\s/.test(v) && !PII.test(v));

// A quoted string that isn't a key (not followed by a colon); the key before it, if any, decides `keep`.
// ponytail: quoted values only, so free text outside quotes (a log line's own words) stays. Upgrade: mask log text whole.
const LIT = /(?<![\w\\])(["'`])((?:\\.|(?!\1)[^\\\n])*)\1(?!\w)/g;
const FORM = /^[\w.%+-]+=[^\s&]*(?:&[\w.%+-]+=[^\s&]*)*$/;

function masker(o: MaskOptions = {}) {
  const keep = new Set(o.keep?.map((k) => k.toLowerCase()));
  const seen = o.seen ?? new Map<string, number>();
  const one = (v: string, key?: string): string => {
    if (keepsValue(v) || (key !== undefined && keep.has(key.toLowerCase()))) return v;
    if (!seen.has(v)) seen.set(v, seen.size + 1);
    return `[text#${seen.get(v)}]`;
  };
  const query = (q: string) =>
    q.replace(/([^&=?#\s]+)=([^&#\s]*)/g, (m, k: string, v: string) => {
      let d = v;
      try {
        d = decodeURIComponent(v.replace(/\+/g, " "));
      } catch {}
      const out = one(d, k);
      return out === d ? m : `${k}=${out}`;
    });
  const url = (u: string) => (u.includes("?") ? `${u.slice(0, u.indexOf("?") + 1)}${query(u.slice(u.indexOf("?") + 1))}` : u);
  const quoted = (s: string) =>
    s.replace(LIT, (m, q: string, v: string, at: number, all: string) => {
      if (/^\s*:/.test(all.slice(at + m.length, at + m.length + 8))) return m;
      const key = /([\w$-]+)["'`]?\s*[:=]\s*$/.exec(all.slice(Math.max(0, at - 64), at))?.[1];
      const out = one(v, key);
      return out === v ? m : `${q}${out}${q}`;
    });
  const text = (s: string) => (FORM.test(s) ? query(s) : quoted(s));
  const row = (r: Record<string, Cell>) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === "string" ? one(v, k) : v]));
  const event = (e: DebugEvent): DebugEvent => {
    const r: DebugEvent = { ...e, name: e.kind === "db_query" ? quoted(e.name) : url(e.name) };
    if (e.http) {
      r.http = { ...e.http, url: url(e.http.url) };
      if (e.http.reqBody !== undefined) r.http.reqBody = text(e.http.reqBody);
      if (e.http.resBody !== undefined) r.http.resBody = text(e.http.resBody);
    }
    if (e.db) r.db = { ...e.db, statement: quoted(e.db.statement), ...(e.db.params !== undefined ? { params: quoted(e.db.params) } : {}) };
    if (e.change?.rows) r.change = { ...e.change, rows: e.change.rows.map((x) => ({ ...x, ...(x.before ? { before: row(x.before) } : {}), ...(x.after ? { after: row(x.after) } : {}) })) };
    if (e.log) r.log = { ...e.log, message: quoted(e.log.message) };
    if (e.caller?.command !== undefined) r.caller = { ...e.caller, command: quoted(e.caller.command) };
    if (e.args) r.args = e.args.map(quoted);
    if (e.returned !== undefined) r.returned = quoted(e.returned);
    return r;
  };
  return { text, event, url };
}

/** #52: string values in bodies, query values, SQL params, args and row cells become [text#n]; keys, numbers, ids and enum-like words stay. Pure. */
export const maskValues = (e: DebugEvent, o?: MaskOptions): DebugEvent => masker(o).event(e);

/** maskValues over a body or other text (JSON, form data, util.inspect previews). */
export const maskText = (s: string, o?: MaskOptions): string => masker(o).text(s);

/** maskValues over a whole trip, numbered once so the same value reads the same everywhere in it. */
export function maskAction(v: ActionView, o?: MaskOptions): ActionView {
  const m = masker(o);
  const node = (n: TimelineNode): TimelineNode => ({ event: m.event(n.event), children: n.children.map(node) });
  return { ...v, label: m.url(v.label), root: m.event(v.root), tree: v.tree.map(node) };
}
