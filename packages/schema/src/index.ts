// Shared contracts for every Shrike package. Types only: no runtime code.
// Spec and protocols: docs/mvp-contract.md

export type Precision = "exact" | "approximate" | "unavailable";

export interface SourceLocation {
  file: string; // repo-relative, forward slashes (e.g. "server/todos.controller.ts")
  line: number; // 1-based
  column?: number;
  functionName?: string;
  precision: Precision;
}

export type EventKind = "user_action" | "http_request" | "function" | "db_query" | "cache_op" | "external_call" | "log" | "error";

// A place where code runs or data lives. Lanes are discovered from places (docs/12-feature-map.md, D1–D13).
export type PlaceKind = "caller" | "client" | "service" | "queue" | "cache" | "data" | "outside";
export interface Place {
  id: string; // stable key, e.g. "service:api", "data:sqlite:events.db", "outside:api.stripe.com", "caller:curl"
  kind: PlaceKind;
  name: string; // short lane label: "API", "SQLITE · events.db", "STRIPE"
  detail?: string; // e.g. "localhost:4100", "api.stripe.com"
}
export type Origin = "browser" | "server" | "db" | "explorer" | "agent";
export type Status = "ok" | "slow" | "error";

export interface DebugEvent {
  id: string; // 16 lowercase hex chars
  traceId: string; // 32 lowercase hex chars; one per Action
  parentId?: string;
  origin: Origin;
  kind: EventKind;
  name: string; // "Clicked \"Add Todo\"", "POST /api/todos", "createTodo()", "INSERT INTO todos"
  startMs: number; // epoch ms (Date.now() or performance.timeOrigin + performance.now())
  durationMs?: number;
  status: Status;
  source?: SourceLocation; // where this thing is defined / happened
  callSite?: SourceLocation; // for function events: the line that called it
  framework?: boolean;
  otel?: true; // recorded through OpenTelemetry: steps, but no values or row changes
  trigger?: "click" | "submit" | "navigation" | "explorer" | "agent" | "server"; // user_action only
  http?: {
    method: string;
    url: string; // path + query for same-origin, full URL otherwise
    status?: number;
    reqHeaders?: Record<string, string>;
    resHeaders?: Record<string, string>;
    serverTiming?: { name: string; durMs?: number; desc?: string }[]; // #59: parsed Server-Timing, ≤ 20 entries
    serverTraceId?: string; // #59: trace ID from the traceresponse header, the one the server used (not Shrike's traceId)
    reqBody?: string; // ≤ 64KB, truncated with "…[truncated]"
    resBody?: string;
    fromCache?: true; // #55: the browser's cache or the site's service worker answered, not the network
  };
  db?: { system: string; statement: string; params?: string };
  log?: { level: "debug" | "info" | "warn" | "error"; message: string };
  error?: { message: string; type?: string; stack?: string };
  args?: string[]; // util.inspect-style previews, each ≤ 2KB, already redacted
  returned?: string; // preview, ≤ 2KB
  stack?: string; // raw JS stack captured at call time (browser http_request, or a React 19 user_action's JSX); main resolves it into source
  target?: { x: number; y: number; width: number; height: number; viewportWidth: number; viewportHeight: number }; // user_action click target rect (CSS px)
  place?: Place; // where this event ran; set by agents or main (services, datastores, outside hosts, callers)
  cache?: { op: string; key?: string; path?: string; hit?: boolean }; // cache_op: op "get" | "set" | "del" | "incr" | ...; hit for reads
  caller?: { kind: "browser" | "curl" | "postman" | "explorer" | "agent" | "cron" | "test" | "service" | "other"; label: string; command?: string }; // user_action roots that didn't start in a browser
  change?: DataChange; // I3: db_query writes, captured by node-agent around the statement
  resendOf?: string; // AP: user_action roots, the trip this request edited and resent
  live?: true; // set by main on events from a live site's page (#54); never trusted from the page
}

// docs/13 I: place inspector
export type Cell = string | number | boolean | null;
export interface DataChange {
  table: string;
  op: "insert" | "update" | "delete";
  count?: number; // rows the statement changed; unset when the database didn't say (Supabase with Prefer: return=minimal)
  rows?: { pk?: string; before?: Record<string, Cell>; after?: Record<string, Cell> }[]; // at most 5, redacted
}
export type DataSystem = "sqlite" | "postgres" | "mysql" | "mongodb" | "supabase" | "dynamodb" | "firestore"; // docs/13 DB
export type InspectRequest =
  | { op: "tables"; placeId: string }
  | { op: "rows"; placeId: string; table: string; limit?: number; offset?: number; orderBy?: string; desc?: boolean; search?: string }
  | { op: "cacheKeys"; placeId: string; limit?: number; cursor?: string; match?: string }
  | { op: "cacheGet"; placeId: string; key: string };
export type InspectResult =
  | { op: "tables"; system: DataSystem; how: string; tables: { name: string; rows: number; columns: { name: string; pk: boolean }[] }[] }
  | { op: "rows"; table: string; columns: string[]; pk: string[]; rows: Cell[][]; total: number }
  | { op: "cacheKeys"; system: "lru" | "redis"; size: number; max?: number; entries: { key: string; preview: string; type?: string; ttlMs: number | null; bytes?: number }[]; cursor?: string }
  | { op: "cacheGet"; key: string; type?: string; value: string };

export interface TimelineNode {
  event: DebugEvent;
  children: TimelineNode[];
}

export interface Flag {
  kind: "slow" | "n_plus_one" | "sequential" | "duplicate_request" | "swallowed_error" | "cache_never_hit" | "slow_outside" | "empty_result" | "blocked_request";
  eventId: string;
  message: string; // plain English, one sentence, includes numbers
  source?: SourceLocation;
}

export interface WhatHappenedStep {
  ok: boolean;
  text: string;
  eventId: string;
  source?: SourceLocation;
}

export interface WhatHappened {
  headline: string;
  steps: WhatHappenedStep[];
  stats: { files: number; functions: number; requests: number; queries: number; logs: number; errors: number; totalMs: number };
}

export interface ActionView {
  id: string; // == id of the root user_action event
  traceId: string;
  trigger: NonNullable<DebugEvent["trigger"]>;
  label: string;
  startMs: number;
  durationMs: number;
  status: Status;
  complete: boolean;
  tree: TimelineNode[]; // children of the root user_action event (root itself not repeated)
  root: DebugEvent;
  summary: WhatHappened;
  flags: Flag[];
}

export interface Route {
  method: string;
  path: string;
  handler?: SourceLocation;
}

export interface ProcessSpec {
  name: string; // "web", "api", "auth" (becomes SHRIKE_SERVICE)
  command: string;
  cwd?: string; // relative to the project root
  url?: string; // where it listens, if known
}

export interface ProjectInfo {
  root: string; // absolute
  name: string;
  frontend?: string; // "vite-react" | "next" | ...
  backend?: string; // "express" | "next" | ...
  devCommand: string;
  appUrl?: string; // absent for backend-only projects
  routes: Route[];
  processes: ProcessSpec[]; // at least one; the single-command case is [{ name: "app", command: devCommand }]
  expectedPlaces: Place[]; // D11: guessed before anything runs
  declaredPlaces?: Record<string, { kind: PlaceKind; name: string }>; // D8, from .shrike/config.json "places" (key = host:port or db target)
  notes?: string[]; // plain-words caveats about how Shrike will start it (shown in Setup)
  placesFrom?: "plan" | "skill"; // expectedPlaces came from Claude's start plan or the run skill; absent = the scanner's guess (lanes-from-plan)
  liveUrl?: string; // .shrike/config.json "liveUrl": the deployed site (#54); with no dev command, Run opens it instead of starting anything
  origins?: string[]; // .shrike/config.json "origins": extra API hosts the user lists for the live site
  livePartition?: string; // set by main with liveUrl: the live site's own session (#55), so its logins survive restarts and never mix with the local pane's
  redact?: RedactRules; // .shrike/config.json "redact" (#52), validated by main; a broken block is dropped with a note
}

// #52 (docs/07 rule 6): keys and headers are redacted at the store in every mode; keep only spares values from masking
export interface RedactRules {
  keys?: string[];
  headers?: string[];
  keep?: string[];
}

export interface RunStatus {
  state: "idle" | "starting" | "running" | "stopped" | "error";
  url?: string;
  error?: string;
  instrumented?: boolean; // true once node-agent said hello
  processes?: { name: string; state: "starting" | "running" | "stopped" | "error"; pid?: number; url?: string; instrumented?: boolean; error?: string }[];
}

export interface MemoryNote {
  id: string;
  text: string; // "userId must be a number"
  file?: string;
  line?: number;
  createdAt: number;
  by: "agent" | "user";
}

export interface Checkpoint {
  id: string;
  patchId: string;
  label: string; // "Fix userId in createTodo"
  files: string[];
  createdAt: number;
  current: boolean; // false once rewound past
}

export interface Skill {
  id: string; // file name without .md (or the skill folder name)
  name: string; // "N+1 hunter"
  when: string; // one line: when it applies
  source?: "builtin" | "project" | "personal" | "claude"; // S1/S2: prompts/skills, .shrike/skills, ~/.shrike/skills, ~/.claude/skills (read-only)
  path?: string; // absolute path of the skill file
  readOnly?: boolean; // claude-sourced skills are never edited in place
  version?: number;
  uses?: number;
  proficiency?: number; // SL4: successful uses (system)
  improvedAt?: number;
  kind?: "debug" | "flow" | "git" | "run" | "chain"; // what running it does; run = how to start the app (R4, start-agent); chain = a prompt chain (P4)
  steps?: string[]; // S3: the checklist shown while it runs (its numbered list or its sections) (skills engineer)
  usesMcp?: string[]; // MCP7: MCP servers it needs, from front matter `uses-mcp: [chrome-devtools]`
}

export interface SkillProposal { // S4: an improvement the agent suggests after a run
  id: string;
  skillId: string;
  reason: string; // "Learned: port 5173 is often taken, check it first"
  before: string;
  after: string;
}

export type SkillOutcome = "run" | "fix" | "flow" | "ship" | "conflicts" | "ci" | "review" | "design" | "quest" | "preflight" | "reviewed"; // what a skill-driven action must reach before its learnings are kept (evolve-on-outcome)
export interface SkillDraft { // a learning waiting for its outcome (evolve-on-outcome)
  id: string;
  skillId: string;
  name: string;
  reason: string; // "wait for MySQL login before seeding"
  expect: SkillOutcome;
  runId?: string;
  at: number;
  status: "pending" | "applied" | "undone" | "discarded" | "superseded";
  missed?: string; // why the last run didn't count: "the app never came up"
  version?: number; // applied: the version it wrote
}

export interface FlowStep {
  type: "click" | "type" | "navigate" | "wait" | "request";
  name?: string; // accessible name of the target element
  text?: string;
  url?: string;
  ms?: number;
  request?: HttpRequestSpec;
  assert?: ApiAssertion[]; // request: checked on replay instead of "answered 4xx/5xx" (AP Save as test)
  submit?: boolean; // type: Enter submitted the form (flows engineer)
  secret?: boolean; // type: a password-like field; text is encrypted on this machine, never stored in clear (flows engineer)
}

export interface Flow { // B1/B2: a recorded, replayable sequence of user steps
  id: string;
  name: string;
  steps: FlowStep[];
  watch?: { mode: "save" | "interval"; minutes?: number }; // B3
  lastRun?: { at: number; ok: boolean; actionIds: string[] };
}

export interface GitState { // G*
  isRepo: boolean;
  branch?: string;
  upstream?: string;
  ahead: number;
  behind: number;
  changed: { path: string; status: string }[]; // porcelain status letters
  conflicts: string[]; // files with merge conflicts
  ghReady: boolean; // gh installed and authenticated
  pr?: PullRequest; // PR for the current branch, if any
  // git engineer: G1/G3/G6 extras
  base?: string; // the default branch ("main")
  operation?: "rebase" | "merge"; // a sync stopped part way (conflicts)
  incoming?: { sha: string; subject: string }[]; // commits on origin/<base> not in this branch, as of the last fetch (G6 preview)
  ghProblem?: "missing" | "signed-out" | "offline"; // why ghReady is false
  gitMissing?: boolean; // git itself isn't on this computer (not "this folder isn't a repo")
  onBranch?: number; // commits on this branch that its base doesn't have (Ship opens a PR for them)
}

export interface PullRequest {
  number: number;
  title: string;
  url: string;
  state: "open" | "closed" | "merged";
  checks: { name: string; state: "pass" | "fail" | "pending" | "skipped"; url?: string; summary?: string; lines?: string[] }[]; // G4: summary/lines on failing checks
}

// SC: the Changes dock (docs/13 SC1–SC7). Paths are project-relative.
export type ScmArea = "conflicts" | "staged" | "changes" | "untracked" | "branch";
export interface ScmFile {
  path: string;
  oldPath?: string; // renames
  letter: "U" | "M" | "A" | "D" | "R" | "C" | "!"; // ! = conflict
  area: ScmArea;
  added?: number; // absent for binary files
  removed?: number;
}
export interface ScmCommit {
  sha: string;
  short: string;
  author: string;
  at: number; // ms
  subject: string;
  mine: boolean; // on this branch, not on its base
  pushed: boolean; // on a remote
}
export interface ScmState {
  isRepo: boolean;
  gitMissing?: boolean; // git itself isn't on this computer
  branch?: string;
  upstream?: string; // "origin/fix-x"
  ahead: number; // vs upstream
  behind: number;
  base?: string; // "main"
  baseAhead: number; // this branch's commits not on base
  baseBehind: number; // base's commits not on this branch
  remote?: string;
  web?: boolean; // Open on GitHub works
  pull: "rebase" | "ff-only"; // how Sync pulls (git config pull.rebase)
  files: ScmFile[];
  commits: ScmCommit[]; // newest first, at most 30
  undo?: string; // subject of the commit Shrike just made, while it can still be undone
  operation?: "rebase" | "merge";
}
export interface ScmDiffLine {
  kind: "add" | "del" | "ctx";
  text: string;
  old?: number;
  new?: number;
}
export interface ScmDiff {
  path: string;
  oldPath?: string;
  binary: boolean;
  tooBig?: boolean;
  hunks: { header: string; lines: ScmDiffLine[] }[];
}
export interface ScmTarget {
  path: string;
  area: ScmArea | "commit";
  sha?: string; // area "commit"
}

// PR: the pull request and CI panel (docs/13 PR1–PR8)
export interface PrCheck {
  name: string;
  state: "pass" | "fail" | "pending" | "skipped";
  url?: string;
  workflow?: string;
  startedAt?: string;
  completedAt?: string;
  run?: string; // GitHub Actions run id, when the check is one
}
export interface PrComment {
  id: string; // GraphQL node id (reactions, replies)
  author: string;
  bot: boolean;
  body: string; // markdown, shown through the safe renderer only
  at: string;
  url?: string;
  reactions: { content: PrReaction; count: number; mine: boolean }[];
}
export type PrReaction = "THUMBS_UP" | "THUMBS_DOWN" | "LAUGH" | "HOORAY" | "CONFUSED" | "HEART" | "ROCKET" | "EYES";
export interface PrThread {
  id: string;
  path: string;
  line?: number;
  resolved: boolean;
  outdated: boolean;
  comments: PrComment[];
}
export interface PrReview {
  id: string;
  author: string;
  bot: boolean;
  state: "approved" | "changes" | "commented" | "dismissed" | "pending";
  body: string;
  at?: string;
}
export interface PrInfo {
  id: string; // node id
  number: number;
  title: string;
  url: string;
  state: "open" | "draft" | "merged" | "closed";
  author: string;
  updatedAt: string;
  base: string;
  head: string;
  decision?: "approved" | "changes" | "review"; // reviewDecision
}
export interface PrView {
  ghReady: boolean;
  problem?: string; // plain words when gh can't be used
  branch?: string;
  prefix?: string; // the project folder inside the repo ("" or "apps/web/"): GitHub paths are repo paths
  viewer?: string; // the signed-in GitHub login
  pr?: PrInfo; // absent: no pull request for this branch yet, checks come from its workflow runs
  checks: PrCheck[];
  threads: PrThread[];
  comments: PrComment[]; // conversation comments
  reviews: PrReview[];
  at: number;
}
export interface PrCheckJob {
  steps: { name: string; state: PrCheck["state"]; seconds?: number }[];
  summary?: string; // failing checks: the first problem in plain words
  lines: string[]; // failing checks: the log tail
}
export type PrAction =
  | { kind: "reply"; n: number; threadId: string; body: string }
  | { kind: "comment"; n: number; body: string }
  | { kind: "react"; n: number; subjectId: string; content: PrReaction }
  | { kind: "resolve"; n: number; threadId: string; resolved: boolean }
  | { kind: "review"; n: number; event: "COMMENT" | "APPROVE" | "REQUEST_CHANGES"; body: string }
  | { kind: "ready"; n: number }
  | { kind: "rerun"; run: string };
export type PrAgentTask =
  | { kind: "queue"; n: number; commentId: string } // Up next: address this comment
  | { kind: "fix-all"; n: number } // one run over every open thread, ending with a reply draft per thread
  | { kind: "fix-check"; n?: number; name: string };

// CI: CI lessons and pre-flight (docs/13 CI1 to CI8). Read from the CI config and gh run history (reads only).
export type CiFailureKind = "format" | "lint" | "types" | "tests" | "build" | "install" | "memory" | "env" | "schema" | "secrets" | "network" | "unknown";
export interface CiStep {
  name: string;
  run?: string; // the command, with ${{ env.X }} and ${{ matrix.x }} filled in
  cwd?: string; // repo-relative working-directory
  env?: Record<string, string>; // the step's own env
  local: "run" | "prep" | "skip"; // prep: an install or a tool download, run here only when needed
  why?: string; // prep and skip, in plain words
}
export interface CiJob {
  id: string; // "<file>#<job>[/<called job>][:<matrix leg>]"
  name: string; // as GitHub shows it: "ci / Dashboard lint"
  workflow: string;
  file: string; // repo-relative config file
  system: "github" | "gitlab" | "jenkins" | "circleci";
  stage: number; // 0-based, from needs (GitLab: its stage)
  stageName?: string;
  needs: string[]; // job ids
  node?: string; // "22"
  services: { name: string; image?: string; port?: number }[];
  env: Record<string, string>; // literal values only
  secrets: string[]; // env names CI fills from secrets (never read)
  steps: CiStep[];
  scope: string[]; // repo-relative folders and files that make it matter; empty: every change
  paths?: string[]; // the workflow's own paths filter
  pathsIgnore?: string[];
  off?: string; // why it doesn't run on a pull request
  stats?: { runs: number; fails: number; flaky: number; seconds?: number; last?: { kind: CiFailureKind; line: string; at?: string } };
}
export interface CiPipeline {
  systems: CiJob["system"][];
  files: string[]; // config files read
  jobs: CiJob[];
  history: { runs: number; problem?: string };
  at: number;
}
export interface PreflightLeg {
  job: string; // CiJob.id
  name: string;
  state: "waiting" | "running" | "pass" | "fail" | "skipped";
  why?: string; // skipped: why; failed: the cause in plain words
  kind?: CiFailureKind;
  fix?: string;
  line?: string; // the first failing line
  command?: string; // running now, or the one that failed
  tail?: string[]; // the last lines while it runs; the failing lines once red
  seconds?: number;
}
export interface PreflightRun {
  id: string;
  at: number;
  sha?: string;
  tree?: string; // the tracked files it ran on, to match the push
  branch?: string;
  state: "running" | "done" | "stopped";
  files: number; // changed files it looked at
  legs: PreflightLeg[];
  warnings: string[]; // what can't match CI here
  safe?: boolean;
  verdict?: string;
  from: "map" | "skill" | "draft"; // where the legs came from: the CI config, the lessons skill, or its pending draft (being tried)
  hosted?: { sha: string; state: "waiting" | "done" | "gave-up"; jobs: { name: string; state: PrCheck["state"] }[]; matched?: boolean; first?: string }; // CI5
}
export interface CiLessonsState {
  ready: boolean; // the project has CI config Shrike can read
  problem?: string;
  pipeline: CiPipeline | null;
  touched: string[]; // job ids the current change touches
  files: number; // changed files against the base
  run: PreflightRun | null; // the newest
  record: { pushes: ("clean" | "surprise" | "caught" | "waiting")[]; surprises: number; streak: number }; // CI6, the last 8, oldest first
  skill?: { version: number; pending: boolean; lessons: number };
  busy?: "reading" | "learning";
  note?: string;
}

// RL: review lessons and reviewer profiles (docs/13 RL1 to RL9), mined read-only from your PRs' review threads
export interface ReviewExample {
  commentId: string; // the thread's first comment (or the review) node id
  pr: number;
  url?: string;
  path?: string;
  line?: number;
  reviewer: string;
  at: string;
  quote: string; // the first lines, redacted
}
export interface ReviewLesson {
  id: string;
  title: string; // "Missing loading state"
  spot: string; // how to spot it
  fix: string[]; // how to fix it, in steps
  count: number;
  prs: number[]; // newest first
  reviewers: string[]; // most first
  trend: "up" | "down" | "flat";
  spark: number[]; // per reviewed PR, the last 12, oldest first
  clean: number; // reviewed PRs since it last came up
  rank: SkillRank; // E (0 clean) to S (5 or more)
  status: "learning" | "not-working" | "mastered";
  pending?: boolean; // its newest text waits for a reviewer (an S4 draft)
  examples: ReviewExample[]; // newest first, at most 5
}
export interface ReviewerProfile {
  login: string;
  bot: boolean;
  prs: number; // your PRs they reviewed
  comments: number;
  perPr: number[]; // comments on each PR they reviewed, oldest first, the last 10
  trend: "up" | "down" | "flat";
  blocking: number;
  nits: number;
  questions: number;
  notes: number;
  approvals: number;
  changes: number; // changes requested
  concerns: { lessonId: string; title: string; count: number }[]; // ranked
  style: string[]; // conventions in plain words (from the brain)
  habit?: string;
}
export interface SelfCheck {
  key: string; // the change it checked (HEAD and the working tree)
  at: number;
  state: "checking" | "done" | "failed";
  reviewers: string[]; // likely reviewers: CODEOWNERS, then recent ones
  checked: number; // lessons checked
  found: { lessonId: string; title: string; where?: string; fixed?: boolean }[];
  note?: string; // failed: why, in plain words
  by: "shrike" | "agent";
}
export interface ReviewLessonsView {
  ready: boolean; // gh is set up and the project is a GitHub repo
  problem?: string;
  repo?: string; // "owner/name"
  viewer?: string;
  limit: number; // how many of your PRs to read
  prs: number; // read so far
  reviewed: number; // of those, PRs someone reviewed
  minedAt?: number;
  busy?: "mining" | "thinking";
  lessons: ReviewLesson[]; // most first
  reviewers: ReviewerProfile[];
  burn: { pr: number; flagged: number }[]; // repeat issues per reviewed PR, the last 12, oldest first
  byComment: Record<string, { lessonId: string; nth: number; title: string }>; // RL8 chips
  skill?: { version: number; pending: boolean };
  check?: SelfCheck;
}
export interface LearnComment {
  commentId: string;
  pr: number;
  author: string;
  body: string;
  at: string;
  url?: string;
  path?: string;
  line?: number;
}
export interface SelfReviewResult {
  lesson: string; // id or title
  found: boolean;
  fixed?: boolean;
  where?: string;
}

export interface Worktree { // W*
  name: string; // "main", "fix-userid"
  path: string; // absolute
  branch: string;
  current: boolean; // the one Shrike is showing
  running: boolean;
  portOffset: number; // W2: added to every known port of this worktree's processes
  note?: string; // "sandbox fix", "race: approach B"
}

export type WorkspaceGroup = "working" | "needs-you" | "review" | "done" | "idle";
export interface Workspace { // WS1: one row of the workspaces rail (a worktree of a project Shrike knows)
  path: string; // absolute folder Shrike opens
  projectRoot: string; // the repo's main checkout
  project: string; // project name
  name: string; // "main", a Shrike worktree name, or the folder name of a worktree made outside Shrike
  label?: string; // the user's own name for it (Rename)
  kind: "main" | "shrike" | "git";
  branch: string;
  current: boolean;
  running: boolean;
  port?: number;
  portOffset: number;
  agent: "idle" | "working" | "waiting" | "done";
  pr?: { number: number; state: "open" | "closed" | "merged"; url: string; draft?: boolean };
  ahead?: number;
  behind?: number;
  changes?: number; // uncommitted files
  group: WorkspaceGroup;
  note?: string;
}
export type WorkspaceFrom = { kind: "smart"; text: string } | { kind: "pr"; number: number } | { kind: "branch"; branch: string } | { kind: "name"; name: string };
export interface CreateWorkspace { // WS2
  project: string; // main checkout
  from: WorkspaceFrom;
  base?: string; // a new name starts from this branch instead of your code as it is now
  portOffset?: number;
  copyEnv?: boolean; // default true
}
export interface WorkspaceSources { // WS2: what the dialog offers, all read-only
  current: string; // the main checkout's branch
  branches: { name: string; remote: boolean }[];
  prs: { number: number; title: string; branch: string; author?: string; draft?: boolean }[];
  prsError?: string; // gh missing or signed out, in plain words
  location: string; // where new workspaces go
}

export interface Race { // W3: candidate fixes raced in worktrees
  id: string;
  kind?: "race" | "sandbox"; // W4: a single fix tried in a sandbox worktree
  actionId: string; // the broken trip being fixed
  adopted?: string; // worktree whose fix was brought into the user's code
  candidates: {
    worktree: string;
    approach: string;
    state: "thinking" | "patched" | "rerunning" | "green" | "red" | "failed";
    rerunActionId?: string;
    patchId?: string;
    files?: string[]; // what the fix changed
    summary?: string; // the agent's last line, or why it failed
    rerun?: ActionView; // the re-run trip, recorded in that worktree (not in the shown trips)
    runId?: string; // X7 (xray): the candidate's agent run; its steps arrive on "race:step"
  }[];
}

export type SdlcStage = "spot" | "understand" | "fix" | "prove" | "review" | "ship" | "watch";
export interface SdlcState { // L*
  actionId: string | null; // the change in flight
  stages: Record<SdlcStage, "idle" | "active" | "done" | "failed" | "skipped">;
  detail: Partial<Record<SdlcStage, string>>; // one plain sentence per stage
  review?: Finding[]; // L5: what "Review this fix" raised (sdlc engineer)
  tests?: string; // L4: the test run's plain summary (sdlc engineer)
  hasTests?: boolean; // L4: the project has a real test script, so "Run the tests" can do something
  build?: BuildRail; // L8–L15: the quest in flight (quests)
}

// L8–L15 + QB: the Build rail and quests (quests)
export type BuildStage = "idea" | "plan" | "design" | "build" | "prove" | "review" | "ship" | "live";
export interface BuildRail {
  questId: string;
  title: string;
  stages: Record<BuildStage, SdlcState["stages"][SdlcStage]>;
  detail: Partial<Record<BuildStage, string>>;
}
export interface QuestObjective {
  id: string; // "o1"
  text: string; // plain words: "Click a todo's title to edit it"
  doneWhen: string; // "Editing a todo keeps the new title"
  flowId?: string; // the recorded journey that proves it (QB6)
  state: "todo" | "working" | "done" | "failed" | "dropped";
  runAt?: number; // the flow run last counted
  linkedAt?: number; // only a run after this counts (a new flow or new words start the proof over)
  sentAt?: number; // sent to the agent's up next
  workspace?: string; // sent to a new workspace
}
export interface Quest { // .shrike/quests/<id>.json
  id: string;
  title: string;
  idea: string;
  state: "planning" | "active" | "complete" | "dropped";
  objectives: QuestObjective[];
  issue?: { number: number; url: string; imported?: boolean }; // imported from, or opened as, a GitHub issue
  runId?: string; // the plan-feature run
  waiting?: boolean; // propose_quest is waiting on the user's approval
  reds?: number; // red objective runs on the way (XP)
  createdAt: number;
  updatedAt: number;
  focusAt?: number; // QB5: the one that glows
  completedAt?: number;
}
export interface GhIssue { number: number; title: string; url: string; body: string; labels: string[] }
export type QuestAct =
  | { kind: "focus" }
  | { kind: "drop" }
  | { kind: "open-issue" }
  | { kind: "link"; objective: string; flowId: string | null }
  | { kind: "check"; objective: string }
  | { kind: "sent"; objective: string; workspace?: string };
export interface QuestHost { // QB9: what the MCP tools need from main
  list(): Promise<Quest[]>;
  flows(): Promise<Flow[]>;
  propose(p: { questId?: string; title: string; objectives: { text: string; doneWhen: string; flowId?: string }[] }): Promise<{ approved: boolean; quest: Quest }>;
  updateObjective(questId: string, objectiveId: string | undefined, patch: { text?: string; doneWhen?: string; state?: "todo" | "working" | "dropped" }): Promise<Quest>;
  linkFlow(questId: string, objectiveId: string, flow: { id?: string; name?: string; steps?: FlowStep[] }): Promise<{ quest: Quest; flow: Flow }>;
}

export interface AgentOptions { // hidden moves made obvious
  planFirst?: boolean;
  thinking?: "quick" | "normal" | "deep";
  skillId?: string; // run with this skill loaded (S3)
  useMyMcp?: boolean; // B4: also give the brain the user's own MCP servers
  worktree?: string; // run against this worktree
  context?: string[]; // extra context lines (point picks, dragged stations)
}

// MCP: the tools hub (docs/13 MCP). Shrike reads Claude Code's MCP config, keeps its own in ~/.shrike/mcp.json and <project>/.shrike/mcp.json.
export type McpSource = "claude-user" | "claude-project" | "claude-local" | "shrike-personal" | "shrike-project";
export interface McpTool {
  name: string;
  description?: string;
}
export interface McpHealth {
  state: "checking" | "ok" | "failed";
  tools?: McpTool[];
  error?: string; // plain words, redacted
  at: number;
  ms?: number;
}
export interface McpServerView {
  name: string;
  source: McpSource;
  transport: "stdio" | "http" | "sse";
  command?: string; // command and args as one line (secrets are ${NAME} placeholders or redacted)
  url?: string; // redacted
  envNames: string[]; // names only, never values
  headerNames: string[];
  purpose: string; // plain words: from the catalog when Shrike knows it
  glyph: string; // a key of mcpGlyph in design-system/tokens.ts
  catalogId?: string;
  enabled: boolean; // this project's own on/off (Shrike's setting, userData)
  trusted: boolean; // project-file servers start only after one trust click (or Claude Code's own approval)
  missing: string[]; // ${NAME}s with no value in Shrike's keychain
  shadows?: McpSource[]; // the same name at lower-precedence sources, which this one hides
  health?: McpHealth;
}
export interface McpCatalogField {
  name: string; // env or ${NAME} placeholder
  label: string; // plain words: "GitHub token"
  secret: boolean; // secrets go to the keychain; others (a path) into the config as text
  hint?: string;
}
export interface McpCatalogEntry {
  id: string;
  name: string;
  purpose: string; // plain words
  why: string; // "why you'd want it"
  glyph: string;
  transport: "stdio" | "http";
  command?: string;
  args?: string[];
  url?: string;
  headers?: Record<string, string>; // values may hold ${NAME}
  env?: Record<string, string>; // values may hold ${NAME}
  fields: McpCatalogField[];
  install?: string; // pre-download command, run through the guarded shell after an approval
  scope?: "project"; // only makes sense per project (filesystem)
  signals?: string[]; // MCP3: place ids or facts that make it a recommendation: "data:postgres", "client", "github"
  match?: string[]; // words in a command or url that mean a configured server is this one
}
export interface McpRecommendation {
  id: string; // catalog id
  why: string; // "Your app talks to Postgres"
}
export interface McpHubState {
  servers: McpServerView[];
  catalog: McpCatalogEntry[];
  recommended: McpRecommendation[];
  project?: string; // root the per-project switches belong to
}
export type McpAddRequest =
  | { kind: "catalog"; id: string; scope: "personal" | "project"; values: Record<string, string> }
  | { kind: "paste"; text: string; scope: "personal" | "project"; name?: string; values: Record<string, string> };
/** MCP9: what the user copies to use Shrike from their own Claude Code. Shrike never writes these anywhere itself. */
export interface ConnectInfo {
  url: string;
  token: string;
  command: string; // claude mcp add --transport http ...
  configCommand: string; // claude --mcp-config '<userData>/mcp.json'
  skill: string; // SKILL.md text for ~/.claude/skills/shrike/
  settings: string; // permissions.deny for Claude Code's own edit and shell tools
  clients: { name: string; at: number }[]; // outside clients since Shrike opened, last call time, newest first
  movedFrom?: number; // the saved port was taken, so the address changed this session
}

export interface AgentUsage {
  runId: string;
  inputTokens: number;
  outputTokens: number;
  contextTokens?: number; // tokens in the current context window
  contextLimit?: number;
  costUsd?: number;
  rateLimitResetsAt?: number; // O12: epoch ms when the brain's usage window resets, when reported
}

export interface PointPick {
  selector: string;
  text: string; // accessible name or visible text, <= 80 chars
  role: string;
  rect: { x: number; y: number; width: number; height: number; viewportWidth: number; viewportHeight: number };
  source?: SourceLocation; // React component location when known
}

export interface FileNode {
  name: string;
  path: string; // repo-relative
  dir: boolean;
  children?: FileNode[]; // a folder without children is collapsed
  ignored?: boolean; // FV: gitignored (node_modules, dist), drawn dimmed
  count?: number; // FV: files inside a folder, all of them, listed or not
  fold?: number; // FV: a fold row standing for this many hidden files
}

export interface HttpRequestSpec {
  method: string;
  url: string; // absolute, or path relative to the app URL
  headers?: Record<string, string>;
  body?: string;
  name?: string; // AP: the request's name, shown as the trip's caller
  resendOf?: string; // AP: the trip this edits and resends
}

export interface HttpResponseSpec {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  durationMs: number;
}

// AP · API client (docs/13): Bruno-compatible collections on disk, sent from main (apps/desktop/src/main/api)
export interface ApiKv {
  name: string;
  value: string;
  enabled: boolean;
  secret?: boolean; // environment vars only: the value lives in the keychain, never in a file
}
export type ApiAuth =
  | { type: "inherit" }
  | { type: "none" }
  | { type: "bearer"; token: string }
  | { type: "basic"; username: string; password: string }
  | { type: "apikey"; key: string; value: string; placement: "header" | "query" };
export type ApiBody =
  | { type: "none" }
  | { type: "json" | "text" | "xml"; data: string }
  | { type: "form-urlencoded"; fields: ApiKv[] }
  | { type: "multipart"; fields: (ApiKv & { file?: boolean })[] } // file: value is an absolute path the user picked
  | { type: "graphql"; query: string; variables: string };
export interface ApiAssertion {
  expr: string; // "res.status", "res.body.user.id", "res.headers.content-type", "res.responseTime"
  op: string; // Bruno operators: eq neq gt gte lt lte in notIn contains notContains startsWith endsWith matches notMatches between length isEmpty isNotEmpty isNull isDefined isUndefined isTruthy isFalsy isNumber isString isBoolean isArray isJson
  value: string;
  enabled: boolean;
}
export interface ApiRequest {
  path: string; // collection-relative file, e.g. "users/Get user.bru"; "" when unsaved
  name: string;
  seq?: number;
  method: string;
  url: string; // may hold {{vars}}
  params: ApiKv[]; // query
  pathParams: ApiKv[]; // :id in the url
  headers: ApiKv[];
  body: ApiBody;
  auth: ApiAuth;
  vars: { pre: ApiKv[]; post: ApiKv[] }; // post value is a response expression, e.g. res.body.token
  assertions: ApiAssertion[];
  scripts: { pre?: string; post?: string; tests?: string };
  settings: { timeoutMs?: number; followRedirects?: boolean; maxRedirects?: number; verifyTls?: boolean; encodeUrl?: boolean };
  docs?: string;
}
export type ApiTreeNode =
  | { type: "folder"; name: string; path: string; seq?: number; children: ApiTreeNode[] }
  | { type: "request"; name: string; path: string; method: string; seq?: number };
export interface ApiEnvironment {
  name: string;
  vars: ApiKv[]; // secret values are filled from the keychain when read
}
export interface ApiCollection {
  id: string; // stable hash of root
  root: string; // absolute folder
  name: string;
  format: "bru" | "yaml"; // bru: bruno.json + *.bru; yaml: OpenCollection (opencollection.yml + *.yml)
  owned: boolean; // true for <project>/.shrike/api/*, false for a linked Bruno folder
  tree: ApiTreeNode[];
  environments: string[];
  defaults: { headers: ApiKv[]; auth: ApiAuth; vars: ApiKv[] };
  warnings: string[]; // plain words, e.g. "Get user has a token saved in the file."
}
export interface ApiTimings {
  dnsMs?: number;
  connectMs?: number;
  tlsMs?: number;
  ttfbMs?: number;
  downloadMs?: number;
  totalMs: number;
}
export interface ApiResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string; // text, or base64 when bodyEncoding is base64 (binary, images)
  bodyEncoding: "text" | "base64";
  contentType?: string;
  size: number; // bytes received
  truncated: boolean;
  url: string; // final URL after redirects
  redirects: number;
  timings: ApiTimings;
}
export interface ApiAssertionResult extends ApiAssertion {
  ok: boolean;
  actual?: string;
  error?: string;
}
export interface ApiSendResult {
  sent: { method: string; url: string; headers: Record<string, string> };
  response?: ApiResponse;
  error?: string; // plain words: couldn't reach, timed out, cancelled
  actionId?: string; // the trip on the Thread
  assertions: ApiAssertionResult[];
  setVars: Record<string, string>; // from post-response vars and scripts
  logs: string[]; // console.log from scripts
  scriptError?: string;
}
export interface ApiSendOptions {
  collectionId?: string;
  environment?: string;
  sendId?: string; // pass the same id to apiCancel
  resendOf?: string; // AP Edit and resend: the trip this edits; set root.resendOf so the new trip sits under it
}
export interface ApiHistoryEntry {
  id: string;
  at: number;
  method: string;
  url: string;
  status?: number;
  durationMs?: number;
  actionId?: string;
  collectionId?: string;
  request: ApiRequest; // redacted
}
export type ApiImportKind = "curl" | "postman" | "openapi" | "bruno" | "routes";
export type ApiCodeLang = "curl" | "fetch" | "axios" | "python" | "httpie";

// AP20: the Routes page. One entry per method + path, from the OpenAPI spec, the code scan and accepted guesses.
export type JsonSchema = Record<string, unknown>; // dereferenced, depth-bounded
export type RouteSource = "spec" | "code" | "guess";
export interface RouteParam {
  name: string;
  in: "path" | "query" | "header";
  required: boolean;
  type?: string;
  enum?: string[];
  description?: string;
  example?: string;
}
export interface RouteResponse {
  status: string; // "200", "4XX", "default"
  description?: string;
  schema?: JsonSchema;
  example?: string; // JSON text
}
export interface RouteDoc {
  method: string;
  path: string; // "/orders/:order_id"
  tag: string; // the spec's first tag, else the first path segment
  sources: RouteSource[];
  summary?: string;
  description?: string;
  deprecated?: boolean;
  params: RouteParam[];
  body?: { contentType: string; required: boolean; schema?: JsonSchema; example?: string };
  responses: RouteResponse[];
  handler?: SourceLocation;
}
export interface RoutesView {
  routes: RouteDoc[];
  spec?: { from: string; title?: string; version?: string }; // a repo-relative file or the local URL it came from
  notes: string[]; // plain words, e.g. a Swagger 2 file Shrike can't read yet
}
/** AP22: what the agent guessed for one route from its handler code, before the user accepts it. */
export interface RouteGuess {
  method: string;
  path: string;
  summary?: string;
  params: RouteParam[];
  body?: { example: string; schema: JsonSchema };
  responses: RouteResponse[];
}

export interface AppElement {
  ref: string; // stable within a page load, e.g. "e7"
  role: string; // "button" | "textbox" | "link" | "checkbox" | ...
  name: string; // accessible name / visible text, ≤ 80 chars
  value?: string;
}

export interface AppSnapshot {
  url: string;
  title: string;
  elements: AppElement[];
  text: string; // visible text, ≤ 4KB
}

export interface Finding {
  confidence: "observed" | "likely" | "possible";
  claim: string;
  file?: string;
  line?: number;
  eventId?: string;
}

export interface Patch {
  id: string;
  files: { path: string; before: string; after: string }[];
  rationale: string;
  status: "proposed" | "applied" | "rejected" | "reverted";
}

export interface ApprovalRequest {
  id: string;
  kind: "patch" | "request";
  title: string; // "Apply this change to server/todos.controller.ts?"
  reason: string;
  patch?: Patch;
  request?: HttpRequestSpec;
  quest?: string; // QB3: the quest whose plan this approves (quests)
  from?: string; // who proposed a patch: an outside MCP client's name, or "Shrike agent"
}

export type BrainId = "claude-code" | "builtin";

export interface BrainInfo {
  id: BrainId;
  label: string; // "Claude Code", "Built-in (API key)"
  available: boolean;
  detail: string; // "v2.1.280 at /path" or "Set ANTHROPIC_API_KEY to enable"
}

export interface AgentStep {
  id: string;
  runId: string;
  activity?: string; // X1: "Reading todos.controller.ts lines 10-30"
  files?: { path: string; action: "read" | "search" | "edit"; lines?: [number, number] }[]; // X2
  thinking?: string; // X3: latest reasoning text when the brain sends it
  usage?: { input: number; output: number; cacheRead: number; cacheWrite: number; costUsd?: number }; // X6: per turn
  skill?: string; // skill id the brain loaded for this run
  plan?: string[]; // A1: planned checks, on the first step that states a plan
  kind: "message" | "tool_call" | "tool_result" | "findings" | "patch" | "error" | "done";
  text: string; // one-line plain description for the panel
  tool?: string; // tool name without the "mcp__shrike__" prefix
  detail?: string; // full input/output JSON or text, shown when expanded
  actionIds?: string[];
  findings?: Finding[];
  summary?: string;
  patchId?: string;
  createdAt: number;
}

export interface AgentRunInfo {
  id: string;
  goal: string;
  brain: BrainId;
  status: "running" | "done" | "failed" | "stopped";
  // C: conversation branches
  parentRunId?: string; // set on a branch
  branchFromStepId?: string; // the parent's step the branch starts from
  name?: string; // short branch label ("try the cache")
  color?: string; // branch colour token key: "violet" | "cyan" | "amber" | "magenta" | "teal"
  aside?: boolean; // C3: a one-off question that never enters a session
  worktree?: string; // C6: a branch that changes code runs in its own worktree
  continues?: string; // C5: the run this one picks up (same conversation, e.g. resumed with a branch's finding)
}

// X: what the agent is spending its context on
export interface ContextSegment {
  kind: "instructions" | "tools" | "skill" | "memory" | "question" | "context" | "file" | "tool_result" | "agent";
  label: string; // "todos.controller.ts", "get_action", "Your question"
  tokens: number;
  estimated: boolean; // split within one message is estimated ("about")
  stepId?: string;
}

export interface ContextMap {
  runId: string;
  totalTokens: number;
  limit?: number;
  segments: ContextSegment[];
}

// R: Get it running
export interface StartStep {
  id: string;
  title: string; // plain words: "Start the databases (Postgres, Redis)"
  kind: "check" | "install" | "build" | "infra" | "service" | "env" | "health" | "other";
  command?: string; // exact command, shown on expand
  cwd?: string; // relative to the project root
  service?: string; // process name when it starts a service
  state: "pending" | "running" | "done" | "failed" | "fixed" | "skipped" | "waiting_approval";
  detail?: string; // last error or note, one line
  fix?: string; // what the agent changed to make it work ("Used uv run uvicorn")
  output?: string; // live tail of the command's output (start-agent)
  category?: StartCategory; // R6 (start-agent)
  ask?: StartAsk; // R6: waiting on the user, inline (start-agent)
}

// R6: what a command is, for the guarded shell (start-agent)
export type StartCategory = "inspect" | "install" | "build" | "service" | "health" | "env" | "migrate" | "free-port" | "outside" | "write" | "clean" | "other";
export interface StartAsk {
  id: string;
  kind: "approve" | "env";
  title: string; // plain words: "Write 2 values to apps/backend/.env.local?"
  reason?: string;
  command?: string; // exact text
  category?: StartCategory; // approve: what "Always allow for this project" covers
  file?: string; // env: repo-relative
  keys?: string[]; // env: values the user types
}
export interface StartReward { // SL5: what [QUEST COMPLETE] lists (start-agent)
  kind: "acquired" | "leveled" | "used" | "proposed";
  skillId: string;
  name: string;
  level?: number;
  learned?: string;
  proposalId?: string; // proposed: Keep / Discard via answerSkillProposal
}

export interface StartSettings {
  autoKeep: boolean; // keep skill improvements automatically after a successful run (off by default)
}

export interface StartPlan {
  projectRoot: string;
  source: "shrike-skill" | "project-skill" | "claude-skill" | "readme" | "explored";
  skillId?: string;
  steps: StartStep[];
  services: { name: string; port?: number; url?: string; health?: string }[];
  state: "planning" | "running" | "ready" | "failed" | "stopped";
  // start-agent
  name?: string; // project name, for "[ QUEST ] Get <name> running"
  runId?: string; // the start agent's run
  say?: string; // Claude's latest line
  error?: string; // why it stopped, plain words
  recipes?: { id: string; name: string; source: StartPlan["source"] | "lessons"; path: string }[]; // R1: what was found, best first
  places?: Place[]; // the lanes this plan expects: its services plus the stores it names (lanes-from-plan)
  rewards?: StartReward[];
  tools?: ToolNeed[]; // what this computer is missing for this project (docs/14 "Missing tools")
}

// A tool the project needs that isn't on this computer, or is too old. Shrike never installs it; it says how.
export interface ToolNeed {
  tool: "node" | "npm" | "pnpm" | "yarn" | "bun" | "python" | "uv" | "docker" | "nix" | "devbox" | "git";
  name: string; // "Node.js"
  found?: string; // the version here, when it's too old
  blocking: boolean; // false: the app still runs, with less (no steps inside the server, no containers)
  message: string; // plain words
  command?: string; // what to paste in a terminal ("brew install node")
  url: string; // the official download page
}

// P: prompt chains (up next, schedules, conditional chains)
export type UpNextWhen =
  | { on: "finished" | "succeeded" | "verified" | "always" | "app" | "ci" } // after the run on now ends (as it says), or when the app runs, or CI is green
  | { on: "time"; at: number }; // epoch ms
export interface UpNextItem {
  id: string;
  prompt: string;
  when: UpNextWhen;
  target: "main" | "branch"; // main continues the same session; branch forks it
  state: "waiting" | "running" | "done" | "skipped" | "missed"; // missed: a time that passed while Shrike was closed
  runId?: string;
  note?: string; // why it was skipped
  createdAt: number;
}
export interface ChainDef {
  id: string; // also the skill id when saved
  name: string;
  prompt: string; // the first node; "" works on the run going now (or the last one)
  check: "critique" | "succeeded" | "verified"; // what decides the branch
  rubric: string; // critique: what a 10 looks like
  threshold: number; // 0–10: below goes to `below`
  below?: string; // score under threshold (prompt A)
  pass?: string; // score at or over threshold, or the run succeeded (prompt B); absent: stop
  failed?: string; // the run failed or the outcome wasn't reached (prompt C)
  loop: boolean; // below's run is critiqued again: "repeat until score >= N"
  maxRounds: number; // loop guard: critiques at most
  budget: { tokens?: number; minutes?: number };
}
export type ChainNodeKind = "prompt" | "below" | "pass" | "failed";
export interface ChainStep {
  node: ChainNodeKind;
  prompt: string;
  runId?: string;
  status?: AgentRunInfo["status"];
  verified?: boolean;
  score?: number; // the critique of this step's run
  reason?: string;
  took?: ChainNodeKind | "stop"; // the branch taken after it
}
export interface ChainRun {
  id: string;
  def: ChainDef;
  state: "waiting" | "running" | "critiquing" | "done" | "stopped";
  steps: ChainStep[];
  round: number; // critiques so far
  tokens: number;
  startedAt: number;
  endedAt?: number;
  why?: string; // how it ended, plain words
}
export interface ChainsState {
  items: UpNextItem[]; // waiting, running and missed first; a few finished ones after
  paused: boolean;
  chain: ChainRun | null; // the chain running now, or the last one
}
export interface ChainEvent {
  kind: "queued" | "next" | "skipped" | "paused" | "critique" | "complete" | "stopped" | "missed" | "saved";
  text: string; // "Next up: write the tests"
  score?: number;
  ok?: boolean; // complete: it reached its outcome (false when the failure branch ended it)
  at: number;
}

// SL: the System (skill feedback)
export type SkillRank = "E" | "D" | "C" | "B" | "A" | "S";
export interface SkillEvent {
  kind: "acquired" | "leveled" | "used" | "quest_complete" | "not_learned"; // not_learned: drafts kept waiting, learned says why (evolve-on-outcome)
  skillId: string;
  name: string;
  level: number;
  rank: SkillRank;
  proficiency: number;
  nextRankAt?: number;
  learned?: string; // one line for level ups
  at: number;
  when?: string; // acquired: one line of what it does (system)
  quest?: string; // quest_complete: "Get xyne-spaces running" (system)
  runId?: string; // quest_complete: the agent run, for Save as skill (system)
  rewards?: StartReward[]; // quest_complete: skills acquired, leveled or used on the way (system)
  draftId?: string; // leveled: the applied draft, for Undo (evolve-on-outcome)
}

// S8: action recipes (Orca-style): each Shrike action's prompt template, agent and CLI arguments (action-recipes)
export type RecipeAgent = "default" | "claude-code" | "builtin" | "claude-teams" | "codex" | "opencode";
export interface RecipeSettings {
  agent?: RecipeAgent;
  args?: string; // extra CLI arguments for Claude Code; only allowlisted flags
  template?: string; // the prompt; {var} chips are filled in when the action runs
}
export interface ActionRecipe {
  id: string; // "review-pr", "commit-message", …
  name: string;
  description: string; // one line
  skillId?: string; // the Shrike skill whose body is {basePrompt}; absent: the agent picks the matching playbook
  vars: { name: string; hint: string }[];
  defaultTemplate: string;
  agent: RecipeAgent; // effective (project over personal over built-in)
  args: string;
  template: string;
  from: "builtin" | "personal" | "project"; // the most specific place that sets any of these
  wired: boolean; // false: Shrike doesn't hand this action to an agent yet
}

// XP: progression (progression)
export type QuestKind = "start" | "fix" | "ship" | "build"; // build: a feature quest (QB7)
export type QuestGrade = "S" | "A" | "B" | "C" | "D";
export type Medal = "bronze" | "silver" | "gold";
export type CardRarity = "bronze" | "silver" | "gold" | "golden";
export interface QuestLine {
  id: "clear" | "time" | "first_try" | "fixes" | "skills" | "verified" | "bonus";
  label: string;
  value: string; // "2:41", "Yes", "0"
  xp: number;
  points: number; // grade points toward the rank letter
}
export interface ProgressCard { id: string; name: string; rarity: CardRarity; desc: string; at?: number } // at: when it was unlocked
export interface QuestResult { // XP3
  id: string;
  kind: QuestKind;
  quest: string;
  project?: string;
  at: number;
  lines: QuestLine[];
  xp: number;
  score: number; // 0–100
  grade: QuestGrade;
  medal?: Medal;
  rewards: StartReward[];
  cards: ProgressCard[]; // unlocked by this quest
  before: number; // total XP before and after
  after: number;
  promoted?: { from: string; to: string };
}
export interface Progress {
  xp: number;
  title: string;
  titleIndex: number;
  titleFrom: number;
  nextTitle?: string;
  nextAt?: number;
  medals: Record<Medal, number>;
  cards: ProgressCard[]; // every card, owned ones have at
  quests: number;
  bugsFixed: number;
  projectsStarted: number;
  prsShipped: number;
  project?: { name: string; xp: number; quests: number; medals: Record<Medal, number> }; // the open project's tally
  recent: QuestResult[]; // oldest first
  formula: { label: string; xp: number }[]; // XP8
}

export type AppSide = "local" | "live"; // #62: what the app pane of a project with a liveUrl and a dev command shows

// Preload API exposed to the renderer as window.shrike
export interface ShrikeApi {
  platform?: string; // process.platform from preload: shortcut labels, voice, title bar
  openProjectDialog(): Promise<ProjectInfo | null>;
  openProject(root: string): Promise<ProjectInfo>;
  sampleProjectPath(): Promise<string>;
  openLiveSite(url: string): Promise<ProjectInfo>; // #54: a scratch project in userData/live/<host> with .shrike/config.json { liveUrl }
  setLiveUrl(url: string | null): Promise<ProjectInfo>; // #54: Setup's Live URL field
  setAppSide(side: AppSide): Promise<AppSide>; // #62: the Local / Live switch; asks for consent once per host, answers the side now shown
  appPartition(): Promise<string>; // #55: the app pane's partition now (follows the Local / Live side); the app window asks on every run:status
  signOutLive(): Promise<void>; // #55: clears the live site's session (cookies, storage, cache, basic-auth) and reloads it
  answerLiveLogin(id: string, login: { username: string; password: string } | null): Promise<void>; // #55: the answer to "live:login"; null cancels
  getProject(): Promise<ProjectInfo | null>;
  run(): Promise<RunStatus>;
  stop(): Promise<RunStatus>;
  getRunStatus(): Promise<RunStatus>;
  reloadApp(): Promise<void>;
  popOutApp(): Promise<void>; // the app in its own window (or focus it)
  dockApp(): Promise<void>; // close that window: the app docks back
  appWindowOpen(): Promise<boolean>;
  listFiles(): Promise<FileNode[]>;
  mapTree(touched: string[]): Promise<{ total: number; nodes: FileNode[] }>; // FV: the tree sliced to one trip's files
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  getActions(): Promise<ActionView[]>;
  sendRequest(req: HttpRequestSpec): Promise<{ response: HttpResponseSpec; actionId: string }>;
  detectBrains(): Promise<BrainInfo[]>;
  startAgent(goal: string, brain: BrainId): Promise<AgentRunInfo>;
  stopAgent(runId: string): Promise<void>;
  answerApproval(id: string, approved: boolean): Promise<void>;
  revertPatch(patchId: string): Promise<void>;
  getActionShot(actionId: string): Promise<string | null>; // PNG data URL of the app pane captured when the action started
  openInEditor(file: string, line: number): Promise<{ ok: boolean; editor?: string; error?: string }>; // user's own editor: cursor, code, zed, webstorm, else OS default
  saveClip(bytes: Uint8Array, ext: "webm" | "mp4"): Promise<string | null>; // save dialog; returns saved path
  setProcesses(processes: ProcessSpec[]): Promise<ProjectInfo>; // D12: edit and persist to .shrike/config.json
  getMemory(): Promise<MemoryNote[]>; // A5
  removeMemory(id: string): Promise<void>;
  getCheckpoints(): Promise<Checkpoint[]>; // A6
  rewindTo(checkpointId: string): Promise<void>;
  listSkills(): Promise<Skill[]>; // A4
  reviseFix(patchId: string, comments: { line: number; file: string; text: string }[]): Promise<void>; // A13/O7: send diff comments back to the agent
  startPointMode(): Promise<void>; // O1: next click in the app pane is captured, not delivered
  cancelPointMode(): Promise<void>;
  exportIssue(actionId: string): Promise<{ markdown: string; clipPath?: string }>; // O6
  showInFolder(path: string): Promise<void>; // O6 "Show clip in Finder"; absolute path inside the project's .shrike folder
  readFileDataUrl(path: string): Promise<string>; // O13 images in the file view; repo-relative, images only
  watchedBy(): Promise<{ client: string; actionIds: string[] }[]>; // A11
  // S: skills
  runSkill(skillId: string, input?: string): Promise<AgentRunInfo>;
  answerSkillProposal(id: string, keep: boolean): Promise<void>;
  saveAsSkill(from: { actionId?: string; runId?: string; flowId?: string; name?: string }): Promise<Skill>;
  importClaudeSkills(enable: boolean): Promise<Skill[]>;
  saveAsCommand(name: string, prompt: string): Promise<void>; // hidden move: custom slash command (.shrike/commands)
  editSkill(skillId: string): Promise<string>; // S1 Edit: repo-relative file for the in-app file view; skills outside the project get a .shrike/skills copy first (skills engineer)
  claudeSkillsOffer(): Promise<number | null>; // S2: how many ~/.claude/skills to offer, null once answered or none (skills engineer)
  listSkillDrafts(): Promise<SkillDraft[]>; // evolve-on-outcome: pending, applied and undone learnings, newest first
  undoSkillLevel(draftId: string): Promise<void>; // [Level Up] Undo: the previous version's bytes come back
  editSkillDraft(draftId: string): Promise<string>; // "Edit before keeping": repo-relative copy of the draft for the file view
  // B: flows and automation
  listFlows(): Promise<Flow[]>;
  startFlowRecording(): Promise<void>;
  stopFlowRecording(name: string): Promise<Flow | null>;
  runFlow(id: string): Promise<{ actionIds: string[]; ok: boolean }>;
  setFlowWatch(id: string, watch: Flow["watch"] | null): Promise<void>;
  deleteFlow(id: string): Promise<void>;
  saveFlow(name: string, steps: FlowStep[]): Promise<Flow>; // "Save as flow" from the API explorer (flows engineer)
  listMyMcpServers(): Promise<string[]>; // B4: names of the user's own MCP servers this project has on (Claude Code's and Shrike's own), for the Ask pill chips
  // MCP: the tools hub
  mcpState(): Promise<McpHubState>; // no health checks; "mcp:update" carries them
  mcpCheck(name?: string): Promise<McpHubState>; // health check one server, or every trusted one that's on
  mcpSetEnabled(name: string, on: boolean): Promise<McpHubState>; // this project only
  mcpTrust(name: string): Promise<McpHubState>; // a project-file server may start
  mcpAdd(req: McpAddRequest): Promise<McpHubState>; // approval card first; writes only Shrike's own config, secrets to the keychain
  mcpRemove(name: string): Promise<McpHubState>; // Shrike's own config only
  mcpFix(name: string): Promise<AgentRunInfo>; // "Fix it": asks your agent with the error in plain words
  mcpDismiss(id: string): Promise<McpHubState>; // a recommendation, for this project
  connectInfo(): Promise<ConnectInfo>; // MCP9: use Shrike from your own Claude Code
  connectResetToken(): Promise<ConnectInfo>; // a new token; anything connected with the old one is cut off
  // AP: the API client (main/api)
  apiCollections(): Promise<ApiCollection[]>; // the project's own (.shrike/api/*) plus linked Bruno folders
  apiCreateCollection(name: string): Promise<ApiCollection>; // <project>/.shrike/api/<name>/, Bruno format
  apiLinkCollection(): Promise<ApiCollection | null>; // folder dialog: open an existing Bruno collection in place
  apiUnlinkCollection(id: string): Promise<void>; // forgets the link, never deletes files
  apiReadRequest(collectionId: string, path: string): Promise<ApiRequest>;
  apiSaveRequest(collectionId: string, req: ApiRequest, folder?: string): Promise<{ path: string; collection: ApiCollection }>; // req.path "" = new file in folder
  apiDeleteItem(collectionId: string, path: string): Promise<ApiCollection>;
  apiCreateFolder(collectionId: string, path: string): Promise<ApiCollection>;
  apiRenameItem(collectionId: string, path: string, name: string): Promise<ApiCollection>;
  apiReadEnvironment(collectionId: string, name: string): Promise<ApiEnvironment>;
  apiSaveEnvironment(collectionId: string, env: ApiEnvironment): Promise<ApiCollection>; // secret values go to the keychain
  apiSend(req: ApiRequest, opts?: ApiSendOptions): Promise<ApiSendResult>; // the user's own send: any http(s) host
  apiCancel(sendId: string): Promise<void>;
  apiHistory(): Promise<ApiHistoryEntry[]>; // last 200 for this project, newest first, redacted
  apiClearHistory(): Promise<void>; // empties this project's request history; saved requests and collections untouched
  apiImport(kind: ApiImportKind, text?: string, name?: string): Promise<ApiCollection | ApiRequest>; // curl returns a request; the rest a new owned collection (bruno: folder dialog; text absent: file dialog)
  apiCode(req: ApiRequest, lang: ApiCodeLang, opts?: ApiSendOptions): Promise<string>;
  apiPickFile(): Promise<string | null>; // a file for a multipart field
  apiRoutes(refresh?: boolean): Promise<RoutesView>; // AP20: spec (repo file or the app's own well-known URL) merged with scanned routes and accepted guesses
  apiGuessRoutes(routes: { method: string; path: string }[]): Promise<RouteGuess[]>; // AP22: a read-only agent run; nothing is saved
  apiSaveGuess(guess: RouteGuess): Promise<RoutesView>; // AP22: the user accepted it: .shrike/api/guessed-routes.json and a request in the project's collection
  apiSaveResponse(bytes: Uint8Array, name: string): Promise<string | null>; // AP-res: save dialog for a response body; null when the user cancels
  // G: git and GitHub
  gitState(): Promise<GitState>;
  shipFix(opts: { actionId?: string; title?: string; message?: string; files?: string[] }): Promise<PullRequest>; // G1: needs approval for push; message: the Commit box draft
  listPullRequests(): Promise<PullRequest[]>;
  reviewPullRequest(n: number): Promise<AgentRunInfo>; // G2
  resolveConflicts(): Promise<AgentRunInfo>; // G3
  explainCheck(n: number, checkName: string): Promise<AgentRunInfo>; // G4
  mergePullRequest(n: number): Promise<void>; // G5: only when green
  syncWithMain(opts?: { mode?: "preview" | "rebase" | "merge" | "continue" | "abort" }): Promise<GitState>; // G6: preview fetches only; continue finishes after conflicts
  // SC: the Changes dock (scm.ts). Paths empty = all. Discard and push wait on an approval.
  scmState(): Promise<ScmState>;
  scmDiff(t: ScmTarget): Promise<ScmDiff>;
  scmStage(paths: string[]): Promise<ScmState>;
  scmUnstage(paths: string[]): Promise<ScmState>;
  scmDiscard(paths: string[]): Promise<ScmState>;
  scmCommit(message: string): Promise<ScmState>; // stages everything first when nothing is staged
  scmUndoCommit(): Promise<ScmState>;
  scmWriteMessage(): Promise<string>; // the Commit message recipe through the agent
  scmSync(): Promise<ScmState>;
  scmCommitFiles(sha: string): Promise<ScmFile[]>;
  scmOpenOnGitHub(): Promise<void>;
  // W: worktrees
  listWorktrees(): Promise<Worktree[]>;
  createWorktree(name: string, note?: string): Promise<Worktree>;
  switchWorktree(name: string): Promise<ProjectInfo>;
  removeWorktree(name: string): Promise<void>;
  startRace(actionId: string, approaches?: number): Promise<Race>; // W3
  adoptWorktreeFix(name: string): Promise<void>; // W3/W4: bring the fix into the user's branch
  trySandbox(patchId: string, actionId?: string): Promise<Race>; // W4: "Try in a sandbox first" on a proposed patch
  // WS: workspaces rail (every project Shrike knows and its worktrees)
  listWorkspaces(): Promise<Workspace[]>;
  addWorkspaceProject(): Promise<string | null>; // folder picker; the project's main checkout, remembered in userData
  workspaceSources(project: string): Promise<WorkspaceSources>;
  createWorkspace(opts: CreateWorkspace): Promise<Workspace>; // progress on "workspace:progress"
  openWorkspace(path: string): Promise<ProjectInfo>; // switches everything; other workspaces' apps keep running
  workspaceAction(path: string, action: "folder" | "terminal" | "stop"): Promise<void>;
  renameWorkspace(path: string, label: string): Promise<void>;
  deleteWorkspace(path: string): Promise<boolean>; // asks first when it has changes or commits that exist nowhere else
  // L: SDLC and hidden moves
  getSdlc(): Promise<SdlcState>;
  startAgentWith(goal: string, brain: BrainId, opts: AgentOptions): Promise<AgentRunInfo>;
  reviewFix(patchId: string): Promise<AgentRunInfo>; // "Review this fix" before Apply
  runTests(): Promise<{ ok: boolean; summary: string } | null>; // Prove stage; null when the project has no test script
  lastSession(): Promise<{ project: string; actionIds: string[]; at: number } | null>; // "Pick up where you left off"
  // C: conversation branches
  listRuns(): Promise<AgentRunInfo[]>;
  getRunSteps(runId: string): Promise<AgentStep[]>;
  retryRun(runId: string): Promise<AgentRunInfo>; // a failed or stopped run again (a follow-up resumes its conversation)
  branchRun(runId: string, fromStepId: string, question: string, opts?: { name?: string }): Promise<AgentRunInfo>; // C1
  askAside(runId: string, question: string): Promise<AgentRunInfo>; // C3: answer arrives as steps of an aside run
  keepAside(asideRunId: string, name?: string): Promise<AgentRunInfo>; // C3 → branch
  bringBack(branchRunId: string, mode: "summary" | "fix"): Promise<void>; // C5
  getContextMap(runId: string): Promise<ContextMap | null>; // X5
  // R: get it running (replaces the one-shot guess behind run())
  getStartPlan(): Promise<StartPlan | null>;
  startApp(): Promise<StartPlan>;
  getStartSettings(): Promise<StartSettings>; // lanes-from-plan
  setStartSettings(s: StartSettings): Promise<void>;
  stopApp(): Promise<void>;
  answerStart(askId: string, answer: { allow: boolean; always?: boolean; values?: Record<string, string> }): Promise<void>; // R6 inline approvals and env form (start-agent)
  // SL: skill feedback
  getSkillLog(): Promise<SkillEvent[]>;
  // XP: progression
  getProgress(): Promise<Progress>;
  saveImage(bytes: Uint8Array, name: string): Promise<string | null>; // XP7 Share as image: save dialog; returns saved path
  noteSkillUse(skillId: string): Promise<void>; // SL3: a skill that ran outside an agent run (git skills) worked (system)
  // S8: action recipes (action-recipes)
  listRecipes(): Promise<ActionRecipe[]>;
  saveRecipe(id: string, settings: RecipeSettings, scope: "project" | "personal"): Promise<ActionRecipe[]>;
  resetRecipe(id: string): Promise<ActionRecipe[]>; // clears this project's and your default, back to built-in
  waiveReview(): Promise<SdlcState>; // L5: skip the review for the change in flight (sdlc engineer)
  listCommands(): Promise<{ name: string; prompt: string }[]>; // saved slash commands from .shrike/commands/<name>.md (sdlc engineer)
  // V: voice (ShrikeVoice.app helper, Jev fallback)
  voiceSend(cmd: VoiceCommand): Promise<void>; // starts the helper on first use
  openVoiceSettings(pane: "mic" | "speech" | "dictation"): Promise<void>; // System Settings: Privacy, or Keyboard for Dictation
  voiceModels(): Promise<VoiceModels>; // V7: on-device models in userData, their state and free disk
  voiceModelAct(act: "download" | "cancel" | "delete", id?: VoiceModelId): Promise<VoiceModels>; // no id: every model; progress on "voice:models"
  voicePlan(req: VoicePlanRequest): Promise<VoicePlanResult>; // V9: the bundled planner (utilityProcess); "missing" until its model is downloaded
  voicePlanWarm(prefix: string): Promise<boolean>; // V9: load the planner and evaluate the fixed prompt when voice turns on; false: no model yet
  // Z: themes (themes-composer)
  setWindowChrome(chrome: { appearance: "system" | "dark" | "light"; background: string; ink?: string }): Promise<void>; // macOS draws the traffic lights for this appearance; Windows and Linux paint their window buttons in background and ink
  // I: place inspector
  inspect(req: InspectRequest): Promise<InspectResult>; // read-only look inside a database or cache lane, through the process that holds it
  // P: prompt chains (up next, schedules, conditional chains)
  getChains(): Promise<ChainsState>;
  queuePrompt(prompt: string, when: UpNextWhen, target?: UpNextItem["target"]): Promise<ChainsState>; // P1/P2
  editUpNext(id: string, patch: { prompt?: string; when?: UpNextWhen; target?: UpNextItem["target"] } | null): Promise<ChainsState>; // null removes it
  moveUpNext(id: string, index: number): Promise<ChainsState>;
  pauseUpNext(paused: boolean): Promise<ChainsState>;
  answerMissed(id: string, run: boolean): Promise<ChainsState>;
  listChains(): Promise<ChainDef[]>; // P4: built-in and saved chains (skills of kind chain)
  startChain(def: ChainDef): Promise<ChainsState>; // P3
  stopChain(): Promise<ChainsState>;
  saveChain(def: ChainDef, scope: "project" | "personal"): Promise<ChainDef>; // P4: a skill of kind chain
  // M: options and mockups (ask_options)
  getOptions(): Promise<OptionsSession[]>; // this app session's, newest last
  answerOptions(sessionId: string, answer: OptionsAnswer): Promise<OptionsSession>;
  // PR: the pull request and CI panel
  prView(n?: number): Promise<PrView>; // the current branch's PR (or #n), its checks, threads, comments and reviews
  prCheckJob(link: string, name: string): Promise<PrCheckJob>; // a check's steps and, when it failed, its log tail
  prAct(action: PrAction): Promise<PrView>; // every GitHub write, each behind an approval card
  prAgent(task: PrAgentTask): Promise<AgentRunInfo | ChainsState>;
  openLink(url: string): Promise<void>; // http(s) only, in the system browser
  // CI: CI lessons and pre-flight (ci-lessons)
  ciLessons(opts?: { refresh?: boolean }): Promise<CiLessonsState>; // the pipeline map (refresh re-reads the config and gh run history)
  ciLearn(from?: { check: string; url?: string }): Promise<CiLessonsState>; // CI2 Claude writes the lessons skill; CI8 with a failing check's lesson
  preflight(): Promise<PreflightRun>; // CI3 runs the legs this change touches; resolves when it's done, progress on "ci:update"
  stopPreflight(): Promise<void>;
  ciFixLeg(job: string): Promise<AgentRunInfo>; // CI4 Fix it
  // RL: review lessons and reviewer profiles (reads only)
  reviewLessons(): Promise<ReviewLessonsView>; // what's cached; mines nothing
  refreshReviewLessons(opts?: { limit?: number }): Promise<ReviewLessonsView>; // read new review activity, then cluster it
  learnFromComment(c: LearnComment): Promise<ReviewLessonsView>; // RL8 Learn from this
  selfCheck(opts?: { force?: boolean }): Promise<SelfCheck | null>; // RL6; null when there are no lessons yet
  fixSelfCheck(): Promise<AgentRunInfo>; // RL6 Fix it first
  // QB: quests (quests)
  listQuests(): Promise<Quest[]>;
  planQuest(idea: string): Promise<Quest>; // a new quest in Plan; the renderer then asks the agent with plan-feature
  listIssues(): Promise<GhIssue[]>; // gh issue list, read only
  importIssue(n: number): Promise<Quest>;
  questAct(id: string, act: QuestAct): Promise<Quest[]>;
  on<K extends keyof ShrikeEvents>(channel: K, cb: (payload: ShrikeEvents[K]) => void): () => void;
}

// V: voice. JSON lines to and from ShrikeVoice.app, relayed by main.
export type VoicePerm = "granted" | "denied" | "restricted" | "unknown";
export type VoiceCommand =
  | { cmd: "start"; id: number }
  | { cmd: "stop" }
  | { cmd: "context"; words: string[] }
  | { cmd: "auth" }
  | { cmd: "hands"; on: boolean } // hands-free: the helper cuts turns itself (VAD + Smart Turn) and numbers them from 1_000_000
  | { cmd: "config"; langs: string[] } // languages I speak, e.g. ["en", "hi"]; [] = auto. The first is the hint, the second gets an "alt" decode
  | { cmd: "arm"; on: boolean } // mic open into the 500ms pre-roll (push-to-talk arms on its first press; closes after 10 quiet minutes)
  | { cmd: "reload" }; // a model was downloaded or deleted: the helper loads what is there now
export type VoiceEvent =
  | { type: "ready"; onDevice: boolean; available: boolean; speech: VoicePerm; mic: VoicePerm }
  | { type: "permission"; speech: VoicePerm; mic: VoicePerm }
  | { type: "partial" | "final"; id: number; text: string }
  | { type: "level"; value: number }
  | { type: "error"; message: string; id?: number; code?: "dictation" } // dictation: the older recognizer needs Dictation turned on
  | { type: "setup" } // building the helper (first run)
  | { type: "vad"; id: number; speech: boolean } // speech started or stopped in turn `id`
  | { type: "lang"; id: number; lang: string } // the language turn `id` was decoded as
  | { type: "turn"; id: number; complete: boolean } // hands-free: Smart Turn's verdict after a pause
  | { type: "engine"; engine: "open" | "apple" } // apple: the English fallback while the open model downloads
  | { type: "alt"; id: number; lang: string; text: string } // after the final: the same audio decoded with the second language
  | { type: "barge"; id: number }; // a partial or final that is only a stop word (stop, cancel, ruko, bas): cancel what is running now

// V7: on-device voice models, downloaded on first use into userData with a sha256 check.
export type VoiceModelId = "asr" | "vad" | "turn" | "planner";
export interface VoiceModel {
  id: VoiceModelId;
  name: string; // "Nemotron 3.5 ASR Streaming 0.6B"
  license: string;
  bytes: number;
  state: "missing" | "downloading" | "verifying" | "ready" | "failed";
  got?: number; // bytes so far while downloading
  error?: string;
}
export interface VoiceModels {
  models: VoiceModel[];
  freeBytes: number;
}

// V8: a spoken plan as the plan card (V*) draws it. The plan executor fills it; the card only reads it.
export type VoiceRisk = "safe" | "undoable" | "outward" | "destructive";
export interface VoicePlanStep {
  id: string;
  action: string; // registry id, e.g. "git.push"
  title: string; // "Push to origin"
  risk: VoiceRisk;
  state: "waiting" | "running" | "done" | "failed" | "needs_yes" | "skipped";
  detail?: string; // "4 files", the commit message
  error?: string; // why it failed, in plain words
  added?: boolean; // inserted by a precondition rule, not said
}
export interface VoicePlan {
  id: string;
  heard: string; // Roman script
  source: "grammar" | "planner";
  steps: VoicePlanStep[];
  state: "running" | "needs_yes" | "done" | "failed" | "stopped";
}
export interface VoiceChip {
  label: string; // "Open PR 42"
  say?: string; // what to say to pick it, when it differs from the label
  action?: string; // registry id
  plan?: VoicePlanAsk[]; // "Did you mean": the whole plan this chip runs
}
// V9: a registry step as understanding hands it to the executor ({action: "pr.open", slots: {pr: 42}}).
export interface VoicePlanAsk {
  action: string;
  slots: Record<string, string | number>;
}
export interface VoicePlanRequest {
  prefix: string; // the fixed prompt (registry actions and examples); the planner keeps it evaluated
  context: string; // live app state, one line each
  text: string; // what was heard
  schema: Record<string, unknown>; // this turn's JSON schema: every slot an enum of live values
}
export type VoicePlanResult = { ok: true; json: unknown; ms: number } | { ok: false; error: "missing" | "timeout" | "failed" | "broken" }; // broken: the model is there but won't load (corrupt, or node-llama-cpp failed)

// main → renderer push channels
export interface ShrikeEvents {
  "run:status": RunStatus;
  "run:output": string; // raw chunk of dev server stdout/stderr
  "actions:update": ActionView[]; // only the actions that changed
  "actions:cleared": null;
  "agent:status": AgentRunInfo;
  "agent:step": AgentStep;
  "approval:request": ApprovalRequest;
  "approval:resolved": { id: string; approved: boolean };
  "patch:update": Patch;
  "file:changed": { path: string };
  "process:output": { process: string; chunk: string }; // O4
  "point:picked": PointPick; // O1
  "point:cancelled": null; // O1: Esc pressed inside the app page
  "live:login": { id: string; host: string; realm: string }; // #55: a page asked for a username and password (basic auth); answered with answerLiveLogin
  "live:notice": string; // #55: a plain message about the app page (a bad certificate, a sign-in that refuses embedded browsers)
  "app:window": boolean; // true while the app is in its own window
  "agent:usage": AgentUsage; // A7
  "agent:cursor": { x: number; y: number; label: string; click?: boolean } | null; // O2, app-pane CSS px; null hides it
  "memory:update": MemoryNote[];
  "checkpoint:update": Checkpoint[];
  "mcp:watch": { client: string; actionIds: string[] }; // A11
  "skills:update": Skill[];
  "flows:update": Flow[];
  "api:first": { kind: "saved" | "passed"; name: string }; // AP: [Request Saved] / [Assertion Passed], once per project
  shortcut: "close-tab"; // AP5: main turns ⌘W into this instead of closing the window
  "flow:recording": { steps: FlowStep[] } | null; // live steps while recording (B1)
  "flow:result": { flowId: string; ok: boolean; actionIds: string[]; watched: boolean }; // B3: a run finished (flows engineer)
  "trip:focus": { actionId: string }; // B5 focus_trip from an outside MCP client (flows engineer)
  "file:open": { path: string; line: number }; // B5 open_file from an outside MCP client (flows engineer)
  "project:opened": ProjectInfo; // B5 open_project from an outside MCP client (flows engineer)
  "git:update": GitState;
  "scm:update": ScmState; // SC
  "worktrees:update": Worktree[];
  "race:update": Race; // W3
  "workspaces:update": Workspace[]; // WS1
  "workspace:progress": { step: string; state: "running" | "done" | "failed" }; // WS2
  "sdlc:update": SdlcState; // L*
  "agent:context": ContextMap; // X5
  "runs:update": AgentRunInfo[]; // C2
  "start:plan": StartPlan; // R
  "start:step": StartStep;
  "skill:event": SkillEvent; // SL
  "progress:update": { progress: Progress; result?: QuestResult; promoted?: { from: string; to: string }; cards?: ProgressCard[] }; // XP: result opens the results screen; promoted and cards outside a quest
  "race:step": AgentStep; // X7 (xray): a race candidate's steps, kept off the agent column
  "voice:event": VoiceEvent; // V1
  "voice:models": VoiceModels; // V7 download progress
  "chains:update": ChainsState; // P
  "chains:event": ChainEvent; // P5 System toasts
  "options:update": OptionsSession; // M
  "ci:update": CiLessonsState; // CI
  "ci:mastered": { job: string; learned: string }; // CI7 [Lesson Mastered]
  "lessons:update": ReviewLessonsView; // RL
  "lessons:mastered": { lessonId: string; title: string; clean: number; xp: number }; // RL9
  "quests:update": Quest[]; // QB
  "mcp:update": McpHubState; // MCP
  "mcp:unlocked": { server: string; glyph: string; xp: number }; // MCP8 [New Tool Unlocked]
  "connect:update": ConnectInfo; // MCP9: an outside client connected, or the token changed
}

// What the MCP server needs from the desktop main process
export interface ShrikeHost {
  projectRoot(): string;
  listActions(): ActionView[];
  getAction(id: string): ActionView | undefined;
  getEvent(id: string): DebugEvent | undefined;
  searchEvents(query: string): DebugEvent[];
  listFiles(): Promise<string[]>; // repo-relative, .gitignore-aware, no node_modules
  readFile(path: string): Promise<string>;
  searchCode(query: string, glob?: string): Promise<{ file: string; line: number; text: string }[]>;
  listRoutes(): Route[];
  sendRequest(req: HttpRequestSpec): Promise<{ response: HttpResponseSpec; actionId: string }>;
  appSnapshot(): Promise<AppSnapshot>;
  appClick(ref: string): Promise<{ actionId: string | null }>;
  appType(ref: string, text: string, submit?: boolean): Promise<{ actionId: string | null }>;
  appNavigate(url: string): Promise<{ actionId: string | null }>;
  waitForAction(actionId: string, timeoutMs?: number): Promise<ActionView | undefined>;
  requestApproval(req: Omit<ApprovalRequest, "id">): Promise<boolean>;
  proposePatch(
    files: { path: string; edits: { oldText: string; newText: string }[] }[],
    rationale: string,
    from?: string, // shown on the approval card
  ): Promise<{ patchId: string; status: "applied" | "rejected"; feedback?: string }>; // feedback: A13 diff comments sent with a rejection
  revertPatch(patchId: string): Promise<void>;
  reportFindings(findings: Finding[], summary: string): void;
  remember(note: { text: string; file?: string; line?: number }): Promise<MemoryNote>; // A5, MCP tool "remember"
  noteWatch(client: string, actionIds: string[]): void; // A11, called when an MCP client reads trips
  liveOrigins?(): string[]; // #53: set by main; the live project's origins (liveUrl's first). Empty or missing: a local project
  redactKeep?(): string[] | undefined; // #52: set by main; .shrike/config.json redact.keep, names whose values live tool output doesn't mask
  drive?: ShrikeDriver; // B5: set by main; its tools are offered to outside MCP clients only (flows engineer)
  askOptions?(req: OptionsAsk): Promise<OptionsReply>; // M1: set by main; waits for the user's cards, or times out with action "waiting"
  preflight?(): Promise<string>; // CI3: set by main; runs only legs from the CI config or the lessons skill, through the guarded shell
  selfReview?(results?: SelfReviewResult[]): Promise<string>; // RL5: set by main; no results returns the checklist, results record it
  quests?: QuestHost; // QB9: set by main (quests)
  api?: ApiHost; // AP: set by main
}

// AP: the API client as seen by MCP tools (send_request outside the app, save_request, list_requests)
export interface ApiHost {
  send(spec: HttpRequestSpec, assertions?: ApiAssertion[]): Promise<{ response: HttpResponseSpec; actionId?: string; assertions?: ApiAssertionResult[] }>; // any http(s) host; tools ask first outside project origins
  save(req: Pick<ApiRequest, "name" | "method" | "url"> & Partial<ApiRequest>, folder?: string): Promise<string>; // into the project's own collection; returns the file path
  list(): Promise<{ collection: string; path: string; method: string; name: string }[]>;
}

// B5: Shrike itself as MCP tools, so an outside agent can operate Shrike the way it drives any app (flows engineer)
export interface ShrikeDriver {
  openProject(root: string): Promise<ProjectInfo>;
  run(): Promise<RunStatus>;
  stop(): Promise<RunStatus>;
  focusTrip(actionId: string): void;
  openFile(path: string, line: number): void;
  listFlows(): Promise<Flow[]>;
  startFlowRecording(): Promise<void>;
  stopFlowRecording(name: string): Promise<Flow | null>;
  runFlow(id: string): Promise<{ actionIds: string[]; ok: boolean }>;
  askAgent(goal: string): Promise<{ runId: string; status: AgentRunInfo["status"]; summary: string }>; // waits for the run to end
}

// Ingest wire format (node-agent → main, HTTP) and browser-agent → main (CDP binding)
export type IngestMessage =
  | { type: "hello"; source: "server" | "browser"; pid?: number; url?: string; place?: Place; at: number } // place: the server's service place
  | { type: "events"; events: DebugEvent[] }
  | { type: "action_end"; actionId: string; at: number };

// M: options and mockups. ask_options shows cards; each answer goes back to the same blocking call, so Claude loops until approve.
export interface OptionInput {
  id?: string; // the agent's own key, echoed back; Shrike names the cards (A, B, B1, B2+C)
  label: string;
  description: string;
  mockupHtml?: string; // untrusted: only ever rendered in a sandboxed srcdoc iframe
  preview?: string; // code or text, shown monospace
}
export interface OptionsAsk {
  session?: string; // continue a session: the new options answer what the user last asked for
  question?: string;
  header?: string;
  options?: OptionInput[]; // none with a session: keep waiting after a timeout
  multi?: boolean;
  runId?: string;
}
export interface OptionCard extends OptionInput {
  card: string; // "B2", "B2+C"
  parents: string[];
  round: number;
}
export interface OptionsRound {
  n: number;
  kind: "start" | "vary" | "tweak" | "combine" | "more";
  title: string; // "Round 1", "More like B", "B, changed", "B2 + C"
  from: string[]; // parent cards
  note?: string; // what the user said
  cards: string[];
}
export type OptionsAnswer =
  | { action: "vary"; card: string; count?: number }
  | { action: "tweak"; card: string; text: string }
  | { action: "combine"; cards: string[]; text?: string }
  | { action: "approve"; cards: string[] }
  | { action: "other"; text: string };
export interface OptionsSession {
  id: string;
  runId?: string;
  question: string;
  header: string;
  multi: boolean;
  cards: Record<string, OptionCard>;
  rounds: OptionsRound[];
  state: "asking" | "working" | "approved" | "closed";
  last?: OptionsAnswer; // what the user asked for last
  approved?: string[]; // approved cards
  waiting: boolean; // a call is blocked on the user right now
  at: number;
}
export type OptionsReply = { action: OptionsAnswer["action"] | "waiting"; session: string; answer?: OptionsAnswer; cards: OptionCard[] };
