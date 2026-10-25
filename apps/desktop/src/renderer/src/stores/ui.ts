import { create } from "zustand";
import type { AgentOptions, Flow, HttpRequestSpec, PointPick, Race, SdlcStage, SdlcState } from "@shrike/schema";
import type { Chip } from "../hud/logic.ts";

export interface Toast {
  id: number;
  text: string;
  tone: "error" | "info" | "ok";
}

export type Sheet = null | "logs" | "network" | "api" | "terminal" | "details";
/** Other engineers' summoned sheets, mounted by Shell with { open, onClose }: K skills, S ship, W flows. */
export type Panel = null | "skills" | "ship" | "flows";

/** A file opened inside Shrike (the in-app file view), optionally tied to the step it came from. */
export interface OpenFile {
  path: string;
  line: number;
  error?: boolean;
  actionId?: string;
  stepIndex?: number;
  note?: string; // pr-ci: a review comment shown as a chip on `line`
}

interface UiState {
  toasts: Toast[];
  explorerDraft: (HttpRequestSpec & { nonce: number }) | null;
  sheet: Sheet; // one summoned sheet at a time
  appVisible: boolean; // docked live app (P)
  recMenu: boolean;
  help: boolean; // the ? shortcuts card
  newTrip: string | null; // action id behind the quiet "New trip" toast
  agentCaption: string | null; // overrides the focused station's caption while the agent narrates
  keysUsed: boolean; // the key hints have done their job once the Thread keys are used
  file: OpenFile | null;
  pointing: boolean; // O1: the next click in the app goes to Shrike
  pick: (PointPick & { at: number }) | null; // the reticle shown on the dock for a moment
  chips: Chip[]; // O1/O8 context for the next Ask
  quickOpen: boolean; // O5
  issue: string | null; // O6: action id behind the issue card
  setup: boolean; // D12
  checkpoint: string | null; // A6: the checkpoint whose card is open (the agent's fix card steps aside)
  panel: Panel;
  sdlc: SdlcState | null; // L*: from main
  sdlcOpen: SdlcStage | null; // the stage whose detail is open
  flows: Flow[];
  race: Race | null;
  hasPr: boolean;
  commands: { name: string; prompt: string }[]; // saved slash commands
  ask: { planFirst: boolean | null; thinking: NonNullable<AgentOptions["thinking"]>; useMyMcp: boolean }; // planFirst null: decided by planFirstDefault
  togglePanel(p: Exclude<Panel, null>): void;
  addChip(c: Chip): void;
  removeChip(id: string): void;
  prefillExplorer(req: HttpRequestSpec): void;
  toggleSheet(s: Exclude<Sheet, null>): void;
  setNewTrip(id: string | null): void;
  openFile(f: OpenFile): void;
  closeFile(): void;
  dismiss(id: number): void;
}

let toastId = 0;

export const useUi = create<UiState>((set) => ({
  toasts: [],
  explorerDraft: null,
  sheet: null,
  appVisible: true,
  recMenu: false,
  help: false,
  newTrip: null,
  agentCaption: null,
  keysUsed: false,
  file: null,
  pointing: false,
  pick: null,
  chips: [],
  quickOpen: false,
  issue: null,
  setup: false,
  checkpoint: null,
  panel: null,
  sdlc: null,
  sdlcOpen: null,
  flows: [],
  race: null,
  hasPr: false,
  commands: [],
  ask: { planFirst: null, thinking: "normal", useMyMcp: false },
  togglePanel: (panel) => set((s) => ({ panel: s.panel === panel ? null : panel, sheet: null })),
  addChip: (c) => set((s) => ({ chips: [...s.chips.filter((x) => x.id !== c.id), c].slice(-6) })),
  removeChip: (id) => set((s) => ({ chips: s.chips.filter((x) => x.id !== id) })),
  prefillExplorer: (req) => set({ explorerDraft: { ...req, nonce: Date.now() } }),
  toggleSheet: (sheet) => set((s) => ({ sheet: s.sheet === sheet ? null : sheet })),
  setNewTrip: (newTrip) => set({ newTrip }),
  openFile: (file) => set({ file, sheet: null }),
  closeFile: () => set({ file: null }),
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

export function toast(text: string, tone: Toast["tone"] = "info"): void {
  const id = ++toastId;
  useUi.setState((s) => ({ toasts: [...s.toasts.slice(-2), { id, text, tone }] }));
  setTimeout(() => useUi.getState().dismiss(id), tone === "error" ? 7000 : 3500);
}
