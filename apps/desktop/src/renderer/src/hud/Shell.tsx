import { Component, useEffect, useRef, useState, type ComponentType, type ReactNode, type RefObject } from "react";
import { useAgent } from "../stores/agent.ts";
import { useUi } from "../stores/ui.ts";
import { Thread } from "../thread/Thread.tsx";
import { TopBar } from "./TopBar.tsx";
import { AppDock } from "./AppDock.tsx";
import { Caption } from "./Caption.tsx";
import { AgentCards, AgentCursor, AgentStream, CheckpointRail } from "./Agent.tsx";
import { Sheet } from "./Sheets.tsx";
import { FileView } from "./FileView.tsx";
import { QuickOpen } from "./QuickOpen.tsx";
import { Setup } from "./Setup.tsx";
import { Shortcuts } from "./Shortcuts.tsx";
import { IssueCard } from "../components/IssueCard.tsx";
import { api } from "../lib/api.ts";
import { useRun } from "../stores/run.ts";
import { onPicked, useKeyboard } from "./commands.ts";
import { useAgentWalk, useTrips } from "./useDriver.ts";
import { overlays, SdlcRail, slot, SLOTS, useSdlcBridge } from "./Sdlc.tsx";
import type { Panel } from "../stores/ui.ts";
import { useVoice } from "../voice/index.ts";
import { ChainsLayer } from "../chains/ChainsLayer.tsx"; // chains: P1–P5
import { OptionsLayer } from "../options/OptionsLayer.tsx"; // options: M1–M6
import { RAIL_GAIN, WorkspacesRail } from "../workspaces/Rail.tsx"; // workspaces: WS1
import { CreateWorkspaceDialog } from "../workspaces/CreateDialog.tsx"; // workspaces: WS2
import { WorkspaceReady } from "../workspaces/Ready.tsx"; // workspaces: WS3
import { LessonsLayer } from "../lessons/index.ts"; // review-lessons: RL9
import { QuestLayer } from "../quests/QuestBoard.tsx"; // quests: QB
import { PrMomentWindow } from "../pr/Moment.tsx"; // style-pass: PR13
import { ToolsLayer } from "../mcp/ToolsPanel.tsx"; // mcp: MCP8
import { ApiFirstLayer } from "../thread/ApiFirst.tsx"; // AP-first

// Other engineers' sheets and rows (K skills, S ship, W flows, W3 race), found by export name in Sdlc.tsx.
const Panels: [Exclude<Panel, null>, ReturnType<typeof slot>][] = [["skills", slot(SLOTS.skills)], ["ship", slot(SLOTS.ship)], ["flows", slot(SLOTS.flows)]];
const RaceCard = slot(SLOTS.race);
const Overlays = overlays();

// Layout slots: the bottom composer (export `Composer`) and the right dock (export `RightDock`), from these folders.
const docks = import.meta.glob<Record<string, unknown>>(["../{composer,scm,pr,dock}/**/*.tsx", "!../**/*.test.tsx"], { eager: true });
const dock = (name: string) => Object.values(docks).map((m) => m[name]).find((v) => typeof v === "function") as ComponentType | undefined;
const Composer = dock("Composer");
const RightDock = dock("RightDock");

function Mounted() {
  const panel = useUi((s) => s.panel);
  const close = () => useUi.setState({ panel: null });
  return (
    <>
      {Panels.map(([id, C]) => C && <C key={id} open={panel === id} onClose={close} />)}
      {RaceCard && <RaceCard />}
      {Overlays.map(([k, C]) => (
        <C key={k} />
      ))}
    </>
  );
}

/** O1 picks and O4 per-process output arrive here; bridge.ts carries the rest. */
function usePowerEvents(): void {
  useEffect(() => {
    const a = api();
    const offs = [
      a.on("point:picked", (p) => p && typeof p.selector === "string" && onPicked(p)),
      a.on("point:cancelled", () => useUi.setState({ pointing: false })),
      a.on("process:output", (m) => m && typeof m.process === "string" && typeof m.chunk === "string" && useRun.getState().appendProcess(m.process, m.chunk)),
    ];
    return () => offs.forEach((off) => off());
  }, []);
}

/** The stage column asks for --stage-min. Short of it, the workspaces rail folds to icons, and opens again once its width fits. */
function useSqueeze(col: RefObject<HTMLDivElement | null>): boolean {
  const [squeezed, setSqueezed] = useState(false);
  useEffect(() => {
    const c = col.current;
    if (!c) return;
    const ro = new ResizeObserver(() => {
      const spare = c.offsetWidth - parseFloat(getComputedStyle(c).flexBasis);
      setSqueezed((s) => (s ? spare < RAIL_GAIN : spare < -1));
    });
    ro.observe(c);
    return () => ro.disconnect();
  }, [col]);
  return squeezed;
}

/** The window: navy glow on void, a drag strip on top. */
export function Frame({ children }: { children: ReactNode }) {
  return <div className="app-bg flex h-full w-full flex-col px-3 pb-3">{children}</div>;
}

export function Shell() {
  useKeyboard();
  useVoice();
  useTrips();
  useAgentWalk();
  usePowerEvents();
  useSdlcBridge();
  const loadBrains = useAgent((s) => s.loadBrains);
  useEffect(() => void loadBrains(), [loadBrains]);
  const stage = useRef<HTMLElement>(null);
  const col = useRef<HTMLDivElement>(null);
  const squeezed = useSqueeze(col);

  return (
    <Frame>
      <TopBar />
      <SdlcRail />
      <div className="flex min-h-0 flex-1 pt-3">
        <WorkspacesRail squeezed={squeezed} />
        <AppDock />
        {/* It shrinks too (weight 1 against the panes' 3), so nothing ever scrolls sideways. */}
        <div ref={col} className="flex min-w-0 grow basis-[var(--stage-min)] flex-col">
          <main className="relative min-h-0 flex-1">
            <Guard>
              <Thread />
            </Guard>
            <CheckpointRail />
            {/* Over the Thread's feed frame: under its view toggle (28px + 8px gap), clear of its minimap column (34px + 12px gap). */}
            <section ref={stage} aria-label="Shrike" className="pointer-events-none absolute top-[36px] bottom-0 left-0 right-[46px] overflow-hidden rounded-[var(--r-pane)] *:pointer-events-auto">
              <Caption />
              <AgentStream />
              <AgentCards stage={stage} />
              <Sheet />
              <Mounted />
              <ChainsLayer />
              <LessonsLayer />
              <ToolsLayer />
              <ApiFirstLayer />
              <OptionsLayer />
              <FileView />
              <IssueCard />
              <Shortcuts />
              <Setup />
              <QuickOpen />
              <WorkspaceReady />
              <QuestLayer />
              <PrMomentWindow />
            </section>
            <AgentCursor />
          </main>
          {Composer && <Composer />}
        </div>
        {RightDock && <RightDock />}
      </div>
      <CreateWorkspaceDialog />
    </Frame>
  );
}

/** A Thread render error must not blank the window: the dock, sheets and agent keep working. */
class Guard extends Component<{ children: ReactNode }, { error: string | null }> {
  state = { error: null as string | null };
  static getDerivedStateFromError(e: unknown) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="stage grid h-full place-items-center p-6 text-center">
        <div>
          <p className="text-[15px] text-ink">The trip view hit a problem.</p>
          <p className="mt-1 font-mono text-[11.5px] text-dim">{this.state.error}</p>
          <button type="button" className="btn mt-4" onClick={() => this.setState({ error: null })}>
            Try again
          </button>
        </div>
      </div>
    );
  }
}
