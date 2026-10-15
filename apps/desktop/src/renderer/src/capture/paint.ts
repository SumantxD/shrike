import { color, font, radius } from "@shrike/design";
import { maskAction } from "@shrike/redact";
import type { ActionView, DebugEvent, TimelineNode } from "@shrike/schema";
import type { Token } from "../lib/highlight.ts";
import { enclosingFunction } from "../lib/panes.ts";
import { toSteps } from "../lib/steps.ts";
import { firstFailure, layoutTrip, subLine, type PlacedStation, type Trip, type TripGeometry } from "../lib/thread-layout.ts";

// Canvas2D painter for REC clips (docs/06-design.md "Recording clips"). paint(ctx, scene, t) is a pure function of t:
// frame n at any fps paints the same image every time. Pure helpers are exported for clip.test.ts.

export type Aspect = "16:9" | "9:16";
export type PhaseName = "intro" | "drop" | "snap" | "return" | "dive" | "verdict" | "outro";
export interface Phase {
  name: PhaseName;
  start: number; // seconds
  dur: number;
}

const DUR: Record<PhaseName, number> = { intro: 0.8, drop: 1.6, snap: 0.5, return: 0.8, dive: 2.5, verdict: 1.2, outro: 0.6 };

export function timeline(o: { snap: boolean; dive: boolean }): Phase[] {
  const out: Phase[] = [];
  let start = 0;
  for (const name of Object.keys(DUR) as PhaseName[]) {
    if ((name === "snap" && !o.snap) || (name === "dive" && !o.dive)) continue;
    out.push({ name, start, dur: DUR[name] });
    start = Math.round((start + DUR[name]) * 1000) / 1000;
  }
  return out;
}

export const totalOf = (tl: Phase[]): number => {
  const l = tl[tl.length - 1];
  return l ? l.start + l.dur : 0;
};

export const frameCount = (tl: Phase[], fps: number): number => Math.ceil(totalOf(tl) * fps - 1e-9);

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** The phase playing at t (clamped to the clip) and progress 0..1 through it. */
export function phaseAt(tl: Phase[], t: number): { phase: Phase; index: number; k: number } {
  const tt = Math.max(0, Math.min(t, totalOf(tl)));
  let index = 0;
  for (let i = 0; i < tl.length; i++) if (tl[i]!.start <= tt + 1e-9) index = i;
  const phase = tl[index]!;
  return { phase, index, k: clamp01((tt - phase.start) / phase.dur) };
}

export interface Frame {
  W: number;
  H: number;
  k: number; // canvas px per layout px
  LW: number; // layout width the trip is placed in
  feedTop: number; // canvas y where the feed (lanes) starts
  capTop: number; // canvas y where the caption band starts
}

export function frameFor(aspect: Aspect): Frame {
  return aspect === "9:16" ? { W: 1080, H: 1920, k: 2, LW: 540, feedTop: 300, capTop: 1344 } : { W: 1920, H: 1080, k: 1.5, LW: 1280, feedTop: 150, capTop: 842 };
}

/** Layout point → canvas point for a camera at layout y camY. */
export const toCanvas = (f: Frame, camY: number, x: number, y: number): { x: number; y: number } => ({ x: x * f.k, y: f.feedTop + (y - camY) * f.k });

const visibleH = (f: Frame) => (f.capTop - f.feedTop) / f.k;

// Dive card metrics (layout px).
const CARD = { head: 34, padTop: 10, line: 21, chip: 28, padBottom: 10, why: 56, gap: 26 } as const;

/** Code rows that fit in the dive card under the station without hiding behind the caption. */
export function maxCodeRows(aspect: Aspect): number {
  const fixed = 40 + CARD.gap + CARD.head + CARD.padTop + CARD.chip + CARD.padBottom + CARD.why + 10;
  return Math.max(5, Math.floor((visibleH(frameFor(aspect)) - fixed) / CARD.line));
}

/** 1-based [start, end] of the code to show: the enclosing function if it fits, else a window around the live line (±4). */
export function snippetRange(lines: string[], live: number, maxRows: number): [number, number] {
  const n = Math.max(1, lines.length);
  const at = Math.max(1, Math.min(live, n));
  const fn = enclosingFunction(lines, at);
  if (fn && fn.end - fn.start + 1 <= maxRows) return [fn.start, fn.end];
  const lo = fn?.start ?? 1;
  const hi = fn?.end ?? n;
  const half = fn ? Math.floor((maxRows - 1) / 2) : 4;
  const start = Math.max(lo, Math.min(at - half, hi - Math.min(maxRows, half * 2 + 1) + 1));
  return [start, Math.min(hi, start + Math.min(maxRows, half * 2 + 1) - 1)];
}

/** The station the clip dives into: the same clue the live Thread lands on. -1 for no dive. */
export const diveTarget = (trip: Trip): number => (trip.status === "error" ? firstFailure(trip) : -1);

export interface Rect {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}
export interface Target {
  x: number;
  y: number;
  width: number;
  height: number;
  viewportWidth: number;
  viewportHeight: number;
}

/** Region of an app screenshot (image px) with the given aspect, centred on what was clicked; top of the page if nothing was. */
export function cropAround(imgW: number, imgH: number, aspect: number, target?: Target): Rect {
  if (imgW <= 0 || imgH <= 0 || aspect <= 0) return { sx: 0, sy: 0, sw: Math.max(0, imgW), sh: Math.max(0, imgH) };
  const scale = target && target.viewportWidth > 0 ? imgW / target.viewportWidth : 1;
  let sw = target ? Math.min(imgW, Math.max(target.width * scale * 3, imgW * 0.55)) : imgW;
  let sh = sw / aspect;
  if (sh > imgH) (sh = imgH), (sw = sh * aspect);
  if (!target) return { sx: (imgW - sw) / 2, sy: 0, sw, sh };
  const lim = (v: number, max: number) => Math.max(0, Math.min(v, max));
  return { sx: lim((target.x + target.width / 2) * scale - sw / 2, imgW - sw), sy: lim((target.y + target.height / 2) * scale - sh / 2, imgH - sh), sw, sh };
}

// Polylines (the layout's paths are only horizontal and vertical, so arc length is exact).
export type Pt = [number, number];

export function outPoints(g: TripGeometry): { pts: Pt[]; at: number[] } {
  return { pts: g.outPts, at: g.stations.map((s) => s.reach) };
}

export function retPoints(g: TripGeometry): Pt[] {
  const [x, y] = g.outPts[g.outPts.length - 1]!;
  return g.stations.length ? [[x, y], [x, g.endY], [g.callerX, g.endY]] : [[g.callerX, g.shotY], [g.callerX, g.endY]];
}

export function lengthOf(pts: Pt[]): number {
  let l = 0;
  for (let i = 1; i < pts.length; i++) l += Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![1] - pts[i - 1]![1]);
  return l;
}

/** The first `len` px of a polyline, as an SVG path (for new Path2D(d)) plus its tip. */
export function partial(pts: Pt[], len: number): { d: string; tip: Pt } {
  const first = pts[0] ?? [0, 0];
  let d = `M ${first[0]} ${first[1]}`;
  let tip: Pt = first;
  let left = Math.max(0, len);
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const seg = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (seg === 0) continue;
    const f = Math.min(1, left / seg);
    tip = [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
    d += ` L ${tip[0]} ${tip[1]}`;
    left -= seg;
    if (left <= 0) break;
  }
  return { d, tip };
}

/** Deterministic PRNG (mulberry32) so sparks land the same way in every render. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = Math.imul(a ^ (a >>> 15), 1 | a);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

export const hashSeed = (s: string): number => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};

// ---------------------------------------------------------------- scene

export interface DiveCode {
  station: number;
  file: string;
  start: number; // 1-based first line shown
  lines: Token[][];
  live: number; // 1-based
  chip?: string; // the value at the live line, e.g. insertTodo({ ..., userId: undefined })
  error: boolean;
  why: string;
}

export interface Shot {
  img: CanvasImageSource;
  w: number;
  h: number;
  target?: Target;
}

export interface ClipScene {
  aspect: Aspect;
  frame: Frame;
  trip: Trip;
  geo: TripGeometry;
  out: { pts: Pt[]; at: number[]; len: number };
  ret: { pts: Pt[]; len: number };
  tl: Phase[];
  shot?: Shot;
  dive?: DiveCode;
  intro: string; // caption over the intro, e.g. You clicked "Add Todo"
  knit: boolean; // verified re-run (M8)
  captions: boolean;
  still?: boolean; // LV4: one frame for a card, without the clip's own header, caption and watermark
  seed: number;
}

export function makeScene(o: { aspect: Aspect; trip: Trip; shot?: Shot; dive?: DiveCode; intro: string; knit: boolean; captions: boolean; frame?: Frame; still?: boolean }): ClipScene {
  const frame = o.frame ?? frameFor(o.aspect);
  const geo = layoutTrip(o.trip, frame.LW);
  const op = outPoints(geo);
  const rp = retPoints(geo);
  const snap = geo.stations.some((s) => s.snap) && !o.knit;
  return {
    ...o,
    frame,
    geo,
    out: { ...op, len: lengthOf(op.pts) },
    ret: { pts: rp, len: lengthOf(rp) },
    tl: timeline({ snap, dive: !!o.dive && !o.knit }),
    seed: hashSeed(o.trip.actionId),
  };
}

// ---------------------------------------------------------------- painting

type Ctx = CanvasRenderingContext2D;

const easeOut = (k: number) => 1 - (1 - clamp01(k)) ** 3;
const easeOutQuad = (k: number) => 1 - (1 - clamp01(k)) ** 2;
const inOut = (k: number) => {
  const x = clamp01(k);
  return x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2;
};
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

function hexRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1, 7), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const rgba = (hex: string, a: number) => `rgba(${hexRgb(hex).join(",")},${a})`;
const mix = (h1: string, h2: string, k: number) => {
  const a = hexRgb(h1);
  const b = hexRgb(h2);
  return `rgb(${a.map((v, i) => Math.round(lerp(v, b[i]!, k))).join(",")})`;
};
const BAD_RE = /(\bundefined\b|\bnull\b|\bNaN\b)/;

const mono = (size: number, weight = 500) => `${weight} ${size}px ${font.mono}`;
const display = (size: number, weight = 500) => `${weight} ${size}px ${font.display}`;

/** Text with a dark halo so lines crossing behind it never cut through. */
function haloText(ctx: Ctx, text: string, x: number, y: number): void {
  ctx.save();
  ctx.strokeStyle = rgba(color.void, 0.85);
  ctx.lineWidth = 4;
  ctx.lineJoin = "round";
  ctx.strokeText(text, x, y);
  ctx.restore();
  ctx.fillText(text, x, y);
}

type Measure = { measureText(t: string): { width: number } };

function fitText(ctx: Measure, text: string, maxW: number): string {
  if (ctx.measureText(text).width <= maxW) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (ctx.measureText(`${text.slice(0, mid)}…`).width <= maxW) lo = mid;
    else hi = mid - 1;
  }
  return `${text.slice(0, lo)}…`;
}

/** Like fitText, but a value with undefined/null/NaN in it loses its head instead, so the bad part stays visible. */
export function fitValue(ctx: Measure, text: string, maxW: number): string {
  if (ctx.measureText(text).width <= maxW) return text;
  const bad = text.search(BAD_RE);
  if (bad < 0) return fitText(ctx, text, maxW);
  let lo = 0;
  let hi = bad;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (ctx.measureText(`…${text.slice(mid)}`).width <= maxW) hi = mid;
    else lo = mid + 1;
  }
  const out = `…${text.slice(lo)}`;
  return ctx.measureText(out).width <= maxW ? out : fitText(ctx, text.slice(bad), maxW);
}

function wrap(ctx: Ctx, text: string, maxW: number, maxLines: number): string[] {
  const lines: string[] = [];
  let cur = "";
  for (const word of text.split(/\s+/)) {
    const next = cur ? `${cur} ${word}` : word;
    if (cur && ctx.measureText(next).width > maxW) {
      lines.push(cur);
      cur = word;
    } else cur = next;
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) {
    lines.length = maxLines;
    lines[maxLines - 1] = fitText(ctx, `${lines[maxLines - 1]!} …`, maxW);
  }
  return lines.map((l) => fitText(ctx, l, maxW));
}

const at = (s: ClipScene, name: PhaseName) => s.tl.find((p) => p.name === name);

/** Drawn length of the outbound thread at t. */
function outLen(s: ClipScene, t: number): number {
  const d = at(s, "drop")!;
  return s.out.len * easeOutQuad((t - d.start) / d.dur);
}

/** When the tip reaches outbound arc length L. */
function reachTime(s: ClipScene, L: number): number {
  const d = at(s, "drop")!;
  if (!isFinite(L)) return Infinity;
  return d.start + d.dur * (1 - Math.sqrt(Math.max(0, 1 - L / Math.max(1, s.out.len))));
}

function retLen(s: ClipScene, t: number): number {
  const r = at(s, "return")!;
  return s.ret.len * easeOut((t - r.start) / (r.dur * 0.8));
}

function cardBox(s: ClipScene): { x: number; y: number; w: number; h: number } | undefined {
  if (!s.dive) return undefined;
  const st = s.geo.stations[s.dive.station]!;
  const w = Math.min(640, s.frame.LW - 28);
  const x = Math.max(14, Math.min(st.x - w * 0.35, s.frame.LW - w - 14));
  const h = CARD.head + CARD.padTop + s.dive.lines.length * CARD.line + (s.dive.chip ? CARD.chip : 0) + CARD.padBottom + (s.captions ? 0 : CARD.why);
  return { x, y: st.y + CARD.gap, w, h };
}

function camTarget(s: ClipScene, name: PhaseName, k: number): number {
  const vis = visibleH(s.frame);
  const min = s.geo.shotY - 64;
  const bottom = s.geo.endY + 44;
  const fit = (c: number, b = bottom) => Math.max(min, Math.min(c, b - vis));
  const st = s.dive ? s.geo.stations[s.dive.station] : undefined;
  switch (name) {
    case "intro":
      return min;
    case "drop":
    case "snap": {
      const d = at(s, "drop")!;
      return fit(partial(s.out.pts, outLen(s, name === "snap" ? d.start + d.dur : d.start + d.dur * k)).tip[1] - vis * 0.55);
    }
    case "return": {
      const r = at(s, "return")!;
      return fit(partial(s.ret.pts, retLen(s, r.start + r.dur * k)).tip[1] - vis * 0.55);
    }
    default: {
      const box = cardBox(s);
      if (st && box && s.tl.some((p) => p.name === "dive")) return Math.max(min, st.y - 40 - Math.max(0, vis - (box.y + box.h - st.y + 40)) / 2); // station + card centred
      return camTarget(s, "return", 1);
    }
  }
}

function camAt(s: ClipScene, t: number): number {
  const { phase, index, k } = phaseAt(s.tl, t);
  const target = camTarget(s, phase.name, k);
  const into = t - phase.start;
  if (index === 0 || into >= 0.5) return target;
  const prev = s.tl[index - 1]!;
  return lerp(camTarget(s, prev.name, 1), target, inOut(into / 0.5));
}

/** Paint the frame at time t (seconds). */
export function paint(ctx: Ctx, s: ClipScene, t: number): void {
  const f = s.frame;
  const { phase } = phaseAt(s.tl, t);
  const total = totalOf(s.tl);
  const tc = Math.max(0, Math.min(t, total));
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.shadowBlur = 0;
  ctx.setLineDash([]);
  ctx.letterSpacing = "0px";

  const bg = ctx.createRadialGradient(f.W * 0.55, f.H * 0.3, 0, f.W * 0.55, f.H * 0.3, Math.max(f.W, f.H) * 0.75);
  bg.addColorStop(0, color.navy);
  bg.addColorStop(1, color.void);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, f.W, f.H);

  const outro = at(s, "outro")!;
  const fade = easeOut((tc - outro.start) / outro.dur);
  const intro = clamp01(tc / DUR.intro);
  const tilt = 1 - inOut(intro);
  const dive = at(s, "dive");
  const dim = dive ? 1 - 0.55 * easeOut((tc - dive.start) / 0.35) : 1;

  // The only rotation: lanes start tilted back and come upright over the intro. 2D fake: squash + skew about the bottom.
  ctx.save();
  ctx.globalAlpha = 0.25 + 0.75 * easeOut(intro * 1.4);
  if (tilt > 0) {
    const ax = f.W / 2;
    const ay = (f.feedTop + f.H) / 2;
    ctx.translate(ax, ay);
    ctx.transform(1 - 0.03 * tilt, 0, -0.05 * tilt, 1 - 0.07 * tilt, 0, 0);
    ctx.translate(-ax, -ay);
  }
  drawLanes(ctx, s, tilt, dim);
  const camY = camAt(s, tc);
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, f.feedTop - 4, f.W, f.H - f.feedTop + 4);
  ctx.clip();
  ctx.setTransform(ctx.getTransform().multiply(new DOMMatrix([f.k, 0, 0, f.k, 0, f.feedTop - camY * f.k])));
  drawTrip(ctx, s, tc, dim);
  drawCard(ctx, s, tc);
  ctx.restore();
  drawLaneHead(ctx, s, dim);
  ctx.restore();
  if (s.still) return;

  ctx.save();
  drawHeader(ctx, s, tc, intro);
  ctx.restore();
  if (fade > 0) {
    ctx.fillStyle = rgba(color.void, 0.8 * fade);
    ctx.fillRect(0, 0, f.W, f.H);
  }

  const cap = captionAt(s, tc, phase.name);
  if (cap) drawCaption(ctx, f, cap.text, cap.error, cap.alpha * (1 - fade));
  if (phase.name === "outro") drawOutroMark(ctx, f, fade);
  else drawWatermark(ctx, f);
}

function drawLanes(ctx: Ctx, s: ClipScene, tilt: number, dim: number): void {
  const f = s.frame;
  const top = f.feedTop - 10;
  s.geo.lanes.cols.forEach((col) => {
    const x = col.x * f.k;
    const xt = f.W / 2 + (x - f.W / 2) * (1 - 0.08 * tilt); // tops converge while tilted
    const on = col.mode !== "sliver";
    const a = (on ? 1 : 0.45) * (0.4 + 0.6 * dim);
    const g = ctx.createLinearGradient(0, top, 0, f.H);
    g.addColorStop(0, rgba(color.ink, 0));
    g.addColorStop(0.08, rgba(color.ink, 0.16 * a));
    g.addColorStop(0.9, rgba(color.ink, 0.16 * a));
    g.addColorStop(1, rgba(color.ink, 0));
    const band = 14 * f.k;
    const glow = ctx.createLinearGradient(x - band, 0, x + band, 0);
    glow.addColorStop(0, rgba(color.cyan, 0));
    glow.addColorStop(0.5, rgba(color.cyan, 0.04 * a));
    glow.addColorStop(1, rgba(color.cyan, 0));
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.moveTo(xt - band, top);
    ctx.lineTo(xt + band, top);
    ctx.lineTo(x + band, f.H);
    ctx.lineTo(x - band, f.H);
    ctx.fill();
    ctx.strokeStyle = g;
    ctx.lineWidth = Math.max(1, f.k * 0.8);
    ctx.beginPath();
    ctx.moveTo(xt, top);
    ctx.lineTo(x, f.H);
    ctx.stroke();
  });
}

function drawLaneHead(ctx: Ctx, s: ClipScene, dim: number): void {
  const f = s.frame;
  const cols = s.geo.lanes.cols;
  const g = ctx.createLinearGradient(0, f.feedTop - 70, 0, f.feedTop + 24);
  g.addColorStop(0, rgba(color.void, 0));
  g.addColorStop(0.45, rgba(color.void, 0.85));
  g.addColorStop(0.75, rgba(color.void, 0.6));
  g.addColorStop(1, rgba(color.void, 0));
  ctx.fillStyle = g;
  ctx.fillRect(0, f.feedTop - 70, f.W, 94);
  // Many lanes in a narrow frame: one row, smaller type until every name fits its lane, then trimmed.
  const names = cols.map((c) => (c.sub && cols.filter((o) => o.head === c.head).length > 1 ? c.sub.toUpperCase() : c.head));
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  let size = Math.round((cols.length > 5 ? 9.5 : 11) * f.k);
  const setFont = () => {
    ctx.font = mono(size, 600);
    ctx.letterSpacing = `${(size * (cols.length > 5 ? 0.12 : 0.24)).toFixed(1)}px`;
  };
  setFont();
  while (size > 7 * f.k && !cols.every((c, i) => ctx.measureText(names[i]!).width + size * 1.25 <= c.w * f.k - 6)) {
    size -= 1;
    setFont();
  }
  const glyph = size * 1.25;
  cols.forEach((c, i) => {
    const y = f.feedTop - 14;
    const text = fitText(ctx, names[i]!, c.w * f.k - glyph - 8);
    const tw = ctx.measureText(text).width;
    const cx = Math.max(tw / 2 + glyph + 8, Math.min(f.W - tw / 2 - 12, c.x * f.k + glyph / 2 + size * 0.12)); // stays inside the frame
    ctx.fillStyle = c.mode !== "sliver" ? rgba(color.ink, 0.5 + 0.5 * dim) : color.inkDim;
    ctx.fillText(text, cx, y);
    ctx.save(); // kind glyph left of the name
    ctx.translate(cx - tw / 2 - glyph, y - size * 0.85);
    ctx.scale(size / 12, size / 12);
    ctx.strokeStyle = ctx.fillStyle;
    ctx.lineWidth = 1.1;
    ctx.lineJoin = ctx.lineCap = "round";
    ctx.stroke(new Path2D(c.glyph));
    ctx.restore();
  });
  ctx.letterSpacing = "0px";
}

function drawHeader(ctx: Ctx, s: ClipScene, t: number, intro: number): void {
  const f = s.frame;
  const portrait = s.aspect === "9:16";
  const m = portrait ? 64 : 72;
  const size = portrait ? 58 : 44;
  const base = portrait ? 156 : 82;
  ctx.globalAlpha *= easeOut(intro * 1.6);
  ctx.font = display(size, 600);
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = color.ink;
  const title = fitText(ctx, s.trip.title, f.W - m * 2 - (portrait ? 0 : 420));
  ctx.fillText(title, m, base);
  const tw = ctx.measureText(title).width;

  // T14 verdict pill + ms appear when the trip comes back; BROKE shows from the first second (the hook).
  const r = at(s, "return")!;
  const k = s.trip.status === "error" && !s.knit ? easeOut((t - 0.25) / 0.3) : easeOut((t - r.start) / 0.3);
  if (k <= 0) return;
  const err = s.trip.status === "error";
  const c = err ? color.fail : s.trip.status === "slow" ? color.slow : color.ok;
  const word = err ? "BROKE" : s.trip.status === "slow" ? "SLOW" : "WORKED";
  const ps = portrait ? 22 : 18;
  ctx.font = mono(ps, 500);
  ctx.letterSpacing = `${(ps * 0.14).toFixed(1)}px`;
  const pw = ctx.measureText(word).width + ps * 1.1;
  const ph = ps * 1.6;
  const px = portrait ? m : m + tw + 28;
  const py = portrait ? base + 30 : base - size * 0.72;
  ctx.save();
  ctx.globalAlpha *= k;
  ctx.translate(px + pw / 2, py + ph / 2);
  ctx.scale(0.85 + 0.15 * k, 0.85 + 0.15 * k);
  ctx.translate(-(px + pw / 2), -(py + ph / 2));
  ctx.beginPath();
  ctx.roundRect(px, py, pw, ph, 8);
  ctx.fillStyle = rgba(c, 0.1);
  ctx.fill();
  ctx.strokeStyle = rgba(c, 0.55);
  ctx.lineWidth = 2;
  if (err) {
    ctx.shadowColor = rgba(color.fail, 0.45);
    ctx.shadowBlur = 24;
  }
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.fillStyle = c;
  ctx.textBaseline = "middle";
  ctx.fillText(word, px + ps * 0.55, py + ph / 2 + 1);
  ctx.fillStyle = color.inkDim;
  ctx.fillText(`${s.trip.ms}MS`, px + pw + ps * 0.8, py + ph / 2 + 1);
  ctx.restore();
  ctx.letterSpacing = "0px";
}

function drawTrip(ctx: Ctx, s: ClipScene, t: number, dim: number): void {
  const g = s.geo;
  const drop = at(s, "drop")!;
  const ret = at(s, "return")!;
  const snapStation = s.knit ? undefined : g.stations.find((st) => st.snap);
  const snapT = at(s, "snap")?.start ?? Infinity;

  drawShot(ctx, s, t);

  // T6/M3 return line, under the thread.
  if (t >= ret.start) {
    const err = s.trip.status === "error";
    const c = err ? color.fail : s.trip.shape === "came_back_empty" ? color.slow : color.ok;
    const { d, tip } = partial(s.ret.pts, retLen(s, t));
    ctx.save();
    ctx.globalAlpha *= 0.85 * (0.5 + 0.5 * dim);
    ctx.strokeStyle = c;
    ctx.lineWidth = 1.8;
    ctx.shadowColor = c;
    ctx.shadowBlur = 8;
    if (err) ctx.setLineDash([6, 6]);
    ctx.stroke(new Path2D(d));
    ctx.restore();
    const land = clamp01((t - ret.start - ret.dur * 0.8) / 0.25);
    if (land > 0) {
      ctx.save();
      ctx.globalAlpha *= land * (0.5 + 0.5 * dim);
      ctx.fillStyle = c;
      ctx.shadowColor = c;
      ctx.shadowBlur = 12;
      ctx.beginPath();
      ctx.arc(g.callerX, g.endY, 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.font = mono(14, 500);
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      haloText(ctx, fitText(ctx, s.trip.returned, s.frame.LW - g.callerX - 24), g.callerX + 14, g.endY - 16);
      ctx.restore();
    } else if (t < ret.start + ret.dur) drawTip(ctx, tip, c);
  }

  // T2 outbound thread (M1 drop; M8 knits green then settles to the spectrum).
  const L = outLen(s, t);
  if (L > 0) {
    const { d, tip } = partial(s.out.pts, L);
    const path = new Path2D(d);
    for (const fk of g.forks) if (L > fk.start) path.addPath(new Path2D(partial(fk.pts, L - fk.start).d)); // T17 branches grow alongside
    const spec = ctx.createLinearGradient(g.callerX, 0, s.frame.LW * 0.86, 0);
    spec.addColorStop(0, color.violet);
    spec.addColorStop(0.5, color.blue);
    spec.addColorStop(1, color.cyan);
    const settle = s.knit ? easeOut((t - ret.start) / ret.dur) : 1;
    ctx.save();
    ctx.globalAlpha *= 0.55 + 0.45 * dim;
    ctx.lineWidth = 2.6;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.shadowBlur = 9;
    if (settle < 1) {
      ctx.strokeStyle = color.ok;
      ctx.shadowColor = color.ok;
      ctx.stroke(path);
    }
    if (settle > 0) {
      ctx.globalAlpha *= settle;
      ctx.strokeStyle = spec;
      ctx.shadowColor = rgba(color.blue, 0.9);
      ctx.stroke(path);
    }
    ctx.restore();
    if (t < drop.start + drop.dur) drawTip(ctx, tip, s.knit ? color.ok : color.cyan);
  }

  // T3 stations, revealed as the tip passes; T5 coils.
  const focusIdx = s.dive?.station ?? -1;
  const clue = diveTarget(s.trip);
  g.stations.forEach((st, i) => {
    const hot = !!st.snap || i === clue; // red only where it broke and at the clue, as in the live Thread
    const reach = reachTime(s, s.out.at[i]!);
    const k = easeOut((t - reach) / 0.25);
    if (k <= 0) return;
    const a = i === focusIdx || st === snapStation ? 1 : 0.4 + 0.6 * dim;
    ctx.save();
    ctx.globalAlpha *= k * a;
    if (st.count && st.kind !== "express" && st.status !== "ok") drawCoil(ctx, st);
    const fk = st.fork && !st.fork.main ? g.forks.find((x) => x.id === st.fork!.id && x.label) : undefined;
    if (fk?.label && g.stations.findIndex((x) => x.fork?.id === st.fork!.id && !x.fork.main) === i) {
      ctx.font = mono(11, 500);
      ctx.fillStyle = color.inkDim;
      const ax = fk.pts[0]![0]; // where the thread splits; the branch labels sit to its left
      const right = s.frame.LW - ax - 12 >= ctx.measureText("at the same time").width;
      ctx.textAlign = right ? "left" : "right";
      ctx.textBaseline = "middle";
      haloText(ctx, "at the same time", right ? ax + 10 : ax - 10, right ? fk.pts[0]![1] : fk.label.y);
    }
    drawStation(ctx, st, 0.2 + 0.8 * k, s.knit, hot);
    drawLabel(ctx, s, st, t - reach, hot);
    ctx.restore();
  });

  // T4/M2 snap: ring pulse + 22 sparks.
  if (snapStation && t >= snapT) {
    const p = (t - snapT) / 0.7;
    if (p < 1) {
      ctx.save();
      ctx.strokeStyle = rgba(color.fail, 0.9 * (1 - p));
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(snapStation.x, snapStation.y, 7 + 26 * easeOut(p), 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    const r = rng(s.seed);
    const base = ctx.globalAlpha;
    ctx.save();
    ctx.shadowColor = color.fail;
    ctx.shadowBlur = 8;
    for (let i = 0; i < 22; i++) {
      const ang = r() * Math.PI * 2;
      const dist = 18 + r() * 46;
      const dur = 0.52 + r() * 0.3;
      const q = (t - snapT) / dur;
      if (q >= 1) continue;
      const e = easeOut(q);
      ctx.globalAlpha = base * (1 - q);
      ctx.fillStyle = mix(color.fail, color.core, 0.75);
      ctx.beginPath();
      ctx.arc(snapStation.x + Math.cos(ang) * dist * e, snapStation.y + Math.sin(ang) * dist * e, 1.6, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}

function drawTip(ctx: Ctx, p: Pt, c: string): void {
  ctx.save();
  ctx.shadowColor = c;
  ctx.shadowBlur = 18;
  ctx.fillStyle = rgba(c, 0.55);
  ctx.beginPath();
  ctx.arc(p[0], p[1], 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = color.core;
  ctx.beginPath();
  ctx.arc(p[0], p[1], 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawStation(ctx: Ctx, st: PlacedStation, scale: number, knit: boolean, hot: boolean): void {
  const err = st.status === "error" && hot && !knit; // one red focal point: where it broke
  const c = err ? color.fail : st.cache === "hit" ? color.ok : st.cache === "miss" || st.status === "slow" ? color.slow : st.live ? color.inkDim : knit ? color.ok : color.cyan;
  ctx.save();
  ctx.translate(st.x, st.y);
  ctx.scale(scale, scale);
  ctx.beginPath();
  ctx.arc(0, 0, st.cache === "hit" ? 5.5 : st.cache === "set" ? 4.5 : 7, 0, Math.PI * 2);
  if (st.cache === "hit") {
    ctx.shadowColor = color.ok;
    ctx.shadowBlur = 10;
  }
  ctx.fillStyle = err ? color.failDeep : st.cache === "hit" ? color.ok : color.abyss;
  if (st.cache !== "miss") ctx.fill(); // T16: hollow
  ctx.lineWidth = st.live && !err ? 1.5 : 2;
  if (st.live && !err) ctx.setLineDash([3, 3]); // T22
  ctx.strokeStyle = c;
  if (st.snap && err) {
    ctx.shadowColor = color.fail;
    ctx.shadowBlur = 18;
  }
  ctx.stroke();
  ctx.restore();
}

function drawCoil(ctx: Ctx, st: PlacedStation): void {
  const n = Math.min(6, st.count ?? 1);
  ctx.save();
  ctx.lineWidth = 1.4;
  for (let i = 0; i < n; i++) {
    ctx.strokeStyle = rgba(color.slow, 0.35 + i * 0.12);
    ctx.beginPath();
    ctx.ellipse(st.x + (i - (n - 1) / 2) * 7, st.y, 9, 15, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

/** A value chip; undefined/null/NaN inside it are lit in fail red. Returns its width. */
function drawChip(ctx: Ctx, text: string, x: number, y: number, size: number, err: boolean, glow: number): number {
  ctx.font = mono(size, 500);
  const w = ctx.measureText(text).width + size * 1.2;
  const h = size * 1.75;
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 5);
  ctx.fillStyle = err ? rgba(color.fail, 0.14) : rgba(color.cyan, 0.08);
  ctx.fill();
  ctx.strokeStyle = err ? rgba(color.fail, 0.6) : rgba(color.cyan, 0.3);
  ctx.lineWidth = 1;
  if (err) {
    ctx.shadowColor = rgba(color.fail, 0.5);
    ctx.shadowBlur = 16 * glow;
  }
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  let cx = x + size * 0.6;
  for (const part of text.split(BAD_RE)) {
    if (!part) continue;
    const bad = err && BAD_RE.test(part);
    ctx.font = mono(size, bad ? 700 : 500);
    ctx.fillStyle = bad ? color.fail : err ? mix(color.fail, color.core, 0.8) : mix(color.cyan, color.core, 0.7);
    if (bad) {
      ctx.shadowColor = color.fail;
      ctx.shadowBlur = 10 * glow;
    }
    ctx.fillText(part, cx, y + h / 2 + 0.5);
    ctx.shadowBlur = 0;
    cx += ctx.measureText(part).width;
  }
  ctx.restore();
  return w;
}

function drawLabel(ctx: Ctx, s: ClipScene, st: PlacedStation, since: number, hot: boolean): void {
  const LW = s.frame.LW;
  const label = `${st.label}${st.count && st.kind !== "express" ? ` ×${st.count}` : ""}`;
  const sub = subLine(st);
  const chip = st.chipError && (s.knit || (st.status === "error" && !hot)) ? undefined : st.chip;
  const err = !!st.chipError && !s.knit;
  ctx.font = mono(13.5, 500);
  const w1 = ctx.measureText(label).width;
  ctx.font = mono(11, 400);
  const w2 = ctx.measureText(sub).width;
  ctx.font = mono(11.5, 500);
  const w3 = chip ? ctx.measureText(chip).width + 14 : 0;
  const need = Math.max(w1, w2, w3);
  const roomR = Math.min(LW - 8 - (st.x + 18), st.left ? Infinity : st.room);
  const roomL = st.x - 18 - 8;
  const left = (st.left || need > roomR) && (need <= roomL || roomL > roomR);
  const room = left ? roomL : roomR;
  const h = 17 + 15 + (chip ? 24 : 0);
  const top = st.y - h / 2;
  const x = left ? st.x - 18 : st.x + 18;
  ctx.textAlign = left ? "right" : "left";
  ctx.textBaseline = "alphabetic";
  ctx.font = mono(13.5, 500);
  ctx.fillStyle = st.cache === "hit" ? color.ok : st.cache === "miss" ? color.slow : st.live ? color.inkDim : color.ink;
  haloText(ctx, fitText(ctx, label, room), x, top + 13);
  ctx.font = mono(11, 400);
  ctx.letterSpacing = "0.6px";
  ctx.fillStyle = color.inkDim;
  haloText(ctx, fitText(ctx, sub, room), x, top + 29);
  ctx.letterSpacing = "0px";
  if (chip) {
    ctx.font = mono(11.5, 500);
    const text = fitValue(ctx, chip, room - 14);
    const cw = ctx.measureText(text).width + 11.5 * 1.2;
    drawChip(ctx, text, left ? x - cw : x, top + 34, 11.5, err, err ? 0.6 + 0.4 * Math.sin(since * 6) ** 2 : 0);
  }
}

function drawShot(ctx: Ctx, s: ClipScene, t: number): void {
  const g = s.geo;
  const w = Math.min(150, g.callerX * 2 - 10);
  const h = Math.round(w * 0.58);
  const x = g.callerX - w / 2;
  if (!s.trip.caller.browser) return drawTerminal(ctx, s, x, g.shotY - h / 2, w, h);
  const y = g.shotY - h / 2;
  ctx.save();
  ctx.font = mono(9.5, 500);
  ctx.letterSpacing = "1.3px";
  ctx.fillStyle = color.inkDim;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillText("BEFORE", x, y - 7);
  ctx.letterSpacing = "0px";
  ctx.shadowColor = "rgba(0,0,0,0.7)";
  ctx.shadowBlur = 24;
  ctx.shadowOffsetY = 8;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 9);
  ctx.fillStyle = color.ink;
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
  ctx.save();
  ctx.clip();
  let ret: { x: number; y: number; w: number; h: number } | undefined;
  if (s.shot) {
    const r = cropAround(s.shot.w, s.shot.h, w / h, s.shot.target);
    ctx.drawImage(s.shot.img, r.sx, r.sy, r.sw, r.sh, x, y, w, h);
    const tg = s.shot.target;
    if (tg && tg.viewportWidth > 0) {
      const sc = (s.shot.w / tg.viewportWidth) * (w / r.sw);
      ret = { x: x + (tg.x * (s.shot.w / tg.viewportWidth) - r.sx) * (w / r.sw), y: y + (tg.y * (s.shot.w / tg.viewportWidth) - r.sy) * (h / r.sh), w: tg.width * sc, h: tg.height * sc };
    }
  } else {
    ctx.fillStyle = color.abyss;
    ctx.font = display(11, 600);
    ctx.fillText(fitText(ctx, s.trip.title, w - 14), x + 7, y + h / 2 + 4);
  }
  ctx.restore();
  ctx.strokeStyle = color.glassEdge;
  ctx.lineWidth = 1;
  ctx.stroke();
  if (ret) {
    // H8 reticle on what was clicked; pulses until the drop leaves it.
    const d = at(s, "drop")!;
    const pulse = t < d.start + 0.3 ? 0.5 + 0.5 * Math.sin(t * 9) ** 2 : 0.6;
    const pad = 3;
    ctx.beginPath();
    ctx.roundRect(ret.x - pad, ret.y - pad, ret.w + pad * 2, ret.h + pad * 2, 5);
    ctx.strokeStyle = color.cyan;
    ctx.lineWidth = 1.6;
    ctx.shadowColor = color.cyan;
    ctx.shadowBlur = 8 + 10 * pulse;
    ctx.stroke();
  }
  ctx.restore();
}

/** T20: who started a trip that didn't start in a browser. */
function drawTerminal(ctx: Ctx, s: ClipScene, x: number, y: number, w: number, h: number): void {
  ctx.save();
  ctx.font = mono(9.5, 500);
  ctx.letterSpacing = "1.3px";
  ctx.fillStyle = color.inkDim;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(s.trip.caller.place.name, x, y - 7);
  ctx.letterSpacing = "0px";
  ctx.shadowColor = "rgba(0,0,0,0.7)";
  ctx.shadowBlur = 24;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 9);
  ctx.fillStyle = mix(color.abyss, color.navy, 0.4);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = color.glassEdge;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.font = mono(9.5, 500);
  ctx.fillStyle = mix(color.cyan, color.core, 0.7);
  ctx.textBaseline = "top";
  const lines = Math.max(1, Math.floor((h - 12) / 13));
  charWrap(ctx, s.trip.caller.text, w - 14, lines).forEach((l, i) => ctx.fillText(l, x + 7, y + 7 + i * 13));
  ctx.restore();
}

/** Wraps on any character (commands have long unbroken runs); the last line ends in … if cut. */
function charWrap(ctx: Ctx, text: string, maxW: number, maxLines: number): string[] {
  const out: string[] = [];
  let rest = text;
  while (rest && out.length < maxLines) {
    let n = rest.length;
    while (n > 1 && ctx.measureText(rest.slice(0, n)).width > maxW) n--;
    out.push(rest.slice(0, n));
    rest = rest.slice(n);
  }
  if (rest && out.length) out[out.length - 1] = fitText(ctx, `${out[out.length - 1]!}…`, maxW);
  return out;
}

function drawCard(ctx: Ctx, s: ClipScene, t: number): void {
  const dv = s.dive;
  const ph = at(s, "dive");
  const box = cardBox(s);
  if (!dv || !ph || !box || t < ph.start) return;
  const td = t - ph.start;
  const st = s.geo.stations[dv.station]!;
  const open = easeOut(td / 0.42);
  const { x, y, w, h } = box;
  ctx.save();
  // T8: scale from the station point.
  ctx.translate(st.x, st.y);
  ctx.scale(0.12 + 0.88 * open, 0.12 + 0.88 * open);
  ctx.translate(-st.x, -st.y);
  ctx.globalAlpha *= open;
  ctx.shadowColor = "rgba(0,0,0,0.8)";
  ctx.shadowBlur = 50;
  ctx.shadowOffsetY = 24;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 16);
  const bg = ctx.createLinearGradient(0, y, 0, y + h);
  bg.addColorStop(0, color.navy);
  bg.addColorStop(1, color.abyss);
  ctx.fillStyle = bg;
  ctx.fill();
  ctx.shadowColor = rgba(color.cyan, 0.3);
  ctx.shadowBlur = 40;
  ctx.shadowOffsetY = 0;
  ctx.strokeStyle = color.glassEdge;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.save();
  ctx.clip();

  // head: traffic dots + file label
  for (let i = 0; i < 3; i++) {
    ctx.fillStyle = color.inkFaint;
    ctx.beginPath();
    ctx.arc(x + 18 + i * 14, y + CARD.head / 2, 4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.font = mono(11.5, 600);
  ctx.letterSpacing = "1.4px";
  ctx.fillStyle = color.ink;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(fitText(ctx, dv.file.toUpperCase(), w - 80), x + 66, y + CARD.head / 2 + 1);
  ctx.letterSpacing = "0px";
  ctx.fillStyle = color.hair;
  ctx.fillRect(x, y + CARD.head, w, 1);

  // code
  const lit = easeOut((td - 0.45) / 0.3);
  const c = dv.error ? color.fail : color.cyan;
  let ly = y + CARD.head + CARD.padTop;
  ctx.font = mono(13, 400);
  const longest = Math.max(1, ...dv.lines.map((tk) => tk.reduce((n, t) => n + t.content.length, 0)));
  const size = Math.max(9.5, Math.min(13, (13 * (w - 62)) / (longest * ctx.measureText("M").width))); // the longest line fits the card
  ctx.font = mono(size, 400);
  const adv = ctx.measureText("M").width;
  dv.lines.forEach((tokens, i) => {
    const n = dv.start + i;
    const live = n === dv.live;
    const rowH = CARD.line + (live && dv.chip ? CARD.chip : 0);
    if (live && lit > 0) {
      const lg = ctx.createLinearGradient(x, 0, x + w, 0);
      lg.addColorStop(0, rgba(c, 0.26 * lit));
      lg.addColorStop(1, rgba(c, 0.04 * lit));
      ctx.fillStyle = lg;
      ctx.fillRect(x, ly, w, rowH);
      ctx.fillStyle = rgba(c, lit);
      ctx.fillRect(x, ly, 2.5, rowH);
    }
    ctx.font = mono(size, 400);
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.fillStyle = live && lit > 0 ? mix(color.inkFaint, color.ink, lit * 0.7) : color.inkFaint;
    ctx.fillText(String(n), x + 34, ly + CARD.line / 2);
    ctx.textAlign = "left";
    let col = 0;
    for (const tk of tokens) {
      ctx.fillStyle = tk.color;
      ctx.fillText(tk.content, x + 48 + col * adv, ly + CARD.line / 2);
      col += tk.content.length;
    }
    if (live && dv.chip) {
      const chars = Math.round(dv.chip.length * clamp01((td - 0.6) / 0.4)); // P7 type-on
      if (chars > 0) {
        const glow = td > 1.0 ? 0.6 + 0.4 * Math.sin((td - 1.0) * 5) ** 2 : 0.6;
        ctx.font = mono(12, 500);
        drawChip(ctx, fitValue(ctx, dv.chip.slice(0, chars), w - 48 - 30), x + 46, ly + CARD.line + 2, 12, dv.error, glow);
      }
    }
    ly += rowH;
  });

  // why
  const wy = y + h - CARD.why;
  const wk = s.captions ? 0 : clamp01((td - 1.0) / 0.4); // with captions on, the caption already says it
  if (!s.captions) {
    ctx.fillStyle = color.hair;
    ctx.fillRect(x, wy, w, 1);
  }
  if (wk > 0) {
    ctx.globalAlpha *= wk;
    ctx.font = display(13.5, 400);
    ctx.fillStyle = color.inkDim;
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    wrap(ctx, dv.why, w - 28, 2).forEach((l, i) => ctx.fillText(l, x + 14, wy + 22 + i * 19));
  }
  ctx.restore();
  ctx.restore();
}

function captionAt(s: ClipScene, t: number, name: PhaseName): { text: string; error: boolean; alpha: number } | undefined {
  const ph = at(s, name)!;
  const a = easeOut((t - ph.start) / 0.2);
  if (name === "verdict" || name === "outro") return { text: s.trip.verdict, error: s.trip.status === "error", alpha: name === "outro" ? 1 : a };
  if (!s.captions) return undefined;
  if (name === "intro") return { text: s.intro, error: false, alpha: a };
  if (name === "return") return { text: s.trip.returned, error: s.trip.status === "error", alpha: a };
  if (name === "dive" && s.dive) return { text: s.dive.why, error: s.dive.error, alpha: a };
  // drop/snap: the station the tip last passed
  let idx = -1;
  s.geo.stations.forEach((_, i) => {
    if (reachTime(s, s.out.at[i]!) <= t) idx = i;
  });
  if (name === "snap") idx = s.geo.stations.findIndex((st) => st.snap);
  const st = s.geo.stations[idx];
  if (!st) return { text: s.intro, error: false, alpha: 1 };
  return { text: st.caption, error: st.status === "error" && !s.knit && (!!st.snap || idx === diveTarget(s.trip)), alpha: clamp01((t - reachTime(s, s.out.at[idx]!)) / 0.15) * 0.6 + 0.4 };
}

function drawCaption(ctx: Ctx, f: Frame, text: string, error: boolean, alpha: number): void {
  const portrait = f.H > f.W;
  let size = portrait ? 56 : 44;
  const maxW = f.W * (portrait ? 0.84 : 0.7);
  ctx.save();
  ctx.font = display(size, 500);
  if (wrap(ctx, text, maxW, 9).length > 3) ctx.font = display((size = Math.round(size * 0.8)), 500); // a long "why" gets smaller type, not cut
  const lines = wrap(ctx, text, maxW, 4);
  const lh = size * 1.3;
  const top = f.capTop + (portrait ? 70 : 40);
  const g = ctx.createLinearGradient(0, f.capTop - 40, 0, f.H);
  g.addColorStop(0, rgba(color.void, 0));
  g.addColorStop(0.3, rgba(color.void, 0.82));
  g.addColorStop(1, rgba(color.void, 0.96));
  ctx.fillStyle = g;
  ctx.fillRect(0, f.capTop - 40, f.W, f.H - f.capTop + 40);
  ctx.globalAlpha = alpha;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.shadowColor = "rgba(0,0,0,0.6)";
  ctx.shadowBlur = size * 0.4;
  ctx.fillStyle = error ? mix(color.fail, color.core, 0.72) : color.ink;
  lines.forEach((l, i) => ctx.fillText(l, f.W / 2, top + size + i * lh));
  ctx.restore();
}

function drawWatermark(ctx: Ctx, f: Frame): void {
  const size = Math.round(Math.min(f.W, f.H) * 0.022);
  const m = Math.round(Math.min(f.W, f.H) * 0.04);
  ctx.save();
  ctx.font = mono(size, 500);
  ctx.letterSpacing = `${Math.round(size * 0.3)}px`;
  ctx.textAlign = "right";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = rgba(color.ink, 0.5);
  ctx.fillText("shrike", f.W - m, f.H - m);
  ctx.restore();
}

function drawOutroMark(ctx: Ctx, f: Frame, k: number): void {
  const size = Math.round(Math.min(f.W, f.H) * 0.05);
  ctx.save();
  ctx.globalAlpha = k;
  ctx.font = mono(size, 600);
  ctx.letterSpacing = `${Math.round(size * 0.5)}px`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = color.ink;
  ctx.shadowColor = color.cyan;
  ctx.shadowBlur = 24 * k;
  ctx.fillText("SHRIKE", f.W / 2 + size * 0.25, f.H / 2); // centre: clear of the caption fading out below
  ctx.restore();
}

// ---------------------------------------------------------------- T23: local vs live split (#62)

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 16:9: the verdict band on top, two 9:16 panes (local left, live right), each named in the margin beside it. */
export function splitFrame(): { W: number; H: number; panes: [Box, Box] } {
  const W = 1920;
  const H = 1080;
  const top = 120;
  const gap = 40;
  const h = H - top - 24;
  const w = Math.round((h * 9) / 16);
  const x = Math.round((W - 2 * w - gap) / 2);
  return { W, H, panes: [{ x, y: top, w, h }, { x: x + w + gap, y: top, w, h }] };
}

/** #52: what a clip may show of a trip. A live trip's values are masked, and its page screenshot is left out unless the user turns it on. */
export function forShare(view: ActionView, showPage: boolean, keep?: string[]): { view: ActionView; shot: boolean } {
  return view.root.live ? { view: maskAction(view, { keep }), shot: showPage } : { view, shot: true };
}

/** Composes two painted 9:16 clip frames into the split. */
export function paintSplit(ctx: Ctx, panes: [CanvasImageSource, CanvasImageSource], verdict: string): void {
  const f = splitFrame();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.shadowBlur = 0;
  ctx.letterSpacing = "0px";
  ctx.fillStyle = color.void;
  ctx.fillRect(0, 0, f.W, f.H);
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "center";
  ctx.font = display(34, 500);
  ctx.fillStyle = color.ink;
  ctx.fillText(fitText(ctx, verdict, f.W - 120), f.W / 2, 74);
  f.panes.forEach((p, i) => {
    ctx.drawImage(panes[i]!, p.x, p.y, p.w, p.h);
    ctx.strokeStyle = color.hair;
    ctx.lineWidth = 1;
    ctx.strokeRect(p.x + 0.5, p.y + 0.5, p.w - 1, p.h - 1);
    const x = i ? p.x + p.w + 32 : p.x - 32;
    ctx.textAlign = i ? "left" : "right";
    ctx.font = mono(24, 600);
    ctx.letterSpacing = "6px";
    ctx.fillStyle = i ? color.slow : color.inkDim;
    ctx.fillText(i ? "LIVE" : "LOCAL", x, p.y + 60);
    ctx.letterSpacing = "0px";
  });
}

// ---------------------------------------------------------------- LV4: trip card (#64)

export interface CardSide {
  view: ActionView; // already through forShare
  trip: Trip;
  shot?: Shot;
}

export interface CardScene {
  W: number;
  H: number;
  kicker: string; // 'Clicked "Save"', or Local vs Live
  live: boolean;
  caption: string; // the trip verdict
  error: boolean;
  stats: { label: string; values: string[] }[]; // one value per side
  footer: readonly [string, string];
  head: Box;
  stat: Box;
  panes: { box: Box; scene: ClipScene; t: number }[];
}

export const CARD_FOOTER = ["Seen with Shrike · see what your app does", "github.com/SumantxD/shrike"] as const;

/** 1200x630, or 1080x1350 portrait. Local vs live is always landscape: its numbers sit between the two panes. */
export function cardLayout(portrait: boolean, two: boolean): { W: number; H: number; head: Box; stat: Box; panes: Box[] } {
  if (two) return { W: 1200, H: 630, head: { x: 56, y: 48, w: 1088, h: 132 }, stat: { x: 428, y: 196, w: 344, h: 340 }, panes: [{ x: 56, y: 196, w: 356, h: 340 }, { x: 788, y: 196, w: 356, h: 340 }] };
  if (portrait) return { W: 1080, H: 1350, head: { x: 72, y: 88, w: 936, h: 300 }, stat: { x: 72, y: 1080, w: 936, h: 130 }, panes: [{ x: 72, y: 400, w: 936, h: 650 }] };
  return { W: 1200, H: 630, head: { x: 64, y: 60, w: 560, h: 330 }, stat: { x: 64, y: 410, w: 560, h: 110 }, panes: [{ x: 672, y: 48, w: 464, h: 484 }] };
}

const noQuery = (s: string) => s.replace(/\?[^\s"'`]+/g, "");

/** Shapes only: value chips (rows, bodies, arguments), query strings and step captions are left out; names, statuses, times and counts stay. */
export function shapesOnly(trip: Trip): Trip {
  return {
    ...trip,
    title: noQuery(trip.title),
    verdict: noQuery(trip.verdict),
    returned: noQuery(trip.returned),
    forks: trip.forks.map((f) => ({ ...f, caption: "" })),
    stations: trip.stations.map((s) => {
      const st = { ...s, label: noQuery(s.label), caption: "" };
      delete st.chip;
      delete st.chipError;
      return st;
    }),
  };
}

/** 20+ steps: the path to where it broke only. */
function cardPath(t: Trip): Trip {
  const snap = t.stations.findIndex((s) => s.snap);
  const end = snap >= 0 ? snap : t.stations.findIndex((s) => s.status === "error");
  return t.stations.length >= 20 && end >= 0 ? { ...t, stations: t.stations.slice(0, end + 1) } : t;
}

/** A pane's frame: about 1.2 canvas px per layout px, shrunk (to 0.75 at most) until the whole trip fits. */
// ponytail: a trip still taller than the pane shows its end (where it broke); a card with 8+ lanes reads small. Upgrade: fold more routine steps for cards.
function paneFrame(b: Box, trip: Trip): Frame {
  const feedTop = 52;
  let LW = Math.min(540, Math.max(300, b.w / 1.2));
  const g = layoutTrip(trip, LW);
  const need = g.endY + 44 - (g.shotY - 64);
  if (need > ((b.h - feedTop) * LW) / b.w) LW = Math.min(b.w / 0.75, (need * b.w) / (b.h - feedTop));
  return { W: b.w, H: b.h, k: b.w / LW, LW, feedTop, capTop: b.h };
}

const fmtTime = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`);

/** The last read's row count (what the click ended up showing), else the last write's; undefined when nothing said. */
function rowsOf(v: ActionView): number | undefined {
  const all = (ns: TimelineNode[]): DebugEvent[] => ns.flatMap((n) => [n.event, ...all(n.children)]);
  const evs = all(v.tree);
  const read = evs.findLast((e) => /^\d+ rows?$/.test(e.returned ?? ""))?.returned;
  return read ? parseInt(read, 10) : evs.findLast((e) => e.change?.count !== undefined)?.change?.count;
}

/** The card for one trip, or local and live side by side. Pure: the same trip gives the same card every time. */
export function makeCard(o: { portrait: boolean; sides: CardSide[]; values: boolean; caption?: string }): CardScene {
  const two = o.sides.length > 1;
  const L = cardLayout(o.portrait, two);
  const trips = o.sides.map((s) => cardPath(o.values ? s.trip : shapesOnly(s.trip)));
  const panes = o.sides.map((s, i) => {
    const box = L.panes[i]!;
    const scene = makeScene({ aspect: "9:16", trip: trips[i]!, shot: s.shot, intro: "", knit: false, captions: false, frame: paneFrame(box, trips[i]!), still: true });
    const v = at(scene, "verdict")!;
    return { box, scene, t: v.start + v.dur * 0.9 };
  });
  const rows = o.sides.map((s) => rowsOf(s.view));
  const stats = [
    { label: "TIME", values: trips.map((t) => fmtTime(t.ms)) },
    { label: "STEPS", values: o.sides.map((s) => String(toSteps(s.view).length)) },
    ...(rows.some((r) => r !== undefined) ? [{ label: "ROWS", values: rows.map((r) => (r === undefined ? "unknown" : String(r))) }] : []),
  ];
  const last = trips[trips.length - 1]!;
  return { W: L.W, H: L.H, kicker: two ? "Local vs Live" : trips[0]!.title, live: o.sides.some((s) => !!s.view.root.live), caption: o.caption ?? last.verdict, error: last.status === "error", stats, footer: CARD_FOOTER, head: L.head, stat: L.stat, panes };
}

/** Composes the card around each pane's still (paint(paneCtx, pane.scene, pane.t)). */
export function paintCard(ctx: Ctx, c: CardScene, panes: CanvasImageSource[]): void {
  const portrait = c.H > c.W;
  const two = c.panes.length > 1;
  const m = c.head.x;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.shadowBlur = 0;
  ctx.letterSpacing = "0px";
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  const bg = ctx.createRadialGradient(c.W * 0.3, c.H * 0.3, 0, c.W * 0.3, c.H * 0.3, Math.max(c.W, c.H) * 0.8);
  bg.addColorStop(0, color.navy);
  bg.addColorStop(1, color.void);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, c.W, c.H);

  c.panes.forEach((p, i) => {
    const { x, y, w, h } = p.box;
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, radius.pane);
    ctx.save();
    ctx.clip();
    ctx.drawImage(panes[i]!, x, y, w, h);
    ctx.restore();
    ctx.strokeStyle = color.hair;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
  });

  // Kicker, then the verdict as big as fits.
  const { head, stat } = c;
  const ks = portrait ? 24 : 16;
  ctx.font = mono(ks, 600);
  ctx.letterSpacing = `${(ks * 0.18).toFixed(1)}px`;
  ctx.fillStyle = color.inkDim;
  const kick = fitText(ctx, c.kicker.toUpperCase(), head.w - ks * 5);
  ctx.fillText(kick, head.x, head.y + ks);
  if (c.live && !two) {
    ctx.fillStyle = color.slow;
    ctx.fillText("LIVE", head.x + ctx.measureText(kick).width + ks * 1.2, head.y + ks);
  }
  ctx.letterSpacing = "0px";
  const top = head.y + ks * 2.6;
  const room = head.y + head.h - top;
  let size = two ? 46 : portrait ? 80 : 56;
  const fits = () => {
    ctx.font = display(size, 600);
    return wrap(ctx, c.caption, head.w, 9).length * size * 1.12 <= room;
  };
  while (size > 30 && !fits()) size -= 2;
  ctx.font = display(size, 600);
  ctx.fillStyle = c.error ? mix(color.fail, color.core, 0.72) : color.ink;
  wrap(ctx, c.caption, head.w, Math.max(1, Math.floor(room / (size * 1.12)))).forEach((l, i) => ctx.fillText(l, head.x, top + size * 0.9 + i * size * 1.12));

  // Stats: label over value; local vs live puts both values beside one label.
  const ls = portrait ? 18 : 13;
  const label = (text: string, x: number, y: number, fill: string = color.inkDim) => {
    ctx.font = mono(ls, 600);
    ctx.letterSpacing = `${(ls * 0.2).toFixed(1)}px`;
    ctx.fillStyle = fill;
    ctx.fillText(text, x, y);
    ctx.letterSpacing = "0px";
  };
  if (!two) {
    const vs = portrait ? 64 : 44;
    const bw = stat.w / c.stats.length;
    c.stats.forEach((s, i) => {
      const x = stat.x + i * bw;
      label(s.label, x, stat.y + ls);
      ctx.font = mono(vs, 500);
      ctx.fillStyle = s.label === "ROWS" && s.values[0] === "0" ? color.slow : color.ink;
      ctx.fillText(fitText(ctx, s.values[0]!, bw - 16), x, stat.y + ls + 14 + vs * 0.85);
    });
  } else {
    const cl = stat.x + stat.w * 0.25;
    const cr = stat.x + stat.w * 0.75;
    ctx.textAlign = "center";
    label("LOCAL", cl, stat.y + 24);
    label("LIVE", cr, stat.y + 24, color.slow);
    ctx.fillStyle = color.hair;
    ctx.fillRect(stat.x + 16, stat.y + 44, stat.w - 32, 1);
    const rh = (stat.h - 60) / c.stats.length;
    c.stats.forEach((s, i) => {
      const y = stat.y + 60 + i * rh;
      label(s.label, stat.x + stat.w / 2, y + 18);
      ctx.font = mono(34, 500);
      s.values.forEach((v, j) => {
        ctx.fillStyle = j && v !== s.values[0] ? color.slow : color.ink;
        ctx.fillText(fitText(ctx, v, stat.w / 2 - 20), j ? cr : cl, y + 62);
      });
    });
    ctx.textAlign = "left";
  }

  // Footer: what made it, and where to get it.
  const fs = portrait ? 22 : 16;
  const fy = c.H - (portrait ? 52 : 30);
  ctx.fillStyle = color.hair;
  ctx.fillRect(m, fy - fs - (portrait ? 26 : 16), c.W - m * 2, 1);
  ctx.font = mono(fs, 500);
  ctx.fillStyle = color.inkDim;
  ctx.fillText(c.footer[0], m, fy);
  ctx.textAlign = "right";
  ctx.fillStyle = mix(color.cyan, color.core, 0.35);
  ctx.fillText(c.footer[1], c.W - m, fy);
  ctx.textAlign = "left";
}
