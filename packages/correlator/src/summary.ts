import type { ActionView, DebugEvent, TimelineNode, WhatHappened, WhatHappenedStep } from "@shrike/schema";
import { findFlags } from "./flags.ts";
import {
  allEvents, callPath, calleeOf, errMsg, fmtMs, hasFailedFnWithMessage, httpStatus, isFailure, outsideName, refusalMessage, reqName,
  serviceName, targetName, topRequests, walk, withWord,
} from "./util.ts";

type View = Omit<ActionView, "summary" | "flags">;

const isWrite = (sql: string): boolean => /^\s*(insert|update|delete|replace|upsert|merge|create|alter|drop)\b/i.test(sql);

function replyStep(status: number, e: DebugEvent): WhatHappenedStep {
  const text = status >= 500 ? `Server returned an error (${status})` : status >= 400 ? `Server said no (${withWord(status)})` : `Server replied ${withWord(status)}`;
  return { ok: status < 400, text, eventId: e.id, ...(e.source ? { source: e.source } : {}) };
}

const step = (ok: boolean, text: string, e: DebugEvent, source = e.source): WhatHappenedStep => ({
  ok,
  text,
  eventId: e.id,
  ...(source ? { source } : {}),
});

function handlerOf(n: TimelineNode): DebugEvent | undefined {
  let found: DebugEvent | undefined;
  walk(n.children, (c) => {
    if (!found && c.event.kind === "function" && !c.event.framework) found = c.event;
  });
  return found;
}

function addSteps(n: TimelineNode, parent: TimelineNode | undefined, steps: WhatHappenedStep[], said: Set<string>): void {
  const e = n.event;
  const recurse = () => {
    for (const c of n.children) addSteps(c, n, steps, said);
  };
  if (e.kind === "http_request" && e.origin === "server") {
    const joined = parent?.event.kind === "http_request" || parent?.event.kind === "external_call";
    const who = serviceName(e) ?? "Server";
    steps.push(step(true, joined ? `${who} received it` : `${who} received ${reqName(e)}`, e, handlerOf(n)?.source ?? e.source));
    recurse();
    if (e.http?.status !== undefined) steps.push(replyStep(e.http.status, e));
    return;
  }
  if (e.kind === "http_request") {
    steps.push(step(true, `Browser sent ${reqName(e)}`, e));
    recurse();
    const hasServer = n.children.some((c) => c.event.kind === "http_request" && c.event.origin === "server");
    if (e.http?.status !== undefined) {
      if (!hasServer) steps.push(replyStep(e.http.status, e));
    } else if (e.status === "error" && !hasServer) {
      steps.push(step(false, `${reqName(e)} got no response`, e));
    }
    return;
  }
  if (e.kind === "external_call") {
    const callee = calleeOf(n);
    if (callee) {
      steps.push(step(true, `Called ${targetName(n)} (${callPath(e)})`, e));
      recurse();
      return;
    }
    steps.push(outsideStep(e));
    said.add(errMsg(e));
    return;
  }
  if (e.kind === "cache_op") {
    if (e.status === "error") steps.push(step(false, `The cache failed: ${errMsg(e) || e.name}`, e));
    else if (e.cache?.hit === true) steps.push(step(true, `The cache answered (hit): ${e.name}`, e));
    else if (e.cache?.hit === false) steps.push(step(true, `The cache had nothing (miss): ${e.name}`, e));
    return;
  }
  const msg = errMsg(e);
  if (e.kind === "function" && e.status === "error" && !hasFailedFnWithMessage(n.children, msg)) {
    steps.push(step(false, msg ? `${e.name} failed: ${msg}` : `${e.name} failed`, e, e.callSite ?? e.source)); // the line that called it, where the bad value went in
    said.add(msg);
  } else if (e.kind === "db_query" && e.status === "error") {
    const base = isWrite(e.db?.statement ?? e.name) ? "Database refused the change" : "Database query failed";
    steps.push(step(false, msg && !said.has(msg) ? `${base}: ${msg}` : base, e));
    said.add(msg);
  } else if (e.kind === "error" && !said.has(msg)) {
    steps.push(step(false, `${e.origin === "browser" ? "The page hit an error" : "The server hit an error"}: ${msg}`, e));
    said.add(msg);
  }
  recurse();
}

// One external_call to a host Shrike doesn't instrument.
function outsideText(e: DebugEvent): string {
  const who = outsideName(e);
  const status = e.http?.status;
  if (status === undefined) return e.status === "error" ? `${who} did not answer${errMsg(e) ? `: ${errMsg(e)}` : ""}` : `Called ${who} (${callPath(e)})`;
  if (status >= 500) return `${who} had an error (${status})`;
  if (status >= 400) {
    const why = refusalMessage(e);
    return `${who} refused${why ? `: ${why}` : ` (${withWord(status)})`}`;
  }
  return `${who} replied ${withWord(status)} (${callPath(e)})`;
}

const outsideStep = (e: DebugEvent): WhatHappenedStep => step(e.status !== "error", outsideText(e), e);

// A failed call to an outside host, when nothing instrumented sat behind it.
function outsideFailure(view: View): DebugEvent | undefined {
  let found: DebugEvent | undefined;
  walk(view.tree, (n) => {
    if (!found && n.event.kind === "external_call" && n.event.status === "error" && !calleeOf(n)) found = n.event;
  });
  return found;
}

function subject(view: View): string {
  const l = view.label.trim();
  const m = /^(Clicked|Submitted|Sent|Typed|Opened) (.+)$/.exec(l);
  let s = l;
  if (m && m[1] !== "Opened") s = `${view.trigger === "agent" ? "The agent" : "You"} ${m[1]!.toLowerCase()} ${m[2]}`;
  return /[.!?]$/.test(s) ? s : `${s}.`;
}

function outcome(view: View): string {
  const reqs: TimelineNode[] = [];
  walk(view.tree, (n) => {
    if (n.event.kind === "http_request") reqs.push(n);
  });
  const outside = outsideFailure(view);
  if (outside && (view.status === "error" || reqs.some((n) => (httpStatus(n) ?? 0) >= 400))) return `${outsideText(outside)}.`;
  const fiveHundred = reqs.map(httpStatus).find((s) => s !== undefined && s >= 500);
  if (fiveHundred !== undefined) return `The server returned an error (${fiveHundred}).`;
  const blocked = findFlags(view).find((f) => f.kind === "blocked_request");
  if (blocked) return blocked.message;
  const noResponse = reqs.find((n) => n.event.status === "error" && httpStatus(n) === undefined);
  if (noResponse) return `The call to ${reqName(noResponse.event)} got no response.`;
  const events = allEvents(view.tree);
  const err = events.find((e) => e.kind === "error");
  if (err) return `${err.origin === "browser" ? "The page" : "The server"} hit an error: ${errMsg(err)}.`;
  const flags = findFlags(view);
  const swallowed = flags.find((f) => f.kind === "swallowed_error");
  if (swallowed) return `It looked like it worked, but ${events.find((e) => e.id === swallowed.eventId)?.name ?? "something"} failed.`;
  const failed = anyFailure(view);
  if (failed) return `${failed.name} failed.`;
  const fourHundred = reqs.map(httpStatus).find((s) => s !== undefined && s >= 400);
  if (fourHundred !== undefined) return `The server said no (${withWord(fourHundred)}).`;
  if (!view.complete) return `Still running (${fmtMs(view.durationMs)} so far).`;
  const empty = flags.find((f) => f.kind === "empty_result" && f.message.includes(" 0 rows"));
  if (empty) return `It looked like it worked, but ${empty.message.split(". ")[0]}.`;
  if (view.status === "slow" || flags.some((f) => f.kind === "slow")) return `It worked, but it was slow (${fmtMs(view.durationMs)}).`;
  return `Everything worked (${fmtMs(view.durationMs)}).`;
}

const anyFailure = (view: View): DebugEvent | undefined => allEvents(view.tree).find(isFailure);

export function summarize(view: View): WhatHappened {
  const steps: WhatHappenedStep[] = [];
  const said = new Set<string>();
  for (const n of view.tree) addSteps(n, undefined, steps, said);
  const events = allEvents(view.tree);
  const files = new Set<string>();
  for (const e of [view.root, ...events]) {
    if (e.framework) continue;
    if (e.source?.file) files.add(e.source.file);
    if (e.callSite?.file && !e.callSite.file.includes("node_modules")) files.add(e.callSite.file);
  }
  const count = (k: DebugEvent["kind"]) => events.filter((e) => e.kind === k).length;
  return {
    headline: `${subject(view)} ${outcome(view)}`,
    steps,
    stats: {
      files: files.size,
      functions: events.filter((e) => e.kind === "function" && !e.framework).length,
      requests: topRequests(view.tree).length,
      queries: count("db_query"),
      logs: count("log"),
      errors: events.filter((e) => e.status === "error" || e.kind === "error").length,
      totalMs: Math.round(view.durationMs),
    },
  };
}
