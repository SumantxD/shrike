import { useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight, ChevronUp, Copy, Save } from "lucide-react";
import type { ActionView, ApiSendResult } from "@shrike/schema";
import { CodeBlock, cx, Kbd, Pairs, Spinner } from "../components/ui.tsx";
import { ShrikeEmblem } from "../brand/index.ts";
import { allEvents, formatBytes, formatDuration, prettyBody, statusWords } from "../lib/format.ts";
import { useActions } from "../stores/actions.ts";
import { toast, useUi } from "../stores/ui.ts";
import { viewTrip } from "../hud/commands.ts";
import { cookiesOf, defaultResponseName, findMatches, pathOf, stepMatch, tryJson } from "./model.ts";
import { call } from "../lib/api.ts";
import { useApi } from "./store.ts";

// AP-res, AP-trip, AP-empty: what came back, and what the app did to answer.

type ResTab = "pretty" | "raw" | "headers" | "cookies" | "timeline" | "image";

const copy = (text: string, what: string) =>
  void navigator.clipboard.writeText(text).then(
    () => toast(`Copied ${what}`, "ok"),
    () => toast("Couldn't copy to the clipboard", "error"),
  );

const SHOW_MAX = 256 * 1024; // ponytail: a longer body shows its start, Copy takes all of it. Upgrade: a virtualised viewer.
const MAX_HIGHLIGHTS = 1000;

const tone = (code: number) => (code === 0 || code >= 500 ? "fail" : code >= 400 ? "slow" : "ok");

function Leaf({ v, hit }: { v: unknown; hit: boolean }) {
  const cls = typeof v === "string" ? "s" : typeof v === "number" ? "n" : typeof v === "boolean" || v === null ? "k" : "";
  return <span className={cx("ap-jv", cls, hit && "hit")}>{typeof v === "string" ? JSON.stringify(v) : String(v)}</span>;
}

function Node({ k, v, path, depth, needle }: { k?: string | number; v: unknown; path: (string | number)[]; depth: number; needle: string }) {
  const kids = v && typeof v === "object" ? (Array.isArray(v) ? v.map((x, i) => [i, x] as const) : Object.entries(v as Record<string, unknown>)) : null;
  const text = (x: unknown) => (typeof x === "object" && x !== null ? JSON.stringify(x) : String(x)).toLowerCase();
  const inside = !!needle && text(v).includes(needle);
  const [open, setOpen] = useState(depth < 3);
  const shown = open || inside;
  const keyHit = !!needle && k !== undefined && String(k).toLowerCase().includes(needle);
  const key =
    k === undefined ? null : (
      <button type="button" className={cx("ap-jk", keyHit && "hit")} title={`Copy ${pathOf(path)}`} onClick={() => copy(pathOf(path), pathOf(path))}>
        {typeof k === "number" ? k : JSON.stringify(k)}
        <span className="text-faint">: </span>
      </button>
    );
  if (!kids)
    return (
      <div className="ap-jrow" style={{ paddingLeft: depth * 14 + 14 }}>
        {key}
        <Leaf v={v} hit={!!needle && !keyHit && text(v).includes(needle)} />
      </div>
    );
  const [o, c] = Array.isArray(v) ? ["[", "]"] : ["{", "}"];
  return (
    <>
      <div className="ap-jrow" style={{ paddingLeft: depth * 14 }}>
        <button type="button" className="ap-jfold" aria-expanded={shown} aria-label={shown ? "Fold" : "Unfold"} onClick={() => setOpen(!shown)}>
          <ChevronRight size={10} className={cx("ap-chev", shown && "open")} />
        </button>
        {key}
        <span className="text-faint">
          {o}
          {!shown && ` ${kids.length} ${Array.isArray(v) ? (kids.length === 1 ? "item" : "items") : kids.length === 1 ? "key" : "keys"} ${c}`}
        </span>
      </div>
      {shown && kids.slice(0, 500).map(([ck, cv]) => <Node key={ck} k={ck} v={cv} path={[...path, ck]} depth={depth + 1} needle={needle} />)}
      {shown && kids.length > 500 && <div className="ap-jrow text-faint" style={{ paddingLeft: (depth + 1) * 14 + 14 }}>…and {kids.length - 500} more</div>}
      {shown && <div className="ap-jrow text-faint" style={{ paddingLeft: depth * 14 + 14 }}>{c}</div>}
    </>
  );
}

function Timeline({ result, view }: { result: ApiSendResult; view?: ActionView }) {
  const t = result.response?.timings;
  const net = t
    ? ([["Finding the host", t.dnsMs], ["Connecting", t.connectMs], ["Securing (TLS)", t.tlsMs], ["Waiting for the answer", t.ttfbMs], ["Downloading", t.downloadMs]] as const).filter(([, ms]) => ms !== undefined)
    : [];
  const events = view ? allEvents(view).filter((e) => e.kind !== "user_action") : [];
  const t0 = view?.startMs ?? 0;
  const total = Math.max(1, t?.totalMs ?? 0, view?.durationMs ?? 0, ...events.map((e) => e.startMs - t0 + (e.durationMs ?? 0)));
  let at = 0;
  const bar = (key: string, place: string, name: string, left: number, ms: number, tone?: string) => (
    <div key={key} role="listitem" className="ap-tl-row" title={`${name} · ${formatDuration(ms)}`}>
      <span className="ap-tl-place">{place}</span>
      <span className="ap-tl-name">{name}</span>
      <span className="ap-tl-track">
        <i className={tone} style={{ left: `${(left / total) * 100}%`, width: `${Math.max(0.6, Math.min((ms / total) * 100, 100 - (left / total) * 100))}%` }} />
      </span>
      <span className="ap-tl-ms">{formatDuration(ms)}</span>
    </div>
  );
  return (
    <div className="ap-tl" role="list" aria-label="Where the time went">
      {net.map(([name, ms]) => {
        const left = at;
        at += ms ?? 0;
        return bar(name, "network", name, left, ms ?? 0);
      })}
      {events.length > 0 && <p className="mt-3 mb-1 text-[11px] font-medium text-faint">What your app did</p>}
      {events.slice(0, 80).map((e) => bar(e.id, e.place?.name ?? e.kind.replace(/_/g, " "), e.name, e.startMs - t0, e.durationMs ?? 0, e.status === "error" ? "fail" : e.status === "slow" ? "slow" : undefined))}
      {!events.length && <p className="ap-hint">{result.actionId ? "Shrike saw the answer but nothing inside your app yet." : "This host isn't your app, so there's no trip inside it. Only the network timing shows."}</p>}
    </div>
  );
}

export function EmptyResponse() {
  return (
    <div className="ap-empty">
      <ShrikeEmblem size={44} sparkle={false} still className="ap-empty-mark" />
      <p>
        Press <Kbd>⌘</Kbd> <Kbd>↵</Kbd> to send. The answer shows here and as a trip on the Thread.
      </p>
      <button type="button" className="hud-btn solid" onClick={() => useApi.getState().newTab()}>
        New request
      </button>
    </div>
  );
}

export function ResponsePane({ tabId }: { tabId: string }) {
  const result: ApiSendResult | undefined = useApi((s) => s.results[tabId]);
  const sending = useApi((s) => !!s.sending[tabId]);
  const view = useActions((s) => (result?.actionId ? s.byId[result.actionId] : undefined));
  const [tab, setTab] = useState<ResTab>("pretty");
  const [needle, setNeedle] = useState("");
  const [matchIndex, setMatchIndex] = useState(0);
  const curMatchRef = useRef<HTMLElement | null>(null);
  const deferredNeedle = useDeferredValue(needle);
  const res = result?.response;
  const binary = res?.bodyEncoding === "base64";
  const json = useMemo(() => (binary ? undefined : tryJson(res?.body)), [res?.body, binary]);
  const long = !binary && !!res && res.body.length > SHOW_MAX;
  const shown = useMemo(() => (long ? res!.body.slice(0, SHOW_MAX) : (res?.body ?? "")), [res?.body, long]);
  const pretty = useMemo(() => (long || json !== undefined ? shown : prettyBody(shown)), [shown, long, json]);
  const ctype = res?.contentType ?? "";
  const image = binary && ctype.startsWith("image/");
  const cookies = cookiesOf(res?.headers ?? {});

  const isPrettyJson = tab === "pretty" && json !== undefined;
  const isRawText = tab === "raw" && !binary && !!res?.body;
  const isPrettyText = tab === "pretty" && json === undefined && !binary && !!res?.body;
  const isTextSearch = isRawText || isPrettyText;
  const showFind = isPrettyJson || isTextSearch;

  const displayText = isPrettyText ? pretty : shown;
  const lowerText = useMemo(() => displayText.toLowerCase(), [displayText]);
  const trimmedQuery = deferredNeedle.trim();
  const matches = useMemo(
    () => (isTextSearch && trimmedQuery ? findMatches(displayText, trimmedQuery, lowerText) : []),
    [isTextSearch, displayText, trimmedQuery, lowerText],
  );

  const safeIndex = matches.length > 0 ? Math.min(matchIndex, matches.length - 1) : 0;

  useEffect(() => {
    setMatchIndex(0);
  }, [tabId, tab, res?.body]);

  useEffect(() => {
    if (isTextSearch && matches.length > 0 && curMatchRef.current) {
      curMatchRef.current.scrollIntoView({ block: "nearest" });
    }
  }, [isTextSearch, safeIndex, trimmedQuery, matches.length]);

  const prevMatch = () => {
    if (matches.length > 0) {
      setMatchIndex((i) => stepMatch(i, matches.length, "prev"));
    }
  };

  const nextMatch = () => {
    if (matches.length > 0) {
      setMatchIndex((i) => stepMatch(i, matches.length, "next"));
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      if (needle) {
        e.stopPropagation();
        setNeedle("");
        setMatchIndex(0);
      }
      return;
    }
    if (e.key === "Enter" && isTextSearch) {
      e.preventDefault();
      if (e.shiftKey) {
        prevMatch();
      } else {
        nextMatch();
      }
    }
  };

  const countText = !trimmedQuery
    ? ""
    : matches.length === 0
      ? "No matches"
      : `${safeIndex + 1} of ${matches.length}`;

  const highlightedContent = useMemo(() => {
    if (!isTextSearch || !trimmedQuery || matches.length === 0) {
      return displayText;
    }
    const qLen = trimmedQuery.length;
    const half = Math.floor(MAX_HIGHLIGHTS / 2);
    let renderStart = Math.max(0, safeIndex - half);
    let renderEnd = renderStart + MAX_HIGHLIGHTS;
    if (renderEnd > matches.length) {
      renderEnd = matches.length;
      renderStart = Math.max(0, renderEnd - MAX_HIGHLIGHTS);
    }

    const nodes: ReactNode[] = [];
    let cursor = 0;

    for (let i = renderStart; i < renderEnd; i++) {
      const matchPos = matches[i]!;
      if (matchPos > cursor) {
        nodes.push(displayText.slice(cursor, matchPos));
      }
      const isCur = i === safeIndex;
      nodes.push(
        <mark
          key={matchPos}
          ref={isCur ? curMatchRef : undefined}
          className={cx("hit", isCur && "cur")}
        >
          {displayText.slice(matchPos, matchPos + qLen)}
        </mark>,
      );
      cursor = matchPos + qLen;
    }

    if (cursor < displayText.length) {
      nodes.push(displayText.slice(cursor));
    }

    return nodes;
  }, [isTextSearch, displayText, trimmedQuery, matches, safeIndex]);

  if (sending)
    return (
      <div className="ap-res ap-center">
        <Spinner size={16} />
        <p className="text-[12px] text-dim">Sending… the trip builds on the Thread as your app answers.</p>
      </div>
    );
  if (!result) return <div className="ap-res"><EmptyResponse /></div>;
  if (result.error)
    return (
      <div className="ap-res ap-center" role="alert">
        <span className="ap-pill fail">Didn't go through</span>
        <p className="max-w-[420px] text-center text-[12.5px] text-ink">{result.error}</p>
        <p className="max-w-[420px] text-center font-mono text-[11px] text-dim">{result.sent.method} {result.sent.url}</p>
      </div>
    );
  if (!res) return null;
  const passed = result.assertions.filter((a) => a.ok).length;

  // AP-res: Save writes the body to a file, text as it came back, binary as bytes. Cancelling shows no toast; a cut body says so in the toast.
  const save = async () => {
    const bytes = binary ? Uint8Array.from(atob(res.body), (c) => c.charCodeAt(0)) : new TextEncoder().encode(res.body);
    const path = await call((a) => a.apiSaveResponse(bytes, defaultResponseName(res.url, res.contentType)), "Couldn't save the body");
    if (path) {
      const file = path.split(/[\\/]/).pop() ?? "the body";
      toast(`Saved ${file}${res.truncated ? " (only what Shrike kept)" : ""}`, "ok");
    }
  };
  const tabs: { id: ResTab; label: string; n?: number }[] = [
    { id: "pretty", label: "Pretty" },
    { id: "raw", label: "Raw" },
    { id: "headers", label: "Headers", n: Object.keys(res.headers).length },
    { id: "cookies", label: "Cookies", n: cookies.length },
    { id: "timeline", label: "Timeline" },
    ...(image ? [{ id: "image" as const, label: "Image" }] : []),
  ];
  return (
    <div className="ap-res">
      <div className="ap-res-head">
        <span className={cx("ap-pill", tone(res.status))}>{statusWords(res.status)}</span>
        <span className="font-mono text-[11px] text-dim">{formatDuration(res.timings.totalMs)}</span>
        <span className="font-mono text-[11px] text-faint" title={res.truncated ? "Shrike kept the first part of a big body" : undefined}>
          {formatBytes(res.size)}
          {res.truncated ? " (cut)" : ""}
        </span>
        {res.redirects > 0 && <span className="font-mono text-[10.5px] text-faint" title={res.url}>{res.redirects} redirect{res.redirects > 1 ? "s" : ""}</span>}
        {result.assertions.length > 0 && (
          <span className={cx("font-mono text-[10.5px]", passed === result.assertions.length ? "text-ok" : "text-fail")}>
            {passed}/{result.assertions.length} checks passed
          </span>
        )}
        <div className="flex-1" />
        {result.actionId && (
          <button
            type="button"
            className="hud-btn solid"
            title="Jump to this request's trip on the Thread"
            onClick={() => {
              viewTrip(result.actionId!);
              useUi.setState({ sheet: null });
            }}
          >
            Show what the app did
          </button>
        )}
      </div>
      <div className="ap-subtabs">
        <div role="tablist" aria-label="Response" className="contents">
        {tabs.map((t) => (
          <button key={t.id} role="tab" type="button" aria-selected={tab === t.id} className={cx("ap-subtab", tab === t.id && "on")} onClick={() => { setTab(t.id); setMatchIndex(0); }}>
            {t.label}
            {!!t.n && <sup>{t.n}</sup>}
          </button>
        ))}
        </div>
        <div className="flex-1" />
        {showFind && (
          <div className="flex items-center gap-1">
            <input
              className="ap-find"
              value={needle}
              onChange={(e) => {
                setNeedle(e.target.value);
                setMatchIndex(0);
              }}
              onKeyDown={handleKeyDown}
              placeholder="Find"
              aria-label="Find in the response"
              spellCheck={false}
            />
            {isTextSearch && countText && (
              <span className="ap-find-count" aria-live="polite">
                {countText}
              </span>
            )}
            {isTextSearch && (
              <>
                <button
                  type="button"
                  className="ap-icon"
                  aria-label="Previous match"
                  title="Previous match (Shift+Enter)"
                  disabled={matches.length === 0}
                  onClick={prevMatch}
                >
                  <ChevronUp size={12} />
                </button>
                <button
                  type="button"
                  className="ap-icon"
                  aria-label="Next match"
                  title="Next match (Enter)"
                  disabled={matches.length === 0}
                  onClick={nextMatch}
                >
                  <ChevronDown size={12} />
                </button>
              </>
            )}
          </div>
        )}
        <button type="button" className="ap-icon" aria-label="Copy the response body" title="Copy the body" disabled={binary} onClick={() => copy(res.body, "the body")}>
          <Copy size={12} />
        </button>
        <button type="button" className="ap-icon" aria-label="Save the response body" title="Save the body" onClick={save}>
          <Save size={12} />
        </button>
      </div>
      <div role="tabpanel" className="ap-res-body">
        {(tab === "pretty" || tab === "raw") && binary && !image && <p className="ap-hint">A binary answer ({ctype || "no content type"}, {formatBytes(res.size)}). Nothing to show as text.</p>}
        {(tab === "pretty" || tab === "raw") && long && (json === undefined || tab === "raw") && <p className="ap-hint">Showing the first {formatBytes(SHOW_MAX)} here. Copy takes everything Shrike kept.</p>}
        {tab === "pretty" && !binary && (json !== undefined ? <div className="ap-json selectable"><Node v={json} path={[]} depth={0} needle={needle.trim().toLowerCase()} /></div> : res.body ? <CodeBlock className="border-0 bg-transparent p-0">{highlightedContent}</CodeBlock> : <p className="ap-hint">Empty body.</p>)}
        {tab === "raw" && !binary && (res.body ? <CodeBlock className="border-0 bg-transparent p-0">{highlightedContent}</CodeBlock> : <p className="ap-hint">Empty body.</p>)}
        {(tab === "pretty" || tab === "image") && image && <img className="ap-img" src={`data:${ctype};base64,${res.body}`} alt="The response image" />}
        {tab === "headers" && <Pairs data={res.headers} />}
        {tab === "cookies" &&
          (cookies.length ? (
            <table className="ap-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Value</th>
                  <th>Settings</th>
                </tr>
              </thead>
              <tbody>
                {cookies.map((c) => (
                  <tr key={c.name}>
                    <td>{c.name}</td>
                    <td className="break-all">{c.value}</td>
                    <td className="text-dim">{c.attrs}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="ap-hint">No cookies set by this response.</p>
          ))}
        {tab === "timeline" && <Timeline result={result} view={view} />}
      </div>
    </div>
  );
}
