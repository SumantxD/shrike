import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { ActionView } from "@shrike/schema";
import type { PlacedStation } from "../lib/thread-layout.ts";
import { CODE_FG, highlight, type Token } from "../lib/highlight.ts";
import { codeRange, codeTarget, copyAsCurl, hasRequest, inlineChips, resendSpec, stationEvents } from "./logic.ts";
import { toast, useUi } from "../stores/ui.ts";
import { useThread } from "../stores/thread.ts";
import { useProject } from "../stores/project.ts";

// T8: the focused station's code unfolds face-on from the station point.

export function openStation(view: ActionView, st: PlacedStation): void {
  const { event, parent } = stationEvents(view, st.stepIndex);
  const t = event && codeTarget(event, parent);
  if (t) useUi.getState().openFile({ path: t.file, line: t.live, error: t.error, actionId: view.id, stepIndex: st.stepIndex });
}

/** AP: open the captured request in the request editor; the send links back to this trip. */
export function editAndResend(view: ActionView, stepIndex?: number): void {
  const spec = resendSpec(view, stepIndex);
  if (!spec) return toast("This trip didn't send a request to resend.");
  useUi.getState().prefillExplorer({ ...spec, resendOf: view.id });
  useUi.setState({ sheet: "api", file: null });
}

/** Copy as cURL: the request a station sent, masked first on a live trip (logic.ts copyAsCurl). */
export async function copyCurl(view: ActionView, stepIndex: number): Promise<void> {
  const r = await copyAsCurl(view, stepIndex, useProject.getState().project?.redact?.keep, (text) => navigator.clipboard.writeText(text));
  toast(r.message, r.ok ? "ok" : "error");
}

export const DIVE_AT = 0.18; // Thread.tsx frames a dived station this far down the feed
export const CLEAR = 110; // px kept free at the bottom for the caption and key hints
export const LABEL_UP = 46; // a dived station sits at least this far under the lane header: its label reaches up

const COVERABLE = ".th-lab, .th-retlab, .th-shot, .th-forklab, .th-found";

type Rect = { left: number; top: number; right: number; bottom: number };

/** Thread text floating cards sit on fades out (`cls`) instead of peeking around their edges; no cards: all back. */
export function recede(scope: ParentNode | null | undefined, cards: readonly Rect[], cls: string): void {
  for (const el of scope?.querySelectorAll(COVERABLE) ?? []) {
    const r = el.getBoundingClientRect();
    const hit = cards.some((c) => r.right > c.left && r.left < c.right && r.bottom > c.top && r.top < c.bottom);
    if (el.classList.contains(cls) !== hit) el.classList.toggle(cls, hit);
  }
}

export function DiveCard({ view, st, at, width }: { view: ActionView; st: PlacedStation; at: number; width: number }) {
  const { event, parent, events } = useMemo(() => stationEvents(view, st.stepIndex), [view, st.stepIndex]);
  const target = useMemo(() => (event ? codeTarget(event, parent) : null), [event, parent]);
  const [code, setCode] = useState<{ lines: string[]; tokens?: Token[][] } | "missing" | null>(null);

  useEffect(() => {
    if (!target) return;
    let live = true;
    setCode(null);
    window.shrike
      .readFile(target.file)
      .then((text) => {
        if (!live) return;
        setCode({ lines: text.replace(/\r\n?/g, "\n").replace(/\t/g, "  ").split("\n") });
        return highlight(target.file, text).then((tokens) => live && setCode((c) => (c && c !== "missing" ? { ...c, tokens } : c)));
      })
      .catch(() => live && setCode("missing"));
    return () => { live = false; };
  }, [target]);

  const w = Math.min(640, Math.max(width * 0.72, Math.min(width - 28, 420))); // a narrow stage still fits the file name and keys
  const left = Math.max(14, Math.min(st.x - w * 0.35, width - w - 14));
  const card = useRef<HTMLDivElement>(null);
  const [top, setTop] = useState(st.y + 26);
  const [maxH, setMaxH] = useState<number>();
  useLayoutEffect(() => {
    const el = card.current;
    const trip = el?.parentElement;
    if (!el || !trip) return;
    const t = trip.getBoundingClientRect();
    const lab = trip.querySelector(`.th-lab[data-i="${at}"]`)?.getBoundingClientRect();
    const below = lab ? Math.round(lab.bottom - t.top + 10) : 0; // under the station's label and its value chip
    if (below > top) return setTop(below);
    const feed = trip.closest(".th-feed");
    const band = (feed?.parentElement?.querySelector(".th-lanehead") as HTMLElement | null)?.offsetHeight ?? 0;
    const m = feed ? Math.max(160, Math.round(feed.clientHeight - Math.max(feed.clientHeight * DIVE_AT, band + LABEL_UP) - (top - st.y) - CLEAR)) : undefined; // ends above the caption; the code scrolls
    if (m !== maxH) return setMaxH(m);
    const r = { left: t.left + el.offsetLeft, top: t.top + el.offsetTop, right: 0, bottom: 0 }; // offsets: the unfold animation scales the box
    recede(trip, [{ ...r, right: r.left + el.offsetWidth, bottom: r.top + el.offsetHeight }], "under");
  });
  useLayoutEffect(() => {
    const trip = card.current?.parentElement;
    return () => recede(trip, [], "under");
  }, []);
  useLayoutEffect(() => {
    const pre = card.current?.querySelector("pre");
    const live = pre?.querySelector<HTMLElement>(".th-ln.live");
    if (!pre || !live) return;
    const end = live.offsetTop - pre.offsetTop + live.offsetHeight + 12; // a short card scrolls the live line and its chips into view
    if (end > pre.scrollTop + pre.clientHeight) pre.scrollTop = end - pre.clientHeight;
  }, [code, maxH]);
  const style = { left, top, width: w, maxHeight: maxH, "--ox": `${st.x - left}px`, "--oy": `${st.y - top}px` } as CSSProperties;

  const range = target && code && code !== "missing" ? codeRange(code.lines, target) : null;
  const chips = range && event && target ? inlineChips(events, event, target.file, range.start, range.end) : null;

  return (
    <div ref={card} className="th-dive" style={style} role="region" aria-label={`Code for ${st.label}`}>
      <div className="head">
        <i className="dot" />
        <i className="dot" />
        <i className="dot" />
        <span className="f" title={target ? target.file : st.label}>{target ? target.file : st.label}</span>
        {target && (
          <button className="k" onClick={() => openStation(view, st)} title="Open the whole file here">
            Open file <kbd>E</kbd>
          </button>
        )}
        {hasRequest(event) && (
          <button className="k" onClick={() => editAndResend(view, st.stepIndex)} title="Open this request in the editor, change it and send it again">
            Edit and resend
          </button>
        )}
        {hasRequest(event) && (
          <button className="k" onClick={() => void copyCurl(view, st.stepIndex)} title="Copy this request as a curl command">
            Copy as cURL
          </button>
        )}
        <button className="k" onClick={() => useThread.getState().surface()}>
          Esc back
        </button>
      </div>
      {!target ? (
        <div className="none">No code to show for this step.</div>
      ) : code === "missing" ? (
        <div className="none">Couldn't read {target.file}.</div>
      ) : range && code ? (
        <pre>
          {code.lines.slice(range.start - 1, range.end).map((text, i) => {
            const n = range.start + i;
            const live = n === target.live;
            const toks = code.tokens?.[n - 1];
            return (
              <div key={n} className={`th-ln${live ? " live" : ""}${live && target.error ? " error" : ""}`}>
                <i>{n}</i>
                <span>{toks ? toks.map((t, k) => <span key={k} style={{ color: t.color }}>{t.content}</span>) : <span style={{ color: CODE_FG }}>{text}</span>}</span>
                {chips?.get(n) && (
                  <span className="inl">
                    {chips.get(n)!.map((c) => (
                      <span key={c.text} className={`th-chip${c.error ? " error" : ""}`}>{c.text}</span>
                    ))}
                  </span>
                )}
              </div>
            );
          })}
        </pre>
      ) : (
        <div className="none">Reading…</div>
      )}
      <div className="why">
        {st.caption}
      </div>
      {st.live && (
        <details className="th-see">
          <summary>See inside</summary>
          <p>Run the app on your computer to see inside its server: Shrike records each function and query there, and an OpenTelemetry SDK can send its traces to Shrike locally.</p>
          <p>Nothing is installed on your live server. Shrike's recorder only runs on your computer.</p>
        </details>
      )}
    </div>
  );
}
