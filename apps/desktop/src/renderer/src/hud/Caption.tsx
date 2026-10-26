import { useMemo } from "react";
import { useActions } from "../stores/actions.ts";
import { useProject } from "../stores/project.ts";
import { useRun } from "../stores/run.ts";
import { firstFailure, tripFor, useThread } from "../stores/thread.ts";
import { useUi } from "../stores/ui.ts";
import { cx } from "../components/ui.tsx";

/** The focused station's caption, bottom of the feed, with "trip · n/N" on the right and the key hints above it (in the flow, so a long caption pushes them up instead of running under them). */
export function Caption() {
  const focus = useThread((s) => s.focus);
  const expanded = useThread((s) => s.expanded);
  const view = useActions((s) => (focus.actionId ? s.byId[focus.actionId] : undefined));
  const trip = useMemo(() => (focus.actionId && view ? tripFor(focus.actionId) : undefined), [focus.actionId, view, expanded]);
  const agent = useUi((s) => s.agentCaption);
  const keysUsed = useUi((s) => s.keysUsed);
  const running = useRun((s) => s.status.state === "running");
  const page = useProject((s) => !s.project || !!s.project.appUrl);
  const st = trip?.stations[focus.station];
  const files = useThread((s) => s.view === "files"); // FV: the caption sits above the step scrubber

  const text = agent ?? st?.caption ?? (!trip ? "" : page
    ? running ? "Click something in your app. Its trip through your code shows up here." : "Run your app, then click something in it."
    : running ? "Send a request from the API explorer or curl. Its trip through your code shows up here." : "Run your app, then send it a request.");
  const failed = !agent && st?.status === "error" && (!!st.snap || focus.station === firstFailure(trip!)); // red only where it broke

  return (
    <div
      data-caption
      className="@container pointer-events-none! absolute inset-x-0 bottom-0 z-[7] flex items-end gap-3 pt-[34px] pr-[18px] pb-[14px] pl-[18px] transition-opacity"
      style={{ background: "linear-gradient(0deg, var(--void) calc(100% - 34px), transparent)", ...(files ? { bottom: 58 } : {}) }}
    >
      <p
        aria-live="polite"
        title={text}
        className={cx("m-0 line-clamp-3 min-w-0 max-w-[64ch] flex-1 font-display text-[18px] leading-[1.35] font-medium", agent ? "text-ink" : failed ? "text-[var(--fail-ink)]" : st ? "text-ink" : "text-dim")}
        style={{ textWrap: "balance" }}
      >
        {agent && <span className="mr-2 text-violet">✦</span>}
        {text}
      </p>
      {trip && (
        <span className="ml-auto flex max-w-[45%] shrink-0 flex-col items-end gap-2">
          {!keysUsed && (
            <span className="hidden justify-items-end gap-[3px] font-mono text-[10px] tracking-[0.1em] text-faint @[640px]:grid" aria-hidden>
              <span>
                <b className="font-medium text-dim">{files ? "← →" : "↑↓"}</b> step · <b className="font-medium text-dim">Enter</b> dive · <b className="font-medium text-dim">Esc</b> surface
              </span>
              <span>
                <b className="font-medium text-dim">T</b> time · <b className="font-medium text-dim">!</b> next failure · <b className="font-medium text-dim">Space</b> {files ? "play" : "replay"} · <b className="font-medium text-dim">V</b> {files ? "thread" : "files"} · <b className="font-medium text-dim">?</b> keys
              </span>
            </span>
          )}
          <span className="flex max-w-full whitespace-nowrap font-mono text-[11px] text-faint" title={trip.title}>
            <span className="min-w-0 truncate">{trip.title}</span>
            <span className="shrink-0">&nbsp;· {focus.station + 1}/{trip.stations.length}</span>
          </span>
        </span>
      )}
    </div>
  );
}
