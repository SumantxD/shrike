import { ipcMain, type BrowserWindow } from "electron";
import { nativeTheme } from "electron"; // themes: Z window chrome
import { z } from "zod";
import type { ShrikeApi, ShrikeEvents } from "@shrike/schema";
import { detectBrains, startAgent, stopAgent } from "./agent.ts";
import * as files from "./files.ts";
import { MAX_HAR_BYTES, parseHar } from "./har.ts"; // #66: HAR import
import {
  answerApproval,
  appView,
  getProject,
  openProject,
  requireProject,
  revertPatch,
  run,
  runner,
  sendRequest,
  setSender,
  store,
} from "./host.ts";
import { paths, sampleCopy } from "./paths.ts";
import { pickFolder } from "./project.ts";
import { openInEditor, saveClip, saveResponseBody } from "./system.ts";
// power (O1 point mode, O6 issue card, O13 images)
import { readFile as readBytes, stat as statPath } from "node:fs/promises";
import type { PointPick, PrView } from "@shrike/schema";
import { exportIssue, showInFolder } from "./issue.ts";
// agent (A4 skills, A5 memory, A6 checkpoints, A11 watched-by, A13 diff comments)
import * as agentExtras from "./agent.ts";
import * as hostExtras from "./host.ts";
import { getCheckpoints } from "./checkpoints.ts";
// setup (D12 processes, O4 per-process output)
import { liveProjectRoot, liveUrlFrom, saveConfig, saveProcesses } from "./project.ts";
// flows (B1–B5, sessions)
import { app as flowsApp, safeStorage, webContents } from "electron";
import { homedir as flowsHome } from "node:os";
import { join as flowsJoin } from "node:path";
import type { AgentRunInfo, AgentStep } from "@shrike/schema";
import { readMyMcpServers } from "@shrike/agent";
import { Flows } from "./flows.ts";
import { notify as flowsNotify } from "./notify.ts";
import { lastSession, SessionSync } from "./sessions.ts";
// sdlc (L1–L7 rail, hidden moves, tests, saved commands)
import { readdir, readFile as readText } from "node:fs/promises";
import { join as joinPath } from "node:path";
import { sdlc } from "./sdlc.ts";
import { runTests, testCommand } from "./tests.ts";
// skills (S1–S5, save as command)
import { app as electronApp } from "electron";
import { homedir } from "node:os";
import { join as skillsJoin } from "node:path";
import * as skills from "./skills.ts";
import * as recipes from "./recipes.ts"; // action-recipes: S8
import * as progress from "./progress.ts";
import { loadFlow as loadFlowForSkill } from "./flows.ts";

// git (G1–G6 ship, PRs, CI, conflicts, merge, sync)
import { createGit, realGh, type GitService } from "./git.ts";
// pr-ci: PR1–PR8 the pull request and CI panel
import { createPrPanel } from "./pr.ts";
import { exec as prExec } from "./git.ts";
import { redactText } from "@shrike/redact";
import { shell as prShell } from "electron";
import { listFlows as readFlows } from "./flows.ts"; // also used by the sdlc block
// scm: SC1–SC7 the Changes dock
import { createScm } from "./scm.ts";
import { exec as scmExec } from "./git.ts";
import { shell as scmShell } from "electron";
let gitSvc: GitService | undefined;
// worktrees (W1 tabs, W2 runs per worktree, W3 race, W4 sandbox, W5 clean up)
import { app as wtApp, BrowserWindow as WtWindow, type WebContents } from "electron";
import { AppView } from "./app-view.ts";
import * as race from "./race.ts";
// workspaces (WS1 rail, WS2 create dialog)
import { shell as wsShell } from "electron";
import { execFile as wsExec } from "node:child_process";
import { createWorkspaces, type Workspaces } from "./workspaces.ts";
let wsSvc: Workspaces | undefined;
// voice (V1 ShrikeVoice.app helper, V7 its models)
import { app as voiceApp, shell as voiceShell } from "electron";
import { VoiceHelper, VoiceModelStore } from "./voice.ts";
import { VoicePlanner } from "./voice-planner.ts";
// xray (X5 context map)
import { xray } from "./context.ts";
// inspector (I place inspector)
import { inspector, inspectRequest } from "./inspector.ts";
import { directInspect } from "./datasources/index.ts";
// start-agent (R1–R8)
import * as start from "./start/index.ts";
// chains (P1 up next, P2 schedules, P3 conditional chains, P4 chains are skills)
import { createHash as chainsHash } from "node:crypto";
import { mkdir as chainsMkdir, writeFile as chainsWrite } from "node:fs/promises";
import type { BrainId, ChainDef } from "@shrike/schema";
import { createChains, critiqueAsk, type Chains } from "./chains.ts";
import { chainFromSkill, chainSkillText, parseScore, slug as chainSlug } from "../renderer/src/chains/logic.ts";
import { getPatch as chainsPatch } from "./patches.ts";
let chainsSvc: Chains | undefined;
// options (M1–M6 ask_options cards)
import { createOptions, type Options } from "./options.ts";
let optionsSvc: Options | undefined;
// review-lessons (RL1–RL9 lessons from your PRs' reviews, gh reads only)
import { createReviewLessons } from "./review-lessons.ts";
import { XP_TABLE as lessonXp } from "../renderer/src/progress/xp.ts";
// quests (QB1–QB9 quest board, L8–L15 build rail)
import { createQuests, readQuests, type Quests } from "./quests.ts";
import type { Quest } from "@shrike/schema";
// ci-lessons: CI1–CI8 the pipeline map, the CI lessons skill, pre-flight
import { createCiLessons, type CiLessons } from "./ci-lessons.ts";
let ciSvc: CiLessons | undefined;
let questsSvc: Quests | undefined;
// mcp: the tools hub (MCP1 to MCP8)
import { killTree as mcpKill, spawnShell as mcpSpawn } from "./platform.ts";
import { readFile as mcpRead } from "node:fs/promises";
import { checkMcpServer, loginPath as mcpLoginPath } from "@shrike/agent";
import { createMcpHub, mcpServerOfStep, serverName as mcpName, type AddPlan } from "./mcp.ts";
import { judge as mcpJudge } from "./start/policy.ts";
import { XP_TABLE as mcpXp } from "../renderer/src/progress/xp.ts";
// api: AP the API client (Bruno-compatible collections, sends, history, imports)
import { app as apiApp, dialog as apiDialog, safeStorage as apiSafe } from "electron";
import { createApi } from "./api/index.ts";
import { codeLangZ, envZ, idZ, importKindZ, relZ, requestZ, routeGuessZ, routeRefsZ, sendOptsZ } from "./api/zod.ts";
let mcpObserve: ((step: AgentStep) => void) | undefined;
let mcpHub: ReturnType<typeof createMcpHub> | undefined;

type Methods = Omit<ShrikeApi, "on" | "platform">;

const str = z.string().min(1).max(4096);
const none = z.tuple([]);
const httpSpec = z.object({
  method: z.string().min(1).max(16).regex(/^[A-Za-z]+$/),
  url: z.string().min(1).max(8192),
  headers: z.record(z.string(), z.string()).optional(),
  body: z.string().max(5 * 1024 * 1024).optional(),
  name: z.string().trim().min(1).max(120).optional(), // AP
  resendOf: z.string().regex(/^[0-9a-f]{16}$/).optional(), // AP: the trip it edits
});
const assertion = z.object({ expr: z.string().trim().min(1).max(300), op: z.string().regex(/^[A-Za-z]{2,20}$/), value: z.string().max(2000), enabled: z.boolean() }); // AP

/** The user's app in its own window (index.ts). It may call only APP_WINDOW_CALLS and hears only APP_WINDOW_EVENTS. */
export interface AppWindowCtl {
  get(): BrowserWindow | undefined;
  open(): void;
  close(): void;
}
const APP_WINDOW_CALLS = new Set<string>(["reloadApp", "startPointMode", "cancelPointMode", "dockApp", "getRunStatus", "appPartition"]);
const APP_WINDOW_EVENTS = new Set<string>(["run:status", "point:picked", "point:cancelled"]);

export function registerIpc(win: () => BrowserWindow | undefined, appWin: AppWindowCtl = { get: () => undefined, open() {}, close() {} }): void {
  const emit = <K extends keyof ShrikeEvents>(channel: K, payload: ShrikeEvents[K]) => {
    for (const w of [win(), APP_WINDOW_EVENTS.has(channel) ? appWin.get() : undefined])
      if (w && !w.isDestroyed() && !w.webContents.isDestroyed()) w.webContents.send(`shrike:event:${channel}`, payload);
    if (channel !== "sdlc:update") sdlc.observe(channel, payload); // sdlc: the rail reads every event
    if (channel === "agent:status" || channel === "agent:step" || channel === "agent:usage") xray.observe(channel, payload); // xray: X5
    if (channel === "file:changed" || channel === "checkpoint:update" || channel === "project:opened") gitSvc?.poke(); // git: G* state follows file changes and project opens (rail L6)
    if (channel !== "skill:event" && channel !== "skills:update") void skills.observe(channel, payload); // system: SL windows follow agent runs, start plans, flows and skill files
    if (channel === "skill:event" || channel === "start:plan" || channel === "flow:result" || channel === "race:update") void progress.observe(channel, payload); // progression: XP from real events
    if (channel !== "chains:update" && channel !== "chains:event") chainsSvc?.observe(channel, payload); // chains: up next and chains follow the agent's runs
    if (channel !== "workspaces:update" && channel !== "workspace:progress") wsSvc?.observe(channel, payload); // workspaces: rail dots follow runs, agents and approvals
    if (channel === "agent:status" && (payload as AgentRunInfo).status !== "running") optionsSvc?.release((payload as AgentRunInfo).id); // options: a stopped run waits on no card
    if (channel === "scm:update") ciSvc?.observe(channel, payload); // ci-lessons: a pushed commit's hosted CI is compared with its pre-flight
    if (channel === "flows:update" || channel === "project:opened") questsSvc?.observe(channel, payload); // quests: flows check objectives off
    if (channel === "agent:step") mcpObserve?.(payload as AgentStep); // mcp: MCP8 a tool that worked for the first time
  };
  setSender(emit);

  const handle = <K extends keyof Methods>(name: K, schema: z.ZodTypeAny, fn: (...args: Parameters<Methods[K]>) => ReturnType<Methods[K]> | Awaited<ReturnType<Methods[K]>>) => {
    ipcMain.handle(`shrike:${name}`, async (e, ...args: unknown[]) => {
      const w = win();
      const fromAppWindow = APP_WINDOW_CALLS.has(name) && e.sender.id === appWin.get()?.webContents.id;
      if (!w || (e.sender.id !== w.webContents.id && !fromAppWindow)) throw new Error("Not allowed.");
      const parsed = schema.safeParse(args);
      if (!parsed.success) throw new Error(`Invalid arguments for ${name}: ${parsed.error.issues[0]?.message ?? "bad input"}`);
      return fn(...(parsed.data as Parameters<Methods[K]>));
    });
  };

  handle("openProjectDialog", none, async () => {
    const root = await pickFolder(win());
    return root ? openProject(root) : null;
  });
  handle("openProject", z.tuple([str]), (root) => openProject(root));
  handle("sampleProjectPath", none, () => sampleCopy());
  handle("openLiveSite", z.tuple([z.string().min(1).max(2048)]), (url) => openProject(liveProjectRoot(liveUrlFrom(url))));
  handle("getProject", none, async () => getProject());
  handle("run", none, () => run());
  handle("stop", none, () => runner.stop());
  handle("getRunStatus", none, async () => runner.status);
  handle("reloadApp", none, () => appView.reload());
  handle("popOutApp", none, async () => appWin.open());
  handle("dockApp", none, async () => appWin.close());
  handle("appWindowOpen", none, async () => !!appWin.get());
  handle("listFiles", none, () => files.fileTree(requireProject().root));
  handle("mapTree", z.tuple([z.array(z.string().min(1).max(1024).refine((p) => !/^([\\/]|[a-zA-Z]:)/.test(p) && !p.split(/[\\/]/).includes("..") && !p.includes("\0"), "not a project path")).max(2000)]), (touched) => files.mapTree(requireProject().root, touched));
  handle("readFile", z.tuple([str]), (path) => files.readFile(requireProject().root, path));
  handle("writeFile", z.tuple([str, z.string().max(20 * 1024 * 1024)]), (path, content) => files.writeFile(requireProject().root, path, content));
  handle("getActions", none, async () => store.listActions());
  // har: #66, a HAR picked through the dialog becomes trips. The size is checked before reading; parseHar throws a plain message for invalid files.
  handle("importHar", none, async () => {
    const path = await pick("Import a HAR file", ["openFile"], ["har", "json"]);
    if (!path) return null;
    if ((await statPath(path)).size > MAX_HAR_BYTES) throw new Error("That HAR file is over 50 MB, so I can't import it.");
    const imported = parseHar(await readText(path, "utf8"));
    for (const events of imported.trips) store.handle({ type: "events", events });
    return {
      trips: imported.trips.length,
      events: imported.trips.reduce((n, t) => n + t.length - 1, 0),
      entries: imported.entries,
      skipped: imported.skipped,
      truncated: imported.truncated,
      webSockets: imported.webSockets,
    };
  });
  handle("sendRequest", z.tuple([httpSpec]), (req) => sendRequest(req, "explorer"));
  handle("detectBrains", none, () => detectBrains());
  handle("startAgent", z.tuple([z.string().trim().min(1).max(4000), z.enum(["claude-code", "builtin"])]), (goal, brain) => startAgent(goal, brain, emit));
  handle("stopAgent", z.tuple([str]), async (id) => stopAgent(id));
  handle("answerApproval", z.tuple([str, z.boolean()]), async (id, approved) => answerApproval(id, approved));
  handle("revertPatch", z.tuple([str]), (id) => revertPatch(id));
  handle("getActionShot", z.tuple([str]), async (id) => appView.shot(id));
  handle("openInEditor", z.tuple([str, z.number().int().min(1).max(10_000_000)]), (file, line) => openInEditor(requireProject().root, file, line));
  handle("saveClip", z.tuple([z.instanceof(Uint8Array).refine((b) => b.byteLength > 0 && b.byteLength <= 2 ** 31, "clip is empty or too big"), z.enum(["webm", "mp4"])]), (bytes, ext) =>
    saveClip(win(), getProject()?.name ?? "app", bytes, ext),
  );

  // ---- power: O1 point mode, O6 issue card, O13 images in the file view ----
  const relPick = (p: PointPick): PointPick => {
    const root = getProject()?.root;
    const file = p.source?.file.replace(/^file:\/\//, "");
    if (!p.source || !root || !file?.startsWith(`${root}/`)) return p;
    return { ...p, source: { ...p.source, file: file.slice(root.length + 1) } };
  };
  appView.onPoint = (pick) => (pick ? emit("point:picked", relPick(pick)) : emit("point:cancelled", null));
  handle("startPointMode", none, () => appView.startPointMode());
  handle("cancelPointMode", none, () => appView.cancelPointMode());
  handle("exportIssue", z.tuple([str]), async (id) => {
    const p = requireProject();
    const view = store.getAction(id);
    if (!view) throw new Error("That trip isn't in this session anymore.");
    const appUrl = (runner.status.state === "running" ? runner.status.url : undefined) ?? p.appUrl;
    return exportIssue({ root: p.root, project: p.name, view, actions: store.listActions(), appUrl, readFile: (rel) => files.readFile(p.root, rel) });
  });
  handle("showInFolder", z.tuple([str]), (path) => showInFolder(requireProject().root, path));
  const IMAGE_TYPES: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", svg: "image/svg+xml", webp: "image/webp" };
  handle("readFileDataUrl", z.tuple([str]), async (rel) => {
    const type = IMAGE_TYPES[rel.split(".").pop()?.toLowerCase() ?? ""];
    if (!type) throw new Error(`Not an image: ${rel}`);
    const abs = files.resolveInside(requireProject().root, rel);
    if ((await statPath(abs)).size > 10 * 1024 * 1024) throw new Error(`${rel} is over 10MB.`);
    return `data:${type};base64,${(await readBytes(abs)).toString("base64")}`;
  });
  // ---- end power ----

  // ---- agent: A4 skills, A5 memory, A6 checkpoints, A11 watched-by, A13 diff comments ----
  handle("listSkills", none, () => agentExtras.listSkills());
  handle("getMemory", none, () => hostExtras.getMemory());
  handle("removeMemory", z.tuple([str]), (id) => hostExtras.removeMemory(id));
  handle("getCheckpoints", none, async () => getCheckpoints());
  handle("rewindTo", z.tuple([str]), (id) => hostExtras.rewindTo(id));
  handle("watchedBy", none, async () => hostExtras.watchedBy());
  handle("reviseFix", z.tuple([str, z.array(z.object({ line: z.number().int().min(1).max(10_000_000), file: z.string().min(1).max(4096), text: z.string().trim().min(1).max(2000) })).min(1).max(50)]), (patchId, comments) =>
    agentExtras.reviseFix(patchId, comments, emit),
  );
  // ---- end agent ----

  // ---- branches: C1 branch, C2 map, C3 aside, C5 bring back ----
  const question = z.string().trim().min(1).max(2000);
  handle("listRuns", none, () => agentExtras.listRuns());
  handle("getRunSteps", z.tuple([str]), (runId) => agentExtras.getRunSteps(runId));
  handle("retryRun", z.tuple([str]), (runId) => agentExtras.retryRun(runId, emit));
  const branchName = z.string().trim().max(40).optional();
  // optional trailing args may be left off entirely, so each call shape is its own tuple
  handle("branchRun", z.union([z.tuple([str, str, question]), z.tuple([str, str, question, z.object({ name: branchName }).optional()])]), (runId, stepId, q, o) => agentExtras.branchRun(runId, stepId, q, emit, { name: o?.name }));
  handle("askAside", z.tuple([str, question]), (runId, q) => agentExtras.askAside(runId, q, emit));
  handle("keepAside", z.union([z.tuple([str]), z.tuple([str, branchName])]), (id, name) => agentExtras.keepAside(id, emit, name));
  handle("bringBack", z.tuple([str, z.enum(["summary", "fix"])]), (id, mode) => agentExtras.bringBack(id, mode, emit));
  // ---- end branches ----

  // ---- setup: D12 processes ----
  const processSpec = z.object({
    name: z.string().regex(/^[\w.-]{1,40}$/, "process names use letters, digits, dot, dash or underscore"),
    command: z.string().trim().min(1).max(4096),
    cwd: z.string().min(1).max(4096).optional(),
    url: z.string().url().max(2048).optional(),
  });
  handle("setProcesses", z.tuple([z.array(processSpec).min(1).max(20).refine((ps) => new Set(ps.map((p) => p.name)).size === ps.length, "process names must be different")]), async (processes) => {
    const root = requireProject().root;
    saveProcesses(root, processes);
    return openProject(root);
  });
  handle("setLiveUrl", z.tuple([z.string().min(1).max(2048).nullable()]), async (url) => {
    const root = requireProject().root;
    saveConfig(root, { liveUrl: url === null ? null : liveUrlFrom(url) });
    return openProject(root);
  });
  handle("setAppSide", z.tuple([z.enum(["local", "live"])]), (side) => hostExtras.setAppSide(side));
  handle("signOutLive", none, () => hostExtras.signOutLive());
  handle("appPartition", none, async () => hostExtras.appPartition());
  handle("answerLiveLogin", z.tuple([str, z.object({ username: z.string().max(1024), password: z.string().max(1024) }).strict().nullable()]), async (id, login) => hostExtras.answerLiveLogin(id, login));
  // ---- end setup ----

  // ---- flows: B1 record, B2 replay, B3 keep watching, B4 my MCP servers, B5 Shrike drivable, sessions ----
  const guest = () => webContents.getAllWebContents().find((w) => w.getType() === "webview" && !w.isDestroyed());
  const keychain = {
    encrypt: (s: string) => {
      if (!safeStorage.isEncryptionAvailable()) throw new Error("No keychain on this machine.");
      return safeStorage.encryptString(s).toString("base64");
    },
    decrypt: (s: string) => safeStorage.decryptString(Buffer.from(s, "base64")),
  };
  const flowsCtl = new Flows({
    root: () => getProject()?.root,
    drive: { ...hostExtras.host, sendRequest: (req) => sendRequest(req, "explorer") },
    page: {
      url: () => appView.currentUrl(),
      record: async (on) => void (await guest()?.executeJavaScript(`window.__shrike?.record(${on === true})`)),
      // ponytail: listens to the app page open when recording starts; a page that is replaced mid-recording stops reporting.
      listen: (cb) => {
        const g = guest();
        if (!g) return () => {};
        const l = (_e: unknown, method: string, params: { name?: string; payload?: unknown }) => {
          if (method !== "Runtime.bindingCalled" || params?.name !== "__shrikeEmit") return;
          try {
            cb(JSON.parse(String(params.payload)));
          } catch {}
        };
        g.debugger.on("message", l);
        return () => void g.debugger.removeListener("message", l);
      },
    },
    emit,
    notify: flowsNotify,
    watchFiles: files.watchFiles,
    secrets: keychain,
    first: (kind, name) => void progress.earn(`api-${kind}:${getProject()?.root ?? ""}`, 0).then((y) => y && emit("api:first", { kind, name })), // AP: once per project
  });
  const sessionsDir = flowsJoin(flowsApp.getPath("userData"), "sessions");
  const sessionSync = new SessionSync({ dir: sessionsDir, root: () => getProject()?.root, name: () => getProject()?.name ?? "", list: () => store.listActions(), handle: (m) => store.handle(m) });
  setInterval(() => {
    void sessionSync.tick();
    void flowsCtl.sync().catch(() => {});
  }, 1000).unref();

  const flowId = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/);
  const flowStep = z.object({
    type: z.enum(["click", "type", "navigate", "wait", "request"]),
    name: z.string().max(200).optional(),
    text: z.string().max(10_000).optional(),
    url: z.string().max(8192).optional(),
    ms: z.number().int().min(0).max(10_000).optional(),
    request: httpSpec.optional(),
    assert: z.array(assertion).max(50).optional(), // AP Save as test
    submit: z.boolean().optional(),
    secret: z.boolean().optional(),
  });
  handle("listFlows", none, () => flowsCtl.list());
  handle("startFlowRecording", none, () => flowsCtl.startRecording());
  handle("stopFlowRecording", z.tuple([z.string().max(120)]), (name) => flowsCtl.stopRecording(name));
  handle("runFlow", z.tuple([flowId]), (id) => flowsCtl.run(id));
  handle("setFlowWatch", z.tuple([flowId, z.object({ mode: z.enum(["save", "interval"]), minutes: z.number().int().min(1).max(1440).optional() }).nullable()]), (id, w) => flowsCtl.setWatch(id, w));
  handle("deleteFlow", z.tuple([flowId]), (id) => flowsCtl.remove(id));
  handle("saveFlow", z.tuple([z.string().trim().min(1).max(120), z.array(flowStep).min(1).max(200)]), (name, steps) => flowsCtl.save(name, steps));
  handle("listMyMcpServers", none, async () => (mcpHub ? Object.keys(await mcpHub.servers(getProject()?.root ?? flowsHome())) : Object.keys(await readMyMcpServers(getProject()?.root ?? flowsHome()))));
  handle("lastSession", none, async () => {
    const m = await lastSession(sessionsDir);
    return m && { project: m.root, actionIds: m.actionIds, at: m.at };
  });

  const ASK_MS = 10 * 60_000;
  hostExtras.host.drive = {
    openProject: async (root) => {
      const p = await openProject(root);
      emit("project:opened", p);
      return p;
    },
    run: async () => {
      await start.startApp(); // R5: outside MCP clients get the same Claude-driven start as the Run button
      for (let i = 0; i < 9000 && ["planning", "running"].includes(start.getStartPlan()?.state ?? ""); i++) await new Promise((r) => setTimeout(r, 200));
      return runner.status;
    },
    stop: async () => (await start.stopApp(), runner.status),
    focusTrip: (actionId) => emit("trip:focus", { actionId }),
    openFile: (path, line) => emit("file:open", { path, line }),
    listFlows: () => flowsCtl.list(),
    startFlowRecording: () => flowsCtl.startRecording(),
    stopFlowRecording: (name) => flowsCtl.stopRecording(name),
    runFlow: (id) => flowsCtl.run(id),
    askAgent: async (goal) => {
      const brains = (await detectBrains()).filter((b) => b.available);
      const brain = (brains.find((b) => b.id === "claude-code") ?? brains[0])?.id;
      if (!brain) throw new Error("No agent is set up in Shrike yet. Install Claude Code, or set ANTHROPIC_API_KEY.");
      let summary = "";
      let end: (s: AgentRunInfo["status"]) => void = () => {};
      const ended = new Promise<AgentRunInfo["status"]>((r) => (end = r));
      const tap = <K extends keyof ShrikeEvents>(ch: K, p: ShrikeEvents[K]) => {
        emit(ch, p);
        const step = ch === "agent:step" ? (p as AgentStep) : undefined;
        if (step?.kind === "done") summary = step.summary || step.detail || summary;
        else if (step?.kind === "findings" && step.summary) summary = step.summary;
        if (ch === "agent:status" && (p as AgentRunInfo).status !== "running") end((p as AgentRunInfo).status);
      };
      const info = await startAgent(goal, brain, tap);
      const timer = setTimeout(() => (stopAgent(info.id), end("stopped")), ASK_MS);
      const status = await ended.finally(() => clearTimeout(timer));
      return { runId: info.id, status, summary };
    },
  };
  // ---- end flows ----

  // ---- skills: S1 shelf, S2 Claude import, S3 run, S4 proposals, S5 save as skill, save as command ----
  skills.configureSkills(
    () => ({
      builtin: skillsJoin(paths.repo, "prompts/skills"),
      project: getProject()?.root,
      personal: skillsJoin(homedir(), ".shrike/skills"),
      claude: skillsJoin(homedir(), ".claude/skills"), // read-only: nothing here writes to it
      state: electronApp.getPath("userData"),
    }),
    emit,
  );
  skills.setFlowLookup((id) => loadFlowForSkill(requireProject().root, id).catch(() => undefined));
  const skillId = z.string().regex(/^[\w.-]{1,80}$/);
  handle("runSkill", z.tuple([skillId, z.string().trim().max(4000).optional()]), async (id, input) => {
    const skill = (await skills.listAll()).find((s) => s.id === id);
    if (!skill) throw new Error("That skill isn't there anymore.");
    // R4: a run skill is the start quest, not a debug run. ponytail: no agent run to hand back; callers skip a null.
    if (skill.kind === "run") return (await start.startApp(), null as unknown as AgentRunInfo);
    const brain = (await detectBrains()).find((b) => b.available)?.id;
    if (!brain) throw new Error("No agent is set up. Install Claude Code, or set ANTHROPIC_API_KEY.");
    const goal = `Run the "${skill.name}" playbook${input ? ` for this: ${input}` : ""}. Follow its steps in order and say plainly how each one went. If you learned something that would make the playbook better next time, call propose_skill_update once at the end.`;
    return agentExtras.startAgentWith(goal, brain, { skillId: skill.id, ...(skill.usesMcp?.length ? { useMyMcp: true } : {}) }, emit); // MCP7: a skill that uses your tools gets them
  });
  handle("answerSkillProposal", z.tuple([str, z.boolean()]), async (id, keep) => {
    if (await skills.answerProposal(skills.services.dirs(), id, keep)) await skills.pushUpdate();
  });
  handle("listSkillDrafts", none, async () => skills.getSkillDrafts()); // evolve-on-outcome
  handle("undoSkillLevel", z.tuple([str]), async (id) => skills.undoSkillLevel(id));
  handle("editSkillDraft", z.tuple([str]), async (id) => skills.editSkillDraft(id));
  handle("saveAsSkill", z.tuple([z.object({ actionId: str.optional(), runId: str.optional(), flowId: str.optional(), name: z.string().trim().max(80).optional() }).refine((f) => f.actionId || f.runId || f.flowId, "say what to save")]), async (from) => {
    const saved = await skills.saveAsSkill(skills.services.dirs(), from);
    await skills.pushUpdate();
    return skills.toSkill(saved);
  });
  handle("importClaudeSkills", z.tuple([z.boolean()]), async (enable) => {
    await skills.setClaudeImport(skills.services.dirs(), enable);
    await skills.pushUpdate();
    return skills.listAll();
  });
  handle("saveAsCommand", z.tuple([z.string().trim().min(1).max(60), z.string().trim().min(1).max(4000)]), async (name, prompt) => void (await skills.saveAsCommand(requireProject().root, name, prompt)));
  handle("editSkill", z.tuple([skillId]), async (id) => {
    const rel = await skills.editablePath(skills.services.dirs(), id);
    await skills.pushUpdate();
    return rel;
  });
  handle("claudeSkillsOffer", none, () => skills.claudeOffer(skills.services.dirs()));
  handle("getSkillLog", none, () => skills.getSkillLog()); // system: SL6
  handle("noteSkillUse", z.tuple([skillId]), (id) => skills.noteSkillUse(id)); // system: SL3 git skills
  // action-recipes: S8
  const recipeSettings = z.object({ agent: z.enum(["default", "claude-code", "builtin", "claude-teams", "codex", "opencode"]).optional(), args: z.string().max(500).optional(), template: z.string().max(20_000).optional() }).strict();
  handle("listRecipes", none, () => recipes.listRecipes(skills.services.dirs()));
  handle("saveRecipe", z.tuple([skillId, recipeSettings, z.enum(["project", "personal"])]), (id, s, scope) => recipes.saveRecipe(skills.services.dirs(), id, s, scope));
  handle("resetRecipe", z.tuple([skillId]), (id) => recipes.resetRecipe(skills.services.dirs(), id));
  // ---- progression: XP1–XP8 ----
  progress.configureProgress({ dir: () => electronApp.getPath("userData"), root: () => getProject()?.root }, emit);
  handle("getProgress", none, () => progress.getProgress());
  handle("saveImage", z.tuple([z.instanceof(Uint8Array).refine((b) => b.byteLength > 0 && b.byteLength <= 32 * 1024 * 1024, "image is empty or too big"), z.string().max(120)]), (bytes, name) => progress.saveImage(win(), bytes, name));
  // ---- end skills ----

  // ---- sdlc: L1–L7 rail, hidden moves (Plan first, Think harder, Review this fix), tests, saved commands ----
  sdlc.connect({ actions: () => store.listActions(), emit, flows: async () => (getProject() ? readFlows(requireProject().root) : []), hasTests: () => !!getProject() && !!testCommand(requireProject().root), quests: async () => (getProject() ? readQuests(requireProject().root) : []) });
  const agentOptions = z.object({
    planFirst: z.boolean().optional(),
    thinking: z.enum(["quick", "normal", "deep"]).optional(),
    skillId: z.string().regex(/^[\w.-]{1,80}$/).optional(),
    useMyMcp: z.boolean().optional(),
    worktree: z.string().regex(/^[\w./-]{1,120}$/).optional(),
    context: z.array(z.string().max(400)).max(12).optional(),
  });
  handle("getSdlc", none, async () => sdlc.get());
  handle("waiveReview", none, async () => sdlc.waiveReview());
  handle("startAgentWith", z.tuple([z.string().trim().min(1).max(4000), z.enum(["claude-code", "builtin"]), agentOptions]), (goal, brain, opts) => agentExtras.startAgentWith(goal, brain, opts, emit));
  handle("reviewFix", z.tuple([str]), (patchId) => agentExtras.reviewFix(patchId, emit));
  handle("runTests", none, async () => {
    const r = await runTests(requireProject().root);
    sdlc.noteTests(r);
    return r && { ok: r.ok, summary: r.summary };
  });
  handle("listCommands", none, async () => {
    const dir = joinPath(requireProject().root, ".shrike", "commands");
    const names = (await readdir(dir).catch(() => [] as string[])).filter((f) => /^[\w.-]{1,60}\.md$/.test(f)).sort();
    const out = await Promise.all(names.map(async (f) => ({ name: f.slice(0, -3), prompt: (await readText(joinPath(dir, f), "utf8").catch(() => "")).replace(/^---\n[\s\S]*?\n---\n/, "").trim().slice(0, 4000) })));
    return out.filter((c) => c.prompt);
  });
  // ---- end sdlc ----

  // ---- git: G1 ship, G2 review a PR, G3 conflicts, G4 CI, G5 merge, G6 sync ----
  const applied = () => getCheckpoints().filter((c) => c.current);
  gitSvc = createGit({
    root: () => getProject()?.root,
    gh: realGh,
    approve: (title, reason) => hostExtras.requestApproval({ kind: "request", title, reason }),
    startAgent: async (goal, opts, want) => {
      const brains = (await detectBrains()).filter((b) => b.available);
      const brain = (brains.find((b) => b.id === want) ?? brains.find((b) => b.id === "claude-code") ?? brains[0])?.id; // want: the action recipe's agent (S8)
      if (!brain) throw new Error("No agent is set up yet. Install Claude Code or set ANTHROPIC_API_KEY.");
      return agentExtras.startAgentWith(goal, brain, opts, emit);
    },
    issue: async (id) => {
      const p = requireProject();
      const view = store.getAction(id);
      if (!view) return undefined;
      return (await exportIssue({ root: p.root, project: p.name, view, actions: store.listActions(), appUrl: p.appUrl, readFile: (rel) => files.readFile(p.root, rel) })).markdown;
    },
    shrikeFiles: () => [...new Set(applied().flatMap((c) => c.files))],
    lastFix: () => applied().at(-1)?.label,
    flows: () => flowsCtl.list(),
    runFlow: (id) => flowsCtl.run(id), // G3 then L4: the saved flows re-run after conflicts are fixed
    emit: (s) => emit("git:update", s),
  });
  const git = gitSvc;
  const prNumber = z.number().int().min(1).max(10_000_000);
  handle("gitState", none, async () => (await git.refresh()) ?? git.state());
  handle("shipFix", z.tuple([z.object({ actionId: str.optional(), title: z.string().trim().max(200).optional(), message: z.string().max(20_000).optional(), files: z.array(z.string().min(1).max(4096)).max(500).optional() })]), (opts) => git.shipFix(opts).then((pr) => (void progress.shipped(pr), pr)));
  handle("listPullRequests", none, () => git.listPullRequests());
  handle("reviewPullRequest", z.tuple([prNumber]), (n) => git.reviewPullRequest(n));
  handle("resolveConflicts", none, () => git.resolveConflicts());
  handle("explainCheck", z.tuple([prNumber, z.string().min(1).max(300)]), (n, name) => git.explainCheck(n, name));
  handle("mergePullRequest", z.tuple([prNumber]), (n) => git.mergePullRequest(n));
  handle("syncWithMain", z.tuple([z.object({ mode: z.enum(["preview", "rebase", "merge", "continue", "abort"]).optional() })]).or(none), (opts) => git.syncWithMain(opts));
  // ---- end git ----

  // ---- scm: SC1–SC7 the Changes dock ----
  const scm = createScm({
    root: () => getProject()?.root,
    exec: scmExec,
    approve: (title, reason) => hostExtras.requestApproval({ kind: "request", title, reason }),
    writeText: async (prompt, want) => {
      const brains = (await detectBrains()).filter((b) => b.available);
      const brain = (brains.find((b) => b.id === want) ?? brains.find((b) => b.id === "claude-code") ?? brains[0])?.id; // want: the recipe's agent (S8)
      if (!brain) throw new Error("No agent is set up yet. Install Claude Code or set ANTHROPIC_API_KEY.");
      return new Promise<string>((done, fail) => {
        let text = "";
        const quiet = {
          onStep: (s: AgentStep) => void (s.kind === "message" && !s.tool ? (text = s.text) : s.kind === "done" && s.detail ? (text = s.detail) : 0),
          onEnd: (st: AgentRunInfo["status"]) => (st === "done" && text.trim() ? done(text) : fail(new Error("Your agent didn't write a message. Try again, or write your own."))),
        };
        agentExtras.startAgent(prompt, brain, emit, { readOnly: true, quiet }).catch(fail);
      });
    },
    emit: (s) => emit("scm:update", s),
    changed: () => gitSvc?.poke(),
    used: (id) => void skills.noteSkillUse(id).catch(() => {}),
  });
  const scmPaths = z.tuple([z.array(z.string().min(1).max(4096)).max(5000)]);
  const sha = z.string().regex(/^[0-9a-f]{7,40}$/);
  handle("scmState", none, () => scm.state());
  handle("scmDiff", z.tuple([z.object({ path: z.string().min(1).max(4096), area: z.enum(["conflicts", "staged", "changes", "untracked", "branch", "commit"]), sha: sha.optional() })]), (t) => scm.diff(t));
  handle("scmStage", scmPaths, (p) => scm.stage(p));
  handle("scmUnstage", scmPaths, (p) => scm.unstage(p));
  handle("scmDiscard", scmPaths, (p) => scm.discard(p));
  handle("scmCommit", z.tuple([z.string().trim().min(1).max(20_000)]), (m) => scm.commit(m));
  handle("scmUndoCommit", none, () => scm.undoCommit());
  handle("scmWriteMessage", none, () => scm.writeMessage());
  handle("scmSync", none, () => scm.sync());
  handle("scmCommitFiles", z.tuple([sha]), (s) => scm.commitFiles(s));
  handle("scmOpenOnGitHub", none, async () => {
    const url = await scm.webUrl();
    if (!url) throw new Error("This project's remote isn't on GitHub.");
    await scmShell.openExternal(url);
  });
  // ---- end scm ----

  // ---- pr-ci: PR1–PR8 the pull request and CI panel; every GitHub write asks first ----
  const prs = createPrPanel({
    root: () => getProject()?.root,
    gh: realGh,
    exec: prExec,
    approve: (title, reason) => hostExtras.requestApproval({ kind: "request", title, reason }),
    startAgent: async (goal, opts) => {
      const brains = (await detectBrains()).filter((b) => b.available);
      const brain = (brains.find((b) => b.id === "claude-code") ?? brains[0])?.id;
      if (!brain) throw new Error("No agent is set up yet. Install Claude Code or set ANTHROPIC_API_KEY.");
      return agentExtras.startAgentWith(goal, brain, opts, emit);
    },
    queue: (prompt) => {
      if (!chainsSvc) throw new Error("Up next isn't ready yet.");
      return chainsSvc.queue(prompt, { on: "finished" });
    },
    redact: redactText,
  });
  const seen = (v: PrView) => {
    if (v.pr) void git.prSeen(v.pr.number, v.checks); // the rail and the Ship sheet follow the panel's fresher checks
    return v;
  };
  const nodeId = z.string().regex(/^[\w=-]{1,120}$/);
  const prBody = z.string().max(60_000);
  handle("prView", z.union([z.tuple([]), z.tuple([prNumber]), z.tuple([z.undefined()])]), (n) => prs.view(n).then(seen));
  handle("prCheckJob", z.tuple([z.string().url().max(2000), z.string().min(1).max(300)]), (link, name) => prs.checkJob(link, name));
  handle(
    "prAct",
    z.tuple([
      z.discriminatedUnion("kind", [
        z.object({ kind: z.literal("reply"), n: prNumber, threadId: nodeId, body: prBody.refine((b) => b.trim(), "write a reply first") }),
        z.object({ kind: z.literal("comment"), n: prNumber, body: prBody.refine((b) => b.trim(), "write a comment first") }),
        z.object({ kind: z.literal("react"), n: prNumber, subjectId: nodeId, content: z.enum(["THUMBS_UP", "THUMBS_DOWN", "LAUGH", "HOORAY", "CONFUSED", "HEART", "ROCKET", "EYES"]) }),
        z.object({ kind: z.literal("resolve"), n: prNumber, threadId: nodeId, resolved: z.boolean() }),
        z.object({ kind: z.literal("review"), n: prNumber, event: z.enum(["COMMENT", "APPROVE", "REQUEST_CHANGES"]), body: prBody }),
        z.object({ kind: z.literal("ready"), n: prNumber }),
        z.object({ kind: z.literal("rerun"), run: z.string().regex(/^\d{1,20}$/) }),
      ]),
    ]),
    (a) => prs.act(a).then(seen),
  );
  handle(
    "prAgent",
    z.tuple([
      z.discriminatedUnion("kind", [
        z.object({ kind: z.literal("queue"), n: prNumber, commentId: nodeId }),
        z.object({ kind: z.literal("fix-all"), n: prNumber }),
        z.object({ kind: z.literal("fix-check"), n: prNumber.optional(), name: z.string().min(1).max(300) }),
      ]),
    ]),
    (t) => prs.agent(t),
  );
  handle("openLink", z.tuple([z.string().url().max(4000).refine((u) => /^https?:\/\//i.test(u), "only web links open")]), (url) => prShell.openExternal(url));
  // ---- end pr-ci ----

  // ---- worktrees: W1 tabs, W2 runs per worktree, W3 race, W4 sandbox, W5 clean up ----
  race.init({
    emit,
    getProject,
    openProject,
    run,
    runner,
    store,
    requestApproval: hostExtras.requestApproval,
    rejectWithFeedback: hostExtras.rejectWithFeedback,
    // A worktree's app page lives in a hidden child window, recorded like the app pane.
    makeView: async (onMessage) => {
      const w = new WtWindow({ show: false, width: 1280, height: 800, parent: win(), webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
      await w.loadURL("about:blank"); // a hidden window has no renderer until it loads something; attaching the recorder first never returns
      const view = new AppView({ bundlePath: paths.browserAgentBundle, appUrl: () => undefined, onMessage, onWarning: () => {} });
      // ponytail: AppView adopts pages from did-attach-webview; hand it this window's page the same way.
      view.watch({ on: (_e: string, cb: (e: unknown, g: WebContents) => void) => cb({}, w.webContents) } as unknown as WebContents);
      const close = () => {
        if (w.isDestroyed()) return;
        // Destroying it straight away while the app page is live crashed Electron 38 (SIGTRAP); blank it first, then destroy on the next tick.
        void w.webContents.loadURL("about:blank").catch(() => {}).finally(() => setTimeout(() => !w.isDestroyed() && w.destroy(), 0));
      };
      return { view, close };
    },
    nodeAgentRegister: paths.nodeAgentRegister,
    pythonAgent: paths.pythonAgent,
    promptsDir: paths.promptsDir,
    skillsDir: joinPath(paths.promptsDir, "../skills"),
  });
  wtApp.on("before-quit", () => void race.stopAllSessions());
  process.on("exit", () => race.killAllSessions());
  const wtName = z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/, "use lowercase letters, digits and dashes");
  const maybe = (a: z.ZodTypeAny, b: z.ZodTypeAny) => z.union([z.tuple([a, b]), z.tuple([a])]); // the second argument may be left out
  handle("listWorktrees", none, () => race.listWorktrees());
  handle("createWorktree", maybe(wtName, z.string().trim().max(200)), (name, note) => race.createWorktree(name, note));
  handle("switchWorktree", z.tuple([wtName]), (name) => race.switchWorktree(name));
  handle("removeWorktree", z.tuple([wtName]), (name) => race.removeWorktree(name));
  handle("startRace", maybe(str, z.number().int().min(2).max(3)), (id, n) => race.startRace(id, n));
  handle("adoptWorktreeFix", z.tuple([wtName]), (name) => race.adoptWorktreeFix(name));
  handle("trySandbox", maybe(str, str), (patchId, actionId) => race.trySandbox(patchId, actionId));
  // ---- end worktrees ----

  // ---- workspaces: WS1 rail, WS2 create dialog ----
  const ws = (wsSvc = createWorkspaces({
    file: joinPath(wtApp.getPath("userData"), "workspaces.json"),
    gh: (args, cwd) => realGh.run(args, { cwd }),
    current: () => getProject()?.root ?? null,
    status: (path) => (getProject()?.root === path ? runner.status : race.backgroundStatus(path)),
    portsOf: race.portsFor,
    requestApproval: hostExtras.requestApproval,
    stopBackground: race.stopBackground,
    emit,
  }));
  const wsPath = z.string().min(1).max(4096);
  const wsFrom = z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("smart"), text: z.string().trim().min(1).max(2000) }),
    z.object({ kind: z.literal("pr"), number: z.number().int().min(1).max(10_000_000) }),
    z.object({ kind: z.literal("branch"), branch: z.string().min(1).max(250).regex(/^[\w./-]+$/).refine((b) => !b.startsWith("-") && !b.includes(".."), "not a branch name") }),
    z.object({ kind: z.literal("name"), name: z.string().trim().min(1).max(120) }),
  ]);
  const wsCreate = z.object({ project: wsPath, from: wsFrom, base: z.string().min(1).max(250).regex(/^[\w./-]+$/).refine((b) => !b.startsWith("-"), "not a branch name").optional(), portOffset: z.number().int().min(100).max(20_000).multipleOf(100).optional(), copyEnv: z.boolean().optional() });
  const knownProject = async (root: string) => {
    if (!(await ws.list()).some((w) => w.projectRoot === root)) throw new Error("Add that project to Shrike first.");
    return root;
  };
  handle("listWorkspaces", none, () => ws.list());
  handle("addWorkspaceProject", none, async () => {
    const root = await pickFolder(win());
    if (!root) return null;
    const key = await ws.remember(root);
    ws.publish();
    return key;
  });
  handle("workspaceSources", z.tuple([wsPath]), async (root) => ws.sources(await knownProject(root)));
  handle("createWorkspace", z.tuple([wsCreate]), async (opts) => ws.create({ ...opts, project: await knownProject(opts.project) }));
  handle("openWorkspace", z.tuple([wsPath]), async (path) => {
    const w = await ws.known(path);
    const p = await race.switchTo(w.path, w.portOffset);
    ws.publish();
    return p;
  });
  handle("workspaceAction", z.tuple([wsPath, z.enum(["folder", "terminal", "stop"])]), async (path, action) => {
    const w = await ws.known(path);
    if (action === "folder") void wsShell.openPath(w.path);
    else if (action === "terminal") wsExec("open", ["-a", "Terminal", w.path], () => {}); // ponytail: macOS Terminal only (the rail hides it elsewhere). Upgrade: the user's own terminal app.
    else if (w.current) await start.stopApp();
    else await race.stopBackground(w.path);
    ws.publish();
  });
  handle("renameWorkspace", z.tuple([wsPath, z.string().max(60)]), async (path, label) => ws.rename((await ws.known(path)).path, label));
  handle("deleteWorkspace", z.tuple([wsPath]), (path) => ws.remove(path));
  // ---- end workspaces ----

  // ---- voice: V1 hearing (ShrikeVoice.app: VAD, Nemotron ASR), V7 the models it loads ----
  const voiceTestArgs = () => {
    try {
      const v: unknown = JSON.parse(process.env.SHRIKE_VOICE_ARGS ?? "null"); // e2e only: ["--fake", "show logs"] or ["--wav", "a.wav"]
      return Array.isArray(v) && v.every((x) => typeof x === "string") ? v : undefined;
    } catch {
      return undefined;
    }
  };
  const voiceModelsDir = joinPath(voiceApp.getPath("userData"), "models");
  const voice = new VoiceHelper({ nativeDir: paths.voiceDir, modelsDir: voiceModelsDir, emit: (e) => emit("voice:event", e), testArgs: voiceTestArgs() });
  voiceApp.on("will-quit", () => voice.close());
  const voiceModels = new VoiceModelStore(voiceModelsDir, (m) => emit("voice:models", m), () => voice.running && voice.send({ cmd: "reload" }));
  voiceApp.on("will-quit", () => void voiceModels.cancel());
  const voiceCmd = z.discriminatedUnion("cmd", [
    z.object({ cmd: z.literal("start"), id: z.number().int().min(0).max(2 ** 31) }),
    z.object({ cmd: z.literal("stop") }),
    z.object({ cmd: z.literal("context"), words: z.array(z.string().max(80)).max(500) }),
    z.object({ cmd: z.literal("auth") }),
    z.object({ cmd: z.literal("hands"), on: z.boolean() }),
    z.object({ cmd: z.literal("config"), langs: z.array(z.string().regex(/^(auto|[a-z]{2,3}(-[A-Z]{2})?)$/)).max(12) }),
    z.object({ cmd: z.literal("arm"), on: z.boolean() }),
    z.object({ cmd: z.literal("reload") }),
  ]);
  handle("voiceSend", z.tuple([voiceCmd]), async (cmd) => voice.send(cmd));
  const voiceModelId = z.enum(["asr", "vad", "turn", "planner"]);
  const modelAct = z.enum(["download", "cancel", "delete"]);
  handle("voiceModels", none, () => voiceModels.list());
  handle("voiceModelAct", z.union([z.tuple([modelAct]), z.tuple([modelAct, voiceModelId.optional()])]), (act, id) =>
    act === "download" ? voiceModels.download(id) : act === "cancel" ? voiceModels.cancel(id) : voiceModels.remove(id),
  );
  const SETTINGS = {
    mic: "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone",
    speech: "x-apple.systempreferences:com.apple.preference.security?Privacy_SpeechRecognition",
    dictation: "x-apple.systempreferences:com.apple.Keyboard-Settings.extension",
  } as const;
  handle("openVoiceSettings", z.tuple([z.enum(["mic", "speech", "dictation"])]), (pane) => voiceShell.openExternal(SETTINGS[pane]));
  // ---- end voice ----
  // ---- voice: V9 the bundled planner (utilityProcess), replaces Jev on the voice path ----
  const planner = new VoicePlanner(joinPath(voiceApp.getPath("userData"), "models"));
  voiceApp.on("will-quit", () => planner.close());
  const planPrefix = z.string().min(1).max(40_000);
  const planRequest = z.object({
    prefix: planPrefix,
    context: z.string().max(8_000),
    text: z.string().trim().min(1).max(500),
    schema: z.record(z.unknown()).refine((v) => JSON.stringify(v).length <= 200_000, "schema too large"),
  });
  handle("voicePlan", z.tuple([planRequest]), (req) => planner.plan(req));
  handle("voicePlanWarm", z.tuple([planPrefix]), (prefix) => planner.warm(prefix));
  // ---- end planner ----
  // themes (Z): the window takes the theme's appearance, so macOS draws visible traffic lights on it, even inactive
  handle("setWindowChrome", z.tuple([z.object({ appearance: z.enum(["system", "dark", "light"]), background: z.string().regex(/^#[0-9a-fA-F]{6}$/), ink: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional() })]), (c) => {
    nativeTheme.themeSource = c.appearance;
    win()?.setBackgroundColor(c.background);
    if (process.platform !== "darwin") win()?.setTitleBarOverlay({ color: c.background, ...(c.ink ? { symbolColor: c.ink } : {}) });
  });

  // ---- xray: X5 context map ----
  xray.connect({ emit, memory: async () => (await hostExtras.getMemory()).map((n) => `- ${n.text}`).join("\n") });
  handle("getContextMap", z.tuple([str]), async (runId) => xray.get(runId));
  // ---- end xray ----

  // ---- inspector: I2/I4 look inside a database or cache lane, read-only, through the process that holds it ----
  inspector.direct = (req) => {
    const root = getProject()?.root;
    return root ? directInspect(root, req) : undefined;
  };
  handle("inspect", z.tuple([inspectRequest]), (req) => inspector.request(req));
  // ---- end inspector ----

  // ---- chains: P1 up next, P2 schedules, P3 conditional chains, P4 chains are skills ----
  const CRITIQUE_MS = 5 * 60_000;
  const anyBrain = async (want?: BrainId) => {
    const b = (await detectBrains()).filter((x) => x.available);
    return (b.find((x) => x.id === want) ?? b.find((x) => x.id === "claude-code") ?? b[0])?.id;
  };
  const chains = (chainsSvc = createChains({
    emit,
    file: () => {
      const root = getProject()?.root;
      return root && skillsJoin(electronApp.getPath("userData"), "chains", `${chainsHash("sha1").update(root).digest("hex").slice(0, 16)}.json`);
    },
    async start(prompt, o) {
      if (o.after && o.target === "branch") {
        const at = (await agentExtras.getRunSteps(o.after.id).catch(() => [])).at(-1);
        if (at) return agentExtras.branchRun(o.after.id, at.id, prompt, emit);
      }
      if (o.after && !o.after.aside) {
        try {
          return await agentExtras.continueRun(o.after.id, prompt, emit);
        } catch (err) {
          if (/still working/.test(String(err))) throw err; // otherwise that run is gone: a fresh one
        }
      }
      const brain = await anyBrain(o.after?.brain);
      if (!brain) throw new Error("No agent is set up. Install Claude Code, or set ANTHROPIC_API_KEY.");
      return startAgent(prompt, brain, emit);
    },
    async critique(run, rubric, o) {
      const brain = await anyBrain(run.brain);
      if (!brain) return null;
      const skill = (await skills.loadSkills(skills.services.dirs()).catch(() => [])).find((s) => s.id === "critique")?.body ?? "";
      const steps = await agentExtras.getRunSteps(run.id).catch(() => []);
      const diff = [...new Set(steps.flatMap((s) => (s.patchId ? [s.patchId] : [])))]
        .flatMap((id) => {
          const p = chainsPatch(id);
          return p?.status === "applied" ? p.files.map((f) => `--- ${f.path} (before)\n${f.before}\n+++ ${f.path} (after)\n${f.after}`) : []; // the critic scores only what shipped
        })
        .join("\n\n");
      let text = "";
      return new Promise((done) => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const end = (r: { score: number; reason: string } | null) => (clearTimeout(timer), done(r));
        if (o.signal.aborted) return end(null);
        o.signal.addEventListener("abort", () => end(null), { once: true });
        startAgent(critiqueAsk({ skill, rubric, goal: run.goal, steps, diff }), brain, emit, {
          readOnly: true, // the critic only reads
          quiet: {
            onStep: (s) => void ((s.kind === "message" || s.kind === "done") && (text += `\n${s.kind === "done" ? (s.detail ?? "") : s.text}`)),
            onEnd: (status) => end(status === "done" ? parseScore(text) : null),
            onUsage: (u) => o.onTokens(u.inputTokens + u.outputTokens),
          },
        }).then(
          (info) => {
            const kill = () => void stopAgent(info.id);
            if (o.signal.aborted) return kill();
            o.signal.addEventListener("abort", kill, { once: true }); // Stop chain, or the budget ran out
            timer = setTimeout(kill, CRITIQUE_MS);
          },
          () => end(null),
        );
      });
    },
    stop: (id) => stopAgent(id),
    outcome: (id, ok, why) => {
      if (ok) void skills.noteSkillUse(id).catch(() => {});
      void skills.settleNow({ expect: "fix", ok, skillIds: [id, "critique"], ...(ok ? {} : { why }) }).catch(() => {}); // drafts of the chain and the critic are kept only when it reached its outcome
    },
  }));
  chains.startTimer();
  wtApp.on("before-quit", () => chains.dispose());
  const upNextWhen = z.union([z.object({ on: z.enum(["finished", "succeeded", "verified", "always", "app", "ci"]) }), z.object({ on: z.literal("time"), at: z.number().int().min(0).max(8.64e15) })]);
  const upNextTarget = z.enum(["main", "branch"]);
  const upNextPrompt = z.string().trim().min(1).max(4000);
  const chainText = z.string().max(4000).optional();
  const chainDef = z.object({
    id: z.string().regex(/^[\w.-]{0,80}$/),
    name: z.string().trim().max(80),
    prompt: z.string().max(4000),
    check: z.enum(["critique", "succeeded", "verified"]),
    rubric: z.string().max(2000),
    threshold: z.number().min(0).max(10),
    below: chainText,
    pass: chainText,
    failed: chainText,
    loop: z.boolean(),
    maxRounds: z.number().int().min(1).max(10),
    budget: z.object({ tokens: z.number().int().min(1000).max(50_000_000).optional(), minutes: z.number().int().min(1).max(1440).optional() }),
  });
  const listChains = async (): Promise<ChainDef[]> => (await skills.loadSkills(skills.services.dirs())).filter((s) => s.kind === "chain").flatMap((s) => chainFromSkill(s) ?? []);
  handle("getChains", none, () => chains.state());
  handle("queuePrompt", z.union([z.tuple([upNextPrompt, upNextWhen]), z.tuple([upNextPrompt, upNextWhen, upNextTarget])]), (p, w, t) => chains.queue(p, w, t));
  handle("editUpNext", z.tuple([str, z.object({ prompt: upNextPrompt.optional(), when: upNextWhen.optional(), target: upNextTarget.optional() }).nullable()]), (id, patch) => chains.edit(id, patch));
  handle("moveUpNext", z.tuple([str, z.number().int().min(0).max(1000)]), (id, i) => chains.move(id, i));
  handle("pauseUpNext", z.tuple([z.boolean()]), (p) => chains.pause(p));
  handle("answerMissed", z.tuple([str, z.boolean()]), (id, yes) => chains.answerMissed(id, yes));
  handle("listChains", none, () => listChains());
  handle("startChain", z.tuple([chainDef]), (d) => chains.startChain(d));
  handle("stopChain", none, () => chains.stopChain());
  handle("saveChain", z.tuple([chainDef, z.enum(["project", "personal"])]), async (d, scope) => {
    const dir = scope === "project" ? joinPath(requireProject().root, ".shrike", "skills") : skills.services.dirs().personal;
    const saved = { ...d, id: chainSlug(d.name || d.prompt) };
    await chainsMkdir(dir, { recursive: true });
    await chainsWrite(joinPath(dir, `${saved.id}.md`), chainSkillText(saved), "utf8");
    await skills.pushUpdate(); // the shelf lists it; the System says [Skill Acquired]
    return saved;
  });
  // ---- end chains ----

  // ---- start-agent: R1–R8, Run driven by Claude (quest checklist, guarded shell, ends with a run skill) ----
  start.configureStart(emit);
  wtApp.on("before-quit", () => void start.shutdownStart());
  handle("getStartPlan", none, async () => start.getStartPlan());
  handle("startApp", none, () => start.startApp());
  handle("stopApp", none, () => start.stopApp());
  handle("getStartSettings", none, async () => start.getStartSettings());
  handle("setStartSettings", z.tuple([z.object({ autoKeep: z.boolean() })]), async (st) => start.setStartSettings(st));
  handle("answerStart", z.tuple([z.string().regex(/^[0-9a-f]{12}$/), z.object({ allow: z.boolean(), always: z.boolean().optional(), values: z.record(z.string().regex(/^[A-Za-z_][A-Za-z0-9_.]*$/), z.string().max(8000)).optional() })]), async (id, a) => start.answerStart(id, a));
  // ---- end start-agent ----

  // ---- options: M1–M6, ask_options cards (mockups, more like this, change, combine, approve) ----
  const options = (optionsSvc = createOptions({
    emit: (sess) => emit("options:update", sess),
    liveRun: () => agentExtras.liveRun(),
    resume: async (runId, text) => (await agentExtras.continueRun(runId, text, emit)).id,
    onApproved: (runId) => skills.noteDesignApproved(runId),
  }));
  hostExtras.host.askOptions = (req) => options.ask(req);
  const card = z.string().min(1).max(40);
  const optionsAnswer = z.discriminatedUnion("action", [
    z.object({ action: z.literal("vary"), card, count: z.number().int().min(1).max(4).optional() }),
    z.object({ action: z.literal("tweak"), card, text: z.string().trim().min(1).max(500) }),
    z.object({ action: z.literal("combine"), cards: z.array(card).min(2).max(8), text: z.string().trim().max(500).optional() }),
    z.object({ action: z.literal("approve"), cards: z.array(card).min(1).max(8) }),
    z.object({ action: z.literal("other"), text: z.string().trim().min(1).max(2000) }),
  ]);
  handle("getOptions", none, async () => options.list());
  handle("answerOptions", z.tuple([z.string().regex(/^[0-9a-f]{8}$/), optionsAnswer]), (id, a) => options.answer(id, a));
  // ---- end options ----

  // ---- quests: QB1–QB9 quest board, plan-feature, L8–L15 build rail ----
  const questDrafts = (q: Quest) => (q.runId ? { runIds: [q.runId] } : { skillIds: ["plan-feature"] }); // only this quest's plan run's drafts
  const quests = (questsSvc = createQuests({
    root: () => getProject()?.root,
    emit: (list) => emit("quests:update", list),
    approve: (title, reason, quest) => hostExtras.requestApproval({ kind: "request", title, reason, ...(quest ? { quest } : {}) }),
    flows: async () => (getProject() ? readFlows(requireProject().root) : []),
    saveFlow: (name, steps) => flowsCtl.save(name, steps),
    runFlow: (id) => flowsCtl.run(id),
    gh: realGh,
    liveRun: () => agentExtras.liveRun(),
    completed: (q) =>
      void (async () => {
        // QB7: the quest ends with a skill: plan-feature's drafts are kept, then [Quest Complete] and the result screen
        const rewards = await skills.settleNow({ expect: "quest", ok: true, ...questDrafts(q) });
        const e = await skills.questComplete(skills.services.dirs(), { quest: `Build: ${q.title}`, since: q.createdAt, skillId: "plan-feature", rewards });
        emit("skill:event", e);
        await progress.questDone({ kind: "build", quest: e.quest ?? q.title, root: getProject()?.root, key: `quest-${q.id}`, ms: (q.completedAt ?? Date.now()) - q.createdAt, firstTry: !q.reds, fixes: q.reds ?? 0, skillsUsed: (e.rewards ?? []).filter((r) => r.kind === "used").length || 1, verified: true, rewards: e.rewards ?? [] });
      })().catch(() => {}),
    dropped: (q) => void skills.settleNow({ expect: "quest", ok: false, why: "the quest was dropped", ...questDrafts(q) }).catch(() => {}),
  }));
  hostExtras.host.quests = quests.host;
  const questId = z.string().regex(/^[0-9a-f]{8}$/);
  const objectiveId = z.string().regex(/^o\d{1,3}$/);
  const questAct = z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("focus") }),
    z.object({ kind: z.literal("drop") }),
    z.object({ kind: z.literal("open-issue") }),
    z.object({ kind: z.literal("link"), objective: objectiveId, flowId: flowId.nullable() }),
    z.object({ kind: z.literal("check"), objective: objectiveId }),
    z.object({ kind: z.literal("sent"), objective: objectiveId, workspace: z.string().max(400).optional() }),
  ]);
  handle("listQuests", none, () => quests.list());
  handle("planQuest", z.tuple([z.string().trim().min(1).max(4000)]), (idea) => quests.plan(idea));
  handle("listIssues", none, () => quests.issues());
  handle("importIssue", z.tuple([z.number().int().min(1).max(10_000_000)]), (n) => quests.importIssue(n));
  handle("questAct", z.tuple([questId, questAct]), (id, a) => quests.act(id, a));
  // ---- end quests ----
  // ---- review-lessons: RL1–RL9 lessons and reviewer profiles from your PRs (gh reads only, never a write) ----
  const LESSONS_MS = 8 * 60_000;
  const lessonsSvc = createReviewLessons({
    root: () => getProject()?.root,
    gh: realGh,
    exec: prExec,
    dir: joinPath(electronApp.getPath("userData"), "review-lessons"),
    skills: () => skills.services.dirs(),
    async skillsChanged() {
      await skills.pushUpdate();
      // the built-in review-lessons is already known, so the rescan sees no new id: [Skill Acquired] for this repo's own copy comes from here
      skills.services.emit("skill:event", skills.skillEvent("acquired", { id: "review-lessons", name: "Review lessons", version: 1 }, 0, { when: "What reviewers keep flagging in your pull requests here, and how to fix it" }));
    },
    guide: () => readText(joinPath(paths.repo, "prompts/skills/review-lessons.md"), "utf8"),
    async ask(prompt) {
      const brain = await anyBrain();
      if (!brain) throw new Error("No agent is set up. Install Claude Code, or set ANTHROPIC_API_KEY.");
      return new Promise<string>((done, fail) => {
        let text = "";
        let timer: ReturnType<typeof setTimeout> | undefined;
        const quiet = {
          onStep: (st: AgentStep) => void ((st.kind === "message" && !st.tool) || st.kind === "done" ? (text += `\n${st.kind === "done" ? (st.detail ?? "") : st.text}`) : 0),
          onEnd: (status: AgentRunInfo["status"]) => (clearTimeout(timer), status === "done" && text.trim() ? done(text) : fail(new Error("Your agent didn't answer. Try again."))),
        };
        startAgent(prompt, brain, emit, { readOnly: true, quiet }).then((info) => void (timer = setTimeout(() => void stopAgent(info.id), LESSONS_MS)), fail); // one-shot and read-only, like the critic
      });
    },
    async startAgent(goal) {
      const brain = await anyBrain();
      if (!brain) throw new Error("No agent is set up. Install Claude Code, or set ANTHROPIC_API_KEY.");
      return agentExtras.startAgentWith(goal, brain, { skillId: "review-lessons" }, emit);
    },
    redact: redactText,
    emit: (v) => emit("lessons:update", v),
    mastered: (m) => {
      emit("lessons:mastered", { lessonId: m.lessonId, title: m.title, clean: m.clean, xp: lessonXp.lessonMastered });
      void progress.earn(m.key, lessonXp.lessonMastered);
    },
  });
  hostExtras.host.selfReview = (r) => lessonsSvc.selfReview(r);
  const lessonText = z.string().max(400);
  handle("reviewLessons", none, () => lessonsSvc.view());
  handle("refreshReviewLessons", z.union([none, z.tuple([z.object({ limit: z.number().int().min(5).max(100).optional() }).strict()])]), (o) => lessonsSvc.refresh(o));
  handle(
    "learnFromComment",
    z.tuple([z.object({ commentId: nodeId, pr: prNumber, author: z.string().min(1).max(100), body: z.string().min(1).max(60_000), at: z.string().datetime(), url: z.string().url().max(2000).optional(), path: lessonText.optional(), line: z.number().int().min(1).max(10_000_000).optional() }).strict()]),
    (c) => lessonsSvc.learn(c),
  );
  handle("selfCheck", z.union([none, z.tuple([z.object({ force: z.boolean().optional() }).strict()])]), (o) => lessonsSvc.selfCheck(o));
  handle("fixSelfCheck", none, () => lessonsSvc.fixSelfCheck());
  // ---- end review-lessons ----

  // ---- ci-lessons: CI1–CI8 pipeline map (gh reads only), CI lessons skill, pre-flight through the guarded shell ----
  const CI_BRAIN_MS = 6 * 60_000;
  const ci = (ciSvc = createCiLessons({
    root: () => getProject()?.root,
    name: () => getProject()?.name,
    gh: realGh,
    exec: prExec,
    state: electronApp.getPath("userData"),
    dirs: () => skills.services.dirs(),
    emit: (st) => emit("ci:update", st),
    mastered: (m) => emit("ci:mastered", m),
    approve: (title, reason) => hostExtras.requestApproval({ kind: "request", title, reason }),
    async brain(prompt) {
      const brain = await anyBrain();
      if (!brain) return null;
      return new Promise<string | null>((done) => {
        let text = "";
        let timer: ReturnType<typeof setTimeout> | undefined;
        const quiet = {
          onStep: (st: AgentStep) => void (st.kind === "message" && !st.tool && st.text.trim() ? (text = st.text) : st.kind === "done" && st.detail?.includes("# ") ? (text = st.detail) : 0),
          onEnd: (status: AgentRunInfo["status"]) => (clearTimeout(timer), done(status === "done" && text.trim() ? text : null)),
        };
        startAgent(prompt, brain, emit, { readOnly: true, quiet }).then((info) => void (timer = setTimeout(() => void stopAgent(info.id), CI_BRAIN_MS)), () => done(null)); // one-shot and read-only, like the critic
      });
    },
    async startAgent(goal, opts) {
      const brain = await anyBrain();
      if (!brain) throw new Error("No agent is set up. Install Claude Code, or set ANTHROPIC_API_KEY.");
      return agentExtras.startAgentWith(goal, brain, opts, emit);
    },
    redact: redactText,
    xp: (key, n) => progress.earn(key, n).then(() => {}),
    ...(Number(process.env.SHRIKE_CI_POLL_MS) > 0 ? { pollMs: Number(process.env.SHRIKE_CI_POLL_MS) } : {}), // ponytail: test-only, like SHRIKE_SAVE_DIR
  }));
  hostExtras.host.preflight = () => ci.hostText();
  wtApp.on("before-quit", () => ci.dispose());
  handle("ciLessons", z.union([none, z.tuple([z.object({ refresh: z.boolean().optional() }).strict()])]), (o) => ci.state(o));
  handle("ciLearn", z.union([none, z.tuple([z.object({ check: z.string().min(1).max(300), url: z.string().url().max(2000).refine((u) => /^https:\/\/github\.com\//.test(u), "a GitHub link").optional() }).strict()])]), (from) => ci.learn(from));
  handle("preflight", none, () => ci.preflight());
  handle("stopPreflight", none, async () => ci.stop());
  handle("ciFixLeg", z.tuple([z.string().min(1).max(600)]), (job) => ci.fix(job));
  // ---- end ci-lessons ----

  // ---- mcp: MCP1 to MCP8, the tools hub. Writes only Shrike's own config; secrets go to the keychain; installs go through the guarded shell ----
  const hub = (mcpHub = createMcpHub({ home: homedir(), stateDir: electronApp.getPath("userData"), keychain, check: async (c, o) => checkMcpServer(c, { ...o, path: await mcpLoginPath() }) }));
  agentExtras.useMcpHub((root) => hub.servers(root));
  const mcpRoot = () => getProject()?.root ?? homedir();
  const installing = new Set<string>();
  const signals = async () => {
    const p = getProject();
    if (!p) return undefined;
    const pkg = await mcpRead(joinPath(p.root, "package.json"), "utf8").then((t) => JSON.parse(t) as Record<string, Record<string, string> | undefined>, () => ({}) as Record<string, undefined>);
    const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
    const github = /github\.com[:/]/.test(await mcpRead(joinPath(p.root, ".git", "config"), "utf8").catch(() => ""));
    return { places: p.expectedPlaces, deps, github };
  };
  const mcpView = async () => {
    const st = await hub.state(mcpRoot(), await signals());
    return { ...st, servers: st.servers.map((x) => (installing.has(x.name) ? { ...x, health: { state: "checking" as const, at: Date.now() } } : x)) };
  };
  let pushTimer: ReturnType<typeof setTimeout> | undefined;
  const mcpPush = () => {
    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => void mcpView().then((v) => emit("mcp:update", v), () => {}), 80);
  };
  const children = new Set<ReturnType<typeof mcpSpawn>>();
  wtApp.on("before-quit", () => children.forEach((c) => mcpKill(c.pid, "SIGKILL")));
  /** A catalog install (warming the npm or uv cache), judged by the guarded shell first. Three minutes at most. */
  const install = async (cmd: string, cwd: string): Promise<string | null> => {
    const j = mcpJudge(cmd, { root: cwd, cwd });
    if (j.verdict === "never") return j.why;
    const PATH = await mcpLoginPath();
    return new Promise((done) => {
      const child = mcpSpawn(cmd, { cwd, env: { ...process.env, ...(PATH ? { PATH } : {}) }, detached: true, stdio: ["ignore", "pipe", "pipe"] });
      children.add(child);
      let tail = "";
      const keep = (c: Buffer) => void (tail = (tail + c.toString("utf8")).slice(-2000));
      child.stdout?.on("data", keep);
      child.stderr?.on("data", keep);
      const timer = setTimeout(() => mcpKill(child.pid, "SIGKILL"), 180_000);
      const end = (ok: boolean) => (clearTimeout(timer), children.delete(child), done(ok ? null : redactText(tail.trim().split("\n").at(-1) ?? "The install didn't finish.")));
      child.on("close", (code) => end(code === 0));
      child.on("error", () => end(false));
    });
  };
  const where = (p: AddPlan) => (p.scope === "personal" ? "your own tools (~/.shrike/mcp.json)" : "this project's tools (.shrike/mcp.json)");
  const what = (p: AddPlan) => redactText(typeof p.config.url === "string" ? `connects to ${p.config.url}` : `runs ${[p.config.command, ...((p.config.args as string[] | undefined) ?? [])].join(" ")}`);
  handle("mcpState", none, () => mcpView());
  handle("mcpCheck", z.union([none, z.tuple([mcpName])]), async (name) => {
    void hub.check(mcpRoot(), name, mcpPush).catch(() => {});
    return mcpView();
  });
  handle("mcpSetEnabled", z.tuple([mcpName, z.boolean()]), async (name, on) => (await hub.setEnabled(mcpRoot(), name, on), mcpView()));
  handle("mcpTrust", z.tuple([mcpName]), async (name) => {
    await hub.trust(mcpRoot(), name);
    void hub.check(mcpRoot(), name, mcpPush).catch(() => {});
    return mcpView();
  });
  handle("mcpDismiss", z.tuple([mcpName]), async (id) => (await hub.dismiss(mcpRoot(), id), mcpView()));
  // MCP9: use Shrike from your own Claude Code. Text to copy only; nothing here writes Claude Code's files.
  handle("connectInfo", none, () => agentExtras.connectInfo());
  handle("connectResetToken", none, () => agentExtras.resetConnectToken());
  agentExtras.useConnectPush(() => void agentExtras.connectInfo().then((c) => emit("connect:update", c), () => {}));
  handle("mcpRemove", z.tuple([mcpName]), async (name) => (await hub.remove(mcpRoot(), name), mcpView()));
  handle("mcpAdd", z.tuple([z.unknown()]), async (req) => {
    const root = mcpRoot();
    const plans = await hub.plan(root, req as Parameters<typeof hub.plan>[1]); // zod-parsed inside
    const names = plans.map((p) => p.name).join(", ");
    const secrets = [...new Set(plans.flatMap((p) => Object.keys(p.values)))];
    const steps = plans.find((p) => p.install)?.install;
    const reason = [
      ...plans.map((p) => `${p.name} ${what(p)}, saved in ${where(p)}${p.replaces ? `, in place of the one from ${p.replaces.replace("-", " ")}` : ""}.`),
      secrets.length ? `${secrets.join(", ")} go${secrets.length === 1 ? "es" : ""} to your Mac's keychain, not the file.` : "",
      steps ? `First Shrike downloads it: ${steps} (${mcpJudge(steps, { root, cwd: root }).why.toLowerCase()}).` : "",
      "Claude Code's own settings are not touched.",
    ].filter(Boolean).join(" ");
    if (!(await hostExtras.requestApproval({ kind: "request", title: `Add ${names} to your agent's tools?`, reason }))) return mcpView();
    await hub.commit(root, plans);
    for (const p of plans) {
      installing.add(p.name);
      void (async () => {
        const failed = p.install ? await install(p.install, root) : null;
        installing.delete(p.name);
        if (failed) flowsNotify("A tool didn't download", `${p.name}: ${failed}`);
        await hub.check(root, p.name, mcpPush);
      })().catch(() => installing.delete(p.name));
    }
    return mcpView();
  });
  handle("mcpFix", z.tuple([mcpName]), async (name) => {
    const s = await hub.describe(mcpRoot(), name);
    if (!s) throw new Error(`There's no tool server called ${name}.`);
    const brain = await anyBrain();
    if (!brain) throw new Error("No agent is set up. Install Claude Code, or set ANTHROPIC_API_KEY.");
    const how = s.transport === "stdio" ? `it starts with: ${s.command}` : `it lives at ${s.url}`;
    const goal = `My MCP tool server "${name}" isn't working in Shrike. Shrike's check said: ${s.health?.error ?? (s.missing.length ? `it needs ${s.missing.join(", ")}` : "it didn't start")}. It comes from ${s.source.replace("-", " ")} settings and ${how}${s.envNames.length ? `, with these settings: ${s.envNames.join(", ")}` : ""}. Explain in plain words what's wrong and exactly what I should change or install. Don't guess secret values.`;
    return agentExtras.startAgentWith(goal, brain, {}, emit);
  });
  mcpObserve = (step) => {
    const server = mcpServerOfStep(step);
    if (!server) return;
    void (async () => {
      if (!(await progress.earn(`mcp:${server}`, mcpXp.toolUnlocked))) return;
      const glyph = (await hub.state(mcpRoot())).servers.find((x) => x.name === server)?.glyph ?? "plug";
      emit("mcp:unlocked", { server, glyph, xp: mcpXp.toolUnlocked });
    })().catch(() => {});
  };
  // ---- end mcp ----

  // ---- api: AP the API client ----
  const pick = async (title: string, props: ("openDirectory" | "openFile")[], exts?: string[]) => {
    const w = win();
    const opts = { title, properties: props, ...(exts ? { filters: [{ name: exts.join(", "), extensions: exts }] } : {}) };
    const r = w ? await apiDialog.showOpenDialog(w, opts) : await apiDialog.showOpenDialog(opts);
    return r.canceled ? undefined : r.filePaths[0];
  };
  const apiSvc = createApi({
    stateDir: () => apiApp.getPath("userData"),
    projectRoot: () => getProject()?.root,
    keychain: {
      encrypt: (v) => {
        if (!apiSafe.isEncryptionAvailable()) throw new Error("No keychain on this machine, so secret values can't be saved.");
        return apiSafe.encryptString(v).toString("base64");
      },
      decrypt: (v) => apiSafe.decryptString(Buffer.from(v, "base64")),
    },
    store,
    baseUrl: () => hostExtras.appBaseUrl(),
    liveOrigins: () => hostExtras.liveOrigins(),
    routes: () => getProject()?.routes ?? [],
    getAction: (id) => store.getAction(id),
    pickFolder: (title) => pick(title, ["openDirectory"]),
    pickFile: (title, exts) => pick(title, ["openFile"], exts),
    // AP22: one-shot and read-only, like the critic (send_request and save_request are write tools)
    async ask(prompt) {
      const brain = await anyBrain();
      if (!brain) throw new Error("No agent is set up. Install Claude Code, or set ANTHROPIC_API_KEY.");
      return new Promise<string>((done, fail) => {
        let text = "";
        let timer: ReturnType<typeof setTimeout> | undefined;
        const quiet = {
          onStep: (st: AgentStep) => void ((st.kind === "message" && !st.tool) || st.kind === "done" ? (text += `\n${st.kind === "done" ? (st.detail ?? "") : st.text}`) : 0),
          onEnd: (status: AgentRunInfo["status"]) => (clearTimeout(timer), status === "done" && text.trim() ? done(text) : fail(new Error("Your agent didn't answer. Try again."))),
        };
        startAgent(prompt, brain, emit, { readOnly: true, quiet }).then((info) => void (timer = setTimeout(() => void stopAgent(info.id), 5 * 60_000)), fail);
      });
    },
  });
  hostExtras.host.api = apiSvc.host;
  const apiName = z.string().trim().min(1).max(200);
  handle("apiCollections", none, () => apiSvc.collections());
  handle("apiCreateCollection", z.tuple([apiName]), (name) => apiSvc.createCollection(name));
  handle("apiLinkCollection", none, () => apiSvc.linkCollection());
  handle("apiUnlinkCollection", z.tuple([idZ]), (id) => apiSvc.unlinkCollection(id));
  handle("apiReadRequest", z.tuple([idZ, relZ]), (id, path) => apiSvc.readRequest(id, path));
  handle("apiSaveRequest", z.union([z.tuple([idZ, requestZ]), z.tuple([idZ, requestZ, relZ.optional()])]), (id, req, folder) => apiSvc.saveRequest(id, req, folder));
  handle("apiDeleteItem", z.tuple([idZ, relZ.min(1)]), (id, path) => apiSvc.deleteItem(id, path));
  handle("apiCreateFolder", z.tuple([idZ, relZ.min(1)]), (id, path) => apiSvc.createFolder(id, path));
  handle("apiRenameItem", z.tuple([idZ, relZ.min(1), apiName]), (id, path, name) => apiSvc.renameItem(id, path, name));
  handle("apiReadEnvironment", z.tuple([idZ, apiName]), (id, name) => apiSvc.readEnvironment(id, name));
  handle("apiSaveEnvironment", z.tuple([idZ, envZ]), (id, env) => apiSvc.saveEnvironment(id, env));
  handle("apiSend", z.union([z.tuple([requestZ]), z.tuple([requestZ, sendOptsZ])]), (req, opts) => apiSvc.send(req, opts));
  handle("apiCancel", z.tuple([z.string().min(1).max(128)]), (id) => apiSvc.cancel(id));
  handle("apiHistory", none, () => apiSvc.history());
  handle("apiClearHistory", none, () => apiSvc.clearHistory());
  // bruno always goes through the folder dialog; a path from the page is never trusted
  handle("apiImport", z.union([z.tuple([importKindZ]), z.tuple([importKindZ, z.string().max(20 * 1024 * 1024).optional()]), z.tuple([importKindZ, z.string().max(20 * 1024 * 1024).optional(), apiName.optional()])]), (kind, text, name) =>
    apiSvc.import(kind, kind === "bruno" ? undefined : text, name),
  );
  handle("apiCode", z.union([z.tuple([requestZ, codeLangZ]), z.tuple([requestZ, codeLangZ, sendOptsZ])]), (req, lang, opts) => apiSvc.code(req, lang, opts));
  // ponytail: the picked path goes back to the page and returns in a multipart field; main reads whatever path the page sends. Upgrade: hand out file tokens.
  handle("apiPickFile", none, async () => (await pick("Pick a file to send", ["openFile"])) ?? null);
  handle("apiRoutes", z.union([none, z.tuple([z.boolean().optional()])]), (refresh) => apiSvc.routes(refresh));
  handle("apiGuessRoutes", z.tuple([routeRefsZ]), (routes) => apiSvc.guessRoutes(routes));
  handle("apiSaveGuess", z.tuple([routeGuessZ]), (g) => apiSvc.saveGuess(g));
  handle("apiSaveResponse", z.tuple([z.instanceof(Uint8Array).refine((b) => b.byteLength <= 64 * 1024 * 1024, "body is too big"), z.string().max(120)]), (bytes, name) => saveResponseBody(win(), bytes, name));
  // ---- end api ----
}
