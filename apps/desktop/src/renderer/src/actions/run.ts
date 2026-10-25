import type { FileNode } from "@shrike/schema";
import { redactText } from "@shrike/redact";
import { api } from "../lib/api.ts";
import { ask, openFocusedFile, openIssue, run, runEntry, runMove, runSlash, togglePoint, viewTrip } from "../hud/commands.ts";
import { sentence } from "../hud/logic.ts";
import { useAgent } from "../stores/agent.ts";
import { useRun } from "../stores/run.ts";
import { tripFor, tripOrder, useThread } from "../stores/thread.ts";
import { useUi } from "../stores/ui.ts";
import { useWorktrees } from "../stores/worktrees.ts";
import { useGit } from "../stores/git.ts";
import { useScm } from "../scm/store.ts";
import { openPrPanel, usePr } from "../pr/store.ts";
import { useWorkspaces } from "../workspaces/store.ts";
import { runChain, useChains } from "../chains/store.ts";
import { useSkills } from "../stores/skills.ts";
import { useOptions } from "../options/store.ts";
import { OPTIONS_ASK } from "../options/logic.ts";
import { useDock } from "../dock/store.ts";
import { openApi } from "../api/store.ts";
import type { LiveContext, PanelId } from "./registry.ts";
import type { Bindings, PlannedStep, StepResult } from "../voice/understand/executor.ts";

// The registry's run fields (docs/16 §5): each action calls the same function its key, button or slash command calls.
// Outward steps still go through main's own approval cards (push, PR, merge, discard); voice adds no way around them.

let files: string[] = [];
const flat = (nodes: FileNode[]): string[] => nodes.flatMap((n) => (n.dir ? flat(n.children ?? []) : [n.path]));

/** The project's files for "open <name>"; refreshed when a turn starts, so it's ready by the final words. */
export async function refreshFiles(): Promise<string[]> {
  const tree = await api().listFiles().catch(() => null);
  if (tree) files = flat(tree).slice(0, 20_000);
  return files;
}

/** The live lists slots snap to, read from the stores now. */
export function liveContext(): LiveContext {
  const git = useGit.getState();
  const scm = useScm.getState().state;
  const pr = usePr.getState().view;
  const prs = (git.prs ?? []).filter((p) => p.state === "open").map((p) => ({ number: p.number, title: p.title }));
  if (pr?.pr && !prs.some((p) => p.number === pr.pr!.number)) prs.unshift({ number: pr.pr.number, title: pr.pr.title });
  const checks = (pr?.checks ?? git.state?.pr?.checks ?? []).map((c) => ({ name: c.name, state: c.state, ...(pr?.pr ? { pr: pr.pr.number } : {}) }));
  const ui = useUi.getState();
  const ws = useWorkspaces.getState().list;
  const wt = useWorktrees.getState().list ?? [];
  return {
    prs,
    checks,
    branches: [...new Set([scm?.branch, scm?.base, ...ws.map((w) => w.branch), ...wt.map((w) => w.branch)].filter((b): b is string => !!b))],
    workspaces: ws.map((w) => ({ name: w.name, ...(w.label ? { label: w.label } : {}) })),
    worktrees: wt.map((w) => w.name),
    files,
    routes: [],
    chains: useChains.getState().defs.map((d) => d.name),
    skills: useAgent.getState().skills.map((k) => ({ id: k.id, name: k.name })),
    flows: ui.flows.map((f) => ({ id: f.id, name: f.name })),
    ...(ui.sheet ? { focus: ui.sheet } : ui.panel ? { focus: ui.panel } : {}),
    ...(scm?.branch ? { branch: scm.branch, ahead: scm.ahead, dirty: scm.files.filter((f) => f.area !== "staged").length, staged: scm.files.filter((f) => f.area === "staged").length } : {}),
  };
}

const NO_TRIP = "No trip to look at yet";
const hasTrip = () => !!useThread.getState().focus.actionId || tripOrder().length > 0;
const need = (ok: unknown, why: string): void => {
  if (!ok) throw new Error(why);
};
const brain = () => need(useAgent.getState().brain, "No agent is set up yet");

const SHEETS = ["logs", "network", "api", "terminal", "details"] as const;
type SheetId = (typeof SHEETS)[number];
const NAME: Record<PanelId, string> = {
  logs: "logs", network: "network", api: "the API client", terminal: "the terminal", details: "details", app: "your app", skills: "skills", flows: "flows", tools: "your tools",
  ship: "the ship panel", time: "the time view", changes: "changes", checks: "checks", workspaces: "workspaces",
};

function isOpen(p: PanelId): boolean {
  const ui = useUi.getState();
  const d = useDock.getState();
  if ((SHEETS as readonly string[]).includes(p)) return ui.sheet === p;
  if (p === "app") return ui.appVisible;
  if (p === "time") return useThread.getState().timeMode;
  if (p === "skills" || p === "flows" || p === "ship") return ui.panel === p;
  if (p === "tools" || p === "changes") return d.open && d.tab === p;
  if (p === "checks") return usePr.getState().open || (d.open && d.tab === "pr");
  return !useWorkspaces.getState().collapsed;
}

function setOpen(p: PanelId, open: boolean): void {
  if (isOpen(p) === open) return;
  const ui = useUi.getState();
  if ((SHEETS as readonly string[]).includes(p)) {
    if (p === "details") need(useThread.getState().focus.actionId, NO_TRIP);
    return ui.toggleSheet(p as SheetId);
  }
  if (p === "app") return run("app");
  if (p === "time") return run("time");
  if (p === "skills" || p === "flows" || p === "ship") return ui.togglePanel(p);
  if (p === "tools" || p === "changes") return open ? useDock.getState().show(p) : useDock.getState().toggle();
  if (p === "checks") return open ? openPrPanel() : usePr.setState({ open: false });
  useWorkspaces.getState().toggle();
}

function panel(p: PanelId, open: boolean): StepResult {
  const was = isOpen(p);
  setOpen(p, open);
  return { echo: `${open ? "Showing" : "Hiding"} ${NAME[p]}`, undo: () => setOpen(p, was) };
}

const cmd = (c: Parameters<typeof run>[0], echo: string, guard = true): StepResult => {
  need(guard, NO_TRIP);
  run(c);
  return { echo };
};

const prNumber = (n: unknown): number => {
  const v = typeof n === "number" ? n : (usePr.getState().view?.pr?.number ?? useGit.getState().state?.pr?.number);
  need(v, "No pull request for this branch yet");
  return v!;
};

function check(name: unknown) {
  const view = usePr.getState().view;
  const c = view?.checks.find((k) => k.name === name) ?? view?.checks.find((k) => k.state === "fail");
  need(c, "Couldn't find that check");
  return c!;
}

const later = <T>(p: Promise<T>, why: string): Promise<T> => p.catch((e: unknown) => Promise.reject(new Error(e instanceof Error && e.message ? e.message : why)));

type Run = (s: PlannedStep) => StepResult | Promise<StepResult>;

/** A Changes-dock action: the store keeps its errors in note, so a failed push fails the step in plain words. */
async function scm(f: () => Promise<void>, ok: string): Promise<StepResult> {
  await f();
  const note = useScm.getState().note;
  need(note?.tone !== "error" && !/^Not (thrown away|sent)\b/.test(note?.text ?? ""), note?.text ?? ""); // "Not sent": you said no on main's card
  return { echo: note?.text ?? ok };
}

const RUN: Record<string, Run> = {
  "step.next": () => cmd("step-down", "Next step", hasTrip()),
  "step.prev": () => cmd("step-up", "Previous step", hasTrip()),
  "trip.next": () => cmd("trip-down", "Next trip", hasTrip()),
  "trip.prev": () => cmd("trip-up", "Previous trip", hasTrip()),
  "trip.list": () => cmd("trip-list", "Trip list", hasTrip()),
  "trip.view_new": () => cmd("view-new-trip", "Showing the new trip", !!useUi.getState().newTrip),
  "trip.latest": () => {
    const id = tripOrder().at(-1);
    need(id, NO_TRIP);
    viewTrip(id!);
    return { echo: "Latest trip" };
  },
  "failure.next": () => {
    need(tripOrder().some((id) => tripFor(id)?.status === "error"), "Nothing broke");
    run("next-failure");
    return { echo: "Here's where it broke" };
  },
  dive: () => cmd("dive", "Diving in", !!useThread.getState().focus.actionId),
  escape: () => cmd("escape", "Back"),
  replay: () => cmd("replay", "Replaying", !!useThread.getState().focus.actionId),
  "view.files": () => {
    const was = useThread.getState().view;
    useThread.getState().setView("files");
    return { echo: "Showing the files view", undo: () => useThread.getState().setView(was) };
  },
  "view.thread": () => {
    const was = useThread.getState().view;
    useThread.getState().setView("thread");
    return { echo: "Showing the Thread", undo: () => useThread.getState().setView(was) };
  },
  "panel.show": (s) => panel(s.slots.panel as PanelId, true),
  "panel.hide": (s) => panel(s.slots.panel as PanelId, false),
  "file.open_focused": () => (openFocusedFile(), { echo: "Opening the file" }),
  "file.open": (s) => {
    const path = String(s.slots.path);
    const before = useUi.getState().file;
    useUi.getState().openFile({ path, line: 1 });
    return { echo: `Opening ${path.split("/").pop()}`, undo: () => useUi.setState({ file: before }) };
  },
  quick_open: () => cmd("quick-open", "Find a file"),
  "keys.show": () => cmd("help", "Keyboard shortcuts"),
  "route.open": (s) => (openApi(String(s.slots.route).split(" ").pop()), { echo: "Opening the route" }),
  record: () => cmd("record", "Recording options"),
  "app.window": () => cmd("pop-out", "Moving your app"),
  point: () => (void togglePoint(), { echo: useUi.getState().pointing ? "Point mode off" : "Point at something in your app" }),
  issue: () => (need(hasTrip(), NO_TRIP), openIssue(), { echo: "Writing it up" }),
  compare: () => (need(hasTrip(), NO_TRIP), brain(), runSlash("compare", ""), { echo: "Comparing with last time" }),
  "app.run": async () => {
    const st = useRun.getState().status.state;
    need(st !== "running" && st !== "starting", "Your app is already running");
    void useRun.getState().start();
    return { echo: "Starting your app", undo: () => useRun.getState().stop() };
  },
  "app.stop": () => {
    need(useRun.getState().status.state !== "idle", "Your app isn't running");
    void useRun.getState().stop();
    return { echo: "Stopping your app", undo: () => useRun.getState().start() };
  },
  "app.restart": () => (void useRun.getState().restart(), { echo: "Restarting your app" }),
  "tests.run": () => (void runMove({ id: "run-tests", label: "Run tests", hint: "" }), { echo: "Running your tests" }),
  "agent.ask": (s) => (brain(), ask(String(s.slots.text)), { echo: "Asking the agent" }),
  "agent.open": () => cmd("ask", "Ask away"),
  "agent.options": (s) => {
    if (!s.slots.text) return useOptions.setState({ askMode: true }), run("ask"), { echo: "Options on. What should it show you?" };
    brain();
    ask(String(s.slots.text), { context: [OPTIONS_ASK] });
    return { echo: "Asking for options" };
  },
  "agent.fix": () => (need(hasTrip(), NO_TRIP), brain(), runSlash("fix", ""), { echo: "Asking the agent to fix it" }),
  "agent.explain": () => (need(hasTrip(), NO_TRIP), brain(), runSlash("explain", ""), { echo: "Asking the agent to explain" }),
  "agent.find_cause": () => (void runMove({ id: "find-cause", label: "", hint: "" }), { echo: "Ask is ready" }),
  "agent.stop": () => {
    const ag = useAgent.getState();
    need(ag.run?.status === "running", "The agent isn't working");
    void ag.stop();
    return { echo: "Stopping the agent" };
  },
  "fix.review": () => {
    const patch = useAgent.getState().approvals.find((a) => a.patch)?.patch;
    need(patch, "No fix to review yet");
    void runMove({ id: "review-fix", label: "", hint: "", patchId: patch!.id });
    return { echo: "Reviewing the fix" };
  },
  "checkpoint.rewind": () => {
    const cp = useAgent.getState().checkpoints.at(-1);
    need(cp, "No checkpoint to go back to");
    void useAgent.getState().rewind(cp!.id);
    return { echo: "Rewinding" };
  },
  "git.stage_all": async () => {
    await useScm.getState().stage([]);
    const n = useScm.getState().state?.files.filter((f) => f.area === "staged").length ?? 0;
    return { echo: `Staged ${n} file${n === 1 ? "" : "s"}`, undo: () => useScm.getState().unstage([]) };
  },
  "git.unstage_all": async () => (await useScm.getState().unstage([]), { echo: "Unstaged", undo: () => useScm.getState().stage([]) }),
  "git.commit": async (s) => {
    if (s.detail && !useScm.getState().message.trim()) useScm.setState({ message: s.detail });
    need(useScm.getState().message.trim(), "Write a commit message first");
    const before = useScm.getState().state?.commits[0]?.sha;
    await useScm.getState().commit();
    need(useScm.getState().state?.commits[0]?.sha !== before, useScm.getState().note?.text ?? "Couldn't commit");
    return { echo: "Committed", undo: () => useScm.getState().undo() };
  },
  "git.undo_commit": async () => (await useScm.getState().undo(), { echo: "Undone" }),
  "git.push": () => scm(() => useScm.getState().sync(), "Pushed"),
  "git.pull": () => scm(() => useScm.getState().sync(), "Pulled"),
  "git.sync_main": async () => {
    const s = await later(api().syncWithMain(), "Couldn't catch up with main"); // main picks merge for a pushed branch: never a force-push
    return { echo: s.conflicts.length ? "Caught up, with conflicts to fix" : "Caught up with main" };
  },
  "git.resolve": async () => (await later(api().resolveConflicts(), "Couldn't start resolving"), { echo: "Asking the agent to resolve the conflicts" }),
  "git.discard": () => scm(() => useScm.getState().discard([]), "Thrown away"),
  "branch.switch": async (s) => {
    const w = useWorkspaces.getState().list.find((x) => x.branch === s.slots.branch);
    need(w, `No workspace is on ${s.slots.branch}`);
    await useWorkspaces.getState().open(w!.path);
    return { echo: `Switching to ${s.slots.branch}` };
  },
  "pr.list": () => (openPrPanel(undefined, true), void useGit.getState().loadPrs(), { echo: "Showing pull requests" }),
  "pr.open": (s) => (openPrPanel(Number(s.slots.pr)), void usePr.getState().load(Number(s.slots.pr)), { echo: `Opening PR ${s.slots.pr}` }),
  "pr.create": async () => {
    const r = await later(api().shipFix({ actionId: useThread.getState().focus.actionId ?? undefined }), "Couldn't open the pull request");
    return { echo: `Opened PR ${r.number}` };
  },
  "pr.merge": async (s) => {
    const n = prNumber(s.slots.pr);
    await later(api().mergePullRequest(n), "Couldn't merge");
    return { echo: `Merged PR ${n}` };
  },
  "pr.approve": async (s) => {
    const n = prNumber(s.slots.pr);
    need(await usePr.getState().act({ kind: "review", n, event: "APPROVE", body: "" }, "Approved"), usePr.getState().note?.text ?? "Couldn't approve");
    return { echo: `Approved PR ${n}` };
  },
  "pr.review": async (s) => (brain(), await later(api().reviewPullRequest(prNumber(s.slots.pr)), "Couldn't start the review"), { echo: "Reviewing the pull request" }),
  "pr.fix_comments": async (s) => (brain(), await usePr.getState().agent({ kind: "fix-all", n: prNumber(s.slots.pr) }, "Fixing the comments"), { echo: "Fixing the review comments" }),
  "ci.open_check": (s) => {
    const c = check(s.slots.check);
    openPrPanel(typeof s.slots.pr === "number" ? s.slots.pr : undefined);
    if (c.url) void usePr.getState().job(c.url, c.name);
    return { echo: `Showing ${c.name}` };
  },
  "ci.fix_check": async (s) => {
    brain();
    const c = check(s.slots.check);
    await usePr.getState().agent({ kind: "fix-check", name: c.name, ...(typeof s.slots.pr === "number" ? { n: s.slots.pr } : {}) }, "Fixing the check");
    return { echo: `Asking the agent to fix ${c.name}` };
  },
  "ci.explain": async (s) => {
    brain();
    const c = check(s.slots.check);
    await later(api().explainCheck(prNumber(s.slots.pr), c.name), "Couldn't explain the check");
    return { echo: `Explaining ${c.name}` };
  },
  "ci.rerun": async (s) => {
    const view = usePr.getState().view;
    const c = s.slots.check ? check(s.slots.check) : view?.checks.find((k) => k.state === "fail" && k.run);
    need(c?.run, "Nothing to rerun");
    need(await usePr.getState().act({ kind: "rerun", run: c!.run! }, "Rerunning"), usePr.getState().note?.text ?? "Couldn't rerun");
    return { echo: `Rerunning ${c!.name}` };
  },
  "workspace.switch": async (s) => {
    const list = useWorkspaces.getState().list;
    const w = list.find((x) => x.name === s.slots.workspace);
    need(w, `No workspace called ${s.slots.workspace}`);
    const back = list.find((x) => x.current)?.path;
    need(await useWorkspaces.getState().open(w!.path), "Couldn't switch");
    return { echo: `Switching to ${w!.label ?? w!.name}`, ...(back ? { undo: () => useWorkspaces.getState().open(back) } : {}) };
  },
  "workspace.create": () => (useWorkspaces.getState().setDialog(true), { echo: "New workspace" }),
  "worktree.switch": async (s) => (await useWorktrees.getState().switchTo(String(s.slots.worktree)), { echo: `Switching to ${s.slots.worktree}` }),
  "race.try_both": async () => {
    const id = useUi.getState().sdlc?.actionId ?? useThread.getState().focus.actionId ?? tripOrder().at(-1);
    need(id, NO_TRIP);
    await later(api().startRace(id!, 2), "Couldn't start the race");
    return { echo: "Trying two fixes, each in its own copy" };
  },
  "race.show": () => {
    const w = useWorktrees.getState();
    const last = Object.values(w.races).at(-1);
    need(last, "No race yet. Say try both on a broken trip");
    useWorktrees.setState({ open: last!.id });
    return { echo: "Showing the race", undo: () => useWorktrees.setState({ open: null }) };
  },
  "chain.run": (s) => (void runChain(String(s.slots.chain)), { echo: `Starting the ${s.slots.chain} chain` }),
  "chain.queue": async (s) => (need(await useChains.getState().queue(String(s.slots.text)), "Couldn't add it"), { echo: "Added to up next" }),
  "skill.run": (s) => (runEntry({ id: String(s.slots.skill), hint: "", kind: "skill" }, ""), { echo: "Running the skill" }),
  "skill.save": async () => (await useSkills.getState().saveAsSkill({ actionId: useUi.getState().sdlc?.actionId ?? undefined, runId: useAgent.getState().run?.id }), { echo: "Saved as a skill" }),
  "flow.run": async (s) => (await later(api().runFlow(String(s.slots.flow)), "Couldn't run the flow"), { echo: "Running the flow" }),
  "flow.record": async () => (await runMove({ id: "record-flow", label: "", hint: "" }), { echo: "Recording. Click through your app" }),
  "flow.watch": async () => (await runMove({ id: "keep-watching", label: "", hint: "" }), { echo: "Watching on every save" }),
  "api.new": () => (openApi(""), { echo: "New request" }),
  "api.send": (s) => (openApi(String(s.slots.path ?? "")), { echo: `${s.slots.method} ${s.slots.path ?? ""} ready to send`.trim() }),
};

/** "push" with changes not yet committed gets a Commit first, with what was said as its message (editable on the card). */
function pre(steps: PlannedStep[], heard: string): PlannedStep[] {
  const out: PlannedStep[] = [];
  const scm = useScm.getState().state;
  const staged = scm?.files.some((f) => f.area === "staged") ?? false;
  const dirty = scm?.files.some((f) => f.area !== "staged") ?? false;
  const message = `Voice: ${sentence(redactText(heard), 60)}`; // a commit message is stored and pushed
  for (const s of steps) {
    const before = out.map((x) => x.action);
    if (s.action === "git.push" && !before.includes("git.commit") && (staged || (dirty && before.includes("git.stage_all")))) out.push({ action: "git.commit", slots: {}, added: true, detail: message });
    out.push(s.action === "git.commit" && !useScm.getState().message.trim() ? { ...s, detail: message } : s);
  }
  return out;
}

export const BINDINGS: Bindings = {
  async run(step) {
    const f = RUN[step.action];
    if (!f) throw new Error("Voice can't do that yet");
    return f(step);
  },
  pre,
};
