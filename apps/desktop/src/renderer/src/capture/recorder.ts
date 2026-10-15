import "@fontsource/space-grotesk/400.css";
import "@fontsource/space-grotesk/500.css";
import "@fontsource/space-grotesk/600.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import "@fontsource/jetbrains-mono/600.css";
import "@fontsource/jetbrains-mono/700.css";
import { create } from "zustand";
import { api } from "../lib/api.ts";
import { highlight, solidColor } from "../lib/highlight.ts";
import { toSteps } from "../lib/steps.ts";
import { buildTrip } from "../lib/thread-layout.ts";
import { useActions } from "../stores/actions.ts";
import { projectPlaces, useThread } from "../stores/thread.ts";
import { compareLocalLive } from "@shrike/correlator/compare";
import { useProject } from "../stores/project.ts";
import { diveTarget, forShare, frameCount, makeCard, makeScene, maxCodeRows, paint, paintCard, paintSplit,snippetRange, splitFrame, type Aspect, type ClipScene, type DiveCode, type Shot } from "./paint.ts";

const FPS = 30;

const useRec = create<{ recording: boolean }>(() => ({ recording: false }));
export const useRecording = (): boolean => useRec((s) => s.recording);

let stopNow: (() => void) | null = null;

/** Ends the clip early; what was recorded so far is still saved. */
export function stopClip(): void {
  stopNow?.();
}

function pickMime(): string {
  return ["video/mp4;codecs=avc1", "video/webm;codecs=vp9", "video/webm"].find((t) => MediaRecorder.isTypeSupported(t)) ?? "";
}

async function loadShot(actionId: string, target: Shot["target"]): Promise<Shot | undefined> {
  const url = await api()
    .getActionShot(actionId)
    .catch(() => null);
  if (!url) return undefined;
  const img = new Image();
  img.src = url;
  try {
    await img.decode();
  } catch {
    return undefined;
  }
  return img.naturalWidth ? { img, w: img.naturalWidth, h: img.naturalHeight, target } : undefined;
}

/** A trip as it may leave the screen (#52), with the fonts it is painted in loaded. */
async function shareable(actionId: string, showPage: boolean) {
  const raw = useActions.getState().byId[actionId];
  if (!raw) throw new Error("That click isn't in this session anymore. Pick another one.");
  const { view, shot: withShot } = forShare(raw, showPage, useProject.getState().project?.redact?.keep);
  const trip = buildTrip(view, useThread.getState().expanded, projectPlaces());
  if (!trip.stations.length) throw new Error("This click has nothing to show yet.");
  const fonts = ["400 20px", "500 20px", "600 20px"].flatMap((w) => [`${w} "Space Grotesk"`, `${w} "JetBrains Mono"`]);
  await Promise.allSettled([...fonts, '700 20px "JetBrains Mono"'].map((f) => document.fonts.load(f)));
  return { view, trip, withShot };
}

/** Everything a clip needs, loaded up front so painting never waits. */
export async function prepareClip(opts: { actionId: string; aspect: Aspect; captions: boolean; showPage?: boolean }): Promise<ClipScene> {
  const { view, trip, withShot } = await shareable(opts.actionId, !!opts.showPage);
  const steps = toSteps(view);

  let dive: DiveCode | undefined;
  const di = diveTarget(trip);
  const st = trip.stations[di];
  const e = st ? steps[st.stepIndex]?.event : undefined;
  const loc = e?.kind === "function" && e.callSite ? e.callSite : e?.source;
  const [shot, text] = await Promise.all([
    withShot ? loadShot(view.id, view.root.target) : undefined,
    loc ? api().readFile(loc.file).catch(() => undefined) : undefined,
  ]);
  if (st && e && loc && text !== undefined) {
    const lines = text.replace(/\r\n?/g, "\n").split("\n");
    const [start, end] = snippetRange(lines, loc.line, maxCodeRows(opts.aspect));
    const tokens = await highlight(loc.file, text);
    dive = { station: di, file: loc.file, start, lines: tokens.slice(start - 1, end).map((l) => l.map((t) => ({ ...t, color: solidColor(t.color) }))), live: loc.line, chip: steps[st.stepIndex]?.tag ?? st.chip, error: st.status === "error" || !!st.chipError, why: st.caption };
  }
  return makeScene({ aspect: opts.aspect, trip, shot, dive, intro: `${steps[0]?.caption ?? trip.title}${trip.status === "error" ? ". Watch where it breaks." : ""}`, knit: useThread.getState().knit.has(view.id), captions: opts.captions });
}

type Painter = { W: number; H: number; frames: number; draw(ctx: CanvasRenderingContext2D, t: number): void };
type Pair = { local: string; live: string };

/** T23 (#62): the local and the live trip as two 9:16 panes in one 16:9 clip; the live pane masked (#52). */
async function splitPainter(pair: Pair, captions: boolean, showPage: boolean): Promise<Painter> {
  const { byId } = useActions.getState();
  const a = byId[pair.local];
  const b = byId[pair.live];
  if (!a || !b) throw new Error("One of these trips isn't in this session anymore. Compare again.");
  const scenes = await Promise.all([pair.local, pair.live].map((actionId) => prepareClip({ actionId, aspect: "9:16", captions, showPage })));
  const panes = scenes.map((s) => {
    const c = document.createElement("canvas");
    c.width = s.frame.W;
    c.height = s.frame.H;
    const ctx = c.getContext("2d");
    if (!ctx) throw new Error("Couldn't set up the clip canvas.");
    return { c, ctx, s };
  });
  const { verdict } = compareLocalLive(a, b);
  const f = splitFrame();
  return {
    W: f.W,
    H: f.H,
    frames: Math.max(...scenes.map((s) => frameCount(s.tl, FPS))),
    draw(ctx, t) {
      for (const p of panes) paint(p.ctx, p.s, t);
      paintSplit(ctx, [panes[0]!.c, panes[1]!.c], verdict);
    },
  };
}

type ClipOpts = { actionId?: string; aspect: Aspect; captions: boolean; compare?: Pair | null; showPage?: boolean; card?: boolean; values?: boolean };

/** LV4 (#64): one still of the trip (or the local vs live split) as a card; 9:16 means the 1080x1350 portrait card. */
async function cardPainter(opts: ClipOpts, actionId: string | undefined): Promise<Painter> {
  const ids = opts.compare ? [opts.compare.local, opts.compare.live] : [actionId!];
  const sides = await Promise.all(
    ids.map(async (id) => {
      const { view, trip, withShot } = await shareable(id, !!opts.showPage);
      return { view, trip, shot: withShot ? await loadShot(view.id, view.root.target) : undefined };
    }),
  );
  const { byId } = useActions.getState();
  const diff = opts.compare ? compareLocalLive(byId[opts.compare.local]!, byId[opts.compare.live]!) : undefined;
  const card = makeCard({ portrait: opts.aspect === "9:16", sides, values: !!opts.values, caption: diff && !diff.sides ? diff.verdict : undefined });
  const panes = card.panes.map((p) => {
    const c = document.createElement("canvas");
    c.width = p.box.w;
    c.height = p.box.h;
    const ctx = c.getContext("2d");
    if (!ctx) throw new Error("Couldn't set up the card canvas.");
    paint(ctx, p.scene, p.t);
    return c;
  });
  return { W: card.W, H: card.H, frames: 1, draw: (ctx) => paintCard(ctx, card, panes) };
}

const painterFor = (opts: ClipOpts, actionId: string | undefined): Promise<Painter> =>
  opts.card
    ? cardPainter(opts, actionId)
    : opts.compare
    ? splitPainter(opts.compare, opts.captions, !!opts.showPage)
    : prepareClip({ actionId: actionId!, aspect: opts.aspect, captions: opts.captions, showPage: opts.showPage }).then((scene) => ({ W: scene.frame.W, H: scene.frame.H, frames: frameCount(scene.tl, FPS), draw: (c: CanvasRenderingContext2D, t: number) => paint(c, scene, t) }));

/** LV3 (#52): one frame of the clip exactly as it will be saved, early in the drop where the page screenshot shows. */
export async function previewClip(opts: ClipOpts, canvas: HTMLCanvasElement): Promise<void> {
  const clip = await painterFor(opts, opts.actionId ?? useThread.getState().focus.actionId ?? undefined);
  canvas.width = clip.W;
  canvas.height = clip.H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Couldn't set up the clip canvas.");
  clip.draw(ctx, 1);
}

/** LV4 (#64): the card as a PNG, copied to the clipboard, then the save dialog. path is null if the dialog was cancelled. */
export async function saveCard(opts: ClipOpts): Promise<{ path: string | null; copied: boolean }> {
  const actionId = opts.actionId ?? useThread.getState().focus.actionId ?? undefined;
  if (!actionId && !opts.compare) throw new Error("Pick a click first.");
  const card = await painterFor({ ...opts, card: true }, actionId);
  const canvas = document.createElement("canvas");
  canvas.width = card.W;
  canvas.height = card.H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Couldn't set up the card canvas.");
  card.draw(ctx, 0);
  const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, "image/png"));
  if (!blob) throw new Error("The card came out empty.");
  const copied = await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]).then(
    () => true,
    () => false,
  );
  const path = await api().saveImage(new Uint8Array(await blob.arrayBuffer()), `shrike-${useProject.getState().project?.name ?? "app"}-${card.W}x${card.H}`);
  return { path, copied };
}

/**
 * Paints the trip into a clip (M1 drop, M2 snap, M3 return, M4 dive, verdict; M8 for verified re-runs) and saves it.
 * actionId defaults to the focused trip; compare records the local vs live split instead. Resolves once saved (or the save dialog is cancelled).
 */
export async function startClip(opts: ClipOpts): Promise<void> {
  if (useRec.getState().recording) throw new Error("A clip is already recording.");
  const actionId = opts.actionId ?? useThread.getState().focus.actionId;
  if (!actionId && !opts.compare) throw new Error("Pick a click first, then press REC.");
  if (typeof MediaRecorder === "undefined") throw new Error("This build can't record video.");
  const mimeType = pickMime();
  if (!mimeType) throw new Error("No supported video format for recording.");
  const ext = mimeType.startsWith("video/mp4") ? "mp4" : "webm";

  useRec.setState({ recording: true });
  const chunks: Blob[] = [];
  let painted = 0;
  let raf = 0;
  let hidden = false;
  const onHide = () => {
    if (document.hidden) (hidden = true), stopClip();
  };
  let stream: MediaStream | undefined;
  try {
    const clip = await painterFor(opts, actionId ?? undefined);
    const canvas = document.createElement("canvas");
    canvas.width = clip.W;
    canvas.height = clip.H;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Couldn't set up the clip canvas.");
    clip.draw(ctx, 0);
    // Frame-exact capture: one requestFrame per painted frame n, painted at t = n / FPS.
    stream = canvas.captureStream(0);
    const track = stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack | undefined;
    if (!track) throw new Error("Couldn't capture the clip canvas.");
    let rec: MediaRecorder;
    try {
      rec = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 12_000_000 });
    } catch (err) {
      throw new Error(`Couldn't start recording: ${(err as Error).message}`);
    }
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    rec.onerror = () => stopClip();
    rec.start(500);

    const frames = clip.frames;
    document.addEventListener("visibilitychange", onHide); // hidden windows throttle rAF; the clip would stutter
    await new Promise<void>((resolve) => {
      stopNow = resolve;
      const t0 = performance.now();
      let n = -1;
      const tick = (now: number) => {
        const f = Math.floor(((now - t0) / 1000) * FPS);
        if (f >= frames) return resolve();
        if (f !== n) {
          n = f;
          clip.draw(ctx, n / FPS);
          track.requestFrame();
          painted++;
        }
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    });
    if (rec.state !== "inactive") {
      const done = new Promise<void>((resolve) => (rec.onstop = () => resolve()));
      rec.stop();
      await done;
    }
  } finally {
    stopNow = null;
    document.removeEventListener("visibilitychange", onHide);
    cancelAnimationFrame(raf);
    stream?.getTracks().forEach((t) => t.stop());
    useRec.setState({ recording: false });
  }

  if (hidden) throw new Error("Recording stopped because Shrike was hidden. Keep it on screen while the clip records.");
  if (!painted || !chunks.length) throw new Error("The clip came out empty. Nothing was recorded.");
  const bytes = new Uint8Array(await new Blob(chunks, { type: mimeType }).arrayBuffer());
  try {
    await api().saveClip(bytes, ext);
  } catch (err) {
    throw new Error(`Couldn't save the clip: ${(err as Error).message}`);
  }
}
