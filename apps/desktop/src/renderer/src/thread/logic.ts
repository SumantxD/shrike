import type { ActionView, DebugEvent, FlowStep, HttpRequestSpec, Place } from "@shrike/schema";
import type { LaneDef, Trip } from "../lib/thread-layout.ts";
import { firstFailure } from "../lib/thread-layout.ts";
import { toSteps } from "../lib/steps.ts";

// Pure helpers for the Thread view: which code a dive card shows, its inline values, and feed windowing.

export interface CodeTarget {
  file: string;
  live: number; // the lit line
  def?: number; // function definition line: show the whole function from here
  error: boolean;
}

const stackLine = (e: DebugEvent, file: string): number | undefined => {
  const m = (e.error?.stack ?? "").match(new RegExp(`\\(?${file.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:(\\d+)`));
  return m ? Number(m[1]) : undefined;
};

/** Where a station's code is. A call with a call site shows the caller around that line (where the value came from). */
export function codeTarget(e: DebugEvent, parent?: DebugEvent): CodeTarget | null {
  const error = e.status === "error";
  if (e.kind === "function" && e.callSite) {
    const c = e.callSite;
    const p = parent?.kind === "function" && parent.source?.file === c.file && parent.source.line <= c.line ? parent.source.line : undefined;
    return { file: c.file, live: c.line, def: p, error };
  }
  if (!e.source) return null;
  const { file, line } = e.source;
  if (e.kind === "function") return { file, live: (error && stackLine(e, file)) || line, def: line, error };
  return { file, live: line, error };
}

/** Last line (1-based) of the block opened on `from`, by a brace count; capped at `max` lines. */
export function blockEnd(lines: string[], from: number, max = 24): number {
  let depth = 0;
  let opened = false;
  const last = Math.min(lines.length, from + max - 1);
  for (let n = from; n <= last; n++) {
    const code = (lines[n - 1] ?? "").replace(/(["'`])(?:\\.|(?!\1).)*\1/g, "").replace(/\/\/.*$/, "");
    for (const ch of code) {
      if (ch === "{") depth++;
      else if (ch === "}") depth--;
    }
    if (depth > 0) opened = true;
    if ((opened || code.includes("}")) && depth <= 0) return n; // ponytail: a multi-line destructured signature can end it early
  }
  return last;
}

/** A station's event, its caller (nearest shallower step) and every event of the trip. */
export function stationEvents(view: ActionView, stepIndex: number): { event?: DebugEvent; parent?: DebugEvent; events: DebugEvent[] } {
  const steps = toSteps(view);
  const s = steps[stepIndex];
  let parent: DebugEvent | undefined;
  for (let i = stepIndex - 1; s && i >= 0; i--) if (steps[i]!.depth < s.depth) { parent = steps[i]!.event; break; }
  return { event: s?.event, parent, events: steps.map((x) => x.event) };
}

/** The line range a dive card shows: the function (≤24 lines) when there is one, else ±4 around the live line. */
export function codeRange(lines: string[], t: CodeTarget): { start: number; end: number } {
  const n = Math.max(1, lines.length);
  if (t.def) {
    const end = blockEnd(lines, t.def);
    if (t.live >= t.def && t.live <= end) return { start: t.def, end };
  }
  return { start: Math.max(1, t.live - 4), end: Math.min(n, t.live + 4) };
}

export interface Chip {
  text: string;
  error: boolean;
}

const BAD = /\bundefined\b|\bnull\b|\bNaN\b/;
const callArgs = (e: DebugEvent) => (e.args ?? []).filter((a) => a !== "res" && !a.startsWith("[Function") && !a.startsWith("req "));
const clip = (s: string, n: number) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

/** Values to show inline, by line: call arguments at call sites, log messages, and the failure at the failing line. */
export function inlineChips(events: DebugEvent[], self: DebugEvent, file: string, start: number, end: number): Map<number, Chip[]> {
  const out = new Map<number, Chip[]>();
  const inRange = (f: string | undefined, l: number | undefined): l is number => f === file && l !== undefined && l >= start && l <= end;
  const add = (line: number, chip: Chip) => {
    const list = out.get(line) ?? [];
    if (!list.some((c) => c.text === chip.text)) list.push(chip);
    out.set(line, list);
  };
  for (const e of events) {
    if (e.kind === "function" && inRange(e.callSite?.file, e.callSite?.line)) {
      const args = callArgs(e);
      if (args.length) {
        const text = clip(`${e.name.replace(/\(\)$/, "")}(${args.join(", ")})`, 90);
        add(e.callSite!.line, { text, error: BAD.test(text) });
      }
    } else if (e.kind === "log" && inRange(e.source?.file, e.source?.line)) {
      add(e.source!.line, { text: clip(e.log?.message ?? e.name, 80), error: e.log?.level === "error" || e.status === "error" });
    } else if (e.kind !== "function" && e.status === "error" && e.error?.message && inRange(e.source?.file, e.source?.line)) {
      add(e.source!.line, { text: `✕ ${clip(e.error.message, 80)}`, error: true });
    }
  }
  if (self.kind === "function" && self.status === "error" && self.error?.message && !self.callSite) {
    const l = stackLine(self, file);
    if (inRange(file, l)) add(l, { text: `✕ ${clip(self.error.message, 80)}`, error: true });
  }
  return out;
}

/** Cumulative tops for blocks of the given heights (length n + 1; the last entry is the total). */
export function offsets(heights: number[]): number[] {
  const o = [0];
  for (const h of heights) o.push(o[o.length - 1]! + h);
  return o;
}

/** Indices [first, last] of blocks that intersect the viewport, plus `overscan` blocks either side. */
export function visibleRange(tops: number[], scrollTop: number, viewport: number, overscan = 2): [number, number] {
  const n = tops.length - 1;
  if (n <= 0) return [0, -1];
  const find = (y: number) => {
    let lo = 0;
    let hi = n - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (tops[mid]! <= y) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };
  return [Math.max(0, find(scrollTop) - overscan), Math.min(n - 1, find(scrollTop + viewport) + overscan)];
}

/** Lanes-from-plan: a planned page lane keeps its own name ("DASHBOARD :5173") instead of the plain word PAGE. A guess is left as it was. */
export function plannedLanes(defs: LaneDef[], expected: readonly Place[] = [], guessed: boolean): LaneDef[] {
  if (guessed) return defs;
  return defs.map((l) => {
    const p = l.ghost && l.kind === "client" ? expected.find((e) => e.id === l.id) : undefined;
    return p ? { ...l, label: p.name, detail: p.detail } : l;
  });
}

/** A ghost lane that only came from the package.json guess (the caller lane is always there, so it is never a guess). */
export const isGuess = (l: Pick<LaneDef, "ghost" | "kind">, guessed: boolean) => guessed && l.ghost && l.kind !== "caller";

// ---- AP: edit and resend, compare, save as test ----

const DROP = new Set(["traceparent", "tracestate", "host", "content-length", "connection", "keep-alive", "transfer-encoding", "accept-encoding"]);

/** The request event a trip (or one station) sent: the caller's own before the server's, a write before a read. */
export function requestEvent(view: ActionView, stepIndex?: number): DebugEvent | undefined {
  const events = toSteps(view).map((s) => s.event);
  const at = stepIndex === undefined ? undefined : events[stepIndex];
  if (at?.kind === "http_request" && at.http) return at;
  const rank = (e: DebugEvent) => (e.origin === "server" ? 2 : 0) + (/^(GET|HEAD)$/i.test(e.http!.method) ? 1 : 0);
  return events.filter((e) => e.kind === "http_request" && e.http).sort((a, b) => rank(a) - rank(b))[0]; // stable: ties keep trip order
}

/** What to put in the request editor: the captured method, URL, headers and body. Hidden values stay as [redacted:…] for the user to fill. */
export function resendSpec(view: ActionView, stepIndex?: number): HttpRequestSpec | undefined {
  const h = requestEvent(view, stepIndex)?.http;
  if (!h) return undefined;
  const headers = Object.fromEntries(Object.entries(h.reqHeaders ?? {}).filter(([k]) => !DROP.has(k.toLowerCase()) && !k.toLowerCase().startsWith("sec-")));
  const hostOf = (x?: Record<string, string>) => Object.entries(x ?? {}).find(([k]) => k.toLowerCase() === "host")?.[1];
  const host = hostOf(h.reqHeaders) ?? toSteps(view).map((s) => hostOf(s.event.http?.reqHeaders)).find(Boolean);
  const url = h.url.startsWith("/") && host ? `http://${host}${h.url}` : h.url; // the server and a page's fetch record only the path
  return { method: h.method.toUpperCase(), url,...(Object.keys(headers).length ? { headers } : {}), ...(h.reqBody !== undefined && !/^(GET|HEAD)$/i.test(h.method) ? { body: h.reqBody } : {}) };
}

/** Save as test: the request plus one row that pins the status it answered. */
export function testStep(view: ActionView): FlowStep | undefined {
  const spec = resendSpec(view);
  const status = requestEvent(view)?.http?.status;
  if (!spec || !status) return undefined;
  const name = view.root.caller?.kind === "explorer" && view.root.caller.label !== "API explorer" ? view.root.caller.label : undefined;
  return { type: "request", request: { ...spec, ...(name ? { name } : {}) }, assert: [{ expr: "res.status", op: "eq", value: String(status), enabled: true }] };
}

const json = (s?: string): Record<string, unknown> | undefined => {
  try {
    const v = JSON.parse(s ?? "") as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
};
const shown = (v: unknown) => (v === undefined ? "missing" : clip(JSON.stringify(v), 40));

/** Compare a resend with the trip it edited, in plain lines: what you changed, then what came back. */
export function resendDiff(before: ActionView, after: ActionView): string[] {
  const a = requestEvent(before)?.http;
  const b = requestEvent(after)?.http;
  if (!a || !b) return [];
  const out: string[] = [];
  if (a.method.toUpperCase() !== b.method.toUpperCase() || a.url !== b.url) out.push(`${a.method.toUpperCase()} ${a.url} → ${b.method.toUpperCase()} ${b.url}`);
  const ja = json(a.reqBody);
  const jb = json(b.reqBody);
  if (ja && jb) {
    for (const k of new Set([...Object.keys(ja), ...Object.keys(jb)])) if (JSON.stringify(ja[k]) !== JSON.stringify(jb[k])) out.push(`body.${k}: ${shown(ja[k])} → ${shown(jb[k])}`);
  } else if ((a.reqBody ?? "") !== (b.reqBody ?? "")) out.push("The body changed.");
  const mine = (h?: Record<string, string>) => Object.fromEntries(Object.entries(h ?? {}).map(([k, v]) => [k.toLowerCase(), v]).filter(([k]) => !DROP.has(k!) && k !== "user-agent")); // the sender sets user-agent, not you
  const ha = mine(a.reqHeaders);
  const hb = mine(b.reqHeaders);
  for (const k of new Set([...Object.keys(ha), ...Object.keys(hb)])) if (ha[k] !== hb[k]) out.push(`${k} header: ${ha[k] === undefined ? "added" : hb[k] === undefined ? "removed" : "changed"}`);
  if (!out.length) out.push("Sent the same request again.");
  if (a.status !== b.status) out.push(`Answered ${a.status ?? "nothing"}, now ${b.status ?? "nothing"}.`);
  else out.push(`Answered ${b.status ?? "nothing"} both times.`);
  if (before.status !== after.status) out.push(after.status === "error" ? "It broke this time." : before.status === "error" ? "It works now." : `It was ${before.status}, now ${after.status}.`);
  return out;
}

/** An edited resend sits right under the trip it came from; resends of one trip keep their send order. */
export function resendOrder(ids: string[], resendOf: (id: string) => string | undefined): string[] {
  const set = new Set(ids);
  const kids = new Map<string, string[]>();
  const top: string[] = [];
  for (const id of ids) {
    const p = resendOf(id);
    if (p && p !== id && set.has(p)) kids.set(p, [...(kids.get(p) ?? []), id]);
    else top.push(id);
  }
  const out: string[] = [];
  const seen = new Set<string>();
  const visit = (id: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    out.push(id);
    for (const k of kids.get(id) ?? []) visit(k);
  };
  top.forEach(visit);
  ids.forEach(visit); // a forged loop still shows every trip
  return out;
}

/** One trip as a few plain lines for pasting into a chat, a PR comment or an agent (#82). Only values the Thread already draws. */
export function tripText(trip: Trip): string {
  const verdict = trip.status === "error" ? "BROKE" : trip.status === "slow" ? "SLOW" : "WORKED";
  const broken = trip.status === "error" ? firstFailure(trip) : -1;
  const lines = [`${trip.title}: ${verdict} (${trip.ms}ms)`, trip.returned];
  trip.stations.forEach((s, i) => {
    const parts = [`${i + 1}. ${s.label}`];
    if (s.where) parts.push(s.where);
    if (i === broken) parts.push("<- broke here");
    if (s.chip) parts.push(s.chip);
    lines.push(parts.join("  "));
  });
  return lines.join("\n");
}
