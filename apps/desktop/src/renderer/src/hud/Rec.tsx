import { useEffect, useRef, useState } from "react";
import { cx } from "../components/ui.tsx";
import { toast, useUi } from "../stores/ui.ts";
import { useThread } from "../stores/thread.ts";
import { useActions } from "../stores/actions.ts";
import { previewClip, saveCard, startClip, stopClip, useRecording } from "../capture/recorder.ts";

/** REC: the focused trip as a 9:16 or 16:9 clip (M1 to M4, plus M8 if a fix follows), or as a card image (LV4). */
export function Rec() {
  const recording = useRecording();
  const actionId = useThread((s) => s.focus.actionId);
  const compare = useThread((s) => (s.view === "thread" ? s.compare : null)); // T23: the split records as one 16:9 clip
  const live = useActions((s) => !!compare || !!(actionId && s.byId[actionId]?.root.live)); // #52: a live trip leaves out the page unless shown
  const open = useUi((s) => s.recMenu);
  const [aspect, setAspect] = useState<"16:9" | "9:16">("9:16");
  const [captions, setCaptions] = useState(true);
  const [showPage, setShowPage] = useState(false);
  const [values, setValues] = useState(false); // LV4: a card shows shapes only until this is on
  const ref = useRef<HTMLDivElement>(null);
  const preview = useRef<HTMLCanvasElement>(null);
  const setOpen = (recMenu: boolean) => useUi.setState({ recMenu });
  const opts = { actionId: actionId ?? undefined, aspect: compare ? ("16:9" as const) : aspect, captions, compare, showPage: live && showPage };

  useEffect(() => {
    if (!open) return;
    setShowPage(false);
    setValues(false);
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [open]);

  useEffect(() => {
    if (open && (live || values) && preview.current) previewClip({ ...opts, card: values, values }, preview.current).catch(() => {});
  }, [open, live, showPage, values, aspect, captions, actionId, compare]);

  const start = async () => {
    setOpen(false);
    if (!actionId && !compare) return;
    try {
      await startClip(opts);
    } catch (e) {
      toast(`Couldn't record: ${e instanceof Error ? e.message : String(e)}`, "error");
    }
  };

  const card = async () => {
    setOpen(false);
    try {
      const { path, copied } = await saveCard({ ...opts, values });
      if (path || copied) toast(path ? `Card saved to ${path}${copied ? " and copied. Paste it anywhere." : "."}` : "Card copied. Paste it anywhere.", "ok");
    } catch (e) {
      toast(`Couldn't make the card: ${e instanceof Error ? e.message : String(e)}`, "error");
    }
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        className={cx("btn", recording && "on")}
        style={recording ? { borderColor: "var(--fail)", color: "var(--fail)" } : undefined}
        aria-pressed={recording}
        aria-haspopup={!recording}
        disabled={!recording && !actionId && !compare}
        title={recording ? "Stop recording" : "Record this trip as a clip (R)"}
        onClick={() => (recording ? stopClip() : setOpen(!open))}
      >
        <i className={cx("size-[7px] rounded-full", recording ? "bg-fail shadow-[0_0_8px_var(--fail)]" : "border border-fail")} aria-hidden />
        {recording ? "Stop" : "Rec"}
      </button>
      {open && !recording && (
        // z-[47]: drops over the SDLC rail (z-40) and the right dock (z-[45])
        <div className="glass solid rise absolute top-10 right-0 z-[47] w-[232px] rounded-[var(--r-card)] p-3" role="dialog" aria-label="Record a clip">
          <p className="lbl mb-2.5">Clip shape</p>
          <div className="mb-3 grid grid-cols-2 gap-1.5">
            {(["9:16", "16:9"] as const).map((a) => (
              <button key={a} type="button" aria-pressed={(compare ? "16:9" : aspect) === a} disabled={!!compare && a === "9:16"} onClick={() => setAspect(a)} className="btn justify-center">
                <span className={cx("inline-block border border-current", a === "16:9" ? "h-[8px] w-[14px]" : "h-[14px] w-[8px]")} aria-hidden />
                {a}
              </button>
            ))}
          </div>
          <label className="mb-3 flex items-center gap-2 text-[12.5px] text-dim">
            <input type="checkbox" checked={captions} onChange={(e) => setCaptions(e.target.checked)} className="accent-[var(--signal)]" />
            Captions
          </label>
          {(live || values) && <canvas ref={preview} className="mx-auto mb-2 block max-h-[200px] max-w-full rounded-[var(--r-control)] border border-hair" aria-label={values ? "Preview of the card" : "Preview of the clip"} />}
          {live && (
            <label className="mb-3 flex items-center gap-2 text-[12.5px] text-dim">
              <input type="checkbox" checked={showPage} onChange={(e) => setShowPage(e.target.checked)} className="accent-[var(--signal)]" />
              Show the page
            </label>
          )}
          <label className="mb-3 flex items-center gap-2 text-[12.5px] text-dim">
            <input type="checkbox" checked={values} onChange={(e) => setValues(e.target.checked)} className="accent-[var(--signal)]" />
            Show values on the card
          </label>
          <button type="button" className="btn go w-full justify-center" onClick={() => void start()}>
            <i className="size-[7px] rounded-full bg-fail" aria-hidden />
            {compare ? "Record both trips" : "Record trip"}
          </button>
          <button type="button" className="btn mt-1.5 w-full justify-center" title="Save one image of this trip (1200×630, or 1080×1350 for 9:16) and copy it" onClick={() => void card()}>
            Save card
          </button>
          <p className="mt-2 text-[11.5px] leading-snug text-faint">{live ? `${compare ? "Plays local and live side by side" : "Plays the trip from the start"}. Live values are hidden${showPage ? "" : ", and so is your live page"}. Then asks where to save.` : "Plays the trip from the start, then asks where to save."}</p>
        </div>
      )}
    </div>
  );
}
