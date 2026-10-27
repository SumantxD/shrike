import { useEffect, useMemo, useState } from "react";
import { Flag, GitBranch, Route, X } from "lucide-react";
import type { Quest, QuestObjective } from "@shrike/schema";
import { api } from "../lib/api.ts";
import { useAgent } from "../stores/agent.ts";
import { useUi } from "../stores/ui.ts";
import { cx, Spinner } from "../components/ui.tsx";
import { Elapsed } from "../components/Activity.tsx";
import { SystemFrame, SystemTag, useCalm } from "../system/System.tsx";
import { focusedQuest, ideaPreview, lookOf, nextObjective, progressOf } from "./logic.ts";
import { useQuests, useQuestsBridge } from "./store.ts";
import { liveSession, useOptions } from "../options/store.ts";
import "./quests.css";

// QB-board: one quest glows, the rest are slivers. Q or the top bar's flag opens it; Esc closes.

const typing = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

export function QuestLayer() {
  useQuestsBridge();
  const open = useQuests((s) => s.open);
  const asking = useOptions((s) => !!liveSession(s)); // the option cards are the one focal point; the board waits behind them
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || liveSession(useOptions.getState())) return;
      const other = (document.activeElement as HTMLElement | null)?.closest?.('[role="dialog"]:not([aria-label="Quest board"]), [role="menu"]'); // another dialog's Esc is its own
      if (e.key === "Escape" && useQuests.getState().open && !other) return void (e.stopPropagation(), useQuests.getState().setOpen(false));
      if (!typing(e.target) && !useUi.getState().help && (e.key === "q" || e.key === "Q")) (e.preventDefault(), useQuests.getState().setOpen(!useQuests.getState().open));
    };
    window.addEventListener("keydown", on, true);
    return () => window.removeEventListener("keydown", on, true);
  }, []);
  return open && !asking ? <QuestBoard /> : null;
}

export function QuestBoard() {
  const list = useQuests((s) => s.list);
  const pick = useQuests((s) => s.pick);
  const q = focusedQuest(list, pick);
  const others = list.filter((x) => x.id !== q?.id && x.state !== "dropped").sort((a, b) => b.createdAt - a.createdAt);
  const close = () => useQuests.getState().setOpen(false);
  return (
    <div className="qb-scrim absolute inset-0 z-[46] overflow-y-auto" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div role="dialog" aria-label="Quest board" className="mx-auto flex max-w-[860px] flex-wrap items-start justify-center gap-5 px-4 pt-14 pb-8">
        <div className="w-[min(560px,100%)]">{q ? <QuestCard key={q.id} q={q} /> : <Empty />}</div>
        <aside aria-label="Your quests" className="glass solid flex w-[240px] flex-col gap-2 rounded-[var(--r-card)] p-3">
          <header className="flex items-center gap-2">
            <span className="lbl">Quests</span>
            <span className="micro text-[9.5px] text-faint">{list.filter((x) => x.state !== "dropped").length}</span>
            <button type="button" aria-label="Close the quest board" onClick={close} className="ml-auto inline-flex size-6 items-center justify-center rounded text-dim hover:text-ink">
              <X size={13} />
            </button>
          </header>
          {others.map((o) => (
            <Sliver key={o.id} q={o} />
          ))}
          <NewQuest />
        </aside>
      </div>
    </div>
  );
}

function Empty() {
  return (
    <SystemFrame label="No quest yet" live={false} pad="px-5 pt-3 pb-4">
      <SystemTag>Quest</SystemTag>
      <p className="sys-title m-0 mt-3 text-[16px]">What do you want to build?</p>
      <p className="sys-line m-0 mt-1">Write the idea on the right, or type "Plan this: …" to your agent. It splits it into a few objectives, and each one is checked off when its flow passes.</p>
    </SystemFrame>
  );
}

function Sliver({ q }: { q: Quest }) {
  const p = progressOf(q);
  return (
    <button type="button" className="qb-sliver" data-state={q.state} title={q.title} aria-label={`Focus quest: ${q.title}`} onClick={() => void useQuests.getState().focus(q.id)}>
      <i aria-hidden />
      <span className="min-w-0 flex-1 truncate text-[12.5px]">{q.title}</span>
      <span className="font-mono text-[10px] text-faint">{q.state === "planning" ? "plan" : `${p.done}/${p.total}`}</span>
    </button>
  );
}

function QuestCard({ q }: { q: Quest }) {
  const calm = useCalm();
  const p = progressOf(q);
  const complete = q.state === "complete";
  const busy = useAgent((s) => s.run?.status === "running");
  const approval = useAgent((s) => s.approvals.find((a) => a.quest === q.id));
  const [menu, setMenu] = useState(false);
  return (
    <SystemFrame calm={calm} label={`${complete ? "Quest complete" : "Quest"}: ${q.title}`} live={false} pad="px-5 pt-3 pb-4" className="w-full">
      <SystemTag>{complete ? "Quest complete" : "Quest"}</SystemTag>
      <div className="mt-3 flex items-baseline gap-3">
        <b className="sys-title min-w-0 flex-1 text-[18px]" title={q.title}>
          {q.title}
        </b>
        {p.total > 0 && <span className="shrink-0 font-mono text-[11px] tracking-[0.08em] text-dim">{p.done}/{p.total}</span>}
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-2">
        {q.issue && (
          <button type="button" className="qb-chip hover:text-ink" title="Open it on GitHub" onClick={() => void api().openLink(q.issue!.url).catch(() => {})}>
            #{q.issue.number}
          </button>
        )}
        <span className={cx("micro text-[9.5px]", complete ? "text-ok" : q.state === "planning" ? "text-violet" : "text-signal")}>{complete ? "Every objective passes" : q.state === "planning" ? "Planning" : "Under way"}</span>
      </div>
      {ideaPreview(q) && <p className="m-0 mt-2 line-clamp-2 text-[12.5px] leading-snug text-dim">{ideaPreview(q)}</p>}
      {p.total > 0 && <div className="sys-bar mt-2.5" aria-hidden><i style={{ width: `${(p.done / p.total) * 100}%`, ...(complete ? { background: "var(--ok)" } : {}) }} /></div>}

      {q.state === "planning" && !q.waiting && (
        <p className="m-0 mt-4 flex items-center gap-2 text-[13px] text-dim">
          <span className="text-violet" aria-hidden>✦</span>
          {busy ? (
            <>
              Your agent is planning this · <Elapsed />
            </>
          ) : (
            <>
              Your agent isn't planning it right now.
              <button type="button" className="btn go ml-auto" onClick={() => useQuests.getState().replan(q)}>
                Plan it
              </button>
            </>
          )}
        </p>
      )}
      {q.state === "planning" && q.waiting && <p className="m-0 mt-4 text-[13px] text-ink">Your agent's plan. Start it, or say no and it plans again.</p>}

      {q.objectives.length > 0 && (
        <ol aria-label="Objectives" className="m-0 mt-4 p-0">
          {q.objectives.map((o) => (
            <Objective key={o.id} q={q} o={o} />
          ))}
        </ol>
      )}

      {q.state === "planning" && q.waiting && (
        <div className="mt-1 flex gap-2">
          <button type="button" className="btn go" disabled={!approval} onClick={() => approval && void useAgent.getState().answer(approval.id, true)}>
            Start this quest
          </button>
          <button type="button" className="btn" disabled={!approval} onClick={() => approval && void useAgent.getState().answer(approval.id, false)}>
            Not this
          </button>
        </div>
      )}

      {approval && !q.waiting && (
        <section aria-label="Allow this?" className="mt-3 rounded-[8px] border border-[color-mix(in_srgb,var(--violet)_55%,transparent)] p-3">
          <p className="m-0 text-[13px] text-ink">{approval.title}</p>
          <p className="m-0 mt-1 max-h-[160px] overflow-y-auto font-mono text-[11px] whitespace-pre-wrap text-dim">{approval.reason}</p>
          <div className="mt-2 flex gap-2">
            <button type="button" className="btn go" onClick={() => void useAgent.getState().answer(approval.id, true)}>
              Allow
            </button>
            <button type="button" className="btn" onClick={() => void useAgent.getState().answer(approval.id, false)}>
              Not now
            </button>
          </div>
        </section>
      )}

      <footer className="relative mt-3 flex items-center gap-2">
        {complete && <span className="text-[12.5px] text-ok">Every objective's flow passed.</span>}
        <button type="button" className="hud-btn ml-auto" aria-expanded={menu} onClick={() => setMenu((m) => !m)}>
          More
        </button>
        {menu && (
          <div role="menu" className="glass solid absolute right-0 bottom-8 z-10 flex min-w-[200px] flex-col rounded-[8px] p-1">
            {!q.issue && q.state !== "planning" && (
              <button type="button" role="menuitem" className="rounded px-3 py-1.5 text-left text-[12.5px] text-ink hover:bg-glass" onClick={() => (setMenu(false), void useQuests.getState().act(q.id, { kind: "open-issue" }))}>
                Open as GitHub issue
              </button>
            )}
            {!complete && (
              <button type="button" role="menuitem" className="rounded px-3 py-1.5 text-left text-[12.5px] text-[var(--fail-ink)] hover:bg-glass" onClick={() => (setMenu(false), void useQuests.getState().act(q.id, { kind: "drop" }))}>
                Drop this quest
              </button>
            )}
          </div>
        )}
      </footer>
    </SystemFrame>
  );
}

const LOOK_WORD = { ghost: "Not yet", next: "Next", passed: "Passed", failed: "Broke", dropped: "Dropped" } as const;

function Objective({ q, o }: { q: Quest; o: QuestObjective }) {
  const look = lookOf(q, o);
  const flows = useUi((s) => s.flows);
  const flow = flows.find((f) => f.id === o.flowId);
  const next = nextObjective(q)?.id === o.id;
  const [busy, setBusy] = useState(false);
  const linkable = useMemo(() => flows.filter((f) => f.id !== o.flowId), [flows, o.flowId]);
  const check = async () => {
    setBusy(true);
    await useQuests.getState().act(q.id, { kind: "check", objective: o.id });
    setBusy(false);
  };
  return (
    <li className="qb-obj" data-look={look} data-objective={o.id} aria-label={`${LOOK_WORD[look]}: ${o.text}`}>
      <span className="qb-node" aria-hidden />
      <p className="qb-text m-0 text-[13.5px] leading-snug">
        {o.text}
        {look === "passed" && <span className="ml-1.5 text-ok" aria-hidden>✓</span>}
      </p>
      <p className="m-0 mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] text-dim">
        <span className="micro text-[9px] text-faint">Done when</span>
        <span>{o.doneWhen}</span>
        {flow ? (
          <span className="qb-chip" title="The flow that proves it">
            <Route size={10} aria-hidden /> <span className="truncate">{flow.name}</span>
          </span>
        ) : (
          q.state !== "planning" && <span className="text-faint">No flow yet</span>
        )}
      </p>
      {look === "failed" && <p className="m-0 mt-1 text-[11.5px] text-[var(--fail-ink)]">Broke on the last run.</p>}
      {(o.sentAt || o.workspace) && look !== "passed" && (
        <p className="m-0 mt-1 text-[11px] text-faint">{o.workspace ? `Being built in the ${o.workspace} workspace.` : "On your agent's up next."}</p>
      )}
      {next && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {flow && (
            <button type="button" className="btn go h-7" disabled={busy} onClick={() => void check()}>
              {busy && <Spinner size={10} />} Check it
            </button>
          )}
          <button type="button" className="btn h-7" onClick={() => void useQuests.getState().send(q, o)} title="Put this objective on your agent's up next">
            Send to agent
          </button>
          <button type="button" className="btn h-7" onClick={() => void useQuests.getState().toWorkspace(q, o)} title="Build it in its own copy of your code">
            <GitBranch size={11} aria-hidden /> New workspace
          </button>
          {linkable.length > 0 && (
            <select
              aria-label="Link a flow"
              className="field h-7 max-w-[160px] text-[11px]"
              value=""
              onChange={(e) => e.target.value && void useQuests.getState().act(q.id, { kind: "link", objective: o.id, flowId: e.target.value })}
            >
              <option value="">{flow ? "Use another flow…" : "Link a flow…"}</option>
              {linkable.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          )}
          {!flow && (
            <button type="button" className="hud-btn" onClick={() => useQuests.getState().record(q, o)}>
              Ask to record one
            </button>
          )}
        </div>
      )}
    </li>
  );
}

function NewQuest() {
  const [idea, setIdea] = useState("");
  const [from, setFrom] = useState(false);
  const [find, setFind] = useState("");
  const issues = useQuests((s) => s.issues);
  const err = useQuests((s) => s.issuesError);
  const shown = (issues ?? []).filter((i) => !find.trim() || `#${i.number} ${i.title}`.toLowerCase().includes(find.trim().toLowerCase()));
  const plan = () => {
    const t = idea.trim();
    if (!t) return;
    setIdea("");
    void useQuests.getState().plan(t);
  };
  return (
    <section aria-label="New quest" className="mt-2 flex flex-col gap-1.5 border-t border-hair pt-3">
      <span className="micro text-[9.5px] text-faint">New quest</span>
      <form
        className="flex gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          plan();
        }}
      >
        <input className="field min-w-0 flex-1" aria-label="What do you want to build?" placeholder="Your idea" value={idea} onChange={(e) => setIdea(e.target.value)} />
        <button type="submit" className="btn h-7 px-2" disabled={!idea.trim()}>
          <Flag size={11} aria-hidden /> Plan it
        </button>
      </form>
      <button
        type="button"
        className="hud-btn self-start px-0"
        aria-expanded={from}
        onClick={() => {
          setFrom(!from);
          if (!from && !issues) void useQuests.getState().loadIssues();
        }}
      >
        From a GitHub issue
      </button>
      {from && (
        <div className="flex flex-col gap-1">
          <input className="field" aria-label="Find an issue" placeholder="Find an issue" value={find} onChange={(e) => setFind(e.target.value)} />
          {!issues && !err && (
            <span className="flex items-center gap-1.5 text-[11.5px] text-dim">
              <Spinner size={10} /> Reading your open issues
            </span>
          )}
          {err && <span className="text-[11.5px] text-[var(--fail-ink)]">{err}</span>}
          {issues && !err && !shown.length && <span className="text-[11.5px] text-dim">No open issues{find.trim() ? " match that" : ""}.</span>}
          <ul role="listbox" aria-label="Open issues" className="m-0 flex max-h-[260px] flex-col overflow-y-auto rounded-[6px] border border-hair p-0">
            {shown.map((i) => (
              <li key={i.number} role="option" aria-selected={false} className="list-none">
                <button type="button" className="flex w-full flex-col gap-0.5 px-2.5 py-1.5 text-left hover:bg-glass" onClick={() => void useQuests.getState().importIssue(i.number)}>
                  <span className="text-[12px] text-ink">
                    <span className="mr-1.5 font-mono text-[10.5px] text-faint">#{i.number}</span>
                    {i.title.replace(/`/g, "")}
                  </span>
                  {i.labels.length > 0 && <span className="truncate font-mono text-[9.5px] text-faint">{i.labels.slice(0, 3).join(" · ")}</span>}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
