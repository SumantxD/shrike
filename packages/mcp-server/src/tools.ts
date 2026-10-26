import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { ShapeOutput } from "@modelcontextprotocol/sdk/server/zod-compat.js";
import type { ActionView, ApiAssertion, ApiAssertionResult, AppElement, DebugEvent, HttpResponseSpec, Quest, ShrikeHost, SourceLocation, TimelineNode } from "@shrike/schema";
import { compareActions, formatActionTree } from "@shrike/correlator";
import { maskAction, maskText, maskValues, type MaskOptions, redactPii, redactText } from "@shrike/redact";
import { registerDriveTools } from "./drive.ts";
import { OUTCOME, outcomeOf, readSkills, type SkillHost } from "./skills.ts";
import { optionsReplyText } from "./options.ts";

const ACTION_WAIT_MS = 20_000;
const MAX_BODY_CHARS = 4000;
const MAX_FILE_LINES = 400;

class ToolError extends Error {}

export interface ToolContext {
  client?: string; // A11: name of an external MCP client; undefined for Shrike's own runs
  skillsDir?: string; // A4: prompts/skills (used when there is no skills host)
  skills?: SkillHost; // S1/S4: every source (built-in, project, personal, Claude Code), plus proposals
}

type ToolExtra = { _meta?: { progressToken?: string | number }; sendNotification(n: { method: "notifications/progress"; params: { progressToken: string | number; progress: number } }): Promise<void> };

export function registerTools(mcp: McpServer, base: ShrikeHost, ctx: ToolContext = {}) {
  const seen = new Map<string, number>(); // #52: [text#n] stays the same value for this whole session
  const maskOpts = () => ({ keep: base.redactKeep?.(), seen });
  const host = maskedHost(base, maskOpts);
  const tool = <S extends z.ZodRawShape>(
    name: string,
    description: string,
    inputSchema: S,
    run: (args: ShapeOutput<S>) => Promise<string>,
  ) => {
    const cb = async (args: ShapeOutput<S>, extra?: ToolExtra): Promise<CallToolResult> => {
      // Claude Code aborts a tool that sends nothing for 300s; tools that wait on the user's click (propose_patch, ask_options) send progress.
      const token = extra?._meta?.progressToken;
      let n = 0;
      const beat = token === undefined ? undefined : setInterval(() => void extra!.sendNotification({ method: "notifications/progress", params: { progressToken: token, progress: ++n } }).catch(() => {}), 30_000);
      try {
        return { content: [{ type: "text", text: shown(await run(args)) }] };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const text = err instanceof ToolError ? message : `${name} failed: ${message}`;
        return { content: [{ type: "text", text: shown(text) }], isError: true };
      } finally {
        clearInterval(beat);
      }
    };
    mcp.registerTool(name, { description, inputSchema }, cb as never);
  };

  // ---- helpers bound to host ----

  // #53: a live project's origins; empty for a local project
  const live = () => host.liveOrigins?.() ?? [];
  const shown = (text: string) => (live().length ? redactPii(redactText(text)) : redactText(text)); // #51: numbered per output

  const answered = new Map<string, boolean>(); // #53: once-per-path answers on the live site, for this session
  const askOnce = async (key: string, title: string, reason: string, declined: string, request?: { method: string; url: string }) => {
    if (!answered.has(key)) answered.set(key, await host.requestApproval({ kind: "request", title, reason, ...(request ? { request } : {}) }));
    if (!answered.get(key)) throw new ToolError(declined);
  };

  const pageIsLive = async () => {
    try {
      return live().includes(new URL((await host.appSnapshot()).url).origin);
    } catch {
      return false;
    }
  };

  // #53: clicks and typing on the live site ask first, naming the element
  const askLiveAct = async (what: string) => {
    if (!live().length || !(await pageIsLive())) return;
    const ok = await host.requestApproval({ kind: "request", title: `${what} on your live site?`, reason: "This is your live site, so the agent asks before it clicks or types. It may change real data." });
    if (!ok) throw new ToolError(`The user declined: ${what}. Don't retry it; ask the user, or try it on your local app.`);
  };

  const actionIdForTrace = (traceId: string) => host.listActions().find((a) => a.traceId === traceId)?.id;

  const watched = (ids: (string | undefined)[]) => {
    const list = [...new Set(ids.filter((id): id is string => !!id))];
    if (ctx.client && list.length) host.noteWatch(ctx.client, list);
  };

  const actionText = (view: ActionView, includeFramework = true) => {
    const v = includeFramework ? view : { ...view, tree: withoutFramework(view.tree) };
    return formatActionTree(v, { includeIds: true });
  };

  const waitText = async (actionId: string | null, didWhat: string): Promise<{ text: string; view?: ActionView }> => {
    if (!actionId) return { text: `${didWhat}. Nothing was recorded: no request, log or error followed.` };
    const view = await host.waitForAction(actionId, ACTION_WAIT_MS);
    if (!view) {
      return { text: `${didWhat}. Action ${actionId} started but did not finish recording in time. Call get_action with "${actionId}" in a moment.` };
    }
    return { text: `${didWhat}.\n${actionText(view)}`, view };
  };

  const resolveElement = async (ref: string | undefined, name: string | undefined, prefer: string[] = []) => {
    if (ref) return { ref, label: ref };
    if (!name?.trim()) throw new ToolError("Pass either ref (from app_snapshot) or name (the element's visible text or label).");
    const snap = await host.appSnapshot();
    const q = norm(name);
    const rank = (els: AppElement[]) => [...els].sort((a, b) => Number(prefer.includes(b.role)) - Number(prefer.includes(a.role)));
    const exact = rank(snap.elements.filter((e) => norm(e.name) === q));
    const partial = rank(snap.elements.filter((e) => norm(e.name).includes(q)));
    const preferred = (els: AppElement[]) => (prefer.length ? els.filter((e) => prefer.includes(e.role)) : els);
    const pick = exact[0] ?? (preferred(partial).length === 1 ? preferred(partial)[0] : partial.length === 1 ? partial[0] : undefined);
    if (pick) return { ref: pick.ref, label: describe(pick) };

    const words = q.split(" ").filter((w) => w.length > 1);
    const close = partial.length ? partial : snap.elements.filter((e) => words.some((w) => norm(e.name).includes(w)));
    const list = (close.length ? close : snap.elements).slice(0, 20).map(describe).join("\n");
    const why = partial.length > 1 ? `Several elements match "${name}"` : `No element named "${name}" on ${snap.url}`;
    throw new ToolError(`${why}. ${close.length ? "Close matches" : "Elements on the page"}:\n${list || "(none)"}\nUse a ref from this list or an exact name.`);
  };

  const safePath = async (p: string) => {
    const root = path.resolve(host.projectRoot());
    const abs = path.resolve(root, p.replace(/\\/g, "/"));
    const rel = toRel(root, abs);
    if (rel === null) throw new ToolError(`"${p}" is outside the project. Use a path relative to the project root.`);
    if (forbidden(rel)) throw new ToolError(`"${rel}" is off limits (node_modules, .git and .env files can't be read or changed).`);
    try {
      const realRel = toRel(await fs.realpath(root), await fs.realpath(abs));
      if (realRel === null || forbidden(realRel)) throw new ToolError(`"${rel}" points outside the project.`);
    } catch (err) {
      if (err instanceof ToolError) throw err; // missing files are reported by the host read
    }
    return rel;
  };

  const errorsIn = (view: ActionView) => {
    const out: string[] = [];
    walk(view.tree, (e) => {
      if (e.status !== "error") return;
      const what = e.error?.message ?? (e.http?.status ? `HTTP ${e.http.status}` : e.log?.message ?? "failed");
      out.push(`${e.name}: ${what}${e.source ? ` (${loc(e.source)})` : ""}`);
    });
    return [...new Set(out)];
  };

  // ---- Recordings ----

  tool(
    "list_actions",
    "List recent Actions recorded in the user's app (each click, page load or request and everything it caused), newest first. Returns id, label, status, duration, counts, and the warning kinds of Actions that carry them.",
    {
      limit: z.number().int().min(1).max(100).optional().describe("How many to return (default 20)"),
      status: z.enum(["ok", "slow", "error"]).optional().describe("Only Actions with this status"),
      flagged: z.boolean().optional().describe("Only Actions that carry a warning"),
      flag: z
        .enum(["slow", "n_plus_one", "sequential", "duplicate_request", "swallowed_error", "cache_never_hit", "slow_outside", "empty_result"])
        .optional()
        .describe("Only Actions with this warning kind"),
    },
    async ({ limit, status, flagged, flag }) => {
      const all = host.listActions();
      const list = all
        .filter((a) => (!status || a.status === status) && (!flagged || a.flags.length > 0) && (!flag || a.flags.some((f) => f.kind === flag)))
        .sort((a, b) => b.startMs - a.startMs)
        .slice(0, limit ?? 20);
      if (!list.length) return all.length ? "No Actions match the given filters." : "No Actions recorded yet. Use app_snapshot and app_click to drive the app, or send_request.";
      watched(list.map((a) => a.id));
      return list
        .map((a) => {
          const s = a.summary.stats;
          const pending = a.complete ? "" : "  (still recording)";
          const kinds = [...new Set(a.flags.map((f) => f.kind))];
          const warnings = kinds.length ? `  warnings: ${kinds.join(", ")}` : "";
          return `Action ${a.id}  ${a.label}  ${a.status}  ${a.durationMs}ms  ${s.requests} requests, ${s.functions} functions, ${s.queries} queries, ${s.errors} errors${pending}${warnings}`;
        })
        .join("\n");
    },
  );

  tool(
    "get_action",
    "Show everything one Action did, as a tree: requests, server functions with file:line, database queries, logs and errors, with timings and status. No payloads; use get_event for those.",
    {
      actionId: z.string().describe("Action id from list_actions or another tool"),
      includeFramework: z.boolean().optional().describe("Include steps inside node_modules (default false)"),
    },
    async ({ actionId, includeFramework }) => {
      const view = mustAction(host, actionId);
      watched([view.id]);
      return actionText(view, includeFramework ?? false);
    },
  );

  tool(
    "get_event",
    "Show one recorded event in full: arguments, return value, request and response bodies, SQL and parameters, error and stack. Use the event ids shown by get_action.",
    { eventId: z.string().describe("Event id") },
    async ({ eventId }) => {
      const e = host.getEvent(eventId);
      if (!e) throw new ToolError(`No event with id "${eventId}". Use get_action to see event ids.`);
      const actionId = actionIdForTrace(e.traceId);
      watched([actionId]);
      return `${actionId ? `In action ${actionId}\n` : ""}${JSON.stringify(e, null, 2)}`;
    },
  );

  tool(
    "search_events",
    "Search every recorded event (requests, functions, queries, logs, errors) by text, e.g. a URL, function name, table or error message.",
    {
      query: z.string().describe("Text to search for"),
      kind: z.enum(["user_action", "http_request", "function", "db_query", "log", "error"]).optional(),
      status: z.enum(["ok", "slow", "error"]).optional(),
    },
    async ({ query, kind, status }) => {
      const hits = host.searchEvents(query).filter((e) => (!kind || e.kind === kind) && (!status || e.status === status));
      if (!hits.length) return `No events match "${query}".`;
      watched(hits.slice(0, 50).map((e) => actionIdForTrace(e.traceId)));
      const lines = hits.slice(0, 50).map((e) => {
        const actionId = actionIdForTrace(e.traceId);
        const http = e.http?.status ? ` ${e.http.status}` : "";
        return `${e.kind} ${e.name}${http} ${e.status}${e.source ? ` at ${loc(e.source)}` : ""}  event ${e.id}${actionId ? `  action ${actionId}` : ""}`;
      });
      return lines.join("\n") + (hits.length > 50 ? `\n…and ${hits.length - 50} more. Narrow the query.` : "");
    },
  );

  tool(
    "get_logs",
    "Show console logs from the app (browser and server) with the file:line that printed them. Pass actionId for one Action's logs, or leave it out for the most recent logs.",
    {
      actionId: z.string().optional(),
      level: z.enum(["debug", "info", "warn", "error"]).optional(),
    },
    async ({ actionId, level }) => {
      let logs: DebugEvent[] = [];
      if (actionId) walk(mustAction(host, actionId).tree, (e) => void (e.kind === "log" && logs.push(e)));
      else logs = host.searchEvents("").filter((e) => e.kind === "log");
      watched([actionId]);
      logs = logs.filter((e) => !level || e.log?.level === level).sort((a, b) => a.startMs - b.startMs).slice(-100);
      if (!logs.length) return "No logs recorded" + (actionId ? " for that Action." : ".");
      return logs
        .map((e) => `[${e.log?.level ?? "info"}] ${e.origin}: ${e.log?.message ?? e.name}${e.source ? `  (${loc(e.source)})` : ""}`)
        .join("\n");
    },
  );

  tool(
    "compare_actions",
    "Compare two Actions, usually the same steps before and after a fix: new or missing steps, status and timing changes, errors gone or added.",
    { beforeId: z.string(), afterId: z.string() },
    async ({ beforeId, afterId }) => {
      const text = compareActions(mustAction(host, beforeId), mustAction(host, afterId));
      watched([beforeId, afterId]);
      return text;
    },
  );

  // ---- App ----

  tool(
    "app_snapshot",
    "See the page currently open in the user's app: URL, title, the clickable and typeable elements with refs (like e3) and the visible text. Call this before app_click or app_type.",
    {},
    async () => {
      const s = await host.appSnapshot();
      const els = s.elements.map(describe).join("\n") || "(no interactive elements)";
      return `URL: ${s.url}\nTitle: ${s.title}\n\nElements:\n${els}\n\nVisible text:\n${s.text}`;
    },
  );

  tool(
    "app_click",
    "Click an element in the user's running app (as the user would). Returns what happened: requests, server functions, queries, logs, errors. Pass ref from app_snapshot, or name with the element's visible text.",
    {
      ref: z.string().optional().describe("Element ref from app_snapshot, e.g. e3"),
      name: z.string().optional().describe('Visible text or label, e.g. "Add Todo"'),
    },
    async ({ ref, name }) => {
      const el = await resolveElement(ref, name, ["button", "link"]);
      await askLiveAct(`Click ${el.label}`);
      const { actionId } = await host.appClick(el.ref);
      return (await waitText(actionId, `Clicked ${el.label}`)).text;
    },
  );

  tool(
    "app_type",
    "Type text into a field in the user's running app (replaces its value). Set submit to true to submit the form afterwards. Returns what happened.",
    {
      ref: z.string().optional().describe("Element ref from app_snapshot"),
      name: z.string().optional().describe("Field label or placeholder"),
      text: z.string().describe("Text to type"),
      submit: z.boolean().optional().describe("Submit the form after typing"),
    },
    async ({ ref, name, text, submit }) => {
      const el = await resolveElement(ref, name, TEXT_ROLES);
      await askLiveAct(`Type into ${el.label}${submit ? " and submit" : ""}`);
      const { actionId } = await host.appType(el.ref, text, submit);
      return (await waitText(actionId, `Typed into ${el.label}${submit ? " and submitted" : ""}`)).text;
    },
  );

  tool(
    "app_navigate",
    "Open a page of the user's app, e.g. /settings. Only the app's own addresses are allowed: local, or the project's live site. Returns what the page load did.",
    { url: z.string().describe("Path like /todos, or a full local URL") },
    async ({ url }) => {
      if (originOf(url, live()) === "live" && changesState(url)) {
        const u = new URL(url, "http://x");
        await askOnce(`page ${url.startsWith("/") ? "" : u.origin}${u.pathname}`, `Open ${url} on your live site?`, "This path looks like it changes something (sign out, unsubscribe, delete). Shrike asks once per path on your live site.", `The user declined opening ${url}. Don't retry it; find another way or explain why it is needed.`);
      }
      const { actionId } = await host.appNavigate(url);
      return (await waitText(actionId, `Opened ${url}`)).text;
    },
  );

  tool(
    "run_scenario",
    "Run several steps in the user's app in order (click, type, navigate, wait) and record each one. Use it to reproduce a problem or to check a fix. Returns each step's Action tree and an overall PASS or FAIL with the errors.",
    {
      steps: z
        .array(
          z.object({
            action: z.enum(["click", "type", "navigate", "wait"]),
            ref: z.string().optional().describe("click/type: element ref"),
            name: z.string().optional().describe("click/type: element visible text or label"),
            text: z.string().optional().describe("type: text to enter"),
            submit: z.boolean().optional().describe("type: submit the form after"),
            url: z.string().optional().describe("navigate: path or local URL"),
            ms: z.number().int().min(0).max(10_000).optional().describe("wait: milliseconds (default 500)"),
          }),
        )
        .min(1)
        .max(20),
    },
    async ({ steps }) => {
      const lv = live();
      if (lv.length) {
        // #53: one card for the whole scenario on the live site, listing every step
        const goesLive = steps.some((s) => s.action === "navigate" && s.url && inProject(s.url, lv) && originOf(s.url, lv) === "live");
        const acts = steps.some((s) => s.action === "click" || s.action === "type" || (s.action === "navigate" && s.url && changesState(s.url)));
        if (acts && (goesLive || (await pageIsLive()))) {
          const list = steps.map((s, i) => `${i + 1}. ${stepLine(s)}`).join("\n");
          const ok = await host.requestApproval({ kind: "request", title: `Run these ${steps.length} steps on your live site?`, reason: redactText(list) });
          if (!ok) throw new ToolError("The user declined this scenario on your live site. Don't retry it; ask the user, or try it on your local app.");
        }
      }
      const out: string[] = [];
      const errors: string[] = [];
      let broken = false;
      for (const [i, step] of steps.entries()) {
        const n = `Step ${i + 1}`;
        try {
          let r: { text: string; view?: ActionView };
          if (step.action === "wait") {
            await new Promise((res) => setTimeout(res, step.ms ?? 500));
            r = { text: `Waited ${step.ms ?? 500}ms` };
          } else if (step.action === "navigate") {
            if (!step.url) throw new ToolError("navigate needs url");
            originOf(step.url, lv);
            r = await waitText((await host.appNavigate(step.url)).actionId, `Opened ${step.url}`);
          } else if (step.action === "click") {
            const el = await resolveElement(step.ref, step.name, ["button", "link"]);
            r = await waitText((await host.appClick(el.ref)).actionId, `Clicked ${el.label}`);
          } else {
            if (step.text === undefined) throw new ToolError("type needs text");
            const el = await resolveElement(step.ref, step.name, TEXT_ROLES);
            r = await waitText((await host.appType(el.ref, step.text, step.submit)).actionId, `Typed into ${el.label}`);
          }
          out.push(`${n}: ${r.text}`);
          if (r.view?.status === "error") {
            const errs = errorsIn(r.view);
            errors.push(...(errs.length ? errs : [`${r.view.label} failed`]).map((e) => `${n}: ${e}`));
          }
        } catch (err) {
          out.push(`${n}: could not run: ${err instanceof Error ? err.message : String(err)}`);
          errors.push(`${n} could not run`);
          broken = true;
          break;
        }
      }
      const verdict = errors.length
        ? `FAIL${broken ? " (stopped early)" : ""}\nErrors:\n${errors.map((e) => `- ${e}`).join("\n")}`
        : "PASS: every step ran and no errors were recorded.";
      return `${out.join("\n\n")}\n\nResult: ${verdict}`;
    },
  );

  // ---- API ----

  tool(
    "list_routes",
    "List the app's backend API routes found in the code, with the file:line of each handler.",
    { query: z.string().optional().describe("Filter by method or path text") },
    async ({ query }) => {
      const q = query?.toLowerCase();
      const routes = host.listRoutes().filter((r) => !q || `${r.method} ${r.path}`.toLowerCase().includes(q));
      if (!routes.length) return query ? `No routes match "${query}".` : "No routes discovered.";
      return routes.map((r) => `${r.method} ${r.path}${r.handler ? `  handler ${loc(r.handler)}` : ""}`).join("\n");
    },
  );

  tool(
    "send_request",
    "Send an HTTP request to the user's app backend and record what the server did. Requests other than GET or HEAD ask the user for approval first. On the project's live site only GET and HEAD are allowed, and each path asks once; in a live project a path like /api/x goes to the live site. Returns status, body and the server-side Action tree.",
    {
      method: z.string().describe("GET, POST, PUT, PATCH, DELETE, ..."),
      url: z.string().describe("Path like /api/todos, or a full local URL"),
      headers: z.record(z.string()).optional(),
      body: z.string().optional().describe("Request body, usually JSON text"),
      reason: z.string().optional().describe("Why you need this request (shown to the user when approval is needed)"),
      assertions: ASSERTIONS,
    },
    async ({ method, url, headers, body, reason, assertions }) => {
      const m = method.toUpperCase();
      const spec = { method: m, url, headers, body };
      const checks = assertions?.map(parseAssertion);
      if (checks?.length && !host.api) throw new ToolError("Assertions need the API client, which isn't available here.");
      const lv = live();
      if (host.api && !inProject(url, lv)) {
        // AP: outside the app always asks first, GET included
        const ok = await host.requestApproval({ kind: "request", title: `Send ${m} ${url}? It's outside your app.`, reason: reason ?? "The agent wants to reach an address that isn't your local app.", request: spec });
        if (!ok) throw new ToolError(`The user declined ${m} ${url}. Don't retry it; find another way or explain why it is needed.`);
        return sentText(await host.api.send(spec, checks), m, url);
      }
      if (originOf(url, lv) === "live") {
        if (m !== "GET" && m !== "HEAD") throw new ToolError(LIVE_WRITE); // no card: one clicked by habit could change real data
        const target = new URL(url, lv[0]);
        const where = `${target.origin}${target.pathname}`;
        const liveSpec = { ...spec, url: target.href };
        await askOnce(`send ${where}`, `Send ${m} ${where} to your live site?`, reason ?? "Even a GET can change data on a live site (a sign out or unsubscribe link). Shrike asks once per path.", `The user declined ${m} ${url}. Don't retry it; find another way or explain why it is needed.`, { method: m, url: target.href });
        return sentText(host.api ? await host.api.send(liveSpec, checks) : await host.sendRequest(liveSpec), m, url, true);
      }
      if (m !== "GET" && m !== "HEAD") {
        const ok = await host.requestApproval({
          kind: "request",
          title: `Send ${m} ${url} to your app?`,
          reason: reason ?? "The agent wants to send a request that may change data in your app.",
          request: spec,
        });
        if (!ok) throw new ToolError(`The user declined ${m} ${url}. Don't retry it; find another way or explain why it is needed.`);
      }
      return sentText(checks?.length ? await host.api!.send(spec, checks) : await host.sendRequest(spec), m, url);
    },
  );

  async function sentText(r: { response: HttpResponseSpec; actionId?: string; assertions?: ApiAssertionResult[] }, m: string, url: string, live = false): Promise<string> {
    const { response, actionId } = r;
    const body = live ? maskText(response.body, maskOpts()) : response.body; // #52
    const resBody = body.length > MAX_BODY_CHARS ? `${body.slice(0, MAX_BODY_CHARS)}…[truncated]` : body;
    const checks = r.assertions?.length ? `\nAssertions: ${r.assertions.filter((a) => a.ok).length} of ${r.assertions.length} passed\n${r.assertions.map((a) => `${a.ok ? "PASS" : "FAIL"} ${a.expr} ${a.op}${a.value ? ` ${a.value}` : ""}${a.ok ? "" : ` (got ${a.error ?? a.actual ?? "nothing"})`}`).join("\n")}\n` : "";
    const head = `HTTP ${response.status} ${response.statusText} (${Math.round(response.durationMs)}ms)${checks}\nBody:\n${resBody || "(empty)"}`;
    return actionId ? `${head}\n\n${(await waitText(actionId, `Sent ${m} ${url}`)).text}` : head;
  }

  tool(
    "list_requests",
    "List the requests saved in this project's API collections (Bruno format), with their collection and file.",
    {},
    async () => {
      if (!host.api) throw new ToolError("The API client isn't available here.");
      const list = await host.api.list();
      return list.length ? list.map((r) => `${r.method} ${r.name}  (${r.collection}: ${r.path})`).join("\n") : "No saved requests yet. Use save_request to add one.";
    },
  );

  tool(
    "save_request",
    "Save a request into the project's own API collection (.shrike/api, Bruno format) so the user can open and send it. Doesn't send it. Requests to addresses outside the app ask the user first.",
    {
      name: z.string().min(1).max(200).describe("Short name, e.g. Create todo with empty title"),
      method: z.string().regex(/^[A-Za-z]+$/).describe("GET, POST, PUT, PATCH, DELETE, ..."),
      url: z.string().max(8192).describe("Path like /api/todos, or {{baseUrl}}/api/todos"),
      headers: z.record(z.string()).optional(),
      body: z.string().max(1024 * 1024).optional().describe("Request body, usually JSON text"),
      folder: z.string().max(200).optional().describe("Folder inside the collection"),
      reason: z.string().optional().describe("Why (shown to the user when approval is needed)"),
      assertions: ASSERTIONS,
    },
    async ({ name, method, url, headers, body, folder, reason, assertions }) => {
      if (!host.api) throw new ToolError("The API client isn't available here.");
      if (folder && (folder.includes("..") || folder.startsWith("/"))) throw new ToolError("The folder must be a plain name inside the collection.");
      const m = method.toUpperCase();
      if (!inProject(url.replace(/^\{\{\s*baseUrl\s*\}\}/, ""), live())) {
        const ok = await host.requestApproval({ kind: "request", title: `Save a request to ${url}? It's outside your app.`, reason: reason ?? "The agent wants to save a request to an address that isn't your local app.", request: { method: m, url, headers, body } });
        if (!ok) throw new ToolError(`The user declined saving ${m} ${url}.`);
      }
      const path = await host.api.save({
        name,
        method: m,
        url,
        headers: Object.entries(headers ?? {}).map(([k, v]) => ({ name: k, value: v, enabled: true })),
        body: body === undefined ? { type: "none" } : /^\s*[[{]/.test(body) ? { type: "json", data: body } : { type: "text", data: body },
        assertions: (assertions ?? []).map(parseAssertion),
      }, folder);
      return `Saved ${m} ${name} as ${path}. The user can open it in the API client and press Send.`;
    },
  );

  // ---- Code ----

  tool(
    "read_file",
    "Read a file from the user's project with line numbers. Optionally pass startLine and endLine. Paths are relative to the project root.",
    {
      path: z.string().describe("e.g. server/todos.controller.ts"),
      startLine: z.number().int().min(1).optional(),
      endLine: z.number().int().min(1).optional(),
    },
    async (args) => {
      const rel = await safePath(args.path);
      const lines = (await host.readFile(rel)).split("\n");
      const start = Math.min(args.startLine ?? 1, lines.length);
      const max = args.endLine ? lines.length : start - 1 + MAX_FILE_LINES;
      const end = Math.min(args.endLine ?? max, max, lines.length);
      if (end < start) throw new ToolError(`endLine ${end} is before startLine ${start}.`);
      const width = String(end).length;
      const body = lines
        .slice(start - 1, end)
        .map((l, i) => `${String(start + i).padStart(width)}| ${l}`)
        .join("\n");
      const more = end < lines.length ? `\n(${lines.length} lines in total; pass startLine ${end + 1} to read more)` : "";
      return `${rel} lines ${start}-${end}\n${body}${more}`;
    },
  );

  tool(
    "search_code",
    "Search the project's code for text. Returns matching lines as file:line. Optional glob limits the files, e.g. server/**/*.ts.",
    { query: z.string().min(1), glob: z.string().optional() },
    async ({ query, glob }) => {
      const hits = (await host.searchCode(query, glob)).filter((h) => !forbidden(h.file));
      if (!hits.length) return `No matches for "${query}".`;
      const lines = hits.slice(0, 100).map((h) => `${h.file}:${h.line}: ${h.text.trim().slice(0, 200)}`);
      return lines.join("\n") + (hits.length > 100 ? `\n…and ${hits.length - 100} more. Narrow the search.` : "");
    },
  );

  tool(
    "list_files",
    "List the project's files (relative paths, no node_modules). Optional glob, e.g. server/**/*.ts or *.tsx.",
    { glob: z.string().optional() },
    async ({ glob }) => {
      const files = (await host.listFiles()).filter(
        (f) => !forbidden(f) && (!glob || path.matchesGlob(f, glob) || path.matchesGlob(path.posix.basename(f), glob)),
      );
      if (!files.length) return glob ? `No files match ${glob}.` : "No files.";
      return files.slice(0, 500).join("\n") + (files.length > 500 ? `\n…and ${files.length - 500} more. Use a glob.` : "");
    },
  );

  // ---- Fix and report ----

  tool(
    "propose_patch",
    "Propose a code change for the user to review. Each edit replaces oldText (copied exactly from the file, and unique in it) with newText. Waits until the user applies or rejects it. Keep it to the smallest change that fixes the cause.",
    {
      files: z
        .array(
          z.object({
            path: z.string(),
            edits: z.array(z.object({ oldText: z.string().min(1), newText: z.string() })).min(1),
          }),
        )
        .min(1),
      rationale: z.string().describe("One or two plain sentences: what the change does and why it fixes the problem"),
    },
    async ({ files, rationale }) => {
      const checked = [];
      for (const f of files) {
        const rel = await safePath(f.path);
        if (LOCKFILES.has(path.posix.basename(rel))) throw new ToolError(`"${rel}" is a lockfile and can't be patched.`);
        checked.push({ path: rel, edits: f.edits });
      }
      const { patchId, status, feedback } = await host.proposePatch(checked, rationale, ctx.client ?? "Shrike agent");
      if (status === "applied") {
        return `Patch ${patchId} applied. The app is reloading. Re-run the same steps with run_scenario to verify the fix, then compare_actions with the earlier Action and say plainly whether it is fixed.`;
      }
      if (feedback) {
        return `Patch ${patchId} rejected by the user with comments on the diff:\n<comments>\n${feedback}\n</comments>\nRead the file again if needed, then call propose_patch with a revised change that addresses every comment.`;
      }
      return `Patch ${patchId} rejected by the user. Don't propose the same change again. Ask what they would prefer, or report your findings.`;
    },
  );

  tool(
    "report_findings",
    "Report what you found to the user (shown as the Found it card). Label each finding observed (read from the recording), likely (one reasoning step away) or possible (not confirmed), and cite file and line.",
    {
      findings: z
        .array(
          z.object({
            confidence: z.enum(["observed", "likely", "possible"]),
            claim: z.string().describe("One plain sentence"),
            file: z.string().optional(),
            line: z.number().int().min(1).optional(),
            eventId: z.string().optional(),
          }),
        )
        .min(1),
      summary: z.string().describe("The cause in one or two plain sentences, for someone who doesn't read code"),
    },
    async ({ findings, summary }) => {
      host.reportFindings(findings, summary);
      return `Reported ${findings.length} finding${findings.length === 1 ? "" : "s"} to the user.`;
    },
  );

  // ---- M1: options and mockups ----

  if (host.askOptions) {
    const askOptions = host.askOptions;
    tool(
      "ask_options",
      "Ask the user to choose, with 2 to 4 options shown as large cards; for anything visual give each option a real plain-HTML mockup. Waits for the user. They may ask for more like one card (vary), a change to one (tweak), a merge of several (combine), or approve. Each answer comes back here as JSON with the mockups it refers to: then call ask_options again with the same thread and the new options, until the action is approve. Load the mockup-options and design-taste skills first.",
      {
        thread: z.string().max(40).optional().describe("The thread from an earlier answer; omit to ask something new"),
        question: z.string().max(300).optional().describe("What the user is choosing, one plain sentence. Required for a new session"),
        header: z.string().max(24).optional().describe('A short caps label, e.g. "Layout"'),
        options: z
          .array(
            z.object({
              id: z.string().max(40).optional().describe("Your own key; echoed back. Shrike names the cards A, B, B1, B2+C"),
              label: z.string().min(1).max(80),
              description: z.string().max(200).describe("One line: how this option differs"),
              mockupHtml: z.string().max(60_000).optional().describe("Self-contained HTML: inline CSS, no scripts, no external URLs (images as data: URIs)"),
              preview: z.string().max(8000).optional().describe("Code or text shown monospace, for non-visual choices"),
            }),
          )
          .max(4)
          .optional()
          .describe("2 to 4 for a new question; 1 to 4 for a follow-up; none to keep waiting after a timeout"),
        multi: z.boolean().optional().describe("The user may approve more than one"),
      },
      async ({ thread, question, header, options, multi }) => {
        const clean = options?.map((o) => ({
          ...(o.id ? { id: o.id } : {}),
          label: redactText(o.label),
          description: redactText(o.description),
          ...(o.mockupHtml ? { mockupHtml: redactText(o.mockupHtml) } : {}),
          ...(o.preview ? { preview: redactText(o.preview) } : {}),
        }));
        const r = await askOptions({ ...(thread ? { session: thread } : {}), ...(question ? { question: redactText(question) } : {}), ...(header ? { header } : {}), ...(clean ? { options: clean } : {}), ...(multi ? { multi } : {}) }).catch((err: unknown) => {
          throw new ToolError(err instanceof Error ? err.message : String(err));
        });
        return optionsReplyText(r);
      },
    );
  }

  // ---- QB9: quests (quests) ----

  if (host.quests) {
    const quests = host.quests;
    const questText = (q: Quest) =>
      [`Quest ${q.id} "${q.title}" (${q.state}${q.waiting ? ", plan waiting for the user" : ""})`, ...q.objectives.map((o) => `  ${o.id} [${o.state}] ${o.text} | done when: ${o.doneWhen} | flow: ${o.flowId ?? "none yet"}`)].join("\n");
    const step = z.object({
      type: z.enum(["click", "type", "navigate", "wait"]),
      name: z.string().max(200).optional().describe("The element's visible text or label (click, type)"),
      text: z.string().max(2000).optional(),
      url: z.string().max(2000).optional(),
      ms: z.number().int().min(0).max(10_000).optional(),
      submit: z.boolean().optional(),
    });
    tool(
      "list_quests",
      "The user's quests (features being built), each objective with its state and the flow that proves it, plus the saved flows you can link.",
      {},
      async () => {
        const [list, flows] = await Promise.all([quests.list(), quests.flows()]);
        const open = list.filter((q) => q.state !== "dropped");
        return `${open.length ? open.map(questText).join("\n\n") : "No quests yet."}\n\nSaved flows: ${flows.map((f) => `${f.id} "${f.name}"${f.lastRun ? (f.lastRun.ok ? " (passed last run)" : " (broke last run)") : ""}`).join(", ") || "none"}.`;
      },
    );
    tool(
      "propose_quest",
      "Propose the plan for a quest: a short title and 2 to 5 objectives in plain words, each with a doneWhen a user can click through. Waits for the user to approve it. Objectives are checked off by Shrike when their flow passes, never by you.",
      {
        questId: z.string().regex(/^[0-9a-f]{8}$/).optional().describe("The quest id from the ask or list_quests"),
        title: z.string().min(1).max(80),
        objectives: z.array(z.object({ text: z.string().min(1).max(160), doneWhen: z.string().min(1).max(200), flowId: z.string().max(80).optional() })).min(1).max(8),
      },
      async ({ questId, title, objectives }) => {
        const r = await quests.propose({ ...(questId ? { questId } : {}), title: redactText(title), objectives: objectives.map((o) => ({ text: redactText(o.text), doneWhen: redactText(o.doneWhen), ...(o.flowId ? { flowId: o.flowId } : {}) })) });
        return r.approved ? `The user started the quest.\n${questText(r.quest)}\nNow give each objective a flow with link_flow.` : "The user said no to this plan. Ask what to change, then propose again.";
      },
    );
    tool(
      "update_objective",
      "Change one objective's words, its doneWhen, or mark it working or dropped. Without objectiveId it adds a new objective (text and doneWhen required). You can't mark one done: its flow passing does that.",
      {
        questId: z.string().regex(/^[0-9a-f]{8}$/),
        objectiveId: z.string().regex(/^o\d{1,3}$/).optional(),
        text: z.string().max(160).optional(),
        doneWhen: z.string().max(200).optional(),
        state: z.enum(["todo", "working", "dropped"]).optional(),
      },
      async ({ questId, objectiveId, text, doneWhen, state }) => {
        const q = await quests.updateObjective(questId, objectiveId, { ...(text ? { text: redactText(text) } : {}), ...(doneWhen ? { doneWhen: redactText(doneWhen) } : {}), ...(state ? { state } : {}) }).catch((e: unknown) => {
          throw new ToolError(e instanceof Error ? e.message : String(e));
        });
        return questText(q);
      },
    );
    tool(
      "link_flow",
      "Link the flow that proves an objective: a saved flow by id or name, or new steps (saved as a flow named after it). Once it passes, Shrike checks the objective off.",
      {
        questId: z.string().regex(/^[0-9a-f]{8}$/),
        objectiveId: z.string().regex(/^o\d{1,3}$/),
        flow: z.string().max(80).optional().describe("A saved flow's id or name"),
        name: z.string().max(80).optional().describe("Name for a new flow made from steps"),
        steps: z.array(step).max(30).optional(),
      },
      async ({ questId, objectiveId, flow, name, steps }) => {
        if (!flow && !steps?.length) throw new ToolError("Pass flow (a saved flow's id or name) or steps for a new one.");
        const clean = steps?.map((s) => ({ ...s, ...(s.text ? { text: redactText(s.text) } : {}) }));
        const r = await quests.linkFlow(questId, objectiveId, clean?.length ? { name: name ?? "", steps: clean } : { id: flow, name: flow }).catch((e: unknown) => {
          throw new ToolError(e instanceof Error ? e.message : String(e));
        });
        return `Linked "${r.flow.name}" (${r.flow.id}) to ${objectiveId}.\n${questText(r.quest)}`;
      },
    );
  }

  // ---- RL5: review lessons before a pull request ----

  if (host.selfReview) {
    const selfReview = host.selfReview;
    tool(
      "self_review",
      "Before a pull request opens, check the change against what reviewers keep flagging in this repo (its review lessons and the likely reviewers' conventions). Call it with no results to get the checklist and the changed files; fix what you find with propose_patch; then call it again with one result per lesson (found, fixed, where). The user sees the results on Ship's self-check card.",
      {
        results: z
          .array(
            z.object({
              lesson: z.string().min(1).max(120).describe("Lesson id (or title) from the checklist"),
              found: z.boolean().describe("The change repeats this issue"),
              fixed: z.boolean().optional().describe("You fixed it in this run"),
              where: z.string().max(200).optional().describe("file:line and what, in plain words"),
            }),
          )
          .max(20)
          .optional(),
      },
      async ({ results }) => selfReview(results?.map((r) => ({ lesson: r.lesson, found: r.found, ...(r.fixed !== undefined ? { fixed: r.fixed } : {}), ...(r.where ? { where: redactText(r.where) } : {}) }))),
    );
  }

  // CI3: runs only legs Shrike read from the CI config (or the project's CI lessons), through the guarded shell; it takes no command.
  if (host.preflight) {
    const preflight = host.preflight;
    tool(
      "preflight",
      "Before a push, run the CI jobs this change touches on this computer, the way the project's CI runs them (commands, env and order from its CI config and CI lessons). Returns each job's result, the first failing line and what usually fixes it. Takes a while for big jobs. Commands the guarded shell doesn't allow on its own ask the user first.",
      {},
      async () => preflight(),
    );
  }

  // ---- Plan, playbooks and memory (A1, A4, A5) ----

  tool(
    "plan",
    "Say what you will check before you start, as 2 to 5 short checks in plain words. Shown to the user as the route you will walk. Call it first.",
    {
      checks: z.array(z.string().min(1).max(200)).min(1).max(12).describe('Plain words, e.g. "check what the page sent"'),
      stationLabels: z.array(z.string().min(1).max(200)).max(20).optional().describe('Step names from the recording you will check, e.g. "createTodo()", "INSERT INTO todos"'),
    },
    async ({ checks }) => `Plan noted: ${checks.length} check${checks.length === 1 ? "" : "s"}. Work through them in order.`,
  );

  const allSkills = async () => (ctx.skills ? await ctx.skills.list() : ctx.skillsDir ? await readSkills(ctx.skillsDir) : []);

  tool(
    "load_skill",
    "Load a playbook (skill) by id (the system prompt lists them, e.g. bad-value, n-plus-one, slow-page). Returns its steps.",
    { skill: z.string().min(1).max(80).describe("Playbook id") },
    async ({ skill }) => {
      const all = await allSkills();
      const want = skill.trim().toLowerCase();
      const doc = all.find((d) => d.id.toLowerCase() === want);
      if (!doc) throw new ToolError(`No playbook "${skill}". Available: ${all.map((d) => d.id).join(", ") || "none"}.`);
      ctx.skills?.used?.(doc.id);
      return `Playbook: ${doc.name}\nUse when: ${doc.when}\nDone when: ${OUTCOME[outcomeOf(doc)].done}\n\n${doc.body}`;
    },
  );

  tool(
    "propose_skill_update",
    "When you learned something that would have saved time (\"port 5173 is often taken, check it first\"), suggest one improvement to the playbook you used. It is a draft tied to this run: Shrike keeps it by itself once the playbook's \"Done when\" outcome is verified, and the skill file is untouched until then. Call it at most once per run.",
    {
      skillId: z.string().min(1).max(80).describe("Playbook id"),
      reason: z.string().min(1).max(200).describe('What you learned, one plain sentence, e.g. "Port 5173 is often taken, check it first"'),
      after: z.string().min(1).max(20_000).describe("The whole improved playbook text, without the front matter"),
    },
    async ({ skillId, reason, after }) => {
      if (!ctx.skills) throw new ToolError("Playbook improvements aren't available here.");
      const want = skillId.trim().toLowerCase();
      const doc = (await ctx.skills.list()).find((d) => d.id.toLowerCase() === want);
      if (!doc) throw new ToolError(`No playbook "${skillId}".`);
      if (after.trim() === doc.body.trim()) throw new ToolError("That is the same as the current playbook. Change something, or skip this.");
      return ctx.skills.propose({ skillId: doc.id, reason: reason.replace(/\s+/g, " ").trim(), after: after.trim() });
    },
  );

  tool(
    "remember",
    "Save one lasting fact about this project for future runs (shown as a pin on that line), e.g. \"userId must be a number\". One short sentence; pass the file and line it is about.",
    {
      text: z.string().min(1).max(300),
      file: z.string().optional().describe("Path relative to the project root"),
      line: z.number().int().min(1).optional(),
    },
    async ({ text, file, line }) => {
      const rel = file ? await safePath(file) : undefined;
      const note = await host.remember({ text: text.trim(), ...(rel ? { file: rel } : {}), ...(rel && line ? { line } : {}) });
      return `Remembered: ${note.text}${note.file ? ` (${note.file}${note.line ? `:${note.line}` : ""})` : ""}`;
    },
  );

  // B5: Shrike drivable, for outside clients only (flows engineer)
  if (ctx.client && host.drive) registerDriveTools(tool, host, host.drive, safePath);
}

const TEXT_ROLES = ["textbox", "searchbox", "combobox", "spinbutton"];
const LOCKFILES = new Set(["package-lock.json", "pnpm-lock.yaml", "yarn.lock", "bun.lockb", "bun.lock"]);

function mustAction(host: ShrikeHost, id: string) {
  const view = host.getAction(id);
  if (!view) throw new ToolError(`No Action with id "${id}". Use list_actions to see recent ones.`);
  return view;
}

function walk(nodes: TimelineNode[], fn: (e: DebugEvent) => void) {
  for (const n of nodes) {
    fn(n.event);
    walk(n.children, fn);
  }
}

function withoutFramework(nodes: TimelineNode[]): TimelineNode[] {
  return nodes.flatMap((n) =>
    n.event.framework ? withoutFramework(n.children) : [{ ...n, children: withoutFramework(n.children) }],
  );
}

function loc(s: SourceLocation) {
  return `${s.file}:${s.line}`;
}

function norm(s: string) {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

function describe(e: AppElement) {
  return `[${e.ref}] ${e.role} "${e.name}"${e.value ? ` value="${e.value}"` : ""}`;
}

function toRel(root: string, abs: string): string | null {
  const rel = path.relative(root, abs);
  if (!rel || rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) return null;
  return rel.split(path.sep).join("/");
}

function forbidden(rel: string) {
  return rel.split("/").some((s) => s === "node_modules" || s === ".git" || /^\.env/i.test(s));
}

// AP11: "res.status eq 201" or { expr, op, value }, Bruno's assertion syntax
const ASSERTIONS = z
  .array(z.union([z.string().max(2000), z.object({ expr: z.string().max(500), op: z.string().max(40), value: z.string().max(2000).optional() })]))
  .max(50)
  .optional()
  .describe("Checks on the response, Bruno style: res.status eq 201, res.body.title eq 'buy milk', res.body.id isNumber");
function parseAssertion(a: string | { expr: string; op: string; value?: string }): ApiAssertion {
  if (typeof a !== "string") return { expr: a.expr, op: a.op, value: a.value ?? "", enabled: true };
  const m = /^\s*(\S+)\s+(\S+)\s*(.*)$/.exec(a);
  if (!m) throw new ToolError(`"${a}" isn't an assertion. Write it like "res.status eq 201".`);
  return { expr: m[1]!, op: m[2]!, value: m[3]!.trim(), enabled: true };
}

function inProject(url: string, live: string[]): boolean {
  try {
    originOf(url, live);
    return true;
  } catch {
    return false;
  }
}

// #53: loopback, or one of a live project's origins (exact, so www. and the apex are separate). A relative path is live in a live project.
// ponytail: custom dev hostnames aren't local; list them as origins in .shrike/config.json.
function originOf(url: string, live: string[]): "local" | "live" {
  if (url.startsWith("/") && !url.startsWith("//")) return live.length ? "live" : "local";
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new ToolError(`"${url}" is not a valid URL. Use a path like /api/todos.`);
  }
  if (/^https?:$/.test(u.protocol) && live.includes(u.origin)) return "live";
  const h = u.hostname.replace(/^\[|\]$/g, "");
  const local = h === "localhost" || h.endsWith(".localhost") || h === "127.0.0.1" || h === "::1";
  if (!local || !/^https?:$/.test(u.protocol)) {
    throw new ToolError(`Only the app's own addresses are allowed, not ${url}. Use a path like /api/todos.`);
  }
  return "local";
}

const LIVE_WRITE = "This is your live site. Shrike won't change live data. Try it on your local app.";

// #53: GETs that often change state. ponytail: a list can't catch every one; send_request's once-per-path card is the backstop.
const STATE_PATH = /(?:^|[^a-z])(?:log[-_]?out|sign[-_]?out|unsubscribe|delete|cron|webhooks?)(?:$|[^a-z])/i;
function changesState(url: string): boolean {
  try {
    const u = new URL(url, "http://x");
    return STATE_PATH.test(u.pathname) || /[?&][\w-]*token=/i.test(u.search);
  } catch {
    return false;
  }
}

function stepLine(s: { action: string; ref?: string; name?: string; text?: string; submit?: boolean; url?: string; ms?: number }): string {
  const el = s.name ? `"${s.name}"` : (s.ref ?? "?");
  if (s.action === "click") return `Click ${el}`;
  if (s.action === "type") return `Type "${s.text ?? ""}" into ${el}${s.submit ? " and submit" : ""}`;
  if (s.action === "navigate") return `Open ${s.url ?? "?"}`;
  return `Wait ${s.ms ?? 500}ms`;
}

// #52: live trips reach the agent with values masked; local trips keep theirs. Object.create keeps every other host method.
// ponytail: search_events still matches the real values, so a hit can say a value exists. Upgrade: search the masked text.
function maskedHost(h: ShrikeHost, o: () => MaskOptions): ShrikeHost {
  const view = (v: ActionView | undefined) => (v?.root?.live ? maskAction(v, o()) : v);
  const event = (e: DebugEvent | undefined) => (e?.live ? maskValues(e, o()) : e);
  return Object.assign(Object.create(h) as ShrikeHost, {
    listActions: () => h.listActions().map((v) => view(v)!),
    getAction: (id: string) => view(h.getAction(id)),
    getEvent: (id: string) => event(h.getEvent(id)),
    searchEvents: (q: string) => h.searchEvents(q).map((e) => event(e)!),
    waitForAction: async (id: string, ms?: number) => view(await h.waitForAction(id, ms)),
  });
}
