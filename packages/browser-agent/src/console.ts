import type { DebugEvent } from "@shrike/schema";
import { currentAction, markFailed } from "./actions.ts";
import { emitEvent } from "./emit.ts";
import { newEventId, ZERO_TRACE } from "./ids.ts";

const MAX = 2048;
type Level = NonNullable<DebugEvent["log"]>["level"];
const LEVELS: [keyof Console & ("log" | "info" | "warn" | "error" | "debug"), Level][] = [
  ["log", "info"],
  ["info", "info"],
  ["warn", "warn"],
  ["error", "error"],
  ["debug", "debug"],
];

const CAP = 100; // entries shown per Map or Set, so a huge one is cut, not walked

// Renders like JSON.stringify, plus Map, Set and Error, which JSON would show as {}.
// Returns undefined for values JSON drops (functions, symbols, undefined).
function show(v: unknown, seen: WeakSet<object>): string | undefined {
  if (typeof v === "bigint") return `${v}n`;
  if (typeof v === "function" || typeof v === "symbol" || v === undefined) return undefined;
  if (typeof v !== "object" || v === null) return JSON.stringify(v);
  if (typeof (v as { toJSON?: unknown }).toJSON === "function") return JSON.stringify(v);
  if (seen.has(v)) return '"[Circular]"';
  seen.add(v);
  const str = (x: unknown) => show(x, seen) ?? "undefined";
  if (v instanceof Error) return JSON.stringify(`${v.name}: ${v.message}`);
  if (v instanceof Map) {
    const items: string[] = [];
    for (const [k, x] of v) {
      if (items.length >= CAP) break;
      items.push(`${str(k)} => ${str(x)}`);
    }
    return `Map(${v.size}) {${items.join(", ")}}`;
  }
  if (v instanceof Set) {
    const items: string[] = [];
    for (const x of v) {
      if (items.length >= CAP) break;
      items.push(str(x));
    }
    return `Set(${v.size}) {${items.join(", ")}}`;
  }
  if (Array.isArray(v)) return `[${v.map((x) => show(x, seen) ?? "null").join(",")}]`;
  const parts: string[] = [];
  for (const k of Object.keys(v)) {
    const s = show((v as Record<string, unknown>)[k], seen);
    if (s !== undefined) parts.push(`${JSON.stringify(k)}:${s}`);
  }
  return `{${parts.join(",")}}`;
}

function preview(v: unknown): string {
  if (typeof v === "string") return v;
  if (v instanceof Error) return v.stack ?? `${v.name}: ${v.message}`;
  if (typeof v === "function") return `[Function ${v.name || "anonymous"}]`;
  if (typeof v !== "object" || v === null) return String(v);
  if (v instanceof Element) return `<${v.tagName.toLowerCase()}>`;
  try {
    return show(v, new WeakSet<object>()) ?? String(v);
  } catch {
    return Object.prototype.toString.call(v);
  }
}

// ponytail: subset of console formatting (%s %d %i %f %o %O %j %c); enough for log lines.
export function format(args: unknown[]): string {
  let rest = args;
  let head = "";
  if (typeof args[0] === "string" && args[0].includes("%")) {
    let i = 1;
    head = args[0].replace(/%[sdifoOjc%]/g, (m) => {
      if (m === "%%") return "%";
      if (i >= args.length) return m;
      const v = args[i++];
      if (m === "%c") return "";
      if (m === "%d" || m === "%i") return String(parseInt(String(v), 10));
      if (m === "%f") return String(parseFloat(String(v)));
      return preview(v);
    });
    rest = args.slice(i);
  } else if (args.length) {
    head = preview(args[0]);
    rest = args.slice(1);
  }
  const s = [head, ...rest.map(preview)].join(" ");
  return s.length > MAX ? s.slice(0, MAX) + "…[truncated]" : s;
}

function base(kind: "log" | "error", name: string, status: DebugEvent["status"]): DebugEvent {
  const a = currentAction();
  const e: DebugEvent = {
    id: newEventId(),
    traceId: a ? a.root.traceId : ZERO_TRACE,
    origin: "browser",
    kind,
    name: name.length > 200 ? name.slice(0, 200) + "…" : name,
    startMs: Date.now(),
    status,
  };
  if (a) e.parentId = a.root.id;
  return e;
}

let inside = false;

export function installConsole(): void {
  for (const [method, level] of LEVELS) {
    const orig = console[method];
    if (typeof orig !== "function") continue;
    console[method] = function (this: unknown, ...args: unknown[]) {
      if (!inside) {
        inside = true;
        try {
          const message = format(args);
          const e = base("log", message.split("\n")[0] ?? "", "ok");
          e.log = { level, message };
          emitEvent(e);
        } catch {
        } finally {
          inside = false;
        }
      }
      return orig.apply(this, args);
    };
  }

  const report = (err: unknown, fallback: string) => {
    try {
      const message = err instanceof Error ? err.message : err === undefined ? fallback : preview(err);
      const e = base("error", message || fallback, "error");
      e.error = { message: message || fallback };
      if (err instanceof Error) {
        e.error.type = err.name;
        if (err.stack) e.error.stack = err.stack;
      }
      emitEvent(e);
      const a = currentAction();
      if (a) markFailed(a);
    } catch {}
  };
  window.addEventListener("error", (ev) => report(ev.error ?? ev.message, "Script error"));
  window.addEventListener("unhandledrejection", (ev) => report(ev.reason, "Unhandled promise rejection"));
}
