// node-redis (redis / @redis/client v4, v5 and later) -> cache_op, module commands (JSON.SET, FT.SEARCH) included.
// v5+: every command ends in client.sendCommand(args). v4: commands call commandsExecutor(command, args, name),
// captured when the module loads, so the base commands are attached again with the patched executor.
import { createRequire } from "node:module";
import path from "node:path";
import { safeKey } from "../cache.mjs";
import { hostKey } from "../place.mjs";
import { preview } from "../preview.mjs";
import { libCall } from "../runtime.mjs";
import { once, urlParts } from "./common.mjs";

const SKIP = new Set(["hello", "ping", "info", "client", "select", "auth", "command", "quit", "readonly", "cluster", "role", "echo"]);
const READS = /^(get|mget|getex|getdel|hget|hmget|hgetall|exists|smembers|sismember|lrange|zrange|zscore|ttl|pttl|type|scan|keys|json\.get|json\.mget|ft\.search|ft\.aggregate|xrange|xread)$/;
const places = new WeakMap();

function placeOf(client) {
  const self = client._self ?? client;
  let p = places.get(self);
  if (p) return p;
  const o = self.options ?? {};
  const u = o.url ? urlParts(o.url) : {};
  const s = o.socket ?? {};
  const db = o.database ?? (Number(u.database) || 0);
  const where = s.path ?? hostKey(String(s.host ?? u.host ?? "localhost"), s.port ?? u.port ?? 6379);
  p = { kind: "cache", id: `cache:redis:${where}/${db}`, name: "REDIS", detail: `${where}/${db}` };
  places.set(self, p);
  return p;
}

const str = (v) => (Buffer.isBuffer(v) ? v.toString() : String(v));

function hit(op, v) {
  if (v == null) return false;
  if (op === "exists") return Number(v) > 0;
  if (op === "ft.search" || op === "ft.aggregate") return Number(Array.isArray(v) ? v[0] : (v.total ?? v.total_results ?? 0)) > 0;
  if (Array.isArray(v)) return v.some((x) => x != null);
  if (typeof v === "object" && !Buffer.isBuffer(v)) return Object.keys(v).length > 0;
  return true;
}
function record(fn, self, op, key, path, call) {
  if (!op || SKIP.has(op)) return call();
  return libCall(
    fn,
    () => {
      const k = key === undefined ? undefined : safeKey(str(key));
      const p = path === undefined ? undefined : str(path);
      return { origin: "db", kind: "cache_op", name: k === undefined ? op.toUpperCase() : `${op.toUpperCase()} ${k}`, cache: { op, key: k, path: p }, place: placeOf(self) };
    },
    call,
    (event, v) => {
      if (!READS.test(op)) return;
      event.cache.hit = hit(op, v);
      if (event.cache.hit) event.returned = preview(Buffer.isBuffer(v) ? v.toString() : v);
    },
    true,
  );
}

/** @redis/client's lib/client/index.js (exports.default is RedisClient). */
export function patchRedis(mod, file) {
  const Client = mod?.default ?? mod;
  const proto = Client?.prototype;
  if (typeof proto?.sendCommand !== "function" || !once(proto)) return;
  if (typeof proto._executeCommand === "function") {
    const orig = proto.sendCommand;
    const patched = function sendCommand(args, options) {
      const a = Array.isArray(args) ? args : [];
      const op = a.length ? str(a[0]).toLowerCase() : "";
      const path = (op === "json.del" || op === "json.forget") ? a[2] : undefined;
      return record(patched, this, op, a[1], path, () => orig.call(this, args, options));
    };
    proto.sendCommand = patched;
    return;
  }
  const exec = proto.commandsExecutor;
  if (typeof exec !== "function") return;
 const patched = function commandsExecutor(command, args, name) {
    const list = Array.isArray(args) ? args : [];
    const key = list.find((x) => typeof x === "string" || Buffer.isBuffer(x));
    const op = String(name ?? command?.NAME ?? "").replace(/^(json|ft)_?/i, (m) => `${m.replace(/_$/, "")}.`).toLowerCase();
    const path = (op === "json.del" || op === "json.forget") ? list[1] : undefined;
    return record(patched, this, op, key, path, () => exec.call(this, command, args, name));
  };
  proto.commandsExecutor = patched;
  try {
    const req = createRequire(file);
    const dir = path.dirname(file);
    req(path.join(dir, "../commander.js")).attachCommands({ BaseClass: Client, commands: req(path.join(dir, "commands.js")).default, executor: patched });
  } catch {}
}
