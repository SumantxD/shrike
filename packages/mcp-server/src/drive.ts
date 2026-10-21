import path from "node:path";
import { z } from "zod";
import type { ShapeOutput } from "@modelcontextprotocol/sdk/server/zod-compat.js";
import type { Flow, ShrikeDriver, ShrikeHost } from "@shrike/schema";

// B5: Shrike as MCP tools, so an outside agent (Claude Code with chrome-devtools, Cursor) can operate Shrike itself.
// Registered only for outside clients: Shrike's own brain never gets them.

type Tool = <S extends z.ZodRawShape>(name: string, description: string, inputSchema: S, run: (args: ShapeOutput<S>) => Promise<string>) => void;

const flowLine = (f: Flow) => `${f.id}  "${f.name}"  ${f.steps.length} steps${f.lastRun ? `  last run ${f.lastRun.ok ? "passed" : "failed"}` : ""}${f.watch ? `  watching ${f.watch.mode === "save" ? "on save" : `every ${f.watch.minutes ?? 5} min`}` : ""}`;

export function registerDriveTools(tool: Tool, host: ShrikeHost, d: ShrikeDriver, safePath: (p: string) => Promise<string>): void {
  const findFlow = async (q: string) => {
    const all = await d.listFlows();
    const want = q.trim().toLowerCase();
    const f = all.find((x) => x.id === want) ?? all.find((x) => x.name.toLowerCase() === want);
    if (!f) throw new Error(`No flow "${q}". Saved flows: ${all.map((x) => `${x.id} ("${x.name}")`).join(", ") || "none yet"}.`);
    return f;
  };

  tool(
    "open_project",
    "Open a project folder in Shrike (like Open a folder on its welcome screen). Pass the folder's absolute path.",
    { path: z.string().min(1).max(4096).describe("Absolute path of the project folder") },
    async ({ path: p }) => {
      if (!path.isAbsolute(p)) throw new Error("Pass the project folder's absolute path.");
      const info = await d.openProject(path.resolve(p));
      const parts = [info.frontend && `frontend ${info.frontend}`, info.backend && `backend ${info.backend}`, `${info.routes.length} routes`].filter(Boolean).join(", ");
      return `Opened ${info.name} (${info.root}): ${parts}. Start it with run_app.`;
    },
  );

  tool("run_app", "Start the open project's app in Shrike (its dev command, recorded). Waits until it is up or fails.", {}, async () => {
    const s = await d.run();
    if (s.state === "error") throw new Error(s.error ?? "The app didn't start.");
    return `The app is ${s.state}${s.url ? ` at ${s.url}` : ""}.`;
  });

  tool("stop_app", "Stop the app running in Shrike.", {}, async () => `The app is ${(await d.stop()).state}.`);

  tool(
    "list_trips",
    "List the trips Shrike recorded (each click, page load or request and everything it caused), newest first, as shown in Shrike's Thread. status keeps only trips that broke, were slow or worked; match keeps only trips whose label contains the text.",
    {
      limit: z.number().int().min(1).max(100).optional().describe("How many to return (default 20)"),
      status: z.enum(["broke", "slow", "worked"]).optional().describe("Keep only trips with this status, the words this tool prints"),
      match: z.string().max(200).optional().describe("Keep only trips whose label contains this text, ignoring case"),
    },
    async ({ limit, status, match }) => {
      const all = host.listActions();
      if (!all.length) return "No trips yet.";
      const q = match?.toLowerCase();
      const list = all
        .filter((a) => (!status || (status === "broke" ? a.status === "error" : status === "slow" ? a.status === "slow" : a.status === "ok")) && (!q || a.label.toLowerCase().includes(q)))
        .sort((a, b) => b.startMs - a.startMs)
        .slice(0, limit ?? 20);
      if (!list.length) return `No ${status ? (status === "broke" ? "broken" : status) + " " : ""}trips${match ? ` match ${match}` : ""}.`;
      const at = (a: (typeof list)[number]) => {
        const s = a.summary?.steps.find((x) => !x.ok && x.source)?.source;
        return s ? `  at ${s.file}:${s.line}` : "";
      };
      return list.map((a) => `${a.id}  ${a.label}  ${a.status === "error" ? "broke" : a.status === "slow" ? "slow" : "worked"}  ${Math.round(a.durationMs)}ms${a.status === "error" ? at(a) : ""}`).join("\n");
    },
  );

  tool(
    "focus_trip",
    "Show one trip in Shrike's Thread, landing on its failure if it broke. The user sees it move there.",
    { tripId: z.string().min(1).max(64).describe("Trip id from list_trips") },
    async ({ tripId }) => {
      const a = host.getAction(tripId);
      if (!a) throw new Error(`No trip "${tripId}". Use list_trips.`);
      d.focusTrip(a.id);
      return `Showing "${a.label}" in Shrike.`;
    },
  );

  tool("list_flows", "List the saved flows (recorded clicks or requests that replay as trips).", {}, async () => {
    const all = await d.listFlows();
    return all.length ? all.map(flowLine).join("\n") : "No flows saved yet. Record one with record_flow.";
  });

  tool(
    "record_flow",
    'Record a flow: action "start" begins recording the user\'s clicks, typing and API explorer requests; action "stop" saves them under name.',
    { action: z.enum(["start", "stop"]), name: z.string().max(120).optional().describe("stop: the flow's name, e.g. Add a todo") },
    async ({ action, name }) => {
      if (action === "start") {
        await d.startFlowRecording();
        return "Recording. Click through the app (or send requests in the API explorer), then call record_flow with action stop and a name.";
      }
      if (!name?.trim()) throw new Error("Give the flow a name when you stop.");
      const f = await d.stopFlowRecording(name);
      return f ? `Saved ${flowLine(f)}` : "Nothing was recorded, so nothing was saved.";
    },
  );

  tool(
    "run_flow",
    "Replay a saved flow in the app (by id or name). Each step becomes a trip. Says whether it passed, and the trip ids.",
    { flow: z.string().min(1).max(120).describe("Flow id or name from list_flows") },
    async ({ flow }) => {
      const f = await findFlow(flow);
      const r = await d.runFlow(f.id);
      return `Flow "${f.name}" ${r.ok ? "passed" : "failed"}.${r.actionIds.length ? ` Trips: ${r.actionIds.join(", ")}` : ""}`;
    },
  );

  tool(
    "open_file",
    "Open a project file in Shrike's file view at a line.",
    { path: z.string().min(1).describe("Path relative to the project root"), line: z.number().int().min(1).optional() },
    async ({ path: p, line }) => {
      const rel = await safePath(p);
      d.openFile(rel, line ?? 1);
      return `Opened ${rel}:${line ?? 1} in Shrike.`;
    },
  );

  tool(
    "ask_agent",
    "Ask Shrike's own agent a question about the app (it reads the recordings). Waits for its answer, up to 10 minutes.",
    { goal: z.string().min(1).max(4000) },
    async ({ goal }) => {
      const r = await d.askAgent(goal);
      return `Agent run ${r.runId} ${r.status}.${r.summary ? `\n${r.summary}` : ""}`;
    },
  );
}
