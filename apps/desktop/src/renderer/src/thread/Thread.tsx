import "./thread.css";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { ActionView, Place } from "@shrike/schema";
import { useRun } from "../stores/run.ts";
import { cssColor as color, font, motion } from "@shrike/design";
import { useActions } from "../stores/actions.ts";
import { useProject } from "../stores/project.ts";
import { firstFailure, tripOrder, useThread } from "../stores/thread.ts";
import { knownPlaces, buildTrip, FALLBACK, fitHead, glyphPath, laneColumns, lanesFor, layoutTrip, touchedBy, type LaneCol, type LaneDef, type LaneLayout, type PlacedStation, type Trip, type TripGeometry } from "../lib/thread-layout.ts";
import { isGuess, offsets, plannedLanes, visibleRange } from "./logic.ts";
import { reducedMotion } from "./motion.ts";
import { TripView, type Play } from "./TripView.tsx";
import { CLEAR, DIVE_AT, LABEL_UP } from "./DiveCard.tsx";
import { useInspector } from "../inspector/store.ts";
import { useUi } from "../stores/ui.ts";
import { useWorktrees } from "../stores/worktrees.ts";
import { FilesView } from "../files/FilesView.tsx";
import { Compare } from "./Compare.tsx";

// The Thread: every click as one glowing round trip through the places it touched (lanes, D9-D11); time runs down.
// Spec: docs/06-design.md, design-system/prototype-thread.html. Keys, caption and auto-dive live in the shell (hud/**).

const kebab = (s: string) => s.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
export const VARS = {
  ...Object.fromEntries(Object.entries(color).map(([k, v]) => [`--${kebab(k)}`, v])),
  "--display": font.display,
  "--mono": font.mono,
  "--ease": motion.ease,
  "--out": motion.easeOut,
} as CSSProperties;

const WINDOW_AFTER = 30; // trips; beyond this only the ones near the viewport render
const PAD = 40; // feed top padding: the first trip's title clears the lane header
const TITLE_FULL = 36; // scroll offset above a trip that puts its title just under the lane header
const TITLE_SLIM = 90; // ...under the taller sliver labels

const trips = new WeakMap<ActionView, { expanded: ReadonlySet<string>; known: readonly Place[]; trip: Trip }>();
function tripOf(v: ActionView, expanded: ReadonlySet<string>, known: readonly Place[]): Trip {
  const hit = trips.get(v);
  if (hit && hit.expanded === expanded && hit.known === known) return hit.trip;
  const trip = buildTrip(v, expanded, known);
  trips.set(v, { expanded, known, trip });
  return trip;
}
const geos = new WeakMap<Trip, { lanes: LaneLayout; m: Map<boolean, TripGeometry> }>();
function geoOf(t: Trip, lanes: LaneLayout, timeMode: boolean): TripGeometry {
  let c = geos.get(t);
  if (!c || c.lanes !== lanes) geos.set(t, (c = { lanes, m: new Map() }));
  let g = c.m.get(timeMode);
  if (!g) c.m.set(timeMode, (g = layoutTrip(t, lanes.width, timeMode, lanes)));
  return g;
}

const BLANK: LaneDef[] = [FALLBACK.screen, FALLBACK.page, FALLBACK.server, FALLBACK.database].map((p) => ({ ...p, label: p.name, ghost: false, hop: 0 }));

/** A sliver that would read like its neighbour ("LRU", "LRU") shows its own part instead: "SESSIONS", "ORDERS". */
const sliverText = (c: LaneCol, all: readonly LaneCol[]) => (c.sub && all.filter((o) => o.head === c.head).length > 1 ? c.sub.toUpperCase() : c.head);

export function KindGlyph({ d }: { d: string }) {
  return (
    <svg className="th-glyph" width="11" height="11" viewBox="0 0 12 12" aria-hidden>
      <path d={d} fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Thread() {
  const order = useActions((s) => s.order);
  const byId = useActions((s) => s.byId);
  const focus = useThread((s) => s.focus);
  const dived = useThread((s) => s.dived);
  const timeMode = useThread((s) => s.timeMode);
  const expanded = useThread((s) => s.expanded);
  const arriving = useThread((s) => s.arriving);
  const knit = useThread((s) => s.knit);
  const probe = useThread((s) => s.probe);
  const openGroups = useThread((s) => s.openGroups);
  const viewMode = useThread((s) => s.view);
  const compare = useThread((s) => (s.view === "thread" ? s.compare : null));
  const expected = useProject((s) => s.project?.expectedPlaces);
  const guessed = useProject((s) => !!s.project && !s.project.placesFrom); // lanes-from-plan: package.json lanes are only a guess until Claude plans the start
  const procs = useRun((s) => s.status.processes);
  const runState = useRun((s) => s.status.state);
  const hasPage = useProject((s) => !s.project || !!s.project.appUrl);
  const liveUrl = useProject((s) => s.project?.liveUrl);
  const origins = useProject((s) => s.project?.origins);
  const known = useMemo(() => knownPlaces(expected, procs, { liveUrl, origins }), [expected, procs, liveUrl, origins]);

  const feed = useRef<HTMLDivElement>(null);
  const miniOn = useRef<HTMLButtonElement>(null);
  const [width, setWidth] = useState(0);
  const [range, setRange] = useState<[number, number]>([0, WINDOW_AFTER]);
  const [play, setPlay] = useState<Play | null>(null);

  useLayoutEffect(() => {
    const el = feed.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(Math.round(el.clientWidth)));
    ro.observe(el);
    setWidth(Math.round(el.clientWidth));
    return () => ro.disconnect();
  }, []);

  // tripOrder() reads order and byId from the store
  const ids = useMemo(() => tripOrder(), [order, byId]);
  const list = useMemo(() => ids.map((id) => tripOf(byId[id]!, expanded, known)), [ids, byId, expanded, known]);
  const fi = focus.actionId ? ids.indexOf(focus.actionId) : -1;
  const fTrip = list[fi];

  // D9-D11: the session's lanes; the focused trip's lanes are full width, the rest slivers.
  const laneDefs = useMemo(() => plannedLanes(list.length ? lanesFor(list, expected ?? []) : expected?.length ? lanesFor([], [FALLBACK.screen, ...expected]) : BLANK, expected, guessed), [list, expected, guessed]);
  const touchKey = (fTrip ?? list[list.length - 1]) ? [...touchedBy((fTrip ?? list[list.length - 1])!)].join("|") : laneDefs.map((l) => l.id).join("|");
  const lanes = useMemo(() => laneColumns(laneDefs, new Set(touchKey.split("|")), width, openGroups), [laneDefs, touchKey, width, openGroups]);
  const many = lanes.cols.length > 6;
  const head = (c: LaneCol) => fitHead(c.head, c.w - 4 - (many ? 15 : 17), many ? 6.8 : 8.4); // 10px mono caps at .08em (many) or .24em, after the glyph
  const sub = (c: LaneCol) => (!c.sub || c.sub.length * 6.4 <= c.w - 8 ? c.sub : c.sub.split(/[\s.-]/)[0]); // too long: its first word (10px at .04em), the rest is in the tooltip
  const inspecting = useInspector((s) => s.placeId); // I1: lane headers open the place in the dock
  const raceOpen = useWorktrees((s) => !!s.open);
  const toast = useUi((s) => s.toasts.length > 0 || (!!s.newTrip && !raceOpen)); // a toast takes the header band (Toasts.tsx)
  useEffect(() => {
    const def = new Map(laneDefs.map((l) => [l.id, l]));
    useInspector.getState().setLanes(lanes.cols.filter((c) => c.mode !== "group").map((c) => ({ id: c.key, kind: c.kind, name: def.get(c.key)?.name ?? c.label, detail: def.get(c.key)?.detail })));
  }, [lanes, laneDefs]);
  const geo = useMemo(() => (width ? list.map((t) => geoOf(t, lanes, timeMode)) : []), [list, lanes, timeMode, width]);
  const tops = useMemo(() => offsets(geo.map((g) => g.height)).map((t) => t + PAD), [geo]);

  const fSt: PlacedStation | undefined = geo[fi]?.stations[focus.station];

  // Windowing: render only trips near the viewport once the feed is long.
  const windowed = ids.length > WINDOW_AFTER;
  const measure = useCallback(() => {
    const el = feed.current;
    if (!el || !windowed) return;
    const r = visibleRange(tops, el.scrollTop, el.clientHeight, 3);
    setRange((p) => (p[0] === r[0] && p[1] === r[1] ? p : r));
  }, [tops, windowed]);
  useEffect(measure, [measure]);
  const raf = useRef(0);
  const onScroll = useCallback(() => {
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(measure);
  }, [measure]);
  const [first, last] = windowed ? range : [0, ids.length - 1];

  // The focused station sits on the reading line (40% down; DIVE_AT while dived so the card has room), with the trip's
  // AFTER card kept above the caption. While a trip arrives (pending or playing), its title sits under the lane header.
  const ready = !!(arriving && byId[arriving]?.complete);
  const focusY = fi >= 0 && fSt ? tops[fi]! + fSt.y : undefined;
  const framing = (play?.arrival && play.id === focus.actionId) || (arriving === focus.actionId && !ready) ? fi : -1;
  useEffect(() => {
    const el = feed.current;
    if (!el || !width) return;
    const h = el.clientHeight;
    const TITLE = lanes.cols.some((c) => c.mode === "sliver") ? TITLE_SLIM : TITLE_FULL;
    let top: number;
    if (framing >= 0) top = tops[framing]! - TITLE;
    else if (focusY === undefined) top = el.scrollHeight;
    else if (dived) top = focusY - Math.max(h * DIVE_AT, TITLE + LABEL_UP);
    else {
      const t0 = tops[fi]!;
      top = Math.max(focusY - h * 0.4, t0 + geo[fi]!.endY + 40 - (h - CLEAR));
      top = Math.min(top, focusY - h * 0.15);
      if (focusY - t0 <= h * 0.4) top = Math.min(top, t0 - TITLE);
    }
    el.scrollTo({ top, behavior: reducedMotion() ? "instant" : "smooth" });
  }, [focus, focusY, dived, width, framing, geo[fi]?.endY, lanes]); // focus: a re-focus on the same step (!, voice) still brings it back after a scroll

  useEffect(() => void miniOn.current?.scrollIntoView({ block: "nearest" }), [fi]);

  // Enter on an express track opens it instead of diving.
  useEffect(() => {
    if (!dived || fSt?.kind !== "express") return;
    const th = useThread.getState();
    th.expand(fSt.id);
    th.surface();
  }, [dived, fSt]);

  // M1-M3 when the shell marks a trip as arriving (once it is complete, so the drawing tells the truth); M8 for re-runs.
  useEffect(() => {
    if (!arriving || !ready) return;
    setPlay((p) => ({ id: arriving, token: (p?.token ?? 0) + 1, knit: useThread.getState().knit.has(arriving), arrival: true }));
  }, [arriving, ready]);
  const knitSeen = useRef(knit);
  useEffect(() => {
    const fresh = [...knit].filter((id) => !knitSeen.current.has(id) && id !== useThread.getState().arriving);
    knitSeen.current = knit;
    const id = fresh[fresh.length - 1];
    if (id) setPlay((p) => ({ id, token: (p?.token ?? 0) + 1, knit: true, arrival: false }));
  }, [knit]);
  const onPlayed = useCallback((p: Play) => {
    setPlay((cur) => (cur?.token === p.token ? null : cur));
    const th = useThread.getState();
    if (p.arrival && th.arriving === p.id) th.arrive(null);
  }, []);

  // FV: the Files view draws one trip; with nothing focused it takes the latest, on its failure if it broke.
  const filesTrip = viewMode === "files" ? (fTrip ?? list[list.length - 1]) : undefined;
  useEffect(() => {
    if (viewMode === "files" && !fTrip && filesTrip) useThread.getState().setFocus(filesTrip.actionId, filesTrip.status === "error" ? firstFailure(filesTrip) : 0);
  }, [viewMode, fTrip, filesTrip]);

  const onStation = useCallback((actionId: string, i: number, st: PlacedStation) => {
    const th = useThread.getState();
    if (st.kind === "express") {
      th.expand(st.id);
      return th.setFocus(actionId, i);
    }
    th.setFocus(actionId, i);
    th.dive();
  }, []);

  const onMiniKey = (e: React.KeyboardEvent<HTMLElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      (e.target as HTMLElement).blur();
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      e.stopPropagation();
      const btns = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>("button"));
      const idx = btns.indexOf(e.target as HTMLButtonElement);
      if (idx === -1) return;
      const next = e.key === "ArrowDown" ? btns[idx + 1] : btns[idx - 1];
      next?.focus();
    }
  };

  return (
    <div className="th-root" style={VARS}>
      <div className="th-bar">
        <div className="th-seg" role="group" aria-label="View">
          <button type="button" aria-pressed={viewMode === "thread"} title="The Thread: each click as one trip through the places it touched (V)" onClick={() => useThread.getState().setView("thread")}>
            THREAD
          </button>
          <button type="button" aria-pressed={viewMode === "files"} title="Files view: the same trip, step by step through your folders and files (V)" onClick={() => useThread.getState().setView("files")}>
            FILES
          </button>
        </div>
        <span className="th-barhint" aria-hidden>
          <kbd>V</kbd> switches
        </span>
      </div>
      {filesTrip && byId[filesTrip.actionId] && <FilesView view={byId[filesTrip.actionId]!} trip={filesTrip} />}
      {viewMode === "files" && !filesTrip && (
        <div className="th-stage">
          <div className="th-empty">
            <p>Click something in your app to see where it runs.</p>
          </div>
        </div>
      )}
      {compare && <Compare {...compare} known={known} />}
      <div className={`th-stage${dived ? " dived" : ""}`} hidden={viewMode === "files" || !!compare}>
        <div className="th-lanes" aria-hidden>
          {lanes.cols.map((c) => (
            <div key={c.key} className={`th-lane${c.mode === "sliver" ? " dim" : ""}${c.ghost ? " ghost" : ""}`} style={{ left: c.x }} />
          ))}
        </div>
        <div className={`th-lanehead${many ? " many" : ""}${lanes.cols.some((c) => c.mode === "sliver") ? " slim" : ""}${toast ? " quiet" : ""}`}>
          {lanes.cols.map((c) =>
            c.mode === "group" ? (
              <button key={c.key} className="hot group" style={{ left: c.x, maxWidth: c.w - 4 }} title={`${c.label}. ${c.title}`} aria-label={`${c.label}. ${c.title}`} onClick={() => useThread.getState().toggleGroup(c.kind)}>
                <KindGlyph d={c.glyph} />
                {fitHead(c.label, c.w - 52, 8).replace(/.+/, "$& ▸") || c.ids.length}
              </button>
            ) : (
              <span key={c.key} className={`${c.mode === "sliver" ? "sliver" : "hot"}${c.ghost ? " ghost" : ""}${inspecting === c.key ? " on" : ""}`} style={{ left: c.x, ...(c.mode === "full" ? { maxWidth: c.w - 4 } : {}) }} title={isGuess(c, guessed) ? `${c.title}. A guess from package.json until Claude plans the start` : c.title}>
                <button type="button" className="th-lanebtn" aria-pressed={inspecting === c.key} aria-label={c.mode === "full" && head(c) !== c.head ? c.title : undefined} onClick={() => useInspector.getState().toggle(c.key)}>
                  <b>
                    <KindGlyph d={c.glyph} />
                    {c.mode === "sliver" ? sliverText(c, lanes.cols) : head(c)}
                  </b>
                  {c.mode === "full" && (c.sub || isGuess(c, guessed)) && <small>{[sub(c), isGuess(c, guessed) && "guess"].filter(Boolean).join(" · ")}</small>}
                </button>
                {openGroups.has(c.kind) && c.mode === "full" && lanes.cols.find((o) => o.kind === c.kind) === c && (
                  <i role="button" tabIndex={0} aria-label={`Fold the ${c.kind} lanes`} onClick={() => useThread.getState().toggleGroup(c.kind)} onKeyDown={(e) => e.key === "Enter" && useThread.getState().toggleGroup(c.kind)}>
                    ◂
                  </i>
                )}
              </span>
            ),
          )}
        </div>
        <div ref={feed} className="th-feed" onScroll={windowed ? onScroll : undefined}>
          {width > 0 && (
            <>
              <div style={{ height: tops[first] }} />
              {list.slice(first, last + 1).map((t, k) => {
                const i = first + k;
                const id = ids[i]!;
                return (
                  <TripView
                    key={id}
                    view={byId[id]!}
                    trip={t}
                    g={geo[i]!}
                    width={width}
                    focused={fi < 0 || i === fi}
                    station={i === fi ? focus.station : -1}
                    dived={i === fi && dived}
                    pending={arriving === id && !ready}
                    timeMode={timeMode}
                    play={play?.id === id ? play : null}
                    probe={probe?.actionId === id ? probe : null}
                    onPlayed={onPlayed}
                    onStation={onStation}
                  />
                );
              })}
              {last < ids.length - 1 && <div style={{ height: tops[ids.length]! - tops[last + 1]! }} />}
              <div className="th-end" />
            </>
          )}
        </div>
        {width > 0 && !list.length && (
          <div className="th-empty">
            <p>{runState === "running" ? (hasPage ? "Click something in your app. Its trip shows up here." : "Send your app a request. Its trip shows up here.") : runState === "starting" ? "Your app is starting. Its first trip shows up here." : hasPage ? "Run your app, then click something in it." : "Run your app, then send it a request."}</p>
          </div>
        )}
      </div>

      <nav className="th-mini" aria-label="Trips" onKeyDown={onMiniKey}>
        {list.map((t, i) => (
          <button
            key={t.actionId}
            data-trip={t.actionId}
            ref={i === fi ? miniOn : undefined}
            className={i === fi ? "on" : ""}
            title={t.title}
            aria-label={`${t.title}, ${t.status === "error" ? "broke" : "worked"}`}
            aria-current={i === fi || undefined}
            onClick={() => useThread.getState().setFocus(t.actionId, t.status === "error" ? firstFailure(t) : 0)}
          >
            <svg width="26" height="30" viewBox="0 0 26 30" aria-hidden>
              <path d={glyphPath(t, laneDefs)} fill="none" stroke={t.status === "error" ? color.fail : t.status === "slow" ? color.slow : color.ok} strokeWidth="1.6" />
            </svg>
          </button>
        ))}
      </nav>

      <ul className="th-sr" role="list" aria-label="Trips, oldest first">
        {list.map((t) => (
          <li key={t.actionId}>
            {t.title}. {t.verdict} {t.returned}.
            <ul role="list">
              {t.stations.map((s) => (
                <li key={s.id}>{s.caption}</li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </div>
  );
}
