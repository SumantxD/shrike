import type { VoiceRisk } from "@shrike/schema";

// The action registry (docs/16 §5): one row per thing a person can make Shrike do, by key, button, slash command,
// MCP tool or voice. Pure data, no store imports, so main, tests and the planner prompt read it too.
// Bindings to the real functions live in run.ts. registry.test.ts proves every key, slash, move and MCP tool has a row.

export type SlotKind = "pr" | "check" | "panel" | "workspace" | "branch" | "worktree" | "file" | "chain" | "skill" | "flow" | "route" | "method" | "path" | "text" | "name";

export interface Slot {
  name: string;
  kind: SlotKind;
  optional?: true;
}

export interface ActionDef {
  id: string;
  title: string; // card chip copy: "Push to origin"
  help: string; // one line, for the planner and "What can I say"
  risk: VoiceRisk;
  slots?: Slot[];
  /** Order-free templates over tier-0 canonical words: a|b alternatives, [x] optional, {slot}. */
  say: string[];
  /** Real phrasings (en, Hinglish, Devanagari, other): planner few-shot, "What can I say", the eval's seed. */
  examples: string[];
  binds?: { command?: string[]; slash?: string[]; move?: string[]; mcp?: string[] };
  /** Not offered to the planner: plan control words the router handles itself. */
  meta?: true;
}

export const PANELS = ["logs", "network", "api", "terminal", "details", "app", "skills", "flows", "tools", "ship", "time", "changes", "checks", "workspaces"] as const;
export type PanelId = (typeof PANELS)[number];

const s = (name: string, kind: SlotKind, optional?: true): Slot => (optional ? { name, kind, optional } : { name, kind });

export const ACTIONS: ActionDef[] = [
  // ---------- the Thread ----------
  { id: "step.next", title: "Next step", help: "Go to the next step of the request", risk: "safe", say: ["next [step]", "step next"], examples: ["next step", "go forward", "agla step", "अगला कदम", "siguiente paso"], binds: { command: ["step-down"] } },
  { id: "step.prev", title: "Previous step", help: "Go back one step", risk: "safe", say: ["previous [step] [go]", "back step [go]", "step back"], examples: ["previous step", "one step back", "pichla step", "पिछला कदम"], binds: { command: ["step-up"] } },
  { id: "trip.next", title: "Next trip", help: "Go to the next request (trip)", risk: "safe", say: ["next trip|request"], examples: ["next request", "agli request"], binds: { command: ["trip-down"] } },
  { id: "trip.prev", title: "Previous trip", help: "Go to the previous request (trip)", risk: "safe", say: ["previous trip|request", "back trip"], examples: ["previous request", "pichli request"], binds: { command: ["trip-up"] } },
  { id: "trip.list", title: "Trip list", help: "Focus the trip list", risk: "safe", say: ["[show|go] triplist"], examples: ["trip list"], binds: { command: ["trip-list"] } },
  { id: "trip.view_new", title: "View the new trip", help: "Jump to the trip that just arrived", risk: "safe", say: ["[show|go] newtrip"], examples: ["show the new trip"], binds: { command: ["view-new-trip"] } },
  { id: "trip.latest", title: "Latest trip", help: "Focus the most recent trip", risk: "safe", say: ["[show|go] latest trip"], examples: ["show the latest trip"], binds: { mcp: ["focus_trip"] } },
  { id: "failure.next", title: "Where it broke", help: "Jump to where something broke or failed", risk: "safe", say: ["[where|what|show|find|next|go] error", "where failing", "error where"], examples: ["where did it break", "what went wrong here", "galti kahan hai", "गलती कहाँ हुई", "dónde falló"], binds: { command: ["next-failure"] } },
  { id: "dive", title: "Dive in", help: "Open the focused step to see its code and values", risk: "safe", say: ["dive [show|go]"], examples: ["dive in", "zoom in", "andar jao"], binds: { command: ["dive"] } },
  { id: "escape", title: "Back", help: "Close what is open or go back out", risk: "safe", say: ["back [go]", "close"], examples: ["go back", "close it", "never mind", "wapas jao", "वापस जाओ"], binds: { command: ["escape"] } },
  { id: "replay", title: "Replay", help: "Play the request's journey again", risk: "safe", say: ["replay [trip]", "again run|replay trip"], examples: ["replay this trip", "play it again", "dobara chalao trip"], binds: { command: ["replay"], slash: ["replay"] } },
  { id: "view.files", title: "Files view", help: "Follow the request through the project's folders and files, step by step", risk: "safe", say: ["[show|open|go] files"], examples: ["show the files view", "files dikhao", "open the files view", "फाइल्स दिखाओ"], binds: { command: ["view"], slash: ["files"] } },
  { id: "view.thread", title: "The Thread", help: "Go back to the Thread view of the request", risk: "safe", say: ["[show|open|go] trip"], examples: ["show the thread", "thread dikhao", "go to the thread view"], binds: { slash: ["thread"] } },
  { id: "panel.show", title: "Show {panel}", help: "Show a panel: logs, network, api, terminal, details, app, skills, flows, tools, ship, time, changes, checks, workspaces", risk: "safe", slots: [s("panel", "panel")], say: ["show|open|go {panel}", "{panel}"], examples: ["show the logs", "open the terminal", "logs dikhao", "टर्मिनल खोलो", "muestra los logs", "zeig das Terminal", "ログを見せて"], binds: { command: ["app", "logs", "network", "api", "terminal", "details", "time", "skills", "ship", "flows"], slash: ["time", "tools"], move: ["ship"] } },
  { id: "panel.hide", title: "Hide {panel}", help: "Hide a panel", risk: "safe", slots: [s("panel", "panel")], say: ["hide|close|stop {panel}"], examples: ["hide the logs", "terminal band karo"] },
  { id: "file.open_focused", title: "Open this file", help: "Open the focused step's source file", risk: "safe", say: ["open|show file|code", "edit", "show code"], examples: ["open this file", "show the code"], binds: { command: ["editor"] } },
  { id: "file.open", title: "Open {path}", help: "Open a project file by name", risk: "safe", slots: [s("path", "file")], say: ["open|show|edit [file] {path}"], examples: ["open cart.ts", "open the todos controller", "readme file kholo", "चेकआउट फाइल खोलो"], binds: { mcp: ["open_file"] } },
  { id: "quick_open", title: "Find a file", help: "Search for a file by name", risk: "safe", say: ["quickopen", "find|search files"], examples: ["quick open", "find file", "file dhundo"], binds: { command: ["quick-open"] } },
  { id: "route.open", title: "Open route {route}", help: "Open one of the app's routes in the API client", risk: "safe", slots: [s("route", "route")], say: ["open|show route {route}"], examples: ["open the todos route"] },
  { id: "record", title: "Record a clip", help: "Record a video clip of the request", risk: "safe", say: ["record [clip|trip]", "create clip"], examples: ["record a clip", "start recording", "recording shuru karo"], binds: { command: ["record"], slash: ["record"] } },
  { id: "point", title: "Point at something", help: "Point at something in the app to ask about it", risk: "safe", say: ["point"], examples: ["point mode", "let me point at it"], binds: { command: ["point"] } },
  { id: "app.window", title: "Your app in its own window", help: "Open your app in its own window, or dock it back", risk: "safe", say: ["popout [app]", "dock back [app]", "own window"], examples: ["pop out the app", "dock the app back", "open the app in its own window"], binds: { command: ["pop-out"] } },
  { id: "issue", title: "Write it up", help: "Write this request up as an issue", risk: "safe", say: ["[create|new|write] issue"], examples: ["file an issue", "write it up", "issue banao"], binds: { slash: ["issue"] } },
  { id: "compare", title: "Compare with last time", help: "Compare this request with the last time it ran", risk: "safe", say: ["compare [previous|time]"], examples: ["compare with last time", "what changed", "pichli baar se compare karo"], binds: { slash: ["compare"] } },
  // ---------- the app ----------
  { id: "app.run", title: "Run the app", help: "Start the user's app", risk: "undoable", say: ["run [app|server]", "run app|server again"], examples: ["run the app", "start the server", "boot up the dev server", "app chalao", "ऐप चलाओ", "ejecuta la app", "アプリを実行"], binds: { mcp: ["run_app"] } },
  { id: "app.stop", title: "Stop the app", help: "Stop the user's app", risk: "undoable", say: ["stop app|server"], examples: ["stop the app", "kill the server", "app band karo", "ऐप बंद करो", "arrête le serveur"], binds: { mcp: ["stop_app"] } },
  { id: "app.restart", title: "Restart the app", help: "Restart the user's app", risk: "undoable", say: ["restart [app|server]", "again run app|server"], examples: ["restart the app", "reload the server", "app restart karo"] },
  { id: "tests.run", title: "Run tests", help: "Run the project's tests", risk: "undoable", say: ["[run] tests"], examples: ["run the tests", "test it", "tests chalao", "टेस्ट चलाओ", "lance les tests", "テストを実行"], binds: { move: ["run-tests"] } },
  // ---------- the agent ----------
  { id: "agent.ask", title: "Ask the agent", help: "Ask the coding agent (Claude) a question or give it a task in words", risk: "safe", slots: [s("text", "text")], say: [], examples: ["ask Claude why the login fails", "Claude se pucho login kyun fail hua", "क्लॉड से पूछो लॉगिन क्यों टूटा", "frag Claude warum es kaputt ist"], binds: { mcp: ["ask_agent"] } },
  { id: "agent.open", title: "Open Ask", help: "Open the Ask box to type to the agent", risk: "safe", say: ["ask [agent|claude]", "open ask"], examples: ["ask", "talk to the agent"], binds: { command: ["ask"] } },
  { id: "agent.options", title: "Show options", help: "Ask the agent for options to pick from", risk: "safe", slots: [s("text", "text", true)], say: ["show options"], examples: ["show me some options", "give me options for the header"] },
  { id: "agent.fix", title: "Fix it", help: "Ask the agent to find the cause and fix this request", risk: "undoable", say: ["fix [error|trip]", "[agent|claude] fix"], examples: ["fix it", "fix this bug", "ise fix karo", "इसे ठीक करो"], binds: { slash: ["fix"] } },
  { id: "agent.explain", title: "Explain this step", help: "Ask the agent to explain the focused step", risk: "safe", say: ["explain [step]"], examples: ["explain this step", "what does this do", "ye step samjhao", "ये स्टेप समझाओ", "explica este paso"], binds: { slash: ["explain"] } },
  { id: "agent.find_cause", title: "Find the cause", help: "Ask the agent why this breaks", risk: "safe", say: ["cause", "find cause"], examples: ["find the cause"], binds: { move: ["find-cause"] } },
  { id: "agent.stop", title: "Stop the agent", help: "Stop the AI agent that is working", risk: "safe", say: ["stop agent|claude", "cancel agent|claude"], examples: ["stop the agent", "agent ko roko", "एजेंट को रोको", "arrête l'agent"] },
  { id: "fix.review", title: "Review the fix", help: "Ask a second agent to review the proposed fix", risk: "safe", say: ["review fix"], examples: ["review this fix"], binds: { move: ["review-fix"] } },
  { id: "checkpoint.rewind", title: "Rewind", help: "Go back to the last checkpoint before the agent's change", risk: "undoable", say: ["rewind", "back checkpoint"], examples: ["rewind", "go back to the checkpoint"], binds: { move: ["rewind"] } },
  // ---------- git ----------
  { id: "git.stage_all", title: "Stage all files", help: "Stage all changed files (git add)", risk: "undoable", say: ["stage [all] [files|file|changes]", "add all|files|file|changes [files|file|changes]"], examples: ["stage all files", "stage everything", "sab files stage karo", "सारी फाइलें स्टेज करो", "全部ステージして"] },
  { id: "git.unstage_all", title: "Unstage all", help: "Unstage every staged file", risk: "undoable", say: ["unstage [all] [files|changes]"], examples: ["unstage everything"] },
  { id: "git.commit", title: "Commit", help: "Commit the staged changes (stages everything when nothing is staged)", risk: "undoable", say: ["commit [all] [changes|files]", "create commit"], examples: ["commit my changes", "make a commit", "changes commit karo", "कमिट करो", "fais un commit"] },
  { id: "git.undo_commit", title: "Undo the commit", help: "Undo the commit Shrike just made", risk: "undoable", say: ["undo commit"], examples: ["undo the last commit"] },
  { id: "git.push", title: "Push to origin", help: "Push commits to the remote", risk: "outward", say: ["push [origin|changes|all]"], examples: ["push", "push my changes", "push to origin", "push kar do", "पुश करो", "pushe die Änderungen"] },
  { id: "git.pull", title: "Pull the latest", help: "Pull the latest changes from the remote", risk: "undoable", say: ["pull [latest] [changes] [main]", "get latest [changes] [main]"], examples: ["pull the latest", "get the latest from main", "latest changes pull karo", "पुल करो"] },
  { id: "git.sync_main", title: "Catch up with main", help: "Bring the latest main into this branch", risk: "undoable", say: ["sync [main]"], examples: ["sync with main", "rebase on main", "catch up with main"] },
  { id: "git.resolve", title: "Resolve conflicts", help: "Ask the agent to resolve merge conflicts", risk: "undoable", say: ["resolve|fix conflicts", "resolve"], examples: ["resolve the conflicts"] },
  { id: "git.discard", title: "Discard changes", help: "Throw away local changes", risk: "destructive", say: ["discard [all] [changes|files]"], examples: ["discard my changes", "throw away my local changes", "changes hata do", "बदलाव हटाओ"] },
  { id: "branch.switch", title: "Switch to {branch}", help: "Switch to another branch", risk: "undoable", slots: [s("branch", "branch")], say: ["switch|go [branch] {branch} branch", "switch|go {branch} [branch]"], examples: ["switch to the main branch", "fix-cart branch pe jao"] },
  // ---------- PRs and CI ----------
  { id: "pr.list", title: "Show pull requests", help: "Show all open pull requests", risk: "safe", say: ["[show|which|open] pr [open|all]", "all pr"], examples: ["show open pull requests", "which PRs are open", "saare PR dikhao", "सभी पुल रिक्वेस्ट दिखाओ", "zeig alle Pull Requests"] },
  { id: "pr.open", title: "Open PR {pr}", help: "Open one pull request by number", risk: "safe", slots: [s("pr", "pr")], say: ["[show|open|go] pr {pr}"], examples: ["open PR 42", "take me to pull request 61", "PR 42 kholo", "पीआर सत्तावन खोलो", "öffne PR 42", "PR 42を開いて"] },
  { id: "pr.create", title: "Open a pull request", help: "Push this branch and open a new pull request", risk: "outward", say: ["create|new|open pr new", "create|new pr"], examples: ["create a pull request", "open a new PR", "ship it", "naya PR banao", "नया पीआर बनाओ"] },
  { id: "pr.merge", title: "Merge PR {pr}", help: "Merge a green pull request", risk: "outward", slots: [s("pr", "pr", true)], say: ["merge [pr] [{pr}]"], examples: ["merge it", "merge PR 42", "PR 42 merge karo"] },
  { id: "pr.approve", title: "Approve PR {pr}", help: "Approve a pull request", risk: "outward", slots: [s("pr", "pr")], say: ["approve [pr] {pr}"], examples: ["approve PR 61", "PR 61 approve karo"] },
  { id: "pr.review", title: "Review PR {pr}", help: "Ask the agent to review a pull request", risk: "safe", slots: [s("pr", "pr")], say: ["review [pr] {pr}"], examples: ["review PR 57"] },
  { id: "pr.fix_comments", title: "Fix review comments", help: "Ask the agent to address every review comment on a PR", risk: "undoable", slots: [s("pr", "pr", true)], say: ["fix [all] comments [pr] [{pr}]"], examples: ["fix all review comments", "address the comments on PR 42", "saare comments fix karo"] },
  { id: "ci.open_check", title: "Open {check}", help: "Open a CI check (the failing one, or by name), optionally on a PR", risk: "safe", slots: [s("check", "check"), s("pr", "pr", true)], say: ["[show|open|why|go] {check} [pr] [{pr}]"], examples: ["open the failing check", "show me why CI is red", "failing check kholo", "फेलिंग चेक खोलो", "ouvre le check en échec"] },
  { id: "ci.fix_check", title: "Fix {check}", help: "Ask the agent to fix a failing CI check", risk: "undoable", slots: [s("check", "check"), s("pr", "pr", true)], say: ["[agent|claude] fix {check} [pr] [{pr}]"], examples: ["fix the failing check", "make CI green", "failing check fix karo", "फेलिंग चेक ठीक करो"] },
  { id: "ci.explain", title: "Explain {check}", help: "Ask the agent why a CI check failed", risk: "safe", slots: [s("check", "check"), s("pr", "pr", true)], say: ["explain {check} [pr] [{pr}]", "why {check} [pr] [{pr}]"], examples: ["explain the failing check", "why did lint fail"] },
  { id: "ci.rerun", title: "Rerun CI", help: "Re-run CI checks", risk: "outward", slots: [s("check", "check", true)], say: ["rerun [ci|checks|check|{check}]", "again run ci|checks|{check}", "run ci|checks again"], examples: ["rerun the checks", "run CI again", "CI dobara chalao"] },
  // ---------- workspaces, worktrees, races ----------
  { id: "workspace.switch", title: "Switch to {workspace}", help: "Switch to another workspace", risk: "undoable", slots: [s("workspace", "workspace")], say: ["switch|go|open {workspace} [workspace]", "{workspace} workspace"], examples: ["switch to the admin workspace", "admin workspace pe jao", "डॉक्स वर्कस्पेस में जाओ", "wechsle zum Workspace admin"], binds: { mcp: ["open_project"] } },
  { id: "workspace.create", title: "New workspace {name}", help: "Create a new workspace", risk: "undoable", slots: [s("name", "name", true)], say: ["create|new [new] workspace [called] [{name}]"], examples: ["create a new workspace called billing", "naya workspace banao"] },
  { id: "worktree.switch", title: "Switch to {worktree}", help: "Switch to one of Shrike's worktrees", risk: "undoable", slots: [s("worktree", "worktree")], say: ["switch|go {worktree} worktree", "{worktree} worktree"], examples: ["switch to the fix-a worktree"] },
  { id: "race.try_both", title: "Try two fixes", help: "Race two fixes, each in its own copy of the code", risk: "undoable", say: ["tryboth [fix]"], examples: ["try both fixes", "try two"], binds: { move: ["try-both"] } },
  { id: "race.show", title: "Show the race", help: "Show the running race of fixes", risk: "safe", say: ["[show] race|worktree"], examples: ["show the race", "show worktrees"] },
  // ---------- chains, skills, flows, API ----------
  { id: "chain.run", title: "Run chain {chain}", help: "Run a saved prompt chain", risk: "undoable", slots: [s("chain", "chain")], say: ["run chain {chain}", "chain {chain}"], examples: ["run the polish chain"], binds: { slash: ["chain"] } },
  { id: "chain.queue", title: "Up next", help: "Queue a prompt to run after the agent finishes", risk: "safe", slots: [s("text", "text")], say: [], examples: ["up next, add tests for the cart", "after it finishes write the docs"] },
  { id: "skill.run", title: "Run skill {skill}", help: "Run a saved skill", risk: "undoable", slots: [s("skill", "skill")], say: ["run skill {skill}", "skill {skill}"], examples: ["run the deploy skill"] },
  { id: "skill.save", title: "Save as skill", help: "Save what just worked as a skill", risk: "safe", say: ["save skill"], examples: ["save this as a skill"], binds: { move: ["save-skill"] } },
  { id: "flow.run", title: "Run flow {flow}", help: "Replay a saved flow", risk: "undoable", slots: [s("flow", "flow")], say: ["run|replay flow {flow}", "flow {flow}"], examples: ["run the checkout flow"], binds: { mcp: ["run_flow"] } },
  { id: "flow.record", title: "Record a flow", help: "Record clicks in your app as a flow", risk: "safe", say: ["record flow", "create flow"], examples: ["record a flow"], binds: { move: ["record-flow"], mcp: ["record_flow"] } },
  { id: "flow.watch", title: "Keep watching", help: "Replay the flow on every save", risk: "safe", say: ["watch [flow]"], examples: ["keep watching"], binds: { move: ["keep-watching"] } },
  { id: "api.new", title: "New request", help: "Open a new request tab in the API client", risk: "safe", say: ["new request", "create request"], examples: ["new request", "nayi request banao"] },
  { id: "api.send", title: "Send {method} {path}", help: "Send an HTTP request to the app from the API client", risk: "safe", slots: [s("method", "method"), s("path", "path", true)], say: ["send {method} [request] [{path}]", "{method} {path}", "send request [{path}]"], examples: ["send a GET to /api/todos", "GET /api/items", "request bhejo /api/users pe"], binds: { slash: ["api"] } },
  // ---------- plan control (router-handled) ----------
  { id: "confirm.yes", title: "Yes", help: "Confirm the plan card or approval on screen", risk: "safe", say: ["yes", "yes do", "do", "yes push|merge|discard|commit|pr|rerun|approve|create [do]"], examples: ["yes", "go ahead", "haan", "kar do", "हाँ"], binds: { command: ["apply"] }, meta: true },
  { id: "confirm.no", title: "No", help: "Cancel the plan card or reject the approval", risk: "safe", say: ["no", "cancel", "no cancel", "no push|merge|discard|commit|pr|rerun"], examples: ["no", "cancel", "nahi", "mat karo", "push mat karo"], meta: true },
  { id: "plan.stop", title: "Stop", help: "Stop the running plan and the agent turn", risk: "safe", say: ["stop", "cancel"], examples: ["stop", "ruko", "bas", "rehne do"], meta: true },
  { id: "plan.undo", title: "Undo", help: "Undo what voice just did", risk: "safe", say: ["undo"], examples: ["undo that", "wapas karo"], meta: true },
  { id: "plan.repeat", title: "Again", help: "Run the last plan again, through the same checks", risk: "safe", say: ["again", "repeat"], examples: ["again", "phir se"], meta: true },
  { id: "voice.help", title: "What can I say", help: "Show the commands for what's on screen", risk: "safe", say: ["help"], examples: ["what can I say"], meta: true },
  { id: "voice.off", title: "Stop listening", help: "Turn hands-free off", risk: "safe", say: ["voiceoff"], examples: ["stop listening"], meta: true },
];

export const BY_ID: ReadonlyMap<string, ActionDef> = new Map(ACTIONS.map((a) => [a.id, a]));

/** MCP tools that only the agent uses (reads, its own plans and patches): nothing for a person to say. registry.test.ts keeps this honest. */
export const AGENT_ONLY_TOOLS = new Set([
  "list_actions", "get_action", "get_event", "search_events", "get_logs", "compare_actions", "app_snapshot", "app_click", "app_type", "app_navigate", "run_scenario", "list_routes",
  "send_request", "list_requests", "save_request", "read_file", "search_code", "list_files", "propose_patch", "report_findings", "ask_options", "list_quests", "propose_quest",
  "update_objective", "link_flow", "self_review", "preflight", "plan", "load_skill", "propose_skill_update", "remember", "read_recipe", "plan_steps", "update_step", "run_command",
  "start_service", "check_health", "check_env", "write_env", "app_ready", "save_run_skill", "propose_lesson", "stop_service", "service_logs", "mark_skill_used", "list_trips", "list_flows",
]);

/** The live lists slots snap to, read from the stores on every turn (run.ts liveContext). */
export interface LiveContext {
  prs: { number: number; title: string }[];
  checks: { name: string; state: "pass" | "fail" | "pending" | "skipped"; pr?: number }[];
  branches: string[];
  workspaces: { name: string; label?: string }[];
  worktrees: string[];
  files: string[];
  routes: { method: string; path: string }[];
  chains: string[];
  skills: { id: string; name: string }[];
  flows: { id: string; name: string }[];
  focus?: string; // focused panel, for the planner
  branch?: string;
  ahead?: number;
  dirty?: number;
  staged?: number;
}

export const EMPTY_CONTEXT: LiveContext = { prs: [], checks: [], branches: [], workspaces: [], worktrees: [], files: [], routes: [], chains: [], skills: [], flows: [] };
