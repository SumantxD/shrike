import { memo, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { ActionView, FlowStep } from "@shrike/schema";
import { cssColor as color } from "@shrike/design";
import { subLine, type Trip, type TripGeometry, type PlacedStation } from "../lib/thread-layout.ts";
import { firstFailure, otherSide, useThread } from "../stores/thread.ts";
import { BeforeShot, AfterShot, TerminalCard, SHOT_W } from "./Shot.tsx";
import { TripDecor } from "./TripDecor.tsx";
import { DiveCard, editAndResend } from "./DiveCard.tsx";
import { playTrip } from "./motion.ts";
import { requestEvent, resendDiff, testStep } from "./logic.ts";
import { useActions } from "../stores/actions.ts";
import { toast } from "../stores/ui.ts";
import { call } from "../lib/api.ts";
import { useNow } from "../components/Activity.tsx";
import { clockTime, relativeTime } from "../lib/format.ts";

export interface Play {
  id: string;
  token: number;
  knit: boolean;
  arrival: boolean;
}

type Probe = ReturnType<typeof useThread.getState>["probe"];

interface Props {
  view: ActionView;
  trip: Trip;
  g: TripGeometry;
  width: number;
  focused: boolean;
  station: number; // focused station index (only meaningful when focused)
  dived: boolean;
  pending: boolean;
  timeMode: boolean;
  play: Play | null;
  probe: Probe;
  diff?: number; // T23: the station of the first difference from the other side
  onPlayed(p: Play): void;
  onStation(actionId: string, i: number, st: PlacedStation): void;
}

type St = PlacedStation & { i: number; hot: boolean; post: boolean }; // hot: where it broke, or the clue; post: ran after the snap (error handling)

const dPath = (d: string) => ({ d: `path("${d}")` }) as CSSProperties; // CSS d so the time view morph can transition

function Coil({ st }: { st: St }) {
  const n = Math.min(8, st.count ?? 1);
  return (
    <div className="th-coil" data-i={st.i} style={{ left: st.x, top: st.y }}>
      <svg width="70" height="40" viewBox="-35 -20 70 40" style={{ position: "static" }}>
        {Array.from({ length: n }, (_, k) => (
          <ellipse key={k} cx={(k - (n - 1) / 2) * 7} cy="0" rx="9" ry="15" fill="none" stroke={color.slow} strokeWidth="1.4" opacity={0.35 + (k / Math.max(1, n - 1)) * 0.6} />
        ))}
      </svg>
    </div>
  );
}

const FORK_W = 140; // ponytail: "at the same time" is ~115px in 10px mono; measure if the copy changes

export const STATION_MIME = "application/x-shrike-station"; // O8: drag a station onto Ask

/** How long ago the trip started ("just now", "4m ago"). Own 1s clock subscription,
    so only this span re-renders each tick, not TripView or the Thread. */
function Ago({ ms }: { ms: number }) {
  const now = useNow();
  return (
    <time className="th-time" dateTime={new Date(ms).toISOString()} title={clockTime(ms)}>
      {relativeTime(ms, now)}
    </time>
  );
}

const EDGE = 8; // px kept clear of the stage edge (design-system space 2)

function Label({ st, below, width }: { st: St; below: boolean; width: number }) {
  const left = st.left;
  const coil = (st.count ?? 1) > 1;
  const off = st.kind === "express" ? 22 : coil ? 40 : 18; // clear of the coil's loops
  const x = st.x + (left ? -off : off);
  const room = Math.min(st.room - (off - 18), left ? x - EDGE : width - x - EDGE); // the layout's 160px floor can pass the stage edge: ellipsis there instead
  if (st.kind === "express")
    return (
      <div className="th-lab express" data-i={st.i} style={{ left: x, top: st.y, maxWidth: room }}>
        {st.label}
        <small>Enter to expand · {Math.round(st.ms)}ms</small>
      </div>
    );
  return (
    <div
      className={`th-lab${left ? " left" : below ? " below" : ""}${st.hot ? " hot" : ""}${st.post ? " post" : ""}${st.cache ? ` ${st.cache}` : ""}${st.live ? " live" : ""}`}
      data-i={st.i}
      style={{ left: x, top: st.y, ...(left ? { "--mw": `${room}px`, "--edge": `${x - EDGE}px` } : { maxWidth: room }) } as CSSProperties}
    >
      <span className="n">
        {st.label}
        {coil && <span className="x"> ×{st.count}</span>}
      </span>
      <small>{subLine(st)}</small>
      {st.chip && !coil && !st.post && !(below && !st.chipError) && !(st.chipError && st.status === "error" && !st.hot) && <span className={`th-chip${st.chipError ? " error" : ""}`} title={st.chip}>{st.chip}</span>}
    </div>
  );
}

async function saveTest(step: FlowStep): Promise<void> {
  const r = step.request!;
  const name = r.name ?? `${r.method} ${r.url.split("?")[0]} answers ${step.assert?.[0]?.value}`;
  const flow = await call((a) => a.saveFlow(name.slice(0, 120), [step]), "Couldn't save the test");
  if (flow) toast(`Saved "${flow.name}" as a test. Your flows replay it.`, "ok");
}

/** AP: Edit and resend on any trip that sent a request; Compare on a resend; Save as test once it answers well. */
function TripActions({ view }: { view: ActionView }) {
  const source = useActions((s) => (view.root.resendOf ? s.byId[view.root.resendOf] : undefined));
  const [open, setOpen] = useState(false);
  const can = useMemo(() => !!requestEvent(view), [view]);
  const step = useMemo(() => {
    const t = view.complete && view.status !== "error" ? testStep(view) : undefined;
    return t && Number(t.assert?.[0]?.value) < 400 ? t : undefined;
  }, [view]);
  const diff = useMemo(() => (open && source ? resendDiff(source, view) : []), [open, source, view]);
  const other = useActions((s) => otherSide(view, s)); // #62
  if (!can && !other) return null;
  const live = !!view.root.live;
  return (
    <>
      <span className="th-acts">
        {other && (
          <button type="button" className="th-act" onClick={() => useThread.getState().setCompare(live ? { local: other, live: view.id } : { local: view.id, live: other })} title={`Show this trip and the last ${live ? "local" : "live"} one side by side, with the first difference`}>
            {live ? "Compare with local" : "Compare with live"}
          </button>
        )}
        {can && source && (
          <button type="button" className="th-act" aria-pressed={open} onClick={() => setOpen((o) => !o)} title={`Compare with "${source.label}", the trip you edited`}>
            Compare
          </button>
        )}
        {can && step && (
          <button type="button" className="th-act" onClick={() => void saveTest(step)} title="Save this request and the status it answered as a test your flows replay">
            Save as test
          </button>
        )}
        {can && (
          <button type="button" className="th-act" onClick={() => editAndResend(view)} title="Open this request in the editor, change it and send it again">
            Edit and resend
          </button>
        )}
      </span>
      {open && diff.length > 0 && (
        <ul className="th-diff" aria-label="What changed since the trip you edited">
          {diff.map((d) => (
            <li key={d}>{d}</li>
          ))}
        </ul>
      )}
    </>
  );
}

export const TripView = memo(function TripView(p: Props) {
  const { view, trip, g, width, focused } = p;
  const root = useRef<HTMLElement>(null);
  const onPlayed = useRef(p.onPlayed);
  onPlayed.current = p.onPlayed;
  const gid = `th-${trip.actionId}`;
  const failed = trip.status === "error";
  const retColor = failed ? color.fail : trip.shape === "came_back_empty" ? color.slow : color.ok; // T6: an empty answer comes back amber
  const clue = failed ? firstFailure(trip) : -1;
  const snapAt = g.stations.findIndex((s) => s.snap);
  const stations: St[] = g.stations.map((s, i) => ({ ...s, i, hot: !!s.snap || i === clue, post: snapAt >= 0 && !isFinite(s.reach) }));
  const play = p.play;

  useLayoutEffect(() => {
    if (!play || !root.current) return;
    return playTrip(root.current, g, { knit: play.knit, failed, okColor: color.ok, failColor: color.fail }, () => onPlayed.current(play));
    // g is read once at the start: a relayout mid-play keeps the old reveal marks (harmless)
  }, [play?.token]);

  const probe = p.probe?.actionId === trip.actionId ? p.probe : null;
  const pst = probe ? stations[probe.station] : undefined;
  const found = probe?.found !== undefined ? stations[probe.found] : undefined;
  const focusSt = focused ? stations[p.station] : undefined;
  const x0 = Math.max(g.callerX, SHOT_W / 2 + EDGE); // a narrow stage puts SCREEN under 60px: keep its cards whole
  const verdict = failed ? "BROKE" : trip.status === "slow" ? "SLOW" : "WORKED";

  return (
    <section
      ref={root}
      className={`th-trip ${focused ? "focus" : "recede"}${p.pending ? " pending" : ""}${p.timeMode ? " time" : ""}`}
      style={{ height: g.height }}
      data-trip={trip.actionId}
      aria-label={trip.title}
    >
      <div className="th-head">
        <span className="t">{trip.title}</span>
        <span className={`th-verdict ${trip.status}`}>{verdict}</span>
        <span className="th-lbl">{trip.ms}ms</span>
        <Ago ms={view.startMs} />
        {view.root.resendOf && <span className="th-lbl">edited resend</span>}
        <TripActions view={view} />
      </div>
      <svg width={width} height={g.height}>
        <defs>
          <filter id={`${gid}-g`} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="4" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <linearGradient id={`${gid}-sp`} x1="0" x2="1">
            <stop offset="0" stopColor={color.violet} />
            <stop offset=".5" stopColor={color.blue} />
            <stop offset="1" stopColor={color.cyan} />
          </linearGradient>
        </defs>
        <path className="th-out" d={g.out} style={dPath(g.out)} fill="none" stroke={`url(#${gid}-sp)`} strokeWidth="2.4" strokeLinejoin="round" filter={`url(#${gid}-g)`} />
        <path
          className="th-ret"
          d={g.ret}
          style={dPath(g.ret)}
          fill="none"
          stroke={retColor}
          strokeWidth="1.8"
          strokeDasharray={failed ? "6 6" : undefined}
          opacity=".85"
          filter={`url(#${gid}-g)`}
        />
        {g.forks.map((f, k) => (
          <path key={k} className="th-fork" data-start={f.start} d={f.d} style={dPath(f.d)} fill="none" stroke={`url(#${gid}-sp)`} strokeWidth="2" strokeLinejoin="round" opacity=".9" filter={`url(#${gid}-g)`} />
        ))}
        <circle className="th-tip" r="4" fill={color.core} style={{ opacity: 0, filter: `drop-shadow(0 0 6px ${color.cyan})` }} />
      </svg>

      {p.timeMode && stations.length > 0 && (
        <>
          <div className="th-ruler" style={{ top: stations[0]!.y, height: g.endY - stations[0]!.y }} />
          {stations.filter((s) => !s.fork || s.fork.main).map((s) => (
            <span key={s.id} className="th-tick" style={{ top: s.y }}>
              {Math.round(s.ms)}ms
            </span>
          ))}
        </>
      )}

      {trip.caller.browser ? <BeforeShot view={view} x={x0} y={g.shotY} /> : <TerminalCard caller={trip.caller} x={x0} y={g.shotY} />}
      {g.forks.map((f) =>
        f.label ? (
          <span key={`f${f.id}`} className={`th-forklab${f.label.x > FORK_W ? " flip" : ""}`} data-i={stations.findIndex((x) => x.fork?.id === f.id && !x.fork.main)} style={{ left: f.label.x, top: f.label.y }} title={trip.forks.find((x) => x.id === f.id)?.caption}>
            at the same time
          </span>
        ) : null,
      )}
      <AfterShot trip={trip} x={x0} y={g.endY} />
      <div className="th-retlab th-after" style={{ left: x0 + 72, top: g.endY - 14, color: retColor }}>
        {trip.returned}
      </div>

      {stations.map((s) => ((s.count ?? 1) > 1 && s.kind !== "express" && s.status !== "ok" ? <Coil key={`c${s.id}`} st={s} /> : null))}
      {stations.map((s) => (
        <button
          key={s.id}
          data-i={s.i}
          data-lane={s.lane}
          className={`th-st${s.status === "slow" || (s.status === "error" && s.hot) ? ` ${s.status}` : ""}${s.kind === "express" ? " express" : ""}${s.cache ? ` ${s.cache}` : ""}${s.live ? " live" : ""}${s.post ? " post" : ""}${focusSt === s ? " focus" : ""}`}
          style={{ left: s.x, top: s.y }}
          aria-label={s.caption}
          title={s.caption}
          tabIndex={-1}
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData(STATION_MIME, JSON.stringify({ actionId: trip.actionId, station: s.i, label: s.label, file: s.file, line: s.line }));
            e.dataTransfer.setData("text/plain", s.file && s.line ? `${s.label} (${s.file}:${s.line})` : s.label);
            e.dataTransfer.effectAllowed = "copy";
          }}
          onClick={() => p.onStation(trip.actionId, s.i, s)}
        />
      ))}
      {stations.map((s) => (
        <Label key={`l${s.id}`} st={s} width={width} below={!(s.fork && !s.fork.main) && (stations[s.i - 1]?.x ?? 0) > s.x && stations[s.i - 1]?.y !== s.y} />
      ))}

      {focusSt && p.station > 0 && (
        // T21 your trail: dotted cyan through the stations you stepped past (the agent's route is violet)
        <svg className="th-trail" aria-hidden style={{ position: "absolute", left: 0, top: 0, overflow: "visible", pointerEvents: "none" }} width="1" height="1">
          <path
            d={stations.slice(0, p.station + 1).map((s, i) => `${i ? "L" : "M"}${s.x} ${s.y}`).join(" ")}
            fill="none"
            stroke="var(--c-cyan)"
            strokeWidth="1.6"
            strokeDasharray="1.5 6"
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity=".8"
            style={{ filter: "drop-shadow(0 0 3px var(--c-cyan))" }}
          />
          {stations.slice(0, p.station).map((s) => (
            <circle key={s.id} cx={s.x} cy={s.y} r="11" fill="none" stroke="var(--c-cyan)" strokeWidth="1" strokeDasharray="2 3" opacity=".45" />
          ))}
        </svg>
      )}
      {probe &&
        probe.ticks.map((i) =>
          stations[i] ? (
            <span key={`t${i}`} className={`th-ptick${stations[i]!.left ? " flip" : ""}`} style={{ left: stations[i]!.x, top: stations[i]!.y }}>
              ✓
            </span>
          ) : null,
        )}
      {found && (
        <div className={`th-found${found.left ? " flip" : ""}`} style={{ left: found.x, top: found.y }}>
          <i />
          <i />
          <i />
          <i />
        </div>
      )}
      {pst && <i className="th-probe" style={{ left: pst.x, top: pst.y }} />}
      {p.diff !== undefined && stations[p.diff] && (
        <div className="th-found th-first" style={{ left: stations[p.diff]!.x, top: stations[p.diff]!.y }} aria-hidden>
          <i />
          <i />
          <i />
          <i />
        </div>
      )}

      <TripDecor actionId={trip.actionId} stations={g.stations} width={width} />

      {focusSt && p.dived && focusSt.kind !== "express" && <DiveCard key={focusSt.id} view={view} st={focusSt} at={p.station} width={width} />}
    </section>
  );
});
