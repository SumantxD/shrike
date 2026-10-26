// A HAR file dropped on the stage becomes trips (#66).
//
// A HAR has no clicks, so there is no user_action to hang requests on: entries are grouped into trips by
// gaps of a second or more, each under a synthetic "Imported, no clicks" root. Every event goes through the
// store like any live event, so redactEvent runs on it (cookies, Authorization, tokens); events from a host
// that is not loopback/localhost are marked live, which is what switches on the store's pii redaction (#51),
// a HAR from someone else's browser holds real data.
//
// Pure: no fs, no Electron, no network. The main process feeds the returned messages into the store;
// the renderer calls it through the importHar IPC handler. WebSocket messages (_webSocketMessages) are
// skipped for now (ponytail: a HAR's websocket frames are not requests, and there is no trip shape for them
// yet). Firefox and Safari HARs differ slightly (no _initiator, content.text sometimes base64); neither
// field is read here, and base64 bodies are decoded.
import { z } from "zod";
import type { DebugEvent, IngestMessage } from "@shrike/schema";
import { dataKind, toData } from "../../../../packages/browser-agent/src/data.ts";
import { MAX_EVENTS, MAX_TRIP_EVENTS, randomHex } from "./store.ts";

/** The issue's cap: a HAR bigger than this is refused with a plain message, never parsed. */
export const MAX_HAR_BYTES = 50 * 1024 * 1024;
/** A gap of this long between two entries' start times starts a new trip. */
const GAP_MS = 1000;
/** The root label for every imported trip: a HAR has no clicks to name it after. */
export const IMPORTED_LABEL = "Imported, no clicks";

const LOOPBACK = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1", "[::1]"]);
const isLocal = (u: URL): boolean =>
  LOOPBACK.has(u.hostname) || u.hostname.endsWith(".localhost") || /^127\.\d+\.\d+\.\d+$/.test(u.hostname);

const harHeaders = z.array(z.object({ name: z.string(), value: z.string() }).passthrough());
const harEntry = z
  .object({
    startedDateTime: z.string(),
    time: z.number(),
    request: z
      .object({
        method: z.string(),
        url: z.string(),
        headers: harHeaders.optional(),
        postData: z.object({ text: z.string().optional(), encoding: z.string().optional() }).passthrough().optional(),
      })
      .passthrough(),
    response: z
      .object({
        status: z.number(),
        headers: harHeaders.optional(),
        content: z.object({ text: z.string().optional(), encoding: z.string().optional() }).passthrough().optional(),
      })
      .passthrough()
      .optional(),
    _webSocketMessages: z.array(z.unknown()).optional(),
  })
  .passthrough();
const harFile = z.object({ log: z.object({ entries: z.array(z.unknown()) }).passthrough() }).passthrough();

type HarEntry = z.infer<typeof harEntry>;

export interface HarImport {
  /** One trip per array: the synthetic root first, then its events. */
  trips: DebugEvent[][];
  /** Entries that became events (a Supabase/Firestore entry can become more than one). */
  entries: number;
  /** Entries dropped: unparseable, or a URL that is not a URL. */
  skipped: number;
  /** Entries cut by the store's total cap. */
  truncated: number;
  /** Entries carrying WebSocket messages, skipped for now (see the header note). */
  webSockets: number;
}

const lowerHeaders = (headers: { name: string; value: string }[] | undefined): Record<string, string> =>
  Object.fromEntries((headers ?? []).map((h) => [h.name.toLowerCase(), h.value]));

/** HAR content.text is sometimes base64 (Firefox/Safari binary or encoded bodies); plain text otherwise. */
function decodeBody(text: string | undefined, encoding: string | undefined): string | undefined {
  if (text === undefined) return undefined;
  if (encoding !== "base64") return text;
  try {
    return Buffer.from(text, "base64").toString("utf8");
  } catch {
    return text;
  }
}

/** The readable name, mirroring the live browser agent: path for the app's own host, origin + path elsewhere. */
function displayName(url: URL): string {
  return isLocal(url) ? url.pathname : `${url.origin}${url.pathname}`;
}

/** One HAR entry into its events, or null when the entry is unusable. An empty array means the entry was
 *  deliberately dropped (a dev server's own call, a Firestore back channel): not an error. */
function entryEvents(entry: HarEntry, traceId: string, rootId: string): DebugEvent[] | null {
  let url: URL;
  try {
    url = new URL(entry.request.url);
  } catch {
    return null;
  }
  const startMs = Date.parse(entry.startedDateTime);
  if (Number.isNaN(startMs)) return null;
  const method = entry.request.method.toUpperCase();
  const headers = lowerHeaders(entry.request.headers);
  const status = entry.response?.status ?? 0;
  const ev: DebugEvent = {
    id: randomHex(8),
    traceId,
    parentId: rootId,
    origin: "browser",
    kind: "http_request",
    name: `${method} ${displayName(url)}`,
    startMs,
    durationMs: Math.max(0, Math.round(entry.time)),
    status: status === 0 || status >= 400 ? "error" : "ok",
    http: {
      method,
      url: entry.request.url,
      status,
      reqHeaders: headers,
      resHeaders: lowerHeaders(entry.response?.headers),
      reqBody: decodeBody(entry.request.postData?.text, entry.request.postData?.encoding),
      resBody: decodeBody(entry.response?.content?.text, entry.response?.content?.encoding),
    },
  };
  // #51: only foreign data gets pii redaction. Localhost HARs behave like local dev traffic (values visible).
  if (!isLocal(url)) ev.live = true;
  const kind = dataKind(url, method, headers);
  if (kind === "skip") return [];
  if (kind === "supabase" || kind === "firestore") return toData(ev, url, kind, () => randomHex(8));
  return [ev];
}

/**
 * Parse HAR text into trips. Throws a plain Error with a message fit for the UI on any whole-file problem
 * (empty, over the cap, not JSON, not a HAR): never a crash, never a stack trace to the user.
 */
export function parseHar(text: string): HarImport {
  if (!text.trim()) throw new Error("That file is empty.");
  if (Buffer.byteLength(text, "utf8") > MAX_HAR_BYTES) throw new Error("That HAR file is over 50 MB, so I can't import it.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("That doesn't look like a HAR file.");
  }
  const file = harFile.safeParse(parsed);
  if (!file.success) throw new Error("That doesn't look like a HAR file.");

  const valid: { entry: HarEntry; startMs: number; index: number }[] = [];
  let skipped = 0;
  let webSockets = 0;
  for (let i = 0; i < file.data.log.entries.length; i++) {
    const one = harEntry.safeParse(file.data.log.entries[i]);
    if (!one.success) {
      skipped++;
      continue;
    }
    if (one.data._webSocketMessages?.length) webSockets++;
    const startMs = Date.parse(one.data.startedDateTime);
    if (Number.isNaN(startMs)) {
      skipped++;
      continue;
    }
    valid.push({ entry: one.data, startMs, index: i });
  }
  // HARs are usually in order; sort defensively so a gap is a gap, with the file order breaking ties.
  valid.sort((a, b) => a.startMs - b.startMs || a.index - b.index);

  // The store's total cap, applied to entries before they are grouped.
  let truncated = 0;
  const kept = valid.slice(0, MAX_EVENTS);
  truncated = valid.length - kept.length;

  // Group by gaps, then convert. A trip's events are chunked at the store's per-trip cap so the store
  // never has to drop imported events; each chunk is its own trip under the same label.
  const groups: typeof kept[] = [];
  for (const item of kept) {
    const last = groups.at(-1);
    if (!last || item.startMs - last.at(-1)!.startMs >= GAP_MS) groups.push([item]);
    else last.push(item);
  }

  const trips: DebugEvent[][] = [];
  let entries = 0;
  for (const group of groups) {
    const traceId = randomHex(16);
    const rootId = randomHex(8);
    const events: DebugEvent[] = [];
    for (const { entry } of group) {
      const made = entryEvents(entry, traceId, rootId);
      if (made === null) {
        skipped++;
        continue;
      }
      entries++;
      events.push(...made);
    }
    if (!events.length) continue;
    // Leave one slot for the root itself: root + MAX_TRIP_EVENTS children would trip the store's cap.
    const perTrip = MAX_TRIP_EVENTS - 1;
    for (let i = 0; i < events.length; i += perTrip) {
      const chunkRootId = i === 0 ? rootId : randomHex(8);
      const chunkTraceId = i === 0 ? traceId : randomHex(16); // the store caps per traceId, so each chunk needs its own
      const chunk = events.slice(i, i + perTrip).map((e) => ({ ...e, traceId: chunkTraceId, parentId: e.parentId === rootId ? chunkRootId : e.parentId }));
      const first = chunk[0]!;
      const lastEnd = Math.max(...chunk.map((e) => e.startMs + (e.durationMs ?? 0)));
      const root: DebugEvent = {
        id: chunkRootId,
        traceId: chunkTraceId,
        origin: "browser",
        kind: "user_action",
        name: IMPORTED_LABEL,
        startMs: first.startMs,
        durationMs: Math.max(0, lastEnd - first.startMs),
        status: chunk.some((e) => e.status === "error") ? "error" : "ok",
      };
      trips.push([root, ...chunk]);
    }
  }
  return { trips, entries, skipped, truncated, webSockets };
}

/** parseHar, shaped as ingest messages: one { type: "events" } per trip, root first, straight into store.handle. */
export function harMessages(text: string): IngestMessage[] {
  return parseHar(text).trips.map((events) => ({ type: "events", events }));
}
