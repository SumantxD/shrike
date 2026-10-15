import { useEffect } from "react";
import { openTools } from "../mcp/store.ts"; // mcp: MCP1
import { openApi } from "../api/store.ts"; // api: AP
import type { AgentOptions, PointPick } from "@shrike/schema";
import { api, call } from "../lib/api.ts";
import { clockTime } from "../lib/format.ts";
import { useActions } from "../stores/actions.ts";
import { useAgent } from "../stores/agent.ts";
import { firstFailure, tripFor, tripOrder, useThread } from "../stores/thread.ts";
import { toast, useUi } from "../stores/ui.ts";
import { useRun } from "../stores/run.ts";
import { useSkills } from "../stores/skills.ts";
import { runChain } from "../chains/store.ts";
import { useOptions } from "../options/store.ts"; // options: M6
import { OPTIONS_ASK } from "../options/logic.ts";
import { toggleAppWindow } from "../appwindow/store.ts"; // AW1
import {
  commandName, eventsById, fileChip, goalWithContext, logChip, pickChip, planFirstDefault, pointQuestion, previousSameLabel, resolveKey, stationChip, stationLoc, tidySummary,
  type Chip, type Command, type Move, type SlashEntry, type SlashId,
} from "./logic.ts";

// Every shell action in one place, so keys and buttons share them.

export async function openInEditor(file: string, line: number): Promise<void> {
  const r = await call((a) => a.openInEditor(file, line), "Couldn't open your editor");
  if (!r) return;
  if (r.ok) toast(`Opened ${file}:${line}${r.editor ? ` in ${r.editor}` : ""}`, "ok");
  else toast(r.error ?? "Couldn't open your editor", "error");
}

/** E: open the focused step's file inside Shrike. */
export function openFocusedFile(): void {
  const { focus } = useThread.getState();
  const view = focus.actionId ? useActions.getState().byId[focus.actionId] : undefined;
  const st = focus.actionId ? tripFor(focus.actionId)?.stations[focus.station] : undefined;
  const loc = view && st ? stationLoc(view, st) : undefined;
  if (loc && view && st) useUi.getState().openFile({ path: loc.file, line: loc.line, error: st.status === "error", actionId: view.id, stepIndex: st.stepIndex });
  else toast("This step has no file to open.");
}

/** Focus the station that holds an event (from Logs, Network). */
export function focusEvent(actionId: string, eventId: string): void {
  const i = tripFor(actionId)?.stations.findIndex((s) => s.eventIds.includes(eventId)) ?? -1;
  useThread.getState().setFocus(actionId, Math.max(0, i));
}

/** Jump to a trip: its failure if it broke, else its first station. */
export function viewTrip(id: string): void {
  const t = tripFor(id);
  useUi.getState().setNewTrip(null);
  useThread.getState().setFocus(id, t && t.status === "error" ? firstFailure(t) : 0);
}

// ---------- O1 point mode ----------

export async function togglePoint(): Promise<void> {
  if (useUi.getState().pointing) return cancelPoint();
  if (useRun.getState().status.state !== "running") return toast("Press Run first, then point at something in your app.");
  useUi.setState({ pointing: true, appVisible: true });
  const ok = await call((a) => a.startPointMode().then(() => true), "Couldn't start point mode");
  if (!ok) useUi.setState({ pointing: false });
}

export function cancelPoint(): void {
  useUi.setState({ pointing: false });
  void api().cancelPointMode().catch(() => {});
}

/** A pick from the app: reticle on the dock, chip in Ask, a question ready to send. */
export function onPicked(pick: PointPick): void {
  useUi.setState({ pointing: false, pick: { ...pick, at: Date.now() } });
  useUi.getState().addChip(pickChip(pick));
  const { byId, order } = useActions.getState();
  const name = pick.text.toLowerCase();
  const last = name ? order.map((id) => byId[id]).find((a) => a && a.label.toLowerCase().includes(name)) : undefined;
  useAgent.getState().openAndFocus(pointQuestion(pick, last?.status === "error"));
}

// ---------- O8 drag to Ask ----------

export const DRAG_TYPES = ["application/x-shrike-station", "application/x-shrike-log", "application/x-shrike-file"] as const;
export const acceptsDrop = (dt: DataTransfer): boolean => DRAG_TYPES.some((t) => dt.types.includes(t));

function parse(dt: DataTransfer, type: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(dt.getData(type) || "null");
    return v && typeof v === "object" ? v : null;
  } catch {
    return null;
  }
}

/** Station: {actionId, station} or {actionId, eventId}. Log: {actionId, eventId}. File: {path, line?}. */
export function chipFromDrop(dt: DataTransfer): Chip | null {
  const st = parse(dt, DRAG_TYPES[0]);
  if (st && typeof st.actionId === "string") {
    const view = useActions.getState().byId[st.actionId];
    const trip = tripFor(st.actionId);
    const i = typeof st.station === "number" ? st.station : (trip?.stations.findIndex((s) => s.eventIds.includes(String(st.eventId))) ?? -1);
    const station = trip?.stations[i];
    if (view && station) return stationChip(station, eventsById(view).get(station.id));
  }
  const lg = parse(dt, DRAG_TYPES[1]);
  if (lg && typeof lg.actionId === "string") {
    const view = useActions.getState().byId[lg.actionId];
    const e = view ? eventsById(view).get(String(lg.eventId)) : undefined;
    if (e) return logChip(e);
  }
  const f = parse(dt, DRAG_TYPES[2]);
  if (f && typeof f.path === "string") return fileChip(f.path, typeof f.line === "number" ? f.line : undefined);
  return null;
}

export function dropOnAsk(dt: DataTransfer): void {
  const chip = chipFromDrop(dt);
  if (!chip) return toast("Shrike couldn't read what you dropped.");
  useUi.getState().addChip(chip);
  useAgent.getState().openAndFocus();
}

// ---------- Ask, slash commands (A10), issue card (O6) ----------

/** The Ask pill's hidden-move options for this goal: Plan first (auto unless toggled), Think harder, my MCP tools. */
export function askOptions(goal: string): AgentOptions {
  const { ask: o, chips } = useUi.getState();
  const planFirst = o.planFirst ?? planFirstDefault(goal, chips);
  return { ...(planFirst ? { planFirst } : {}), ...(o.thinking !== "normal" ? { thinking: o.thinking } : {}), ...(o.useMyMcp ? { useMyMcp: true } : {}), ...(useOptions.getState().askMode ? { context: [OPTIONS_ASK] } : {}) };
}

/** Like the agent store's start(), with options. */
async function startWith(goal: string, opts: AgentOptions): Promise<void> {
  const brain = useAgent.getState().brain;
  if (!goal.trim() || !brain) return;
  useAgent.setState({ steps: [], approvals: [], answered: {}, run: null, usage: null, revising: null, sentNotes: [] });
  const info = await call((a) => a.startAgentWith(goal.trim().slice(0, 4000), brain, opts), "Couldn't start the agent");
  if (info) useAgent.setState((s) => ({ run: s.run?.id === info.id ? { ...info, status: s.run.status } : info }));
}

/** Starts the agent with what was typed plus the context chips, then clears the chips. */
export function ask(goal: string, extra: AgentOptions = {}): void {
  const ag = useAgent.getState();
  const full = goalWithContext(goal, useUi.getState().chips);
  if (!full) return;
  const opts = { ...askOptions(goal), ...extra };
  useOptions.setState({ askMode: false }); // M6: Show me options is for the next ask only
  if (Object.keys(opts).length) void startWith(full, opts);
  else {
    ag.setGoal(full);
    void ag.start();
  }
  ag.setGoal(goal);
  useUi.setState({ chips: [] });
}

/** A palette row: built-ins run here; a saved command asks its prompt; a skill runs as a flow (S3). */
export function runEntry(e: SlashEntry, rest: string): void {
  if (e.kind === "builtin") return runSlash(e.id as SlashId, rest);
  if (e.kind === "command") return ask(`${e.prompt ?? ""}${rest ? `\n${rest}` : ""}`);
  const skill = useAgent.getState().skills.find((k) => k.id === e.id);
  if (skill) return void useSkills.getState().run(skill, rest || undefined); // S3 checklist; git skills run the git flows
  void call((a) => a.runSkill(e.id, rest || undefined), "Couldn't run the skill").then((info) => info && useAgent.setState({ run: info, steps: [], approvals: [], usage: null }));
}

/** "Save as command": what you asked becomes /name in the palette. */
export async function saveAsCommand(goal: string): Promise<void> {
  const prompt = goal.trim();
  if (!prompt) return;
  const name = commandName(prompt);
  const ok = await call((a) => a.saveAsCommand(name, prompt).then(() => true), "Couldn't save the command");
  if (!ok) return;
  const commands = await call((a) => a.listCommands(), "Couldn't load your commands");
  useUi.setState((s) => ({ commands: commands ?? [...s.commands.filter((c) => c.name !== name), { name, prompt }] }));
  toast(`Saved. Type /${name} to ask it again.`, "ok");
}

/** Tidy up the agent's memory: stop, then a fresh session that starts from a summary (/compact, made obvious). */
export async function tidyUp(): Promise<void> {
  const ag = useAgent.getState();
  const goal = ag.run?.goal ?? ag.goal;
  const summary = tidySummary(goal, ag.steps);
  if (ag.run?.status === "running") await ag.stop();
  await startWith(summary, askOptions(goal));
  toast("Started a fresh session with a short summary.", "ok");
}

/** One hidden-move button (logic.ts hiddenMoves). */
export async function runMove(m: Move): Promise<void> {
  const ui = useUi.getState();
  const actionId = ui.sdlc?.actionId ?? undefined;
  switch (m.id) {
    case "find-cause":
      return useAgent.getState().openAndFocus(m.prompt ?? "Why does this break? Find the cause.");
    case "rewind":
      if (m.checkpointId) await useAgent.getState().rewind(m.checkpointId);
      return;
    case "try-both":
      if (actionId && (await call((a) => a.startRace(actionId, 2), "Couldn't start the race"))) toast("Trying two fixes, each in its own copy of your code.", "ok");
      return;
    case "review-fix":
      if (m.patchId && (await call((a) => a.reviewFix(m.patchId!), "Couldn't start the review"))) useUi.setState({ sdlcOpen: "review" });
      return;
    case "run-tests": {
      toast("Running your tests…");
      const r = await call((a) => a.runTests(), "Couldn't run the tests");
      if (r === null) toast("This project has no test script.");
      else if (r) toast(r.summary, r.ok ? "ok" : "error");
      return;
    }
    case "save-skill": {
      await useSkills.getState().saveAsSkill({ actionId, runId: useAgent.getState().run?.id });
      return;
    }
    case "keep-watching": {
      const f = ui.flows.find((x) => x.lastRun?.actionIds.some((id) => useActions.getState().byId[id]?.label === useActions.getState().byId[actionId ?? ""]?.label)) ?? ui.flows[0];
      if (f && (await call((a) => a.setFlowWatch(f.id, { mode: "save" }).then(() => true), "Couldn't start watching"))) toast(`Watching "${f.name}" on every save.`, "ok");
      return;
    }
    case "record-flow":
      if (await call((a) => a.startFlowRecording().then(() => true), "Couldn't start recording")) {
        useUi.setState({ panel: "flows", appVisible: true });
        toast("Recording. Click through your app, then stop and name it.");
      }
      return;
    case "ship":
      return useUi.setState({ panel: "ship" });
  }
}

function focused() {
  const { focus } = useThread.getState();
  const id = focus.actionId ?? tripOrder().at(-1) ?? null;
  const view = id ? useActions.getState().byId[id] : undefined;
  const trip = id ? tripFor(id) : undefined;
  return { id, view, trip, station: trip?.stations[id === focus.actionId ? focus.station : 0] };
}

export function openIssue(actionId?: string | null): void {
  const id = actionId ?? focused().id;
  if (!id) return toast("Pick a trip first.");
  useUi.setState({ issue: id });
}

export function runSlash(id: SlashId, rest: string): void {
  const { id: trip, view, station } = focused();
  const tail = rest ? ` ${rest}` : "";
  if (id === "time") return run("time");
  if (id === "record") return run("record");
  if (id === "issue") return openIssue(trip);
  if (id === "chain") return void runChain(rest); // P4
  if (id === "tools") return openTools(); // MCP1
  if (id === "api") return openApi(rest); // AP
  if (id === "files" || id === "thread") return useThread.getState().setView(id); // FV
  if (!trip || !view) return toast("Pick a trip first.");
  if (id === "replay") {
    useThread.getState().setFocus(trip, 0);
    return run("replay");
  }
  if (id === "explain") {
    const loc = view && station ? stationLoc(view, station) : undefined;
    return ask(`Explain in plain words what happened at ${station?.label ?? "this step"}${loc ? ` (${loc.file}:${loc.line})` : ""} in the trip "${view.label}" (trip ${trip}).${tail}`);
  }
  if (id === "fix") return ask(`The trip "${view.label}" (trip ${trip}) ${view.status === "error" ? "broke" : "doesn't do what I expect"}: ${view.summary.headline} Find the cause and fix it.${tail}`);
  const { order, byId } = useActions.getState();
  const prev = previousSameLabel([...order].reverse(), byId, trip);
  if (!prev) return toast(`There's no earlier "${view.label}" to compare with.`);
  ask(`Compare the trip "${view.label}" at ${clockTime(view.startMs)} (trip ${trip}) with the previous one at ${clockTime(byId[prev]!.startMs)} (trip ${prev}). What changed between them, and why?${tail}`);
}

export function run(cmd: Command): void {
  const th = useThread.getState();
  const ui = useUi.getState();
  if (!ui.keysUsed && ["step-down", "step-up", "dive", "time", "next-failure", "replay"].includes(cmd)) useUi.setState({ keysUsed: true });
  switch (cmd) {
    case "step-down":
    case "step-up":
      if (th.playing) th.setPlaying(false);
      return th.step(cmd === "step-down" ? 1 : -1);
    case "trip-down":
    case "trip-up":
      return th.stepTrip(cmd === "trip-down" ? 1 : -1);
    case "trip-list": {
      const el = document.querySelector<HTMLButtonElement>(".th-mini button.on") ?? document.querySelector<HTMLButtonElement>(".th-mini button");
      return el?.focus();
    }
    case "dive":
      if (th.view === "files" && th.outward) return th.setOutward(0); // FV: Enter comes back in to the file cards
      return th.focus.actionId ? th.dive() : undefined;
    case "view":
      return th.setView(th.view === "files" ? "thread" : "files");
    case "replay":
      if (!th.focus.actionId) return;
      if (th.view === "files") return th.setPlaying(!th.playing); // FV: Space plays the steps and pauses
      th.surface();
      return th.arrive(th.focus.actionId);
    case "time":
      return th.toggleTime();
    case "next-failure":
      return th.nextFailure();
    case "app":
      return useUi.setState({ appVisible: !ui.appVisible });
    case "logs":
    case "network":
    case "api":
    case "terminal":
      return ui.toggleSheet(cmd);
    case "details":
      return th.focus.actionId ? ui.toggleSheet("details") : undefined;
    case "editor":
      return openFocusedFile();
    case "record":
      return useUi.setState({ recMenu: !ui.recMenu });
    case "view-new-trip":
      return ui.newTrip ? viewTrip(ui.newTrip) : undefined;
    case "ask":
      return useAgent.getState().openAndFocus();
    case "point":
      return void togglePoint();
    case "pop-out":
      return toggleAppWindow();
    case "quick-open":
      return useUi.setState({ quickOpen: !ui.quickOpen });
    case "skills":
    case "ship":
    case "flows":
      return ui.togglePanel(cmd);
    case "apply":
    case "escape": {
      const ag = useAgent.getState();
      const req = ag.approvals[0];
      if (cmd === "apply") return req ? void ag.answer(req.id, true) : undefined;
      if (ui.quickOpen) return useUi.setState({ quickOpen: false });
      if (ui.sdlcOpen) return useUi.setState({ sdlcOpen: null });
      if (ui.panel) return useUi.setState({ panel: null });
      if (ui.pointing) return cancelPoint();
      if (ag.open) return ag.setOpen(false);
      if (ui.issue) return useUi.setState({ issue: null });
      if (ui.setup) return useUi.setState({ setup: false });
      if (ui.recMenu) return useUi.setState({ recMenu: false });
      if (ui.sheet) return useUi.setState({ sheet: null });
      if (req) {
        if (req.patch) th.setProbe(null);
        return void ag.answer(req.id, false);
      }
      if (document.activeElement?.closest(".th-mini")) return (document.activeElement as HTMLElement).blur();
      if (th.dived) return th.surface();
      if (th.view === "files" && th.focus.actionId && th.outward < 2) return th.setOutward(th.outward === 0 ? 1 : 2); // FV: cards, then the tree, then the whole route
      if (ui.newTrip) return ui.setNewTrip(null);
      return;
    }
  }
}

export const isTyping = (t: EventTarget | null): boolean =>
  t instanceof HTMLElement && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName));

export function useKeyboard(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat && !e.key.startsWith("Arrow")) return;
      const typing = isTyping(e.target);
      const cmd = resolveKey(
        { key: e.key, meta: e.metaKey, ctrl: e.ctrlKey, alt: e.altKey, typing },
        { newTrip: !!useUi.getState().newTrip, approval: useAgent.getState().approvals.length > 0, files: useThread.getState().view === "files" },
      );
      if (!cmd) return;
      // Esc inside a field only closes what that field belongs to (the Ask pill or a sheet).
      const ui = useUi.getState();
      if (cmd === "escape" && typing && !useAgent.getState().open && !ui.sheet && !ui.quickOpen && !ui.panel) return (e.target as HTMLElement).blur();
      // Space/Enter on a keyboard-focused button presses it.
      if ((e.key === " " || e.key === "Enter") && !e.metaKey && e.target instanceof HTMLButtonElement && e.target.matches(":focus-visible")) return;
      e.preventDefault();
      run(cmd);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
