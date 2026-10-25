import type { ActionView, AgentStep, AgentUsage, Checkpoint, DebugEvent, Finding, Flow, Patch, PointPick, Race, SdlcState, Skill, SourceLocation, TimelineNode } from "@shrike/schema";
import type { Station, Trip } from "../lib/thread-layout.ts";
import { lineDiff } from "../lib/hud.ts";
import { currentStage } from "../../../main/sdlc.ts";

// Pure shell logic: keyboard map and agent-to-station mapping. Tested in logic.test.ts.

export type Command =
  | "step-down" | "step-up" | "trip-down" | "trip-up" | "dive" | "escape" | "replay" | "time" | "next-failure"
  | "app" | "logs" | "network" | "api" | "terminal" | "details" | "editor" | "record" | "ask" | "apply" | "view-new-trip"
  | "point" | "quick-open" | "skills" | "ship" | "flows" | "pop-out" | "view" | "trip-list" | "help";

export interface KeyInput {
  key: string;
  meta: boolean;
  ctrl: boolean;
  alt: boolean;
  typing: boolean; // focus is in an input, textarea, select or contenteditable
}

export const PLAIN: Record<string, Command> = {
  ArrowDown: "step-down", ArrowUp: "step-up", PageDown: "trip-down", PageUp: "trip-up", " ": "replay",
  t: "time", "!": "next-failure", p: "app", g: "logs", n: "network", a: "api", "`": "terminal", d: "details",
  e: "editor", r: "record", "/": "ask", x: "point", k: "skills", s: "ship", w: "flows", o: "pop-out", v: "view",
  f: "trip-list", "?": "help",
};

/** The ? card (H17). Keys are what resolveKey reads, so logic.test.ts can check every PLAIN key is listed here. */
export const SHORTCUTS: { group: string; rows: { keys: string[]; what: string }[] }[] = [
  { group: "Move", rows: [
    { keys: ["ArrowUp", "ArrowDown"], what: "Step through the trip" },
    { keys: ["PageUp", "PageDown"], what: "Previous or next trip" },
    { keys: ["Enter"], what: "Dive into the step" },
    { keys: ["Escape"], what: "Surface, or close what's open" },
    { keys: ["!"], what: "Next failure" },
    { keys: ["f"], what: "Go to the trip list" },
  ] },
  { group: "Look", rows: [
    { keys: [" "], what: "Replay the trip" },
    { keys: ["t"], what: "Time view" },
    { keys: ["v"], what: "Thread or Files view" },
    { keys: ["e"], what: "Open the step's file" },
    { keys: ["p"], what: "Show or hide your app" },
    { keys: ["o"], what: "Your app in its own window" },
  ] },
  { group: "Panels", rows: [
    { keys: ["g"], what: "Logs" },
    { keys: ["n"], what: "Network" },
    { keys: ["a"], what: "API explorer" },
    { keys: ["`"], what: "Terminal" },
    { keys: ["d"], what: "Details of the step" },
    { keys: ["k"], what: "Skills" },
    { keys: ["s"], what: "Ship" },
    { keys: ["w"], what: "Flows" },
    { keys: ["r"], what: "Record a clip" },
    { keys: ["⌘P"], what: "Find a file, trip, route or log line" },
    { keys: ["?"], what: "Show or hide these keys" },
  ] },
  { group: "Agent", rows: [
    { keys: ["⌘K", "/"], what: "Ask your agent" },
    { keys: ["x"], what: "Point at something in your app" },
    { keys: ["⌘↵"], what: "Allow what the agent asks for" },
  ] },
];

const KEY_LABEL: Record<string, string> = { ArrowUp: "↑", ArrowDown: "↓", PageUp: "PgUp", PageDown: "PgDn", " ": "Space", Escape: "Esc" };

/** How a SHORTCUTS key reads on the card: "t" is T, " " is Space. Chords keep their ⌘ for keys() to localise. */
export const keyLabel = (k: string): string => KEY_LABEL[k] ?? (k.length === 1 ? k.toUpperCase() : k);

/** docs/06-design.md "Keyboard". Only Esc, ⌘K, ⌘P and ⌘↵ work while typing. */
export function resolveKey(k: KeyInput, ctx: { newTrip: boolean; approval: boolean; files?: boolean }): Command | null {
  const mod = k.meta || k.ctrl;
  if (k.key === "Escape") return "escape";
  if (mod && k.key.toLowerCase() === "k") return "ask";
  if (mod && !k.alt && k.key.toLowerCase() === "p") return "quick-open";
  if (mod && k.key === "Enter") return ctx.approval ? "apply" : null;
  if (k.typing || mod || k.alt) return null;
  if (k.key === "Enter") return ctx.newTrip ? "view-new-trip" : "dive";
  if (ctx.files && (k.key === "ArrowRight" || k.key === "ArrowLeft")) return k.key === "ArrowRight" ? "step-down" : "step-up"; // FV: the timeline runs left to right
  return PLAIN[k.key.length === 1 ? k.key.toLowerCase() : k.key] ?? null;
}

export function eventsById(view: ActionView): Map<string, DebugEvent> {
  const m = new Map<string, DebugEvent>([[view.root.id, view.root]]);
  const walk = (nodes: TimelineNode[]) => nodes.forEach((n) => (m.set(n.event.id, n.event), walk(n.children ?? [])));
  walk(view.tree ?? []);
  return m;
}

/** Where E goes for a station: the calling line for a call, else where it happened. */
export function stationLoc(view: ActionView, st: Station): SourceLocation | undefined {
  const e = eventsById(view).get(st.id);
  return e?.callSite ?? e?.source;
}

const sameFile = (a: string, b: string) => a === b || a.endsWith(`/${b}`) || b.endsWith(`/${a}`);
const at = (l: SourceLocation | undefined, f: Finding) => !!l && l.line === f.line && sameFile(l.file, f.file!);

/** The station a finding points at, or -1. Event id beats call line beats definition line beats the label. */
export function matchStation(trip: Trip, view: ActionView, f: Finding): number {
  const st = trip.stations;
  if (f.eventId) {
    const i = st.findIndex((s) => s.eventIds.includes(f.eventId!));
    if (i >= 0) return i;
  }
  if (!f.file || !f.line) return -1;
  const ev = eventsById(view);
  const any = (s: Station, pick: (e: DebugEvent) => SourceLocation | undefined) => s.eventIds.some((id) => at(pick(ev.get(id) ?? view.root), f));
  for (const pick of [(e: DebugEvent) => e.callSite, (e: DebugEvent) => e.source]) {
    const i = st.findIndex((s) => any(s, pick));
    if (i >= 0) return i;
  }
  const tail = `${f.file.split("/").pop()}:${f.line}`;
  return st.findIndex((s) => !!s.where?.endsWith(tail));
}

/** A finding on a function's own line is sharper on the call inside it that got a bad value (the chip in red). */
export function sharpen(trip: Trip, view: ActionView, hit: number, f: Finding): number {
  const st = trip.stations[hit];
  if (!st || st.kind !== "function") return hit;
  const ev = eventsById(view);
  const parent = new Map<string, string>();
  const walk = (nodes: TimelineNode[], up: string) => nodes.forEach((n) => (parent.set(n.event.id, up), walk(n.children ?? [], n.event.id)));
  walk(view.tree ?? [], view.root.id);
  const inside = (id: string) => {
    for (let p = parent.get(id); p; p = parent.get(p)) if (p === st.id) return true;
    return false;
  };
  const i = trip.stations.findIndex((s, k) => k > hit && s.kind === "function" && s.chipError && inside(s.id) && (!f.file || sameFile(ev.get(s.id)?.callSite?.file ?? "", f.file)));
  return i >= 0 ? i : hit;
}

const CONF_RANK: Record<Finding["confidence"], number> = { observed: 0, likely: 1, possible: 2 };

/** Findings that land on a station first, then by confidence. */
export function rankFindings(all: Finding[], trip?: Trip, view?: ActionView): Finding[] {
  const hit = (f: Finding) => (trip && view && matchStation(trip, view, f) >= 0 ? 0 : 1);
  return [...all].sort((a, b) => hit(a) - hit(b) || CONF_RANK[a.confidence] - CONF_RANK[b.confidence]);
}

/** FOUND IT's finding: the one picked when the walk landed (kept, so a cleared probe or a branch's trips can't swap it), else the best ranked. */
export function chosenFinding(step: AgentStep, picked: Readonly<Record<string, Finding>>, trip?: Trip, view?: ActionView): Finding | undefined {
  return picked[step.id] ?? rankFindings(step.findings ?? [], trip, view)[0];
}

/** The probe walks up to, never onto, the snap: the break itself is what FOUND IT reveals. */
export function probeCap(trip: Trip): number {
  const snap = trip.stations.findIndex((s) => s.snap);
  return Math.max(0, snap >= 0 ? snap - 1 : trip.stations.length - 1);
}

/** One plain line: no markdown, and only the first sentence unless `whole`. */
export function sentence(t: string, n = 120, whole = false): string {
  const flat = t.replace(/\*\*|`/g, "").replace(/\s+/g, " ").trim();
  const s = whole ? flat : (flat.split(/(?<=[.!?])\s/)[0] ?? "");
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

// ---------- Ask context chips (O1 point mode, O8 drag to Ask) ----------

export interface Chip {
  id: string; // dedupe key
  kind: "element" | "station" | "log" | "file";
  label: string; // what the chip shows
  line: string; // what the agent gets, one plain line
}

const MAX_LINE = 400;
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const flat = (s: string) => s.replace(/\s+/g, " ").trim();
const baseName = (f: string) => f.split("/").pop() ?? f;
export const shortWhere = (l?: SourceLocation): string => (l ? `${baseName(l.file)}:${l.line}` : "");
const CLICKY = new Set(["button", "link", "checkbox", "radio", "tab", "menuitem", "switch", "summary"]);

/** Button 'Pay now' · Checkout.tsx:22 */
export function pickChip(p: PointPick): Chip {
  const role = p.role ? p.role[0]!.toUpperCase() + p.role.slice(1) : "Element";
  const what = p.text ? `${role} '${clip(flat(p.text), 40)}'` : role;
  const line = `Context: the ${p.role || "element"}${p.text ? ` "${flat(p.text)}"` : ""} I pointed at in my app (selector ${p.selector})${p.source ? `, rendered at ${p.source.file}:${p.source.line}` : ""}`;
  return { id: `element:${p.selector}`, kind: "element", label: [what, shortWhere(p.source)].filter(Boolean).join(" · "), line: clip(line, MAX_LINE) };
}

/** The question the Ask pill suggests for a picked element. */
export function pointQuestion(p: PointPick, broke: boolean): string {
  if (broke) return "Why doesn't this work?";
  const name = clip(flat(p.text), 40);
  if (CLICKY.has(p.role)) return name ? `What happens when I click ${name}?` : "What happens when I click this?";
  return name ? `Where does "${name}" come from?` : "What is this part of the page?";
}

function eventDetail(e: DebugEvent): string {
  if (e.kind === "function" && e.args?.length) return ` with ${flat(e.args.join(", "))}`;
  if (e.db) return `: ${flat(e.db.statement)}${e.db.params ? ` with ${flat(e.db.params)}` : ""}${e.error ? ` (failed: ${flat(e.error.message)})` : ""}`;
  if (e.http) return `: ${e.http.method} ${e.http.url}${e.http.status != null ? ` answered ${e.http.status}` : ""}`;
  if (e.log) return `: "${flat(e.log.message)}"`;
  if (e.error) return ` (failed: ${flat(e.error.message)})`;
  return "";
}

/** Context: insertTodo() at todos.controller.ts:18 with { title: 'buy milk', userId: undefined } */
export function stationChip(st: Pick<Station, "id" | "label">, e: DebugEvent | undefined): Chip {
  const loc = e ? (e.callSite ?? e.source) : undefined;
  const where = shortWhere(loc);
  const line = `Context: ${st.label}${where ? ` at ${where}` : ""}${e ? eventDetail(e) : ""}`;
  return { id: `station:${st.id}`, kind: "station", label: [clip(st.label, 40), where].filter(Boolean).join(" · "), line: clip(line, MAX_LINE) };
}

export function logChip(e: DebugEvent): Chip {
  const msg = flat(e.log?.message ?? e.error?.message ?? e.name);
  const where = shortWhere(e.source);
  return { id: `log:${e.id}`, kind: "log", label: [`log '${clip(msg, 32)}'`, where].filter(Boolean).join(" · "), line: clip(`Context: the log line "${msg}"${where ? ` at ${where}` : ""}`, MAX_LINE) };
}

export function fileChip(path: string, line?: number): Chip {
  return { id: `file:${path}`, kind: "file", label: line ? `${baseName(path)}:${line}` : baseName(path), line: `Context: the file ${path}${line ? `, line ${line}` : ""}` };
}

/** The goal the agent receives: what you typed, then one plain line per chip. Fits startAgent's 4000 chars. */
export function goalWithContext(goal: string, chips: Chip[]): string {
  return [goal.trim(), ...chips.map((c) => c.line)].filter(Boolean).join("\n").slice(0, 4000);
}

// ---------- Slash commands in the Ask pill (A10) ----------

export const SLASH = [
  { id: "explain", hint: "Explain the step you're on" },
  { id: "fix", hint: "Ask the agent to fix this trip" },
  { id: "replay", hint: "Play this trip again" },
  { id: "compare", hint: "Compare with the last time it ran" },
  { id: "record", hint: "Record this trip as a clip" },
  { id: "time", hint: "Switch the time view on or off" },
  { id: "issue", hint: "Write this trip up as an issue" },
  { id: "chain", hint: "Run a prompt chain: /chain polish-until-8" }, // P4
  { id: "tools", hint: "See, check and add your agent's tools (MCP servers)" }, // MCP1
  { id: "api", hint: "Send any request to your app, Postman and Bruno style: /api /api/todos" }, // AP
  { id: "files", hint: "Follow this trip through your folders and files" }, // FV
  { id: "thread", hint: "Back to the Thread, on the same step" }, // FV
] as const;
export type SlashId = (typeof SLASH)[number]["id"];

/** One row of the palette: a built-in command, a skill (S6) or a saved command. */
export interface SlashEntry {
  id: string;
  hint: string;
  kind: "builtin" | "skill" | "command";
  prompt?: string; // saved commands: what gets asked
}

const slug = (s: string) => s.toLowerCase().replace(/[^\w-]+/g, "-").replace(/^-+|-+$/g, "");

/** Built-ins first, then saved commands, then skills; a later entry never shadows an earlier id. */
export function mergeSlash(skills: Pick<Skill, "id" | "name" | "when">[], commands: { name: string; prompt: string }[]): SlashEntry[] {
  const out: SlashEntry[] = SLASH.map((c) => ({ ...c, kind: "builtin" as const }));
  const seen = new Set(out.map((c) => c.id));
  const add = (e: SlashEntry) => e.id && !seen.has(e.id) && (seen.add(e.id), out.push(e));
  for (const c of commands) add({ id: slug(c.name), hint: sentence(c.prompt, 70), kind: "command", prompt: c.prompt });
  for (const k of skills) add({ id: slug(k.id), hint: sentence(k.when || k.name, 70), kind: "skill" });
  return out;
}

/** Commands for the palette while the input starts with "/", else null. At most 9 rows. */
export function slashMatches<T extends { id: string }>(input: string, list: readonly T[] = SLASH as unknown as T[]): T[] | null {
  if (!input.startsWith("/") || /\s/.test(input.trimEnd().slice(1))) return null;
  const q = input.slice(1).trim().toLowerCase();
  return list.filter((c) => c.id.startsWith(q)).slice(0, 9);
}

/** "/fix the form" -> { id: "fix", rest: "the form" }. Unknown commands are not commands. */
export function parseSlash<T extends { id: string }>(input: string, list: readonly T[] = SLASH as unknown as T[]): { id: T["id"]; rest: string; entry: T } | null {
  const m = /^\/([\w-]+)\s*([\s\S]*)$/.exec(input.trim());
  const c = m && list.find((x) => x.id === m[1]!.toLowerCase());
  return c ? { id: c.id, rest: m[2]!.trim(), entry: c } : null;
}

/** The same action again: same label, or a click and a submit of the same named button (the agent's click on a form's button records as its submit). */
export { sameAction } from "../../../main/sdlc.ts";

/** The previous trip with the same label, for /compare. `order` is oldest first. */
export function previousSameLabel(order: string[], byId: Record<string, ActionView | undefined>, id: string): string | undefined {
  const label = byId[id]?.label;
  for (let i = order.indexOf(id) - 1; i >= 0; i--) if (byId[order[i]!]?.label === label) return order[i];
  return undefined;
}

// ---------- Quick open ⌘P (O5) ----------

const WORD_START = /[\s/._\-:"(]/;

/** Subsequence match: higher is better, null when the letters aren't all there in order. */
export function fuzzyScore(query: string, text: string): number | null {
  const q = query.toLowerCase().replace(/\s+/g, "");
  if (!q) return 0;
  const t = text.toLowerCase();
  let score = 0;
  let ti = 0;
  let prev = -2;
  for (const ch of q) {
    const at = t.indexOf(ch, ti);
    if (at < 0) return null;
    score += 1;
    if (at === prev + 1) score += 3;
    if (at === 0 || WORD_START.test(text[at - 1]!) || (text[at] !== t[at] && text[at - 1] === t[at - 1])) score += 2;
    score -= Math.min(at - ti, 4) * 0.1;
    prev = at;
    ti = at + 1;
  }
  const base = t.lastIndexOf("/") + 1;
  if (t.startsWith(q, base) || t.includes(q)) score += 4; // contiguous, best on a file name
  return score - t.length * 0.01;
}

/** Best `max` items for the query; with no query the list keeps its order. */
export function rankQuick<T extends { label: string; exact?: boolean }>(query: string, items: T[], max = 8): T[] {
  if (!query.trim()) return items.slice(0, max);
  const scored: { item: T; s: number; i: number }[] = [];
  const words = query.trim().toLowerCase();
  items.forEach((item, i) => {
    // exact: long free text (log lines) where scattered letters always match; only the words as typed count
    const s = item.exact && !item.label.toLowerCase().includes(words) ? null : fuzzyScore(query, item.label);
    if (s !== null) scored.push({ item, s, i });
  });
  return scored.sort((a, b) => b.s - a.s || a.i - b.i).slice(0, max).map((x) => x.item);
}

// ---------- Issue card (O6) ----------

export interface IssueInput {
  view: ActionView;
  appUrl?: string;
  pagePath?: string; // the page the click happened on ("/checkout")
  excerpt?: { file: string; line: number; start: number; lines: string[] };
  agent?: { summary?: string; findings: Finding[]; patch?: Patch };
  clipName?: string;
}

const imperative = (label: string) =>
  label.replace(/^Clicked /, "Click ").replace(/^Submitted /, "Submit ").replace(/^Ticked /, "Tick ").replace(/^Unticked /, "Untick ").replace(/^Opened /, "Open ").replace(/^Sent /, "Send ");

function walkEvents(view: ActionView): DebugEvent[] {
  const out: DebugEvent[] = [];
  const walk = (nodes: TimelineNode[]) => nodes.forEach((n) => (out.push(n.event), walk(n.children ?? [])));
  walk(view.tree ?? []);
  return out;
}

/** The line to show: the first failed step that names a place, else the innermost error. */
export function failingLocation(view: ActionView): SourceLocation | undefined {
  const all = walkEvents(view);
  const step = view.summary.steps.find((s) => !s.ok && s.source);
  // A failing call breaks where it was called (todos.controller.ts:18 passed the bad value), not where it is defined.
  if (step) return all.find((e) => e.id === step.eventId)?.callSite ?? step.source;
  const errs = all.filter((e) => e.status === "error" && (e.callSite ?? e.source));
  const last = errs.at(-1);
  return last ? (last.callSite ?? last.source) : undefined;
}

export function issueTitle(view: ActionView): string {
  const failed = view.summary.steps.filter((s) => !s.ok);
  const why = failed.find((s) => /database|refused|failed|error/i.test(s.text)) ?? failed[0];
  if (view.status !== "error") return `${view.label}: ${sentence(view.summary.headline, 100, true)}`;
  return `${view.label} fails${why ? `: ${sentence(why.text, 110)}` : ""}`;
}

/** Linear titles stay short: the part before the colon, at most 60 characters. */
export function shortTitle(title: string, n = 60): string {
  const head = title.split(/:\s/)[0] ?? title;
  return head.length > n ? `${head.slice(0, n - 1)}…` : head;
}

export function linearVariant(md: string): string {
  return md.replace(/^# (.*)$/m, (_, t: string) => `# ${shortTitle(t)}`);
}

const fence = (file: string) => ({ ts: "ts", tsx: "tsx", js: "js", jsx: "jsx", py: "python", go: "go", rb: "ruby", sql: "sql", json: "json" })[file.split(".").pop() ?? ""] ?? "";

function reproSteps(i: IssueInput): string[] {
  const { view } = i;
  const req = walkEvents(view).find((e) => e.kind === "http_request" && e.http);
  const browser = view.trigger === "click" || view.trigger === "submit" || view.trigger === "navigation" || (view.trigger === "agent" && view.root.origin === "browser");
  if (browser) {
    const out: string[] = [];
    if (i.appUrl && view.trigger !== "navigation") out.push(`Open ${i.appUrl.replace(/\/$/, "")}${i.pagePath ?? "/"}`);
    out.push(imperative(view.label));
    if (req?.http && req.origin === "browser") out.push(`The page sends \`${req.http.method} ${req.http.url}\`${req.http.reqBody ? ` with \`${clip(flat(req.http.reqBody), 300)}\`` : ""}`);
    return out;
  }
  if (view.root.caller?.command) return [`Run \`${view.root.caller.command}\``];
  if (req?.http) {
    const url = /^https?:/.test(req.http.url) ? req.http.url : `${(i.appUrl ?? "http://localhost").replace(/\/$/, "")}${req.http.url}`;
    const ct = req.http.reqHeaders?.["content-type"];
    const body = req.http.reqBody ? ` -d '${req.http.reqBody.replace(/'/g, "'\\''")}'` : "";
    return [`Run \`curl -X ${req.http.method} '${url}'${ct ? ` -H 'content-type: ${ct}'` : ""}${body}\``];
  }
  return [imperative(view.label)];
}

/** The agent's part of an issue: what it found and the diff it proposed. Empty when it found nothing. */
export function agentSection(a: IssueInput["agent"]): string {
  if (!a || (!a.findings.length && !a.summary && !a.patch)) return "";
  const out = ["## What the agent found", ""];
  if (a.summary) out.push(sentence(a.summary, 400, true), "");
  for (const f of a.findings) out.push(`- (${f.confidence}) ${flat(f.claim)}${f.file ? ` (\`${f.file}${f.line ? `:${f.line}` : ""}\`)` : ""}`);
  if (a.findings.length) out.push("");
  if (a.patch?.files.length) {
    out.push(`## ${a.patch.status === "applied" ? "The fix" : "Suggested fix"}`, "", flat(a.patch.rationale), "");
    for (const f of a.patch.files) {
      out.push("```diff", `--- a/${f.path}`, `+++ b/${f.path}`);
      for (const d of lineDiff(f.before, f.after)) out.push(`${d.kind === "del" ? "-" : d.kind === "add" ? "+" : " "}${d.text}`);
      out.push("```", "");
    }
  }
  return out.join("\n");
}

/** GitHub-ready markdown. Linear gets the same body with linearVariant(). */
export function issueMarkdown(i: IssueInput): string {
  const { view } = i;
  const out = [`# ${issueTitle(view)}`, "", "## What happened", "", sentence(view.summary.headline, 300, true), ""];
  for (const s of view.summary.steps) out.push(`- ${s.ok ? "✓" : "✗"} ${flat(s.text)}${s.source ? ` (\`${s.source.file}:${s.source.line}\`)` : ""}`);
  if (view.summary.steps.length) out.push("");
  out.push("## Steps to reproduce", "", ...reproSteps(i).map((s, k) => `${k + 1}. ${s}`), "");
  const failed = view.summary.steps.filter((s) => !s.ok).at(-1);
  out.push("## Expected", "", `${imperative(view.label)} works without an error.`, "", "## Actual", "");
  out.push(view.status === "error" ? (failed ? `${flat(failed.text)}.`.replace(/\.\.$/, ".") : sentence(view.summary.headline, 300, true)) : sentence(view.summary.headline, 300, true), "");
  for (const f of view.flags) out.push(`> ${flat(f.message)}`, "");
  if (i.excerpt) {
    const { file, line, start, lines } = i.excerpt;
    const w = String(start + lines.length - 1).length;
    out.push("## Where it breaks", "", `\`${file}:${line}\``, "", `\`\`\`${fence(file)}`);
    lines.forEach((l, k) => out.push(`${start + k === line ? ">" : " "} ${String(start + k).padStart(w)} | ${l}`));
    out.push("```", "");
  }
  const agent = agentSection(i.agent);
  if (agent) out.push(agent);
  if (i.clipName) out.push("## Clip", "", `\`${i.clipName}\` shows the trip. It's saved next to this file; drag it into the issue.`, "");
  out.push(`<sub>Recorded with Shrike · trip ${view.id} · ${view.durationMs}ms</sub>`, "");
  return out.join("\n");
}

// ---------- Markdown in the file view (O13) ----------

export type MdInline = { t: "text" | "code" | "b" | "i"; text: string } | { t: "a"; text: string; href: string } | { t: "img"; text: string; src: string };
export type MdBlock =
  | { t: "h"; level: number; text: string }
  | { t: "p" | "quote"; text: string }
  | { t: "ul" | "ol"; items: string[] }
  | { t: "code"; lang: string; text: string }
  | { t: "hr" };

// ponytail: the common subset (headings, lists, code, quotes, emphasis, links, images); tables render as text. Upgrade: a real parser.
export function parseMarkdown(src: string): MdBlock[] {
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  const out: MdBlock[] = [];
  let para: string[] = [];
  const flush = () => para.length && (out.push({ t: "p", text: para.join(" ") }), (para = []));
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!;
    const fenceM = /^\s*```\s*([\w-]*)/.exec(l);
    if (fenceM) {
      flush();
      const body: string[] = [];
      while (++i < lines.length && !/^\s*```/.test(lines[i]!)) body.push(lines[i]!);
      out.push({ t: "code", lang: fenceM[1] ?? "", text: body.join("\n") });
      continue;
    }
    const h = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(l);
    if (h) { flush(); out.push({ t: "h", level: h[1]!.length, text: h[2]! }); continue; }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(l)) { flush(); out.push({ t: "hr" }); continue; }
    const li = /^\s*([-*+]|\d+[.)])\s+(.*)$/.exec(l);
    if (li) {
      flush();
      const t = /\d/.test(li[1]!) ? "ol" : "ul";
      const last = out.at(-1);
      if (last && last.t === t) last.items.push(li[2]!);
      else out.push({ t, items: [li[2]!] });
      continue;
    }
    const q = /^\s*>\s?(.*)$/.exec(l);
    if (q) {
      flush();
      const last = out.at(-1);
      if (last && last.t === "quote") last.text += ` ${q[1]}`;
      else out.push({ t: "quote", text: q[1]! });
      continue;
    }
    if (!l.trim()) { flush(); continue; }
    const last = out.at(-1);
    if (!para.length && last && (last.t === "ul" || last.t === "ol") && /^\s{2,}\S/.test(l)) { last.items[last.items.length - 1] += ` ${l.trim()}`; continue; }
    para.push(l.trim());
  }
  flush();
  return out;
}

const INLINE = /(`[^`]+`)|(!\[[^\]]*\]\([^)\s]+\))|(\[[^\]]+\]\([^)\s]+\))|(\*\*[^*]+\*\*|__[^_]+__)|(\*[^*\s][^*]*\*|_[^_\s][^_]*_)/g;

export function parseInline(text: string): MdInline[] {
  const out: MdInline[] = [];
  let at = 0;
  for (const m of text.matchAll(INLINE)) {
    if (m.index > at) out.push({ t: "text", text: text.slice(at, m.index) });
    const s = m[0];
    if (m[1]) out.push({ t: "code", text: s.slice(1, -1) });
    else if (m[2] || m[3]) {
      const lm = /^!?\[([^\]]*)\]\(([^)\s]+)\)$/.exec(s)!;
      out.push(m[2] ? { t: "img", text: lm[1]!, src: lm[2]! } : { t: "a", text: lm[1]!, href: lm[2]! });
    } else if (m[4]) out.push({ t: "b", text: s.slice(2, -2) });
    else out.push({ t: "i", text: s.slice(1, -1) });
    at = m.index + s.length;
  }
  if (at < text.length) out.push({ t: "text", text: text.slice(at) });
  return out;
}

export const IMAGE_EXT = /\.(png|jpe?g|gif|svg|webp)$/i;
export const isMarkdown = (path: string): boolean => /\.(md|markdown)$/i.test(path);

// ---------- Hidden moves made obvious (docs/13) ----------

export type MoveId = "find-cause" | "rewind" | "try-both" | "review-fix" | "run-tests" | "save-skill" | "keep-watching" | "record-flow" | "ship"; // Tidy up lives by the fuel ring (TopBar) and in the Ask pill
export interface Move {
  id: MoveId;
  label: string;
  hint: string; // the hover title: what it does, in plain words
  checkpointId?: string;
  patchId?: string;
  prompt?: string; // find-cause: what goes in the Ask field
}

export interface MoveInput {
  sdlc: SdlcState;
  checkpoints: Checkpoint[];
  flows: Flow[];
  findings: Finding[]; // the latest FOUND IT card's
  pendingPatchId?: string; // a fix waiting for Apply
  reviewing: boolean;
  agentBusy: boolean;
  race: Race | null;
  hasPr: boolean;
}

/** How full the agent's context is, 0..1. */
export const fuel = (u: AgentUsage | null): number => (u?.contextTokens && u.contextLimit ? Math.min(1, u.contextTokens / u.contextLimit) : 0);

/** The moves worth one button right now, at most `max` (one focal point): the current stage's move first, then what's useful after it. */
export function hiddenMoves(i: MoveInput, max = 2): Move[] {
  const sd = i.sdlc;
  const st = sd.stages;
  const cur = currentStage(sd);
  if (!cur) return [];
  const fix = i.checkpoints.findLast((c) => c.current);
  const claims = new Set(i.findings.filter((f) => f.confidence !== "possible").map((f) => f.file ?? f.claim));
  const raceLive = !!i.race && i.race.actionId === sd.actionId && !i.race.adopted;
  const raceDone = raceLive && i.race!.candidates.every((c) => c.state === "green" || c.state === "red" || c.state === "failed");
  // a fix that only lives in a worktree: its race card has the one button (Use this fix / Bring it over)
  const inYourCode = !!fix || st.fix === "skipped" || (!!i.race?.adopted && i.race.actionId === sd.actionId);
  const tests: Move | undefined = sd.hasTests && !sd.tests ? { id: "run-tests", label: "Run the tests", hint: "Run your project's unit tests to be sure nothing else broke." } : undefined;
  const watch: Move = i.flows.length
    ? { id: "keep-watching", label: "Keep watching", hint: "Re-run your saved flows on every save, and tell you if one turns red." }
    : { id: "record-flow", label: "Record a flow to keep watching", hint: "Click through it once; Shrike replays it on every save." };
  const out: (Move | undefined)[] = [];

  if (st.prove === "failed" && fix) out.push({ id: "rewind", label: "Rewind to before this fix", hint: `The fix didn't work. Put the code back to before "${fix.label}".`, checkpointId: fix.id });
  else if (st.prove === "failed" && raceDone && !i.agentBusy)
    out.push({ id: "find-cause", label: "Find another fix", hint: "Ask your agent to look again and try something different.", prompt: "The fix didn't work when it was re-run. Find the cause again and try a different fix." });
  else if (cur === "understand" && !i.agentBusy && !i.pendingPatchId && !raceLive)
    out.push({ id: "find-cause", label: "Find the cause", hint: "Ask your agent why it broke. It retraces the trip and reads the code.", prompt: "Why does this break? Find the cause." });
  else if (cur === "fix" && st.understand === "done" && !i.agentBusy && !i.race && claims.size >= 2)
    out.push({ id: "try-both", label: "Try both", hint: "Two fixes look plausible. Try each in its own copy of the code and keep the one that works." });
  else if (cur === "prove" && inYourCode) out.push(tests);
  else if (cur === "review" && fix && !i.reviewing && !i.pendingPatchId) out.push({ id: "review-fix", label: "Review this fix", hint: "A second look at the change: bugs, missed cases, security.", patchId: fix.patchId });
  else if (cur === "ship" && inYourCode)
    out.push(i.hasPr ? { id: "ship", label: "See the pull request", hint: "Its checks, and merge when they're green." } : { id: "ship", label: "Ship this fix", hint: "Branch, commit, push and open a pull request. Nothing is pushed until you say yes." });
  else if (cur === "watch" && inYourCode) out.push(watch);

  if (inYourCode && st.prove === "done") out.push(tests, st.fix === "done" ? { id: "save-skill", label: "Save as a skill", hint: "Turn what fixed this into a playbook your agent can reuse next time." } : undefined, st.watch !== "done" ? watch : undefined);
  const seen = new Set<MoveId>();
  return out.filter((m): m is Move => !!m && !seen.has(m.id) && !!seen.add(m.id)).slice(0, max);
}

const MULTI = /\b(refactor|rename|across|everywhere|every|all the|migrate|split|move .* to|add (a|an) (new )?(feature|page|endpoint|screen|field))\b/i;

/** Plan first is on by default when the ask sounds like a change to several files. */
export function planFirstDefault(goal: string, chips: Chip[]): boolean {
  const files = new Set(chips.filter((c) => c.kind === "file" || c.kind === "station").map((c) => c.label.split(" · ").pop()?.split(":")[0]));
  return files.size >= 2 || MULTI.test(goal) || (goal.match(/\b[\w-]+\.(tsx?|jsx?|py|go|rb|css|sql)\b/g)?.length ?? 0) >= 2;
}

/** Tidy up: a fresh session gets the goal and what the last one learned, not its whole transcript. */
export function tidySummary(goal: string, steps: AgentStep[], max = 1800): string {
  const found = steps.findLast((s) => s.kind === "findings");
  const said = steps.filter((s) => s.kind === "message" && !s.tool).slice(-4).map((s) => `- ${sentence(s.text, 200)}`);
  const parts = [`Continue this task in a fresh session: ${goal.trim()}`];
  if (found) parts.push(`What you found so far: ${sentence(found.summary ?? found.text, 300, true)}`, ...(found.findings ?? []).slice(0, 4).map((f) => `- (${f.confidence}) ${sentence(f.claim, 200)}${f.file ? ` ${f.file}${f.line ? `:${f.line}` : ""}` : ""}`));
  if (said.length) parts.push("Your last notes:", ...said);
  parts.push("Don't repeat work already done; pick up from here.");
  return parts.join("\n").slice(0, max);
}

/** "Why is checkout slow?" -> "why-is-checkout". */
export const commandName = (goal: string): string => slug(goal.split(/\s+/).slice(0, 3).join(" ")).slice(0, 40) || "my-command";
