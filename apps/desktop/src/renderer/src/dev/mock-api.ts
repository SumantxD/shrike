// Fake window.shrike for working on the renderer in a plain browser. Installed only when the preload
// didn't provide one, so it never runs inside the real app.
import type {
  ActionView,
  ChainDef,
  ChainEvent,
  ChainsState,
  RecipeSettings,
  AgentRunInfo,
  AgentStep,
  ApprovalRequest,
  BrainId,
  Checkpoint,
  DebugEvent,
  FileNode,
  Flag,
  Flow,
  GitState,
  PullRequest,
  Race,
  Skill,
  Worktree,
  Workspace,
  HttpRequestSpec,
  MemoryNote,
  Patch,
  PointPick,
  ProjectInfo,
  RunStatus,
  ShrikeApi,
  ShrikeEvents,
  StartPlan,
  StartSettings,
  StartStep,
  SourceLocation,
  TimelineNode,
  WhatHappened,
  VoiceModel,
  VoiceModels,
} from "@shrike/schema";
import { files, MOCK_ROOT } from "./mock-files.ts";
import { issueMarkdown, failingLocation } from "../hud/logic.ts";
import { sdlc } from "../../../main/sdlc.ts";
import { rankOf } from "../system/ranks.ts";
import { ACTIONS, changedFrom, merged, parseArgs } from "../recipes/catalog.ts"; // action-recipes: S8
import { CARDS, scoreQuest, titleOf, XP_TABLE, type QuestFacts } from "../progress/xp.ts";
import { blankChain, moveItem, tidy, whenLabel } from "../chains/logic.ts"; // chains: P
import { addRound, answerProblem, roundFor } from "../options/logic.ts"; // options: M
import type { OptionInput, OptionsSession } from "@shrike/schema";
import { prMock } from "../pr/mock.ts"; // pr-ci: PR1–PR10
import { lessonsMock } from "../lessons/review/mock.ts"; // review-lessons: RL
import { mockScm, onMockScm } from "./mock-scm.ts"; // scm: SC
import { onMockQuests, questsMock } from "../quests/mock.ts"; // quests: QB
import { mcpMock, onMockMcp } from "../mcp/mock.ts"; // mcp: MCP
import { ciMock, onMockCi } from "../lessons/ci/mock.ts"; // ci-lessons: CI
import { apiClientMock } from "./mock-api-client.ts"; // api: AP

// options: M1–M4, in memory. ponytail: a canned agent that answers in 700ms; the real loop is main/options.ts + ask_options.
const optionSessions = new Map<string, OptionsSession>();
const todoMock = (o: { accent: string; layout: "list" | "cards" | "compact"; title?: string }): string => {
  const items = ["Fix the signup page on mobile", "Write the release notes", "Call the bank"];
  const row = (t: string, i: number) =>
    o.layout === "cards"
      ? `<div style="padding:14px;border-radius:12px;background:#fff;box-shadow:0 2px 8px #0001;border-top:3px solid ${o.accent}">${t}</div>`
      : `<div style="display:flex;gap:10px;align-items:center;padding:${o.layout === "compact" ? 6 : 12}px 4px;border-bottom:1px solid #eee"><span style="width:16px;height:16px;border:2px solid ${o.accent};border-radius:${i ? 4 : 50}px"></span>${t}</div>`;
  return `<div style="font-family:system-ui;padding:20px;background:#f6f7fb;min-height:100vh;color:#1d2433"><h1 style="font-size:22px;margin:0 0 14px">${o.title ?? "My todos"}</h1><div style="display:flex;gap:8px;margin-bottom:14px"><input placeholder="What needs doing?" style="flex:1;padding:10px;border:1px solid #ccd;border-radius:8px"><button style="padding:10px 16px;border:0;border-radius:8px;background:${o.accent};color:#fff;font-weight:600">Add Todo</button></div><div style="display:${o.layout === "cards" ? "grid" : "block"};grid-template-columns:1fr 1fr;gap:10px">${items.map(row).join("")}</div></div>`;
};
const MOCK_OPTIONS: OptionInput[] = [
  { label: "Clean list", description: "One column, round checkboxes, lots of air", mockupHtml: todoMock({ accent: "#4f46e5", layout: "list" }) },
  { label: "Cards", description: "Each todo is a card in a two-column grid", mockupHtml: todoMock({ accent: "#0ea5e9", layout: "cards" }) },
  { label: "Compact", description: "Dense rows for long lists", mockupHtml: todoMock({ accent: "#16a34a", layout: "compact" }) },
];
function mockOptionsAsk(question: string): void {
  const s0: OptionsSession = { id: hex(8), question, header: "Layout", multi: false, cards: {}, rounds: [], state: "asking", waiting: true, at: Date.now(), ...(agentRun ? { runId: agentRun.id } : {}) };
  const s = addRound(s0, { kind: "start", from: [] }, MOCK_OPTIONS);
  optionSessions.set(s.id, s);
  emit("options:update", s);
}

// chains: P1–P4, in memory. ponytail: queued prompts never fire here; the real engine is main/chains.ts.
let chainsState: ChainsState = { items: [], paused: false, chain: null };
const pushChains = (e?: Omit<ChainEvent, "at">) => {
  chainsState = { ...chainsState, items: tidy(chainsState.items) };
  emit("chains:update", chainsState);
  if (e) emit("chains:event", { ...e, at: Date.now() });
  return chainsState;
};
const MOCK_CHAINS: ChainDef[] = [
  { ...blankChain(), id: "polish-until-8", name: "Build, critique, polish until 8/10" },
  { ...blankChain(), id: "fix-verify-test", name: "Fix, verify, then write tests", check: "verified", pass: "Write tests for this fix.", below: undefined, loop: false },
];

type Listener = (p: unknown) => void;
const listeners = new Map<string, Set<Listener>>();
let voiceTimer: ReturnType<typeof setInterval> | undefined;
let voiceModels: VoiceModels = {
  freeBytes: 6_400_000_000,
  models: [
    { id: "asr", name: "Nemotron 3.5 ASR Streaming 0.6B", license: "OpenMDW-1.1", bytes: 640_000_000, state: "missing" },
    { id: "vad", name: "Silero VAD v6", license: "MIT", bytes: 2_200_000, state: "missing" },
    { id: "turn", name: "Smart Turn v3.2", license: "BSD-2", bytes: 8_700_000, state: "missing" },
    { id: "planner", name: "Qwen3 1.7B planner", license: "Apache-2.0", bytes: 1_300_000_000, state: "missing" },
  ],
};

function emit<K extends keyof ShrikeEvents>(ch: K, payload: ShrikeEvents[K]): void {
  listeners.get(ch)?.forEach((cb) => cb(payload));
  if (ch !== "sdlc:update") sdlc.observe(ch, payload); // the same rail logic as main
}
sdlc.connect({ actions: () => [...actions.values()], emit, flows: async () => flows });
onMockScm((s) => emit("scm:update", s));
onMockMcp((s) => emit("mcp:update", s));
onMockQuests((l) => emit("quests:update", l));
onMockCi((s) => emit("ci:update", s));

const hex = (n: number): string => Array.from(crypto.getRandomValues(new Uint8Array(n / 2)), (b) => b.toString(16).padStart(2, "0")).join("");
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const at = (file: string, line: number, precision: SourceLocation["precision"] = "exact"): SourceLocation => ({ file, line, precision });

let project: ProjectInfo | null = null;
let status: RunStatus = { state: "idle" };
const actions = new Map<string, ActionView>();
let fixed = false;
const patches = new Map<string, Patch>();
const pendingApprovals = new Map<string, (ok: boolean) => void>();
let agentTimer = 0;
let agentRun: AgentRunInfo | null = null;
let memory: MemoryNote[] = [{ id: "m1", text: "userId must be a number", file: "server/todos.controller.ts", line: 18, createdAt: Date.now() - 3_600_000, by: "agent" }];
const checkpoints: Checkpoint[] = [];
const skills: Skill[] = [
  { id: "bad-value", name: "Bad value", when: "A value is wrong or missing somewhere along the trip", source: "builtin", uses: 7, version: 2, kind: "debug" },
  { id: "n-plus-one", name: "N+1 hunter", when: "The same database question is asked many times", source: "builtin", uses: 3, kind: "debug" },
  { id: "slow-page", name: "Slow page", when: "A trip takes longer than it should", source: "builtin", uses: 1, kind: "debug" },
  { id: "auth", name: "Auth", when: "Logins, sessions or permissions fail", source: "builtin", uses: 0, kind: "debug" },
  { id: "ship-this-fix", name: "Ship this fix", when: "Branch, commit, push and open a PR for a verified fix", source: "builtin", uses: 2, kind: "git" },
];
const skillLog: ShrikeEvents["skill:event"][] = [];
const mockDrafts: import("@shrike/schema").SkillDraft[] = [{ id: "mockpending", skillId: "bad-value", name: "Bad value", reason: "Check the form field names before the server code", expect: "fix", at: Date.now() - 600_000, status: "pending", missed: "the fix wasn't verified" }];
function sysEvent(kind: ShrikeEvents["skill:event"]["kind"], s: Skill, extra: Partial<ShrikeEvents["skill:event"]> = {}): void {
  if (kind === "used") s.proficiency = (s.proficiency ?? 0) + 1;
  const r = rankOf(s.version, s.proficiency);
  const e = { kind, skillId: s.id, name: s.name, level: r.level, rank: r.rank, proficiency: r.proficiency, ...(r.nextRankAt !== undefined ? { nextRankAt: r.nextRankAt } : {}), at: Date.now(), ...extra };
  skillLog.push(e);
  emit("skill:event", e);
}
const recipeSaved: Record<"project" | "personal", Record<string, RecipeSettings>> = { project: {}, personal: {} }; // action-recipes: S8, in memory
const recipeList = () => ACTIONS.map((x) => merged(x, recipeSaved.personal, recipeSaved.project));
let commands: { name: string; prompt: string }[] = [{ name: "why-slow", prompt: "Why is this trip slow? Point at the step that takes the longest." }];
let flows: Flow[] = [
  { id: "add-todo", name: "Add a todo", steps: [{ type: "type", name: "New todo", text: "buy milk" }, { type: "click", name: "Add Todo" }] },
  { id: "tick-todo", name: "Tick a todo", steps: [{ type: "click", name: "call the dentist" }] },
];
let git: GitState = { isRepo: true, branch: "main", upstream: "origin/main", ahead: 0, behind: 0, changed: [], conflicts: [], ghReady: true };
const setGit = (p: Partial<GitState>): GitState => {
  git = { ...git, ...p };
  emit("git:update", git);
  return git;
};
let worktrees: Worktree[] = [{ name: "main", path: MOCK_ROOT, branch: "main", current: true, running: true, portOffset: 0 }];
const ws = (w: Partial<Workspace> & Pick<Workspace, "name" | "branch" | "group">): Workspace => ({ path: `${MOCK_ROOT}/.shrike/worktrees/${w.name}`, projectRoot: MOCK_ROOT, project: "todo-app", kind: "shrike", current: false, running: false, portOffset: 0, agent: "idle", changes: 0, ...w });
let workspaces: Workspace[] = [
  ws({ name: "main", path: MOCK_ROOT, kind: "main", branch: "main", group: "idle", current: true, running: true, port: 5173, ahead: 0, behind: 2 }),
  ws({ name: "fix-userid", branch: "shrike/fix-userid", group: "needs-you", agent: "waiting", running: true, port: 5273, portOffset: 100, changes: 1 }),
  ws({ name: "try-cents", branch: "shrike/try-cents", group: "working", agent: "working", running: true, port: 5373, portOffset: 200 }),
  ws({ name: "pr-42", branch: "fix/add-todo", group: "review", pr: { number: 42, state: "open", url: "https://github.com/acme/todo/pull/42" }, ahead: 3, behind: 0, portOffset: 300, note: "PR #42" }),
  ws({ name: "main", path: "/Users/you/shop-app", projectRoot: "/Users/you/shop-app", project: "shop-app", kind: "main", branch: "trunk", group: "done", agent: "done", pr: { number: 17, state: "merged", url: "https://github.com/acme/shop/pull/17" } }),
];
const BACKEND = new URLSearchParams(location.search).has("backend");

// O1 in the mock: MockApp draws the outline and calls mockPicked; the real app does this inside the page.
const pointSubs = new Set<() => void>();
let mockPointing = false;
export const mockPoint = {
  get: () => mockPointing,
  subscribe(cb: () => void) {
    pointSubs.add(cb);
    return () => void pointSubs.delete(cb);
  },
  set(v: boolean) {
    mockPointing = v;
    pointSubs.forEach((cb) => cb());
  },
};
export function mockPicked(pick: PointPick | null): void {
  mockPoint.set(false);
  if (pick) emit("point:picked", pick);
  else emit("point:cancelled", null);
}

const ROUTES = [
  { method: "GET", path: "/api/health", handler: at("server/index.ts", 7) },
  { method: "GET", path: "/api/todos", handler: at("server/index.ts", 8) },
  { method: "POST", path: "/api/todos", handler: at("server/index.ts", 9) },
  { method: "PATCH", path: "/api/todos/:id", handler: at("server/index.ts", 10) },
  { method: "DELETE", path: "/api/todos/:id", handler: at("server/index.ts", 11) },
];

const todos = [
  { id: 1, title: "buy bread", done: true, user_id: 1 },
  { id: 2, title: "call the dentist", done: false, user_id: 1 },
  { id: 3, title: "renew passport", done: false, user_id: 1 },
  { id: 4, title: "water the plants", done: false, user_id: 1 },
  { id: 5, title: "book train tickets", done: false, user_id: 1 },
];

// Where "Add Todo" sits in the fake app, in CSS px of a 440x640 viewport (see shot()).
const ADD_BUTTON = { x: 318, y: 82, width: 90, height: 36, viewportWidth: 440, viewportHeight: 640 };

/** A PNG of the fake app as it looked at the click, drawn to match MockApp. */
function shot(): string | null {
  const c = document.createElement("canvas");
  const k = 2;
  c.width = ADD_BUTTON.viewportWidth * k;
  c.height = ADD_BUTTON.viewportHeight * k;
  const g = c.getContext("2d");
  if (!g) return null;
  g.scale(k, k);
  g.fillStyle = "#fff";
  g.fillRect(0, 0, 440, 640);
  g.fillStyle = "#14161c";
  g.font = "bold 22px Inter Variable, system-ui, sans-serif";
  g.fillText("My Todos", 32, 60);
  g.strokeStyle = "#cfd4dd";
  g.lineWidth = 1;
  g.beginPath();
  g.roundRect(32, 82, 278, 36, 6);
  g.stroke();
  g.font = "14px Inter Variable, system-ui, sans-serif";
  g.fillText("buy milk", 42, 105);
  g.beginPath();
  g.roundRect(ADD_BUTTON.x, ADD_BUTTON.y, ADD_BUTTON.width, ADD_BUTTON.height, 6);
  g.fill();
  g.fillStyle = "#fff";
  g.font = "500 14px Inter Variable, system-ui, sans-serif";
  g.fillText("Add Todo", ADD_BUTTON.x + 14, 105);
  todos.forEach((t, i) => {
    const y = 150 + i * 28;
    g.strokeStyle = "#8a90a2";
    g.strokeRect(34, y - 11, 13, 13);
    g.fillStyle = t.done ? "#8a90a2" : "#14161c";
    g.font = "14px Inter Variable, system-ui, sans-serif";
    g.fillText(t.title, 56, y);
  });
  return c.toDataURL("image/png");
}

/** Builds events relative to one trace with a moving clock. */
function tracer(t0: number) {
  const traceId = hex(32);
  const make = (e: Partial<DebugEvent> & Pick<DebugEvent, "kind" | "name" | "origin">, start: number, dur?: number): DebugEvent => ({
    id: hex(16),
    traceId,
    status: "ok",
    startMs: t0 + start,
    durationMs: dur,
    ...e,
  });
  const n = (event: DebugEvent, children: TimelineNode[] = []): TimelineNode => {
    for (const c of children) c.event.parentId = event.id;
    return { event, children };
  };
  return { traceId, make, n };
}

function view(root: DebugEvent, tree: TimelineNode[], summary: WhatHappened, flags: Flag[] = [], complete = true): ActionView {
  for (const c of tree) c.event.parentId = root.id;
  return {
    id: root.id,
    traceId: root.traceId,
    trigger: root.trigger ?? "click",
    label: root.name,
    startMs: root.startMs,
    durationMs: root.durationMs ?? 0,
    status: root.status,
    complete,
    tree,
    root,
    summary,
    flags,
  };
}

function pageLoad(t0: number): ActionView {
  const { make, n } = tracer(t0);
  const root = make({ kind: "user_action", origin: "browser", name: "Opened /", trigger: "navigation", source: at("src/main.tsx", 5) }, 0, 71);
  const users = Array.from({ length: todos.length }, (_, i) => {
    const s = 18 + i * 8;
    return n(make({ kind: "function", origin: "server", name: "findUser()", source: at("server/db.ts", 13), callSite: at("server/todos.controller.ts", 8), args: ["1"], returned: "{ id: 1, name: 'Sam' }" }, s, 7), [
      n(make({ kind: "db_query", origin: "db", name: "SELECT * FROM users WHERE id = ?", db: { system: "sqlite", statement: "SELECT * FROM users WHERE id = ?", params: "[ 1 ]" }, source: at("server/db.ts", 14) }, s + 1, 6)),
    ]);
  });
  const select = make({ kind: "db_query", origin: "db", name: "SELECT * FROM todos", db: { system: "sqlite", statement: "SELECT * FROM todos" }, source: at("server/db.ts", 10) }, 10, 5);
  const body = JSON.stringify(todos.map((t) => ({ ...t, user: { id: 1, name: "Sam" } })));
  const browserReq = make(
    {
      kind: "http_request",
      origin: "browser",
      name: "GET /api/todos",
      source: at("src/api.ts", 8),
      http: { method: "GET", url: "/api/todos", status: 200, reqHeaders: { accept: "*/*" }, resHeaders: { "content-type": "application/json; charset=utf-8", "content-length": String(body.length) }, resBody: body },
    },
    3,
    66,
  );
  const serverReq = make(
    { kind: "http_request", origin: "server", name: "GET /api/todos", source: at("server/index.ts", 8), http: { method: "GET", url: "/api/todos", status: 200, resBody: body } },
    6,
    60,
  );
  const getTodos = make({ kind: "function", origin: "server", name: "getTodos()", source: at("server/todos.controller.ts", 4), args: ["req { GET /api/todos }", "res"], returned: "undefined" }, 8, 56);
  const listTodos = make({ kind: "function", origin: "server", name: "listTodos()", source: at("server/db.ts", 9), callSite: at("server/todos.controller.ts", 5), args: [], returned: `[ { id: 1, title: 'buy bread', … }, … 4 more ]` }, 9, 7);
  const tree = [n(browserReq, [n(serverReq, [n(getTodos, [n(listTodos, [n(select)]), ...users])])])];
  const flag: Flag = {
    kind: "n_plus_one",
    eventId: users[0]!.children[0]!.event.id,
    message: `The same database question was asked ${todos.length} times in a row (SELECT * FROM users WHERE id = ?).`,
    source: at("server/todos.controller.ts", 8),
  };
  return view(
    root,
    tree,
    {
      headline: "You opened /. Everything worked (71ms).",
      steps: [
        { ok: true, text: "Your app asked the server for the todo list (GET /api/todos)", eventId: browserReq.id, source: at("src/api.ts", 8) },
        { ok: true, text: "The server ran getTodos()", eventId: getTodos.id, source: at("server/todos.controller.ts", 4) },
        { ok: true, text: `Read ${todos.length} todos from the database`, eventId: select.id, source: at("server/db.ts", 10) },
        { ok: true, text: `Looked up the user ${todos.length} times, once per todo`, eventId: users[0]!.event.id, source: at("server/todos.controller.ts", 8) },
        { ok: true, text: "The server answered OK (200)", eventId: serverReq.id },
      ],
      stats: { files: 4, functions: 2 + todos.length, requests: 2, queries: 1 + todos.length, logs: 0, errors: 0, totalMs: 71 },
    },
    [flag],
  );
}

function addTodo(t0: number, title: string, trigger: "click" | "agent" = "click"): ActionView {
  const { make, n } = tracer(t0);
  const ok = fixed;
  const root = make({ kind: "user_action", origin: "browser", name: 'Clicked "Add Todo"', trigger, status: ok ? "ok" : "error", source: at("src/TodoForm.tsx", 31), target: ADD_BUTTON }, 0, ok ? 24 : 48);
  const reqBody = JSON.stringify({ title, userId: 1 });
  const errMsg = "NOT NULL constraint failed: todos.user_id";
  const resBody = ok ? JSON.stringify({ id: 6, title, done: false, user_id: 1 }) : JSON.stringify({ error: errMsg });
  const code = ok ? 201 : 500;
  const browserReq = make(
    {
      kind: "http_request",
      origin: "browser",
      name: "POST /api/todos",
      status: ok ? "ok" : "error",
      source: at("src/api.ts", 12),
      http: {
        method: "POST",
        url: "/api/todos",
        status: code,
        reqHeaders: { "content-type": "application/json", accept: "*/*", traceparent: `00-${root.traceId}-${hex(16)}-01` },
        resHeaders: { "content-type": "application/json; charset=utf-8", "content-length": String(resBody.length), "x-powered-by": "Express" },
        reqBody,
        resBody,
      },
    },
    2,
    ok ? 20 : 45,
  );
  const serverReq = make(
    { kind: "http_request", origin: "server", name: "POST /api/todos", status: ok ? "ok" : "error", source: at("server/index.ts", 9), http: { method: "POST", url: "/api/todos", status: code, reqBody, resBody } },
    5,
    ok ? 15 : 40,
  );
  const create = make(
    { kind: "function", origin: "server", name: "createTodo()", source: at("server/todos.controller.ts", 14), args: [`req { POST /api/todos body: { title: '${title}', userId: 1 } }`, "res"], returned: "undefined" },
    6,
    ok ? 12 : 38,
  );
  const log = make({ kind: "log", origin: "server", name: "creating todo", log: { level: "info", message: `creating todo { title: '${title}' }` }, source: at("server/todos.controller.ts", 16) }, 7);
  const insert = make(
    {
      kind: "function",
      origin: "server",
      name: "insertTodo()",
      source: at("server/db.ts", 17),
      callSite: at("server/todos.controller.ts", 18),
      args: [ok ? `{ title: '${title}', userId: 1 }` : `{ title: '${title}', userId: undefined }`],
      status: ok ? "ok" : "error",
      ...(ok ? { returned: `{ id: 6, title: '${title}', done: 0, user_id: 1 }` } : { error: { type: "Error", message: errMsg, stack: `Error: ${errMsg}\n    at insertTodo (server/db.ts:19:15)\n    at createTodo (server/todos.controller.ts:18:18)` } }),
    },
    8,
    ok ? 6 : 31,
  );
  const query = make(
    {
      kind: "db_query",
      origin: "db",
      name: "INSERT INTO todos (title, user_id) VALUES (?, ?) RETURNING *",
      status: ok ? "ok" : "error",
      db: { system: "sqlite", statement: "INSERT INTO todos (title, user_id) VALUES (?, ?) RETURNING *", params: ok ? `[ '${title}', 1 ]` : `[ '${title}', null ]` },
      source: at("server/db.ts", 19),
      ...(ok ? {} : { error: { type: "Error", message: errMsg } }),
    },
    9,
    ok ? 4 : 29,
  );
  const errLog = make(
    { kind: "log", origin: "server", name: "could not create todo", status: "error", log: { level: "error", message: `could not create todo Error: ${errMsg}` }, source: at("server/todos.controller.ts", 21) },
    41,
  );
  const tree = [n(browserReq, [n(serverReq, [n(create, ok ? [n(log), n(insert, [n(query)])] : [n(log), n(insert, [n(query)]), n(errLog)])])])];
  const summary: WhatHappened = ok
    ? {
        headline: `You clicked "Add Todo". Everything worked (24ms).`,
        steps: [
          { ok: true, text: "Your app sent the new todo to the server (POST /api/todos)", eventId: browserReq.id, source: at("src/api.ts", 12) },
          { ok: true, text: "The server ran createTodo()", eventId: create.id, source: at("server/todos.controller.ts", 14) },
          { ok: true, text: "Saved the todo in the database", eventId: query.id, source: at("server/db.ts", 19) },
          { ok: true, text: "The server answered Created (201)", eventId: serverReq.id },
        ],
        stats: { files: 4, functions: 2, requests: 2, queries: 1, logs: 1, errors: 0, totalMs: 24 },
      }
    : {
        headline: `You clicked "Add Todo". The server returned an error (500).`,
        steps: [
          { ok: true, text: "Your app sent the new todo to the server (POST /api/todos)", eventId: browserReq.id, source: at("src/api.ts", 12) },
          { ok: true, text: "The server ran createTodo()", eventId: create.id, source: at("server/todos.controller.ts", 14) },
          { ok: true, text: 'It logged "creating todo"', eventId: log.id, source: at("server/todos.controller.ts", 16) },
          { ok: false, text: "insertTodo() got userId: undefined", eventId: insert.id, source: at("server/todos.controller.ts", 18) },
          { ok: false, text: "The database couldn't save the todo: NOT NULL constraint failed: todos.user_id", eventId: query.id, source: at("server/db.ts", 19) },
          { ok: false, text: "The server answered Server error (500)", eventId: serverReq.id },
        ],
        stats: { files: 4, functions: 2, requests: 2, queries: 1, logs: 2, errors: 1, totalMs: 48 },
      };
  const flags: Flag[] = ok
    ? []
    : [{ kind: "swallowed_error", eventId: browserReq.id, message: "The Server error (500) was caught in TodoForm.tsx and never shown on screen.", source: at("src/TodoForm.tsx", 16) }];
  return view(root, tree, summary, flags);
}

function toggle(t0: number, todo: { id: number; title: string; done: boolean }): ActionView {
  const { make, n } = tracer(t0);
  const root = make({ kind: "user_action", origin: "browser", name: `Clicked "${todo.title}"`, trigger: "click", source: at("src/TodoList.tsx", 10) }, 0, 19);
  const body = JSON.stringify({ ...todo, done: !todo.done });
  const req = make(
    {
      kind: "http_request",
      origin: "browser",
      name: `PATCH /api/todos/${todo.id}`,
      source: at("src/api.ts", 22),
      http: { method: "PATCH", url: `/api/todos/${todo.id}`, status: 200, reqHeaders: { "content-type": "application/json" }, resHeaders: { "content-type": "application/json; charset=utf-8" }, reqBody: JSON.stringify({ done: !todo.done }), resBody: body },
    },
    1,
    17,
  );
  const server = make({ kind: "http_request", origin: "server", name: "PATCH /api/todos/:id", source: at("server/index.ts", 10), http: { method: "PATCH", url: `/api/todos/${todo.id}`, status: 200, resBody: body } }, 3, 12);
  const fn = make({ kind: "function", origin: "server", name: "toggleTodo()", source: at("server/todos.controller.ts", 26), args: [`req { PATCH /api/todos/${todo.id} body: { done: ${!todo.done} } }`, "res"], returned: "undefined" }, 4, 9);
  const set = make({ kind: "function", origin: "server", name: "setDone()", source: at("server/db.ts", 22), callSite: at("server/todos.controller.ts", 27), args: [String(todo.id), String(!todo.done)], returned: `{ id: ${todo.id}, title: '${todo.title}', done: ${todo.done ? 0 : 1}, user_id: 1 }` }, 5, 4);
  const q = make({ kind: "db_query", origin: "db", name: "UPDATE todos SET done = ? WHERE id = ? RETURNING *", db: { system: "sqlite", statement: "UPDATE todos SET done = ? WHERE id = ? RETURNING *", params: `[ ${todo.done ? 0 : 1}, ${todo.id} ]` }, source: at("server/db.ts", 23) }, 6, 3);
  return view(root, [n(req, [n(server, [n(fn, [n(set, [n(q)])])])])], {
    headline: `You clicked "${todo.title}". Everything worked (19ms).`,
    steps: [
      { ok: true, text: `Your app updated the todo (PATCH /api/todos/${todo.id})`, eventId: req.id, source: at("src/api.ts", 22) },
      { ok: true, text: "The server ran toggleTodo()", eventId: fn.id, source: at("server/todos.controller.ts", 26) },
      { ok: true, text: "Saved the change in the database", eventId: q.id, source: at("server/db.ts", 23) },
      { ok: true, text: "The server answered OK (200)", eventId: server.id },
    ],
    stats: { files: 3, functions: 2, requests: 2, queries: 1, logs: 0, errors: 0, totalMs: 19 },
  });
}

function serverOutput(t0: number): ActionView {
  const traceId = "0".repeat(32);
  const root: DebugEvent = { id: hex(16), traceId, origin: "server", kind: "user_action", name: "Server output", trigger: "server", startMs: t0, status: "ok" };
  const logEv: DebugEvent = { id: hex(16), traceId, parentId: root.id, origin: "server", kind: "log", name: "API listening", startMs: t0 + 1, status: "ok", log: { level: "info", message: "API listening on http://localhost:3001" }, source: at("server/index.ts", 13) };
  const warn: DebugEvent = { id: hex(16), traceId, parentId: root.id, origin: "server", kind: "log", name: "experimental", startMs: t0 + 2, status: "ok", log: { level: "warn", message: "ExperimentalWarning: SQLite is an experimental feature and might change at any time" } };
  return view(root, [{ event: logEv, children: [] }, { event: warn, children: [] }], { headline: "Server output", steps: [], stats: { files: 1, functions: 0, requests: 0, queries: 0, logs: 2, errors: 0, totalMs: 0 } });
}

function push(a: ActionView): void {
  actions.set(a.id, a);
  emit("actions:update", [a]);
}

/** Streams an action in two updates (incomplete, then complete) like main does. */
async function streamAction(a: ActionView): Promise<ActionView> {
  push({ ...a, complete: false, tree: a.tree.map((n) => ({ ...n, children: [] })) });
  await wait(250);
  push(a);
  return a;
}

function fileTree(): FileNode[] {
  const root: FileNode[] = [];
  for (const path of Object.keys(files).sort()) {
    const parts = path.split("/");
    let level = root;
    parts.forEach((name, i) => {
      const p = parts.slice(0, i + 1).join("/");
      const dir = i < parts.length - 1;
      let node = level.find((x) => x.name === name);
      if (!node) {
        node = { name, path: p, dir, ...(dir ? { children: [] } : {}) };
        level.push(node);
      }
      level = node.children ?? [];
    });
  }
  const sort = (l: FileNode[]) => {
    l.sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name));
    l.forEach((x) => x.children && sort(x.children));
  };
  sort(root);
  return root;
}

function setStatus(s: RunStatus): RunStatus {
  status = s;
  emit("run:status", s);
  return s;
}

const out = (s: string) => emit("run:output", s);
const proc = (name: string, s: string) => {
  out(s);
  emit("process:output", { process: name, chunk: s.replace(/\u001b\[3\dm\[\d\]\u001b\[0m /g, "") });
};

async function bootApp(): Promise<void> {
  out("\u001b[2m$ npm run dev\u001b[0m\r\n\r\n> todo-app@0.0.0 dev\r\n> concurrently \"vite\" \"node --watch server/index.ts\"\r\n\r\n");
  await wait(500);
  setStatus({ state: "starting", processes: [{ name: "web", state: "starting" }, { name: "api", state: "starting" }] });
  if (!BACKEND) proc("web", "\u001b[34m[0]\u001b[0m \r\n\u001b[34m[0]\u001b[0m   \u001b[32m\u001b[1mVITE\u001b[22m v7.3.7\u001b[39m  ready in \u001b[1m312\u001b[22m ms\r\n\u001b[34m[0]\u001b[0m   \u001b[32m➜\u001b[39m  \u001b[1mLocal\u001b[22m:   \u001b[36mhttp://localhost:5173/\u001b[39m\r\n");
  await wait(300);
  proc("api", "\u001b[35m[1]\u001b[0m API listening on http://localhost:3001\r\n\u001b[35m[1]\u001b[0m (node:48211) ExperimentalWarning: SQLite is an experimental feature and might change at any time\r\n");
  push(serverOutput(Date.now()));
  const procs = (project?.processes ?? []).map((p) => ({ name: p.name, state: "running" as const, url: p.url, instrumented: true }));
  setStatus({ state: "running", url: BACKEND ? "http://localhost:3001" : "http://localhost:5173", instrumented: true, processes: procs });
  if (BACKEND) return;
  await wait(400);
  await streamAction(pageLoad(Date.now()));
}

/** Called by the fake app pane. */
export function mockClick(what: "add" | "toggle", arg?: string | number): void {
  if (status.state !== "running") return;
  if (what === "add") {
    void streamAction(addTodo(Date.now(), String(arg || "buy milk")));
    proc("api", `\u001b[35m[1]\u001b[0m creating todo { title: '${String(arg || "buy milk")}' }\r\n`);
    if (!fixed) proc("api", "\u001b[35m[1]\u001b[0m \u001b[31mcould not create todo Error: NOT NULL constraint failed: todos.user_id\u001b[0m\r\n");
  } else {
    const t = todos.find((x) => x.id === arg);
    if (!t) return;
    void streamAction(toggle(Date.now(), t));
    t.done = !t.done;
  }
}
export const mockTodos = todos;
export const mockFixed = () => fixed;

// ---------- agent ----------

const MOCK_COLORS = ["violet", "cyan", "amber", "magenta", "teal"];
const mockRuns = new Map<string, { info: AgentRunInfo; steps: AgentStep[] }>(); // C: branches and asides

async function mockBranch(parentRunId: string, fromStepId: string, question: string, name: string | undefined, aside: boolean): Promise<AgentRunInfo> {
  const used = [...mockRuns.values()].filter((r) => r.info.color).length;
  const info: AgentRunInfo = {
    id: hex(16),
    goal: question,
    brain: "claude-code",
    status: "running",
    parentRunId,
    ...(fromStepId ? { branchFromStepId: fromStepId } : {}),
    name: name || question.toLowerCase().split(/\W+/).filter((w) => w.length > 3).slice(0, 3).join(" ") || "branch",
    ...(aside ? { aside: true } : { color: MOCK_COLORS[used % 5], worktree: `branch-${hex(2)}` }),
  };
  const rec = { info, steps: [] as AgentStep[] };
  mockRuns.set(info.id, rec);
  const say = (kind: AgentStep["kind"], text: string, extra: Partial<AgentStep> = {}) => {
    if (rec.info.status !== "running") return;
    const s: AgentStep = { id: hex(16), runId: info.id, kind, text, createdAt: Date.now(), ...extra };
    rec.steps.push(s);
    emit("agent:step", s);
  };
  const end = () => {
    rec.info = { ...rec.info, status: "done" };
    emit("agent:status", rec.info);
  };
  emit("agent:status", info);
  void (async () => {
    await wait(400);
    if (aside) {
      say("message", "No. The cache is only read on GET /api/todos, so it can't change what POST saves.");
      say("done", "Done", { detail: "No. The cache is only read on GET /api/todos, so it can't change what POST saves." });
      return end();
    }
    for (const t of ["Reading server/cache.ts", "Searching the code for userId", "Reading server/todos.controller.ts"]) {
      say("tool_call", t, { tool: "read_file" });
      await wait(900);
    }
    say("findings", "Found it", { summary: "The cache keeps the old user, so the server sees no user ID.", findings: [{ confidence: "likely", claim: "The cache keeps the old user, so the server sees no user ID.", file: "server/cache.ts", line: 9 }] });
    await wait(600);
    say("tool_result", "It worked. No errors this time.", { tool: "run_scenario", detail: "Result: PASS" });
    say("done", "Fixed and verified", { summary: "Fixed and verified" });
    say("patch", "Changed server/cache.ts in its own copy", { tool: "worktree_diff", detail: "--- a/server/cache.ts\n+++ b/server/cache.ts\n-  return cache.get(key);\n+  return cache.get(key) ?? load(key);\n", files: [{ path: "server/cache.ts", action: "edit" }] });
    end();
  })();
  return info;
}

function step(kind: AgentStep["kind"], text: string, extra: Partial<AgentStep> = {}): void {
  if (!agentRun || agentRun.status !== "running") return;
  emit("agent:step", { id: hex(16), runId: agentRun.id, kind, text, createdAt: Date.now(), ...extra });
}

function finish(s: AgentRunInfo["status"]): void {
  if (!agentRun) return;
  agentRun = { ...agentRun, status: s };
  emit("agent:status", agentRun);
}

async function agentScript(runId: string): Promise<void> {
  const alive = () => agentRun?.id === runId && agentRun.status === "running";
  const pause = async (ms: number) => {
    await wait(ms);
    if (!alive()) throw new Error("stopped");
  };
  try {
    step("message", "I'll reproduce the problem first, then read what the server did.");
    await pause(700);
    step("tool_call", "Looking at the page", { tool: "app_snapshot", detail: JSON.stringify({}, null, 2) });
    await pause(500);
    step("tool_result", 'The page has a "New todo" box and an "Add Todo" button.', {
      tool: "app_snapshot",
      detail: JSON.stringify({ url: "http://localhost:5173/", title: "Todos", elements: [{ ref: "e1", role: "textbox", name: "New todo" }, { ref: "e2", role: "button", name: "Add Todo" }] }, null, 2),
    });
    await pause(600);
    step("tool_call", 'Typing "buy milk" and clicking "Add Todo"', { tool: "app_type", detail: JSON.stringify({ ref: "e1", text: "buy milk", submit: true }, null, 2) });
    await pause(400);
    const a = await streamAction(addTodo(Date.now(), "buy milk", "agent"));
    await pause(400);
    step("tool_result", fixed ? "The click worked: Created (201)." : "The click sent POST /api/todos, which returned Server error (500).", { tool: "app_type", actionIds: [a.id], detail: "Clicked \"Add Todo\" ✕ 48ms\n→ POST /api/todos 500 45ms src/api.ts:12\n  createTodo() 38ms server/todos.controller.ts:14\n    log \"creating todo\" server/todos.controller.ts:16\n    insertTodo({ title: 'buy milk', userId: undefined }) ✕ 31ms server/todos.controller.ts:18\n      INSERT INTO todos ✕ NOT NULL constraint failed: todos.user_id" });
    await pause(700);
    step("message", "insertTodo() received userId: undefined, even though the form sends a user ID. Reading the handler.", { actionIds: [a.id] });
    await pause(600);
    step("tool_call", "Reading server/todos.controller.ts", { tool: "read_file", detail: JSON.stringify({ path: "server/todos.controller.ts" }, null, 2) });
    await pause(500);
    step("tool_result", "Read 33 lines.", { tool: "read_file", detail: files["server/todos.controller.ts"] });
    await pause(800);
    const insert = a.tree[0]?.children[0]?.children[0]?.children[1]?.event;
    step("findings", "Found it", {
      summary: "The server reads the user ID from the wrong field, so the database refuses to save the todo.",
      findings: [
        { confidence: "observed", claim: "Your form sends the user ID as userId, but the server reads req.body.user, so insertTodo() gets undefined.", file: "server/todos.controller.ts", line: 18, eventId: insert?.id },
        { confidence: "likely", claim: "The todos table requires a user (user_id is NOT NULL), so the insert fails and the server answers Server error (500).", file: "server/db.ts", line: 19 },
        { confidence: "possible", claim: "The form catches the error and shows nothing, which is why the todo silently doesn't appear.", file: "src/TodoForm.tsx", line: 16 },
      ],
      actionIds: [a.id],
    });
    await pause(700);
    const path = "server/todos.controller.ts";
    const before = files[path]!;
    const patch: Patch = {
      id: hex(16),
      files: [{ path, before, after: before.replace("userId: req.body.user }", "userId: req.body.userId }") }],
      rationale: "Read the user ID from the field the form actually sends (userId).",
      status: "proposed",
    };
    patches.set(patch.id, patch);
    step("patch", "Proposed a one-line fix in server/todos.controller.ts", { patchId: patch.id });
    const approval: ApprovalRequest = { id: hex(16), kind: "patch", title: `Apply this change to ${path}?`, reason: patch.rationale, patch };
    const ok = await new Promise<boolean>((resolve) => {
      pendingApprovals.set(approval.id, resolve);
      emit("approval:request", approval);
    });
    emit("approval:resolved", { id: approval.id, approved: ok });
    if (!alive()) return;
    if (!ok) {
      patch.status = "rejected";
      emit("patch:update", { ...patch });
      step("message", "OK, I won't change anything. The cause is above if you want to fix it yourself.");
      step("done", "Stopped without changes.", { summary: "Found the cause; you chose not to apply the fix." });
      finish("done");
      return;
    }
    files[path] = patch.files[0]!.after;
    fixed = true;
    patch.status = "applied";
    emit("patch:update", { ...patch });
    checkpoints.push({ id: hex(8), patchId: patch.id, label: "Read userId in createTodo", files: [path], createdAt: Date.now(), current: true });
    emit("checkpoint:update", [...checkpoints]);
    emit("file:changed", { path });
    out("\u001b[35m[1]\u001b[0m Restarting 'server/index.ts'\r\n\u001b[35m[1]\u001b[0m API listening on http://localhost:3001\r\n");
    step("tool_result", "Applied the change. Waiting for the server to restart.", { tool: "propose_patch" });
    await pause(900);
    step("tool_call", "Re-running: add a todo", { tool: "run_scenario", detail: JSON.stringify({ steps: [{ type: "type", ref: "e1", text: "buy milk", submit: true }] }, null, 2) });
    await pause(500);
    const b = await streamAction(addTodo(Date.now(), "buy milk", "agent"));
    await pause(300);
    step("tool_result", "POST /api/todos now returns Created (201) and the todo appears.", { tool: "run_scenario", actionIds: [b.id] });
    await pause(400);
    step("done", "Fixed and verified.", { summary: "Fixed and verified. Adding a todo now works.", actionIds: [a.id, b.id], patchId: patch.id });
    finish("done");
  } catch {
    // stopped
  }
}

// ---------- api ----------

function fakeResponse(req: HttpRequestSpec) {
  const path = req.url.replace(/^https?:\/\/[^/]+/, "").split("?")[0] ?? "/";
  const m = req.method.toUpperCase();
  if (path === "/api/health") return { status: 200, statusText: "OK", body: JSON.stringify({ ok: true }) };
  if (path === "/api/todos" && m === "GET") return { status: 200, statusText: "OK", body: JSON.stringify(todos) };
  if (path === "/api/todos" && m === "POST") {
    let userId: unknown;
    try {
      userId = JSON.parse(req.body ?? "{}")[fixed ? "userId" : "user"];
    } catch {
      return { status: 400, statusText: "Bad Request", body: JSON.stringify({ error: "Unexpected token in JSON" }) };
    }
    return userId == null
      ? { status: 500, statusText: "Internal Server Error", body: JSON.stringify({ error: "NOT NULL constraint failed: todos.user_id" }) }
      : { status: 201, statusText: "Created", body: JSON.stringify({ id: 6, title: "buy milk", done: false, user_id: userId }) };
  }
  if (/^\/api\/todos\/\d+$/.test(path)) return m === "DELETE" ? { status: 204, statusText: "No Content", body: "" } : { status: 200, statusText: "OK", body: JSON.stringify(todos[0]) };
  return { status: 404, statusText: "Not Found", body: `Cannot ${m} ${path}` };
}

const makeProject = (root: string): ProjectInfo => ({
  root,
  name: BACKEND ? "orders-api" : root.split("/").pop() || "project",
  ...(BACKEND ? {} : { frontend: "vite-react", appUrl: "http://localhost:5173" }),
  backend: "express",
  devCommand: "npm run dev",
  routes: ROUTES,
  processes: BACKEND
    ? [{ name: "api", command: "node --watch server/index.ts", url: "http://localhost:3001" }]
    : [
        { name: "web", command: "vite", url: "http://localhost:5173" },
        { name: "api", command: "node --watch server/index.ts", url: "http://localhost:3001" },
      ],
  expectedPlaces: [
    ...(BACKEND ? [] : [{ id: "client:web", kind: "client" as const, name: "WEB", detail: "localhost:5173" }]),
    { id: "service:api", kind: "service", name: "API", detail: "localhost:3001" },
    { id: "data:sqlite:todos.db", kind: "data", name: "SQLITE · todos.db" },
    { id: "cache:redis", kind: "cache", name: "REDIS", detail: "REDIS_URL" },
    { id: "outside:api.stripe.com", kind: "outside", name: "STRIPE", detail: "api.stripe.com" },
  ],
});

export const mockApi: ShrikeApi = {
  ...mockScm, // scm: SC
  ...questsMock, // quests: QB
  ...mcpMock, // mcp: MCP
  ...ciMock, // ci-lessons: CI
  ...apiClientMock((r) => mockApi.sendRequest(r)), // api: AP
  async openProjectDialog() {
    return mockApi.openProject(MOCK_ROOT);
  },
  async openProject(root) {
    await wait(150);
    return (project = makeProject(root));
  },
  async sampleProjectPath() {
    return MOCK_ROOT;
  },
  async getProject() {
    return project;
  },
  async run() {
    if (status.state === "running" || status.state === "starting") return status;
    setStatus({ state: "starting" });
    void bootApp();
    return status;
  },
  async stop() {
    out("\r\n\u001b[2mStopped.\u001b[0m\r\n");
    return setStatus({ state: "stopped" });
  },
  async getRunStatus() {
    return status;
  },
  async reloadApp() {
    if (status.state === "running") void streamAction(pageLoad(Date.now()));
  },
  async popOutApp() {},
  async dockApp() {},
  async appWindowOpen() {
    return false;
  },
  async listFiles() {
    return fileTree();
  },
  async mapTree() {
    return { total: Object.keys(files).length, nodes: fileTree() }; // ponytail: every folder open; main slices the real tree
  },
  async readFile(path) {
    await wait(30);
    const f = files[path];
    if (f == null) throw new Error(`No such file: ${path}`);
    return f;
  },
  async writeFile(path, content) {
    files[path] = content;
    emit("file:changed", { path });
  },
  async getActions() {
    return [...actions.values()];
  },
  async importHar() {
    throw new Error("HAR import needs the desktop app.");
  },
  async sendRequest(req) {
    const t0 = Date.now();
    await wait(60 + Math.random() * 60);
    const r = fakeResponse(req);
    const durationMs = Date.now() - t0;
    const { make, n } = tracer(t0);
    const path = req.url.replace(/^https?:\/\/[^/]+/, "");
    const err = r.status >= 500;
    const root = make({ kind: "user_action", origin: "explorer", name: `Sent ${req.method} ${path}`, trigger: "explorer", status: err ? "error" : "ok" }, 0, durationMs);
    const server = make({ kind: "http_request", origin: "server", name: `${req.method} ${path}`, status: err ? "error" : "ok", http: { method: req.method, url: path, status: r.status, reqHeaders: req.headers, reqBody: req.body, resBody: r.body } }, 2, durationMs - 4);
    const a = view(root, [n(server)], {
      headline: `You sent ${req.method} ${path}. ${err ? `The server returned an error (${r.status}).` : `Everything worked (${durationMs}ms).`}`,
      steps: [{ ok: !err && r.status < 400, text: `The server answered ${r.statusText} (${r.status})`, eventId: server.id }],
      stats: { files: 0, functions: 0, requests: 1, queries: 0, logs: 0, errors: err ? 1 : 0, totalMs: durationMs },
    });
    push(a);
    return {
      actionId: a.id,
      response: { status: r.status, statusText: r.statusText, headers: { "content-type": "application/json; charset=utf-8", "x-powered-by": "Express" }, body: r.body, durationMs },
    };
  },
  async detectBrains() {
    await wait(120);
    return [
      { id: "claude-code", label: "Claude Code", available: true, detail: "v2.1.280 at /opt/homebrew/bin/claude" },
      { id: "builtin", label: "Built-in (API key)", available: false, detail: "Set ANTHROPIC_API_KEY to enable" },
    ];
  },
  async startAgent(goal: string, brain: BrainId) {
    if (agentRun?.status === "running") throw new Error("An agent is already running.");
    agentRun = { id: hex(16), goal, brain, status: "running" };
    emit("agent:status", agentRun);
    clearTimeout(agentTimer);
    const id = agentRun.id;
    agentTimer = window.setTimeout(() => void agentScript(id), 200);
    return agentRun;
  },
  async stopAgent(runId) {
    if (agentRun?.id !== runId) return;
    for (const [id, resolve] of pendingApprovals) {
      pendingApprovals.delete(id);
      resolve(false);
    }
    finish("stopped");
  },
  async answerApproval(id, approved) {
    const r = pendingApprovals.get(id);
    if (!r) throw new Error("That request was already answered.");
    pendingApprovals.delete(id);
    r(approved);
  },
  async revertPatch(patchId) {
    const p = patches.get(patchId);
    if (!p || p.status !== "applied") throw new Error("That change isn't applied.");
    for (const f of p.files) {
      files[f.path] = f.before;
      emit("file:changed", { path: f.path });
    }
    fixed = false;
    p.status = "reverted";
    emit("patch:update", { ...p });
  },
  async getActionShot(actionId) {
    return actions.has(actionId) ? shot() : null;
  },
  async openInEditor(file, line) {
    await wait(80);
    if (files[file] == null) return { ok: false, error: `No such file: ${file}` };
    console.info(`[mock] open ${file}:${line} in Cursor`);
    return { ok: true, editor: "Cursor" };
  },
  async saveClip(bytes, ext) {
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: ext === "mp4" ? "video/mp4" : "video/webm" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `shrike-clip.${ext}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    return `~/Downloads/shrike-clip.${ext}`;
  },
  async setProcesses(list) {
    if (!project) throw new Error("No project is open.");
    await wait(120);
    return (project = { ...project, processes: list.map((p) => ({ ...p })) });
  },
  async openLiveSite(url) {
    return (project = { ...makeProject(MOCK_ROOT), liveUrl: url, devCommand: "", processes: [{ name: "app", command: "" }] });
  },
  async setLiveUrl(url) {
    if (!project) throw new Error("No project is open.");
    return (project = { ...project, liveUrl: url ?? undefined });
  },
  async setAppSide(side) {
    return side;
  },
  async signOutLive() {},
  async appPartition() {
    return "persist:shrike-app";
  },
  async answerLiveLogin() {},
  async getMemory() {
    return memory;
  },
  async removeMemory(id) {
    memory = memory.filter((m) => m.id !== id);
    emit("memory:update", memory);
  },
  async getCheckpoints() {
    return [...checkpoints];
  },
  async rewindTo(id) {
    const i = checkpoints.findIndex((c) => c.id === id);
    if (i < 0) throw new Error("No such checkpoint.");
    for (const c of checkpoints.slice(i)) {
      const p = patches.get(c.patchId);
      if (c.current && p?.status === "applied") await mockApi.revertPatch(p.id);
      c.current = false;
    }
    emit("checkpoint:update", [...checkpoints]);
  },
  async listSkills() {
    return skills;
  },
  async reviseFix() {
    await wait(300);
  },
  async startPointMode() {
    if (status.state !== "running") throw new Error("The app isn't open yet. Press Run first.");
    mockPoint.set(true);
  },
  async cancelPointMode() {
    mockPoint.set(false);
  },
  async exportIssue(actionId) {
    const view = actions.get(actionId);
    if (!view) throw new Error("That trip isn't in this session anymore.");
    await wait(160);
    const loc = failingLocation(view);
    const text = loc ? files[loc.file] : undefined;
    const lines = text?.split("\n") ?? [];
    const start = loc ? Math.max(1, loc.line - 3) : 1;
    const excerpt = loc && text ? { file: loc.file, line: loc.line, start, lines: lines.slice(start - 1, loc.line + 3) } : undefined;
    const withClip = new URLSearchParams(location.search).has("clip");
    const clipName = withClip ? `2026-10-08-clicked-add-todo-${actionId.slice(0, 6)}.mp4` : undefined;
    const markdown = issueMarkdown({ view, appUrl: project?.appUrl, pagePath: "/", excerpt, clipName });
    return { markdown, ...(clipName ? { clipPath: `${MOCK_ROOT}/.shrike/issues/${clipName}` } : {}) };
  },
  async watchedBy() {
    return [];
  },
  async showInFolder(path) {
    console.info(`[mock] show ${path} in Finder`);
  },
  async readFileDataUrl(path) {
    await wait(30);
    if (path === "docs/screenshot.png") return shot() ?? "";
    const f = files[path];
    if (f == null) throw new Error(`No such file: ${path}`);
    if (!path.endsWith(".svg")) throw new Error(`Not an image: ${path}`);
    return `data:image/svg+xml;base64,${btoa(f)}`;
  },
  // ---- S: skills ----
  async runSkill(skillId, input) {
    const s = skills.find((x) => x.id === skillId);
    if (!s) throw new Error("No such skill.");
    s.uses = (s.uses ?? 0) + 1;
    emit("skills:update", [...skills]);
    setTimeout(() => sysEvent("used", s), 1500);
    return mockApi.startAgent(`Run the ${s.name} skill${input ? `: ${input}` : ""}`, "claude-code");
  },
  async answerSkillProposal() {
    await wait(80);
  },
  async listSkillDrafts() {
    return mockDrafts.map((d) => ({ ...d }));
  },
  async undoSkillLevel(id) {
    const d = mockDrafts.find((x) => x.id === id && x.status === "applied");
    if (!d) throw new Error("There's nothing to undo there.");
    d.status = "undone";
  },
  async editSkillDraft(id) {
    return `.shrike/skill-drafts/${id}.md`;
  },
  async saveAsSkill(from) {
    await wait(200);
    const skill: Skill = { id: `fix-${hex(4)}`, name: from.name ?? "Missing userId", when: "A form field reaches the server under a different name", source: "project", version: 1, uses: 0, kind: "debug" };
    skills.push(skill);
    emit("skills:update", [...skills]);
    sysEvent("acquired", skill, { when: skill.when });
    return skill;
  },
  async importClaudeSkills(enable) {
    await wait(150);
    if (enable && !skills.some((s) => s.source === "claude")) {
      skills.push(
        { id: "navigate-xyne-spaces", name: "navigate-xyne-spaces", when: "Drive the Xyne Spaces dashboard UI", source: "claude", readOnly: true, uses: 0, kind: "flow" },
        { id: "xyne-ci-check", name: "xyne-ci-check", when: "Run the checks CI runs, before a push", source: "claude", readOnly: true, uses: 0, kind: "git" },
      );
      emit("skills:update", [...skills]);
    }
    return [...skills];
  },
  async editSkill(skillId) {
    const path = `.shrike/skills/${skillId}.md`;
    files[path] ??= `# ${skills.find((s) => s.id === skillId)?.name ?? skillId}\n\nWhen: ${skills.find((s) => s.id === skillId)?.when ?? ""}\n\n1. Reproduce the trip.\n2. Find the first wrong value.\n`;
    return path;
  },
  async claudeSkillsOffer() {
    return skills.some((s) => s.source === "claude") ? null : 30;
  },
  // ---- XP: progression (in memory) ----
  async getProgress() {
    return mockProgress();
  },
  async saveImage(bytes, name) {
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "image/png" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${name}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    return `~/Downloads/${name}.png`;
  },
  // ---- SL: the System ----
  async getSkillLog() {
    return [...skillLog];
  },
  // ---- S8: action recipes ----
  async listRecipes() {
    return recipeList();
  },
  async saveRecipe(id, st, scope) {
    const x = ACTIONS.find((r) => r.id === id);
    if (!x) throw new Error(`There's no action called "${id}".`);
    if (st.args) parseArgs(st.args);
    const keep = changedFrom(merged(x, scope === "project" ? recipeSaved.personal : null, null), st);
    if (Object.keys(keep).length) recipeSaved[scope][id] = keep;
    else delete recipeSaved[scope][id];
    return recipeList();
  },
  async resetRecipe(id) {
    if (recipeSaved.project[id]) delete recipeSaved.project[id];
    else delete recipeSaved.personal[id];
    return recipeList();
  },
  async noteSkillUse(skillId) {
    const s = skills.find((x) => x.id === skillId);
    if (s) sysEvent("used", s);
  },
  async saveAsCommand(name, prompt) {
    commands = [...commands.filter((c) => c.name !== name), { name, prompt }];
  },
  async listCommands() {
    return commands;
  },
  // ---- B: flows ----
  async listFlows() {
    return flows;
  },
  async startFlowRecording() {
    emit("flow:recording", { steps: [] });
  },
  async stopFlowRecording(name) {
    emit("flow:recording", null);
    const f: Flow = { id: hex(6), name, steps: [{ type: "type", name: "New todo", text: "buy milk" }, { type: "click", name: "Add Todo" }] };
    flows = [...flows, f];
    emit("flows:update", flows);
    return f;
  },
  async runFlow(id) {
    const f = flows.find((x) => x.id === id);
    if (!f) throw new Error("No such flow.");
    const a = await streamAction(addTodo(Date.now(), "buy milk", "agent"));
    const ok = a.status !== "error";
    flows = flows.map((x) => (x.id === id ? { ...x, lastRun: { at: Date.now(), ok, actionIds: [a.id] } } : x));
    emit("flows:update", flows);
    return { actionIds: [a.id], ok };
  },
  async saveFlow(name, steps) {
    const f: Flow = { id: hex(6), name, steps };
    flows = [...flows, f];
    emit("flows:update", flows);
    return f;
  },
  async listMyMcpServers() {
    return ["chrome-devtools", "pencil"];
  },
  async setFlowWatch(id, watch) {
    flows = flows.map((x) => (x.id === id ? { ...x, watch: watch ?? undefined } : x));
    emit("flows:update", flows);
  },
  async deleteFlow(id) {
    flows = flows.filter((x) => x.id !== id);
    emit("flows:update", flows);
  },
  // ---- G: git and GitHub ----
  async gitState() {
    return git;
  },
  async shipFix(opts) {
    await wait(600);
    const pr: PullRequest = { number: 42, title: opts.title ?? "Fix userId in createTodo", url: "https://github.com/you/todo-app/pull/42", state: "open", checks: [{ name: "test", state: "pending" }, { name: "lint", state: "pending" }] };
    setGit({ branch: "fix-userid", upstream: "origin/fix-userid", pr });
    setTimeout(() => setGit({ pr: { ...pr, checks: pr.checks.map((c) => ({ ...c, state: "pass" as const })) } }), 2500);
    setTimeout(() => mockQuestResult(`Ship: ${pr.title}`, { kind: "ship", firstTry: true, fixes: 0, skillsUsed: 0, rewards: [] }), 0); // XP: main scores shipFix's result
    return pr;
  },
  async listPullRequests() {
    return git.pr ? [git.pr] : [];
  },
  async reviewPullRequest(n) {
    return mockApi.startAgent(`Review pull request #${n}`, "claude-code");
  },
  async resolveConflicts() {
    return mockApi.startAgent("Resolve the merge conflicts", "claude-code");
  },
  async explainCheck(n, name) {
    return mockApi.startAgent(`Why did ${name} fail on #${n}?`, "claude-code");
  },
  async mergePullRequest() {
    if (!git.pr) throw new Error("There's no pull request for this branch.");
    await wait(400);
    setGit({ pr: { ...git.pr, state: "merged" } });
  },
  async syncWithMain() {
    await wait(300);
    return setGit({ behind: 0 });
  },
  // ---- WS: workspaces ----
  async listWorkspaces() {
    return workspaces;
  },
  async addWorkspaceProject() {
    return null;
  },
  async workspaceSources() {
    await wait(300);
    return { current: "main", location: `${MOCK_ROOT}/.shrike/worktrees`, branches: [{ name: "main", remote: false }, { name: "fix/add-todo", remote: false }, { name: "origin/feature/dark-mode", remote: true }], prs: [{ number: 42, title: "Send the user id when adding a todo", branch: "fix/add-todo", author: "sam" }, { number: 39, title: "Dark mode", branch: "feature/dark-mode", draft: true }] };
  },
  async createWorkspace(opts) {
    const name = opts.from.kind === "pr" ? `pr-${opts.from.number}` : opts.from.kind === "branch" ? opts.from.branch.replace(/\W+/g, "-") : (opts.from.kind === "name" ? opts.from.name : opts.from.text).toLowerCase().replace(/[^a-z0-9]+/g, "-");
    for (const step of ["Copying your code as it is now", "Linked your packages and copied .env files"]) (emit("workspace:progress", { step, state: "running" }), await wait(500));
    const w = ws({ name, branch: `shrike/${name}`, group: "idle", portOffset: 100 * workspaces.length });
    workspaces = [...workspaces, w];
    emit("workspace:progress", { step: `${name} is ready`, state: "done" });
    emit("workspaces:update", workspaces);
    return w;
  },
  async openWorkspace(path) {
    workspaces = workspaces.map((w) => ({ ...w, current: w.path === path }));
    emit("workspaces:update", workspaces);
    return project!;
  },
  async workspaceAction() {},
  async renameWorkspace(path, label) {
    workspaces = workspaces.map((w) => (w.path === path ? { ...w, label } : w));
    emit("workspaces:update", workspaces);
  },
  async deleteWorkspace(path) {
    workspaces = workspaces.filter((w) => w.path !== path);
    emit("workspaces:update", workspaces);
    return true;
  },
  // ---- W: worktrees ----
  async listWorktrees() {
    return worktrees;
  },
  async createWorktree(name, note) {
    const w: Worktree = { name, path: `${MOCK_ROOT}-${name}`, branch: name, current: false, running: false, portOffset: worktrees.length * 10, note };
    worktrees = [...worktrees, w];
    emit("worktrees:update", worktrees);
    return w;
  },
  async switchWorktree(name) {
    worktrees = worktrees.map((w) => ({ ...w, current: w.name === name }));
    emit("worktrees:update", worktrees);
    return project!;
  },
  async removeWorktree(name) {
    worktrees = worktrees.filter((w) => w.name !== name || w.current);
    emit("worktrees:update", worktrees);
  },
  async startRace(actionId, approaches = 2) {
    const race: Race = { id: hex(6), actionId, candidates: ["try-userid", "try-default-user", "try-schema"].slice(0, approaches).map((w, i) => ({ worktree: w, approach: ["Read req.body.userId", "Default to the signed-in user", "Allow null user_id"][i]!, state: "thinking" })) };
    emit("race:update", race);
    setTimeout(() => emit("race:update", { ...race, candidates: race.candidates.map((c, i) => ({ ...c, state: i === 0 ? "green" : "red", patchId: hex(8) })) }), 2500);
    return race;
  },
  async trySandbox(patchId, actionId) {
    const race: Race = { id: hex(6), actionId: actionId ?? [...actions.values()].findLast((a) => a.status === "error")?.id ?? "", candidates: [{ worktree: "sandbox", approach: "The proposed fix", state: "rerunning", patchId }] };
    emit("race:update", race);
    setTimeout(() => emit("race:update", { ...race, candidates: race.candidates.map((c) => ({ ...c, state: "green" })) }), 2000);
    return race;
  },
  async adoptWorktreeFix() {
    await wait(300);
  },
  // ---- L: SDLC and hidden moves ----
  async getSdlc() {
    return sdlc.get();
  },
  async waiveReview() {
    return sdlc.waiveReview();
  },
  async startAgentWith(goal, brain, opts) {
    console.info("[mock] startAgentWith", opts);
    const info = await mockApi.startAgent(goal, brain);
    if (opts.context?.some((c) => c.includes("ask_options"))) setTimeout(() => mockOptionsAsk(goal || "How should your todo list look?"), 600);
    return info;
  },
  async reviewFix(patchId) {
    if (!patches.has(patchId)) throw new Error("That fix isn't in this session anymore.");
    sdlc.noteReview({ state: "running", at: Date.now(), summary: "Your agent is reviewing the fix.", findings: [], patchId });
    setTimeout(() => sdlc.noteReview({ state: "passed", at: Date.now(), summary: "Looks good. One small thing to consider.", findings: [{ confidence: "possible", claim: "createTodo() still trusts the client to send userId. Consider reading it from the session.", file: "server/todos.controller.ts", line: 18 }], patchId }), 1600);
    return { id: hex(16), goal: "Review this fix", brain: "claude-code", status: "running" };
  },
  async runTests() {
    await wait(900);
    const r = fixed ? { ok: true, summary: "All 12 tests passed." } : { ok: false, summary: "1 test failed, 11 passed. First one: creates a todo for the signed-in user." };
    sdlc.noteTests(r);
    return r;
  },
  async lastSession() {
    return { project: MOCK_ROOT, actionIds: [], at: Date.now() - 20 * 3_600_000 };
  },
  // ---- V: voice (the helper is native, so the browser mock can't hear) ----
  async voiceSend(cmd) {
    if (cmd.cmd === "start") emit("voice:event", { type: "error", id: cmd.id, message: "Voice works in the desktop app." });
  },
  async openVoiceSettings() {},
  async voiceModels() {
    return voiceModels;
  },
  async voiceModelAct(act, id) {
    const pick = (m: VoiceModel) => !id || m.id === id;
    if (act === "delete") voiceModels = { ...voiceModels, models: voiceModels.models.map((m) => (pick(m) ? { ...m, state: "missing" as const, got: undefined } : m)) };
    if (act === "cancel") clearInterval(voiceTimer);
    if (act === "cancel") voiceModels = { ...voiceModels, models: voiceModels.models.map((m) => (pick(m) && m.state === "downloading" ? { ...m, state: "missing" as const, got: undefined } : m)) };
    if (act === "download") {
      voiceModels = { ...voiceModels, models: voiceModels.models.map((m) => (pick(m) && m.state !== "ready" ? { ...m, state: "downloading" as const, got: 0 } : m)) };
      clearInterval(voiceTimer);
      voiceTimer = setInterval(() => {
        voiceModels = {
          ...voiceModels,
          models: voiceModels.models.map((m) => {
            if (m.state === "verifying") return { ...m, state: "ready" as const, got: undefined };
            if (m.state !== "downloading") return m;
            const got = Math.min(m.bytes, (m.got ?? 0) + 90_000_000);
            return got >= m.bytes ? { ...m, state: "verifying" as const, got } : { ...m, got };
          }),
        };
        if (voiceModels.models.every((m) => m.state !== "downloading" && m.state !== "verifying")) clearInterval(voiceTimer);
        emit("voice:models", voiceModels);
      }, 300);
    }
    emit("voice:models", voiceModels);
    return voiceModels;
  },
  async voicePlan() {
    return { ok: false, error: "missing" };
  },
  async voicePlanWarm() {
    return false;
  },
  async setWindowChrome() {},
  // ---- C: conversation branches (a scripted branch that finds, fixes in its own copy and re-runs) ----
  async listRuns() {
    return [...mockRuns.values()].filter((r) => !r.info.aside).map((r) => r.info);
  },
  async getRunSteps(runId) {
    return mockRuns.get(runId)?.steps ?? [];
  },
  async retryRun() {
    if (!agentRun) throw new Error("That agent run isn't in this session anymore.");
    return this.startAgent(agentRun.goal, agentRun.brain);
  },
  async branchRun(runId, fromStepId, question, opts) {
    return mockBranch(runId, fromStepId, question, opts?.name, false);
  },
  async askAside(runId, question) {
    return mockBranch(runId, "", question, undefined, true);
  },
  async keepAside(id, name) {
    const r = mockRuns.get(id);
    if (!r) throw new Error("That side question is gone.");
    const { aside: _, ...rest } = r.info;
    r.info = { ...rest, name: name || r.info.name, color: MOCK_COLORS[[...mockRuns.values()].filter((x) => x.info.color).length % 5] };
    emit("agent:status", r.info);
    return r.info;
  },
  async bringBack(id, mode) {
    console.info("[mock] bringBack", id, mode);
    if (mode === "fix") return;
    const prev = agentRun;
    if (!prev) return;
    agentRun = { id: hex(16), goal: "Another line of thinking found…", brain: prev.brain, status: "running", continues: prev.id };
    emit("agent:status", agentRun);
    await wait(300);
    step("message", "Thanks. That fits what I saw: the cache returns the old user, so I'll check it next.");
    finish("done");
  },
  // ---- X: x-ray (the mock agent sends no usage, so there's no context map) ----
  async getContextMap() {
    return null;
  },
  // ---- I: place inspector (needs a real app's databases and caches) ----
  async inspect() {
    throw new Error("Looking inside a database or cache works in the desktop app.");
  },
  // ---- R: start quest (start-agent), a scripted Claude run ----
  async getStartPlan() {
    return startPlan;
  },
  async getStartSettings() {
    return { ...startSettings };
  },
  async setStartSettings(st: StartSettings) {
    startSettings = { autoKeep: st.autoKeep };
  },
  async startApp() {
    if (startPlan && (startPlan.state === "planning" || startPlan.state === "running")) return startPlan;
    void mockQuest();
    return startPlan!;
  },
  async stopApp() {
    if (startPlan) emit("start:plan", (startPlan = { ...startPlan, state: "stopped" }));
    setStatus({ state: "stopped" });
  },
  async answerStart(id, a) {
    startAsks.get(id)?.(a.allow);
    startAsks.delete(id);
  },
  // chains: P
  async getChains() {
    return chainsState;
  },
  async queuePrompt(prompt, when, target = "main") {
    chainsState.items = [...chainsState.items, { id: hex(6), prompt, when, target, state: "waiting", createdAt: Date.now() }];
    return pushChains({ kind: "queued", text: `Queued: ${prompt} · ${whenLabel(when)}` });
  },
  async editUpNext(id, patch) {
    chainsState.items = patch === null ? chainsState.items.filter((i) => i.id !== id) : chainsState.items.map((i) => (i.id === id ? { ...i, ...patch } : i));
    return pushChains();
  },
  async moveUpNext(id, index) {
    chainsState.items = moveItem(chainsState.items, id, index);
    return pushChains();
  },
  async pauseUpNext(paused) {
    chainsState.paused = paused;
    return pushChains();
  },
  async answerMissed(id, run) {
    chainsState.items = chainsState.items.map((i) => (i.id === id ? { ...i, state: run ? "waiting" : "skipped" } : i));
    return pushChains();
  },
  async listChains() {
    return MOCK_CHAINS;
  },
  async startChain(def) {
    chainsState.chain = { id: hex(6), def, state: "running", steps: [{ node: "prompt", prompt: def.prompt || "the last run" }], round: 0, tokens: 0, startedAt: Date.now() };
    return pushChains({ kind: "next", text: `Next up: ${def.prompt || def.name}` });
  },
  async stopChain() {
    if (chainsState.chain) chainsState.chain = { ...chainsState.chain, state: "stopped", why: "You stopped the chain." };
    return pushChains({ kind: "stopped", text: "You stopped the chain." });
  },
  async saveChain(def) {
    return { ...def, id: def.id || "my-chain" };
  },
  // options: M
  async getOptions() {
    return [...optionSessions.values()];
  },
  async answerOptions(id, a) {
    const s = optionSessions.get(id);
    if (!s) throw new Error("Those options aren't open anymore.");
    const problem = answerProblem(s, a);
    if (problem) throw new Error(problem);
    const next: OptionsSession = { ...s, last: a, waiting: false, state: a.action === "approve" ? "approved" : a.action === "other" ? "closed" : "working", ...(a.action === "approve" ? { approved: a.cards } : {}) };
    optionSessions.set(id, next);
    if (next.state === "working") {
      setTimeout(() => {
        const accents = ["#db2777", "#ea580c", "#7c3aed"];
        const base = a.action === "vary" || a.action === "tweak" ? s.cards[a.card] : undefined;
        const layout = base?.label === "Cards" || a.action === "combine" ? "cards" : "list";
        const inputs: OptionInput[] =
          a.action === "vary"
            ? accents.map((accent, i) => ({ label: `${base?.label ?? "Option"} · ${["warm", "bold", "violet"][i]}`, description: `Like ${a.card}, with a ${["warm", "bold", "violet"][i]} accent`, mockupHtml: todoMock({ accent, layout }) }))
            : [{ label: a.action === "combine" ? `${a.cards.join(" + ")}` : `${base?.label ?? "Option"}, changed`, description: a.action === "combine" ? (a.text ?? "The best of each") : a.action === "tweak" ? a.text : "", mockupHtml: todoMock({ accent: "#0f766e", layout, title: "Today" }) }];
        const grown = { ...addRound(next, roundFor(a), inputs), state: "asking" as const, waiting: true };
        optionSessions.set(id, grown);
        emit("options:update", grown);
      }, 700);
    }
    emit("options:update", next);
    return next;
  },
  ...prMock, // pr-ci
  ...lessonsMock, // review-lessons
  on(channel, cb) {
    let set = listeners.get(channel);
    if (!set) listeners.set(channel, (set = new Set()));
    set.add(cb as Listener);
    return () => set.delete(cb as Listener);
  },
};

// ---- R: a scripted start quest for the renderer (start-agent) ----
let startPlan: StartPlan | null = null;
let startSettings: StartSettings = { autoKeep: false };
const startAsks = new Map<string, (ok: boolean) => void>();
async function mockQuest(): Promise<void> {
  const name = project?.name ?? "todo-app";
  const step = (s: StartStep) => {
    if (!startPlan) return;
    startPlan = { ...startPlan, steps: startPlan.steps.map((x) => (x.id === s.id ? s : x)) };
    emit("start:step", s);
  };
  const plan = (p: Partial<StartPlan>) => emit("start:plan", (startPlan = { ...startPlan!, ...p }));
  startPlan = { projectRoot: project?.root ?? MOCK_ROOT, name, source: "project-skill", steps: [{ id: "recipe", title: "Read the \"run-todo-app\" recipe", kind: "check", state: "running", detail: "The project's own Claude skill: .claude/skills/run-todo-app/SKILL.md" }], services: [], state: "planning", recipes: [{ id: "project:run-todo-app", name: "run-todo-app", source: "project-skill", path: ".claude/skills/run-todo-app/SKILL.md" }, { id: "lessons:starting-apps", name: "Starting apps", source: "lessons", path: "prompts/skills/starting-apps.md" }], say: "Reading the project's run skill first." };
  emit("start:plan", startPlan);
  setStatus({ state: "starting" });
  await wait(900);
  const steps: StartStep[] = [
    { id: "recipe", title: "Read the \"run-todo-app\" recipe", kind: "check", state: "done", detail: "The project's own Claude skill" },
    { id: "install", title: "Install the packages", kind: "install", state: "pending", command: "pnpm install" },
    { id: "env", title: "Add the API's settings", kind: "env", state: "pending" },
    { id: "api", title: "Start the API on port 3001", kind: "service", state: "pending", command: "node --watch server/index.ts", service: "api" },
    { id: "web", title: "Start the web page on port 5173", kind: "service", state: "pending", command: "pnpm exec vite", service: "web" },
    { id: "skill", title: "Save what worked as a skill", kind: "other", state: "pending" },
  ];
  plan({ steps, state: "running", services: [{ name: "api", port: 3001 }, { name: "web", port: 5173 }], say: "Here's the plan. Installing first." });
  step({ ...steps[1]!, state: "running", output: "Lockfile is up to date, resolution step is skipped\nPackages: +214" });
  await wait(1000);
  step({ ...steps[1]!, state: "done", output: "Done in 2.1s" });
  const ask = await new Promise<boolean>((r) => {
    const id = hex(12);
    startAsks.set(id, r);
    step({ ...steps[2]!, state: "waiting_approval", ask: { id, kind: "env", title: "Write 2 settings to server/.env?", reason: "The API needs a database file and a session secret (DB_FILE, SESSION_SECRET)", file: "server/.env", keys: ["SESSION_SECRET"], category: "env" } });
    plan({ say: "The API needs two settings. Asking you first." });
  });
  step({ ...steps[2]!, state: ask ? "done" : "skipped", detail: ask ? "Wrote DB_FILE, SESSION_SECRET to server/.env" : "You said no to this" });
  step({ ...steps[3]!, state: "running", output: "$ node --watch server/index.ts\nError: Cannot find module 'better-sqlite3'" });
  plan({ say: "The API can't find its database driver. Rebuilding it." });
  await wait(1100);
  step({ ...steps[3]!, state: "failed", detail: "Error: Cannot find module 'better-sqlite3'", output: "Error: Cannot find module 'better-sqlite3'" });
  await wait(700);
  step({ ...steps[3]!, state: "running", output: "$ pnpm rebuild better-sqlite3\nAPI listening on http://localhost:3001" });
  await wait(900);
  step({ ...steps[3]!, state: "fixed", fix: "Rebuilt better-sqlite3 for this Node version", output: "API listening on http://localhost:3001" });
  step({ ...steps[4]!, state: "running", output: "VITE v7.3.7  ready in 312 ms\n➜  Local:   http://localhost:5173/" });
  await wait(700);
  step({ ...steps[4]!, state: "done", detail: "Answers: 200 \"Todos\"" });
  void bootApp();
  step({ ...steps[5]!, state: "running" });
  plan({ say: "It's up. Saving what worked as your run skill." });
  await wait(900);
  step({ ...steps[5]!, state: "done", detail: "New skill: Run todo-app" });
  // evolve-on-outcome: verified ready, so the draft applies and [Level Up] plays before [Quest Complete]
  const lesson = "Native modules need a rebuild after a Node upgrade";
  mockDrafts.unshift({ id: "mockdraft", skillId: "starting-apps", name: "Starting apps", reason: lesson, expect: "run", at: Date.now(), status: "applied", version: 2 });
  sysEvent("leveled", { id: "starting-apps", name: "Starting apps", when: "Any project", version: 2 }, { learned: lesson, draftId: "mockdraft" });
  plan({ state: "ready", skillId: "run-todo-app", say: "Done.", rewards: [{ kind: "acquired", skillId: "run-todo-app", name: "Run todo-app", level: 1, learned: "better-sqlite3 needs a rebuild after a Node upgrade" }, { kind: "leveled", skillId: "starting-apps", name: "Starting apps", level: 2, learned: lesson }] });
  mockQuestResult(`Get ${name} running`, { kind: "start", ms: 7400, firstTry: true, fixes: 1, skillsUsed: 1, verified: true, rewards: startPlan?.rewards ?? [] });
}

// ---- XP: a tiny in-memory ledger (progression) ----
const ledger = { xp: 0, quests: 0, fixes: 0, medals: { bronze: 0, silver: 0, gold: 0 }, cards: {} as Record<string, number>, recent: [] as import("@shrike/schema").QuestResult[] };
function mockProgress(): import("@shrike/schema").Progress {
  const t = titleOf(ledger.xp);
  return {
    xp: ledger.xp, title: t.title, titleIndex: t.index, titleFrom: t.from, ...(t.next ? { nextTitle: t.next, nextAt: t.nextAt } : {}),
    medals: { ...ledger.medals }, cards: CARDS.map((c) => ({ id: c.id, name: c.name, rarity: c.rarity, desc: c.desc, ...(ledger.cards[c.id] ? { at: ledger.cards[c.id] } : {}) })),
    quests: ledger.quests, bugsFixed: ledger.fixes, projectsStarted: ledger.quests ? 1 : 0, prsShipped: 0, recent: ledger.recent,
    formula: [{ label: "Get an app running", xp: XP_TABLE.clear.start }, { label: "Fix a bug and verify it", xp: XP_TABLE.clear.fix }, { label: "Verified", xp: XP_TABLE.verified }],
  };
}
function mockQuestResult(quest: string, f: QuestFacts): void {
  const s = scoreQuest(f);
  const before = ledger.xp;
  ledger.xp += s.xp;
  ledger.quests++;
  if (f.kind === "fix") ledger.fixes++;
  if (s.medal) ledger.medals[s.medal]++;
  const id = f.kind === "start" ? "first-start" : "first-fix";
  const card = CARDS.find((c) => c.id === id)!;
  const fresh = !ledger.cards[id];
  if (fresh) ledger.cards[id] = Date.now();
  const from = titleOf(before).title;
  const to = titleOf(ledger.xp).title;
  const result = { id: hex(8), kind: f.kind, quest, at: Date.now(), lines: s.lines, xp: s.xp, score: s.score, grade: s.grade, ...(s.medal ? { medal: s.medal } : {}), rewards: f.rewards, cards: fresh ? [{ id, name: card.name, rarity: card.rarity, desc: card.desc, at: Date.now() }] : [], before, after: ledger.xp, ...(from !== to ? { promoted: { from, to } } : {}) };
  ledger.recent = [...ledger.recent, result].slice(-20);
  emit("progress:update", { progress: mockProgress(), result });
}

export function installMockApi(): void {
  window.shrike = mockApi;
  window.__shrikeMock = true;
  // ?demo opens the sample, runs it and clicks "Add Todo", landing on the killer bug.
  if (new URLSearchParams(location.search).has("demo")) {
    project = makeProject(MOCK_ROOT);
    void mockApi.run().then(async () => {
      while (status.state !== "running") await wait(100);
      await wait(900);
      mockClick("add", "buy milk");
    });
  }
}
