import { randomBytes } from "node:crypto";
import { createServer, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { gunzipSync } from "node:zlib";
import { z } from "zod";
import type { IngestMessage } from "@shrike/schema";
import { decodeTraces, otlpMessages } from "./otlp.ts";

const MAX_BODY = 5 * 1024 * 1024;

const id = z.string().min(1).max(64);
const n = z.number().finite();
const label = z.string().max(200);
const row = z.record(z.string().max(200), z.union([z.string().max(2000), z.number(), z.boolean(), z.null()]));
const place = z.object({ id: label.min(1), kind: z.enum(["caller", "client", "service", "queue", "cache", "data", "outside"]), name: label, detail: label.optional() }).strip();
const eventSchema = z
  .object({
    id,
    traceId: id,
    parentId: id.optional(),
    kind: z.enum(["user_action", "http_request", "function", "db_query", "cache_op", "external_call", "log", "error"]),
    name: z.string().max(10_000),
    startMs: z.number().finite(),
    status: z.enum(["ok", "slow", "error"]),
    origin: z.enum(["browser", "server", "db", "explorer", "agent"]),
    target: z.object({ x: n, y: n, width: n, height: n, viewportWidth: n, viewportHeight: n }).strict().optional(),
    // A malformed extra drops only that field, not the whole batch.
    place: place.optional().catch(undefined),
    cache: z.object({ op: z.string().max(40), key: z.string().max(2000).optional(), path: z.string().max(2000).optional(), hit: z.boolean().optional() }).strip().optional().catch(undefined),
    caller: z
      .object({ kind: z.enum(["browser", "curl", "postman", "explorer", "agent", "cron", "test", "service", "other"]), label, command: z.string().max(4000).optional() })
      .strip()
      .optional()
      .catch(undefined),
    change: z // I3
      .object({
        table: label,
        op: z.enum(["insert", "update", "delete"]),
        count: z.number().int().min(0),
        rows: z.array(z.object({ pk: z.string().max(400).optional(), before: row.optional(), after: row.optional() }).strip()).max(5).optional(),
      })
      .strip()
      .optional()
      .catch(undefined),
  })
  .passthrough();

const messageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("hello"), source: z.enum(["server", "browser"]), pid: z.number().optional(), url: z.string().optional(), place: place.optional().catch(undefined), at: z.number() }),
  z.object({ type: z.literal("events"), events: z.array(eventSchema).max(10_000) }),
  z.object({ type: z.literal("action_end"), actionId: id, at: z.number() }),
]);

export function parseIngest(json: unknown): IngestMessage | null {
  const r = messageSchema.safeParse(json);
  return r.success ? (r.data as IngestMessage) : null;
}

export interface Ingest {
  url: string;
  token: string;
  close(): Promise<void>;
}

/** inspect: the place inspector's long poll (POST /inspect/poll, /inspect/reply) on the same port and token. POST /v1/traces: OTLP/HTTP (otlp.ts). */
export function startIngest(onMessage: (msg: IngestMessage) => void, inspect?: { handle(path: string, body: unknown, res: ServerResponse): void }): Promise<Ingest> {
  const token = randomBytes(16).toString("hex");
  const recorded = new Set<string>(); // services node-agent records; their own OpenTelemetry SDK would only double them
  const server = createServer((req, res) => {
    const inspecting = !!inspect && (req.url === "/inspect/poll" || req.url === "/inspect/reply");
    const otlp = req.url === "/v1/traces";
    if (req.method !== "POST" || (req.url !== "/ingest" && !inspecting && !otlp)) return void res.writeHead(404).end();
    if (req.headers["x-shrike-token"] !== token) return void res.writeHead(401).end();
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) {
        res.writeHead(413).end();
        req.destroy();
      } else chunks.push(c);
    });
    req.on("end", () => {
      if (size > MAX_BODY) return;
      if (inspecting) {
        let body: unknown;
        try {
          body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        } catch {
          return void res.writeHead(400).end();
        }
        return inspect!.handle(req.url!, body, res);
      }
      if (otlp) return traces(req.headers["content-type"] ?? "", req.headers["content-encoding"], Buffer.concat(chunks), res);
      let msg: IngestMessage | null = null;
      try {
        msg = parseIngest(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {}
      if (!msg) return void res.writeHead(400).end();
      res.writeHead(204).end();
      if (msg.type === "hello" && msg.place) recorded.add(msg.place.id);
      deliver(msg);
    });
    req.on("error", () => {});
  });
  const deliver = (msg: IngestMessage) => {
    try {
      onMessage(msg);
    } catch (err) {
      console.error("[shrike] ingest handler failed", err);
    }
  };
  // OTLP/HTTP: protobuf (most SDKs' default) or JSON; success is an empty ExportTraceServiceResponse in the same encoding.
  const traces = (type: string, encoding: string | undefined, raw: Buffer, res: ServerResponse) => {
    const json = /json/i.test(type);
    let msgs: IngestMessage[] | null = null;
    try {
      const body = encoding === "gzip" ? gunzipSync(raw, { maxOutputLength: MAX_BODY }) : raw;
      msgs = otlpMessages(json ? JSON.parse(body.toString("utf8")) : decodeTraces(body), (id) => recorded.has(id));
    } catch {}
    if (!msgs) return void res.writeHead(400).end();
    res.writeHead(200, { "content-type": json ? "application/json" : "application/x-protobuf" }).end(json ? "{}" : undefined);
    for (const m of msgs) {
      const valid = parseIngest(m);
      if (valid) deliver(valid);
    }
  };
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${port}`,
        token,
        close: () => new Promise<void>((r) => server.close(() => r())),
      });
    });
  });
}
