import { create } from "zustand";
import type { ActionView, ApiCodeLang, ApiCollection, ApiHistoryEntry, ApiImportKind, ApiKv, ApiSendResult, ApiTreeNode, Route, RouteDoc, RouteGuess, RoutesView } from "@shrike/schema";
import { api, errorMessage } from "../lib/api.ts";
import { allEvents } from "../lib/format.ts";
import { useActions } from "../stores/actions.ts";
import { useProject } from "../stores/project.ts";
import { useRun } from "../stores/run.ts";
import { toast, useUi } from "../stores/ui.ts";
import { useDock } from "../dock/store.ts";
import { blankReq, fromApi, fromRoute, hiddenSecret, looksLikeCurl, makeScope, nameFor, paramsFromUrl, row, sameReq, scrubReq, toApi, uid, type Captured, type Req, type Scope } from "./model.ts";
import { reqFromDoc } from "./routes.ts";

// AP: tabs, environments and sends over main's API (main/api: Bruno-format collections in .shrike/api/ and linked folders,
// secrets in the keychain, history). Only the open tabs and the chosen environment live here, per project, in this profile.

export interface Tab {
  id: string;
  colId?: string; // the collection the request is saved in
  draft: Req;
  base: Req; // as opened or saved: the dirty dot compares against it
  resendOf?: string; // AP16: the trip this edits
}

interface Local {
  tabs: Tab[];
  active: string | null;
  envByCol: Record<string, string | null>;
}

interface ApiState extends Local {
  root: string | null;
  collections: ApiCollection[];
  envVars: Record<string, ApiKv[]>; // `${colId}/${env}`
  runtime: Record<string, Scope>; // set from responses, per collection, this session
  results: Record<string, ApiSendResult>;
  sending: Record<string, string>; // tab id -> send id
  history: ApiHistoryEntry[];
  dialog: null | "env" | "import" | "code";
  view: "requests" | "routes"; // AP20
  routes: RoutesView | null;
  guessing: boolean; // AP22: the agent is reading handlers
  guesses: RouteGuess[]; // waiting for Accept or Skip
  loadRoutes(refresh?: boolean): Promise<void>;
  guess(routes: RouteDoc[]): Promise<void>;
  acceptGuess(g: RouteGuess): Promise<void>;
  skipGuess(g: RouteGuess): void;
  saveTest(req: Req, folder: string): Promise<void>;
  load(root: string | null): void;
  refresh(): Promise<void>;
  open(req: Req, o?: { colId?: string; resendOf?: string }): string;
  openItem(colId: string, path: string): Promise<void>;
  newTab(): void;
  close(tabId: string): void;
  focus(tabId: string): void;
  edit(tabId: string, fn: (r: Req) => Req): void;
  save(tabId: string, folder?: string): Promise<void>;
  send(tabId: string): Promise<void>;
  cancel(tabId: string): void;
  setEnv(colId: string, name: string | null): Promise<void>;
  createFolder(colId: string, path: string): Promise<void>;
  rename(colId: string, path: string, name: string): Promise<void>;
  remove(colId: string, path: string, label: string): Promise<void>;
  clearHistory(): Promise<void>;
  duplicate(colId: string, path: string): Promise<void>;
  move(colId: string, path: string, toCol: string, toFolder: string): Promise<void>;
  reorder(colId: string, path: string, beforePath: string): Promise<void>;
  importAny(kind: ApiImportKind, text?: string, name?: string): Promise<boolean>;
  link(): Promise<void>;
  code(tabId: string, lang: ApiCodeLang): Promise<string>;
}

const EMPTY: Local = { tabs: [], active: null, envByCol: {} };
const key = (root: string) => `shrike.api:${root}`;
const envKey = (colId: string, env: string) => `${colId}/${env}`;
const dirOf = (path: string) => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");

function read(root: string): Local {
  try {
    const v = JSON.parse(localStorage.getItem(key(root)) ?? "null") as Partial<Local> | null;
    if (!v || !Array.isArray(v.tabs)) return EMPTY;
    return { ...EMPTY, ...v, tabs: v.tabs.filter((t) => t?.draft && t.base) };
  } catch {
    return EMPTY;
  }
}

/** What runs a call through main and turns a thrown error into a toast. */
async function ask<T>(fn: () => Promise<T>, what: string): Promise<T | undefined> {
  try {
    return await fn();
  } catch (e) {
    toast(`${what}: ${errorMessage(e)}`, "error");
    return undefined;
  }
}

/** The app's address: relative URLs ("/api/todos") go there. */
export function appAddress(): string | undefined {
  const st = useRun.getState().status;
  return st.processes?.find((p) => p.url && p.name !== "web")?.url ?? st.url ?? useProject.getState().project?.appUrl;
}

/** The collection a tab sends with: its own, else the first one (for the environment picker and inherited auth). */
export function colFor(s: Pick<ApiState, "collections" | "tabs" | "active">, tabId?: string | null): ApiCollection | undefined {
  const t = s.tabs.find((x) => x.id === (tabId ?? s.active));
  return s.collections.find((c) => c.id === t?.colId) ?? s.collections[0];
}

export function scopeFor(req: Req, colId?: string): Scope {
  const s = useApi.getState();
  const col = s.collections.find((c) => c.id === colId) ?? colFor(s);
  const env = col ? s.envByCol[col.id] : null;
  const vars = [...(col?.defaults.vars ?? []), ...(col && env ? (s.envVars[envKey(col.id, env)] ?? []) : [])].map((v) => ({ ...row(v.name, v.value, v.enabled), ...(v.secret ? { secret: true } : {}) }));
  return makeScope({ env: vars, vars: req.vars, runtime: col ? s.runtime[col.id] : undefined });
}

export function flatRequests(nodes: ApiTreeNode[]): (ApiTreeNode & { type: "request" })[] {
  return nodes.flatMap((n) => (n.type === "folder" ? flatRequests(n.children) : [n]));
}

export const useApi = create<ApiState>((set, get) => {
  const setCol = (c: ApiCollection) => set((s) => ({ collections: s.collections.some((x) => x.id === c.id) ? s.collections.map((x) => (x.id === c.id ? c : x)) : [...s.collections, c] }));
  return {
    ...EMPTY,
    root: null,
    collections: [],
    envVars: {},
    runtime: {},
    results: {},
    sending: {},
    history: [],
    dialog: null,
    view: "requests",
    routes: null,
    guessing: false,
    guesses: [],

    load(root) {
      if (root === get().root) return;
      set({ ...(root ? read(root) : EMPTY), root, collections: [], envVars: {}, runtime: {}, results: {}, sending: {}, history: [], routes: null, guesses: [], guessing: false });
      if (root) void get().refresh();
    },
    async refresh() {
      const a = api();
      if (!a?.apiCollections) return;
      const [collections, history] = await Promise.all([a.apiCollections().catch(() => get().collections), a.apiHistory().catch(() => get().history)]);
      set({ collections, history });
      void get().loadRoutes(); // the body check (AP23) needs the schemas too
      // saved tabs come back from their files: what's kept between restarts has its secrets hidden
      for (const t of get().tabs)
        if (t.colId && t.draft.path && !isDirty(t) && collections.some((c) => c.id === t.colId))
          void a.apiReadRequest(t.colId, t.draft.path).then((r) => {
            const fresh = { ...fromApi(r), id: t.draft.id };
            set((s) => ({ tabs: s.tabs.map((x) => (x.id === t.id && !isDirty(x) ? { ...x, draft: fresh, base: fresh } : x)) }));
          }, () => {});
      for (const c of collections) {
        const env = get().envByCol[c.id];
        if (env === undefined && c.environments[0]) void get().setEnv(c.id, c.environments[0]); // never picked: start on the first, like Local
        else if (env && c.environments.includes(env)) void get().setEnv(c.id, env);
      }
    },

    open(req, o = {}) {
      const hit = req.path && o.colId ? get().tabs.find((t) => t.colId === o.colId && t.draft.path === req.path) : undefined;
      if (hit) {
        set({ active: hit.id, view: "requests" });
        return hit.id;
      }
      const tab: Tab = { id: uid(), draft: req, base: req, ...(o.colId ? { colId: o.colId } : {}), ...(o.resendOf ? { resendOf: o.resendOf } : {}) };
      const untouched = (t: Tab) => !t.draft.url && !t.draft.path && !isDirty(t) && !get().results[t.id] && !get().sending[t.id]; // a blank tab nobody typed in gives way
      set((s) => ({ tabs: [...s.tabs.filter((t) => !untouched(t)), tab], active: tab.id, view: "requests" }));
      return tab.id;
    },
    async openItem(colId, path) {
      const hit = get().tabs.find((t) => t.colId === colId && t.draft.path === path);
      if (hit) return set({ active: hit.id });
      const r = await ask(() => api().apiReadRequest(colId, path), "Couldn't open that request");
      if (r) get().open(fromApi(r), { colId });
    },
    newTab() {
      get().open(blankReq());
    },
    close(tabId) {
      const id = get().sending[tabId];
      if (id) void api().apiCancel(id).catch(() => {});
      set((s) => {
        const i = s.tabs.findIndex((t) => t.id === tabId);
        const tabs = s.tabs.filter((t) => t.id !== tabId);
        const { [tabId]: _r, ...results } = s.results;
        const { [tabId]: _s, ...sending } = s.sending;
        return { tabs, results, sending, active: s.active === tabId ? (tabs[Math.min(i, tabs.length - 1)]?.id ?? null) : s.active };
      });
    },
    focus: (active) => set({ active, view: "requests" }),
    edit(tabId, fn) {
      set((s) => ({ tabs: s.tabs.map((t) => (t.id === tabId ? { ...t, draft: fn(t.draft) } : t)) }));
    },

    async save(tabId, folder) {
      const t = get().tabs.find((x) => x.id === tabId);
      if (!t) return;
      if (hiddenSecret(t.draft)) return void toast("Type the real token first (or use a {{var}}). Shrike hid it, and saving would put the placeholder in the file.", "error");
      let colId = t.colId ?? get().collections.find((c) => c.owned)?.id;
      if (!colId) {
        const c = await ask(() => api().apiCreateCollection(useProject.getState().project?.name ?? "Requests"), "Couldn't make a collection");
        if (!c) return;
        setCol(c);
        colId = c.id;
      }
      const draft = t.draft.name === "New request" ? { ...t.draft, name: nameFor(t.draft.method, t.draft.url) } : t.draft;
      const r = await ask(() => api().apiSaveRequest(colId, toApi(draft), folder ?? (dirOf(draft.path) || undefined)), "Couldn't save the request");
      if (!r) return;
      setCol(r.collection);
      const saved = { ...draft, path: r.path };
      set((s) => ({ tabs: s.tabs.map((x) => (x.id === tabId ? { ...x, colId, draft: saved, base: saved } : x)) }));
    },

    async send(tabId) {
      const t = get().tabs.find((x) => x.id === tabId);
      if (!t || !t.draft.url.trim() || get().sending[tabId]) return;
      const sendId = uid();
      const col = colFor(get(), tabId);
      const env = col ? (get().envByCol[col.id] ?? undefined) : undefined;
      set((s) => ({ sending: { ...s.sending, [tabId]: sendId } }));
      let result: ApiSendResult;
      try {
        const named = t.draft.name === "New request" ? { ...t.draft, name: nameFor(t.draft.method, t.draft.url) } : t.draft; // AP15: the caller card shows it
        result = await api().apiSend(toApi(named), { sendId, ...(col ? { collectionId: col.id } : {}), ...(env ? { environment: env } : {}), ...(t.resendOf ? { resendOf: t.resendOf } : {}) });
      } catch (e) {
        result = { sent: { method: t.draft.method, url: t.draft.url, headers: {} }, error: errorMessage(e), assertions: [], setVars: {}, logs: [] };
      }
      if (get().sending[tabId] !== sendId) return; // cancelled or closed
      set((s) => {
        const { [tabId]: _t, ...sending } = s.sending;
        const runtime = col && Object.keys(result.setVars).length ? { ...s.runtime, [col.id]: { ...s.runtime[col.id], ...result.setVars } } : s.runtime;
        return { sending, runtime, results: { ...s.results, [tabId]: result } };
      });
      void api().apiHistory().then((history) => set({ history }), () => {});
    },
    cancel(tabId) {
      const id = get().sending[tabId];
      if (id) void api().apiCancel(id).catch(() => {});
      set((s) => {
        const { [tabId]: _t, ...sending } = s.sending;
        return { sending };
      });
    },

    async setEnv(colId, name) {
      set((s) => ({ envByCol: { ...s.envByCol, [colId]: name } }));
      if (!name) return;
      const env = await api().apiReadEnvironment(colId, name).catch(() => undefined);
      if (env) set((s) => ({ envVars: { ...s.envVars, [envKey(colId, name)]: env.vars } }));
    },

    async createFolder(colId, path) {
      const c = await ask(() => api().apiCreateFolder(colId, path), "Couldn't make the folder");
      if (c) setCol(c);
    },
    async rename(colId, path, name) {
      if (!name.trim()) return;
      const c = await ask(() => api().apiRenameItem(colId, path, name.trim()), "Couldn't rename it");
      if (!c) return;
      setCol(c);
      set((s) => ({ tabs: s.tabs.map((t) => (t.colId === colId && t.draft.path === path ? { ...t, draft: { ...t.draft, name }, base: { ...t.base, name } } : t)) }));
    },
    async remove(colId, path, label) {
      const col = get().collections.find((c) => c.id === colId);
      // the files go: in a linked Bruno folder that's the user's own project
      if (!confirm(`Delete ${label}?${col && !col.owned ? ` It's removed from ${col.name} on disk, where Bruno reads it too.` : ""}`)) return;
      const c = await ask(() => api().apiDeleteItem(colId, path), "Couldn't delete it");
      if (!c) return;
      setCol(c);
      set((s) => ({ tabs: s.tabs.map((t) => (t.colId === colId && (t.draft.path === path || t.draft.path.startsWith(`${path}/`)) ? { ...t, colId: undefined, draft: { ...t.draft, path: "" } } : t)) }));
    },
    async clearHistory() {
      const n = get().history.length;
      if (!n) return;
      if (!confirm(`Clear all ${n} request${n === 1 ? "" : "s"} from History? Your saved requests are not touched.`)) return;
      try {
        await api().apiClearHistory();
      } catch (e) {
        toast(`Couldn't clear History: ${errorMessage(e)}`, "error");
        return;
      }
      set({ history: [] });
    },
    async duplicate(colId, path) {
      const r = await ask(() => api().apiReadRequest(colId, path), "Couldn't copy it");
      if (!r) return;
      const res = await ask(() => api().apiSaveRequest(colId, { ...r, path: "", name: `${r.name} copy`, ...(r.seq === undefined ? {} : { seq: r.seq + 1 }) }, dirOf(path) || undefined), "Couldn't copy it");
      if (res) setCol(res.collection);
    },
    async move(colId, path, toCol, toFolder) {
      if (colId === toCol && dirOf(path) === toFolder) return;
      const r = await ask(() => api().apiReadRequest(colId, path), "Couldn't move it");
      if (!r) return;
      const res = await ask(() => api().apiSaveRequest(toCol, { ...r, path: "" }, toFolder || undefined), "Couldn't move it");
      if (!res) return;
      setCol(res.collection);
      const c = await ask(() => api().apiDeleteItem(colId, path), "Moved, but couldn't remove the old copy");
      if (c) setCol(c);
      set((s) => ({ tabs: s.tabs.map((t) => (t.colId === colId && t.draft.path === path ? { ...t, colId: toCol, draft: { ...t.draft, path: res.path }, base: { ...t.base, path: res.path } } : t)) }));
    },
    async reorder(colId, path, beforePath) {
      const col = get().collections.find((c) => c.id === colId);
      const dir = dirOf(beforePath);
      if (!col) return;
      if (dirOf(path) !== dir) return get().move(colId, path, colId, dir);
      const sibs = flatRequests(col.tree).filter((n) => dirOf(n.path) === dir && n.path !== path).sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
      const at = sibs.findIndex((n) => n.path === beforePath);
      const order = [...sibs.slice(0, at).map((n) => n.path), path, ...sibs.slice(at).map((n) => n.path)];
      for (const [i, p] of order.entries()) {
        const node = sibs.find((n) => n.path === p);
        if (node && node.seq === i + 1) continue;
        const r = await ask(() => api().apiReadRequest(colId, p), "Couldn't reorder");
        if (!r) return;
        const res = await ask(() => api().apiSaveRequest(colId, { ...r, seq: i + 1 }), "Couldn't reorder");
        if (res) setCol(res.collection);
      }
    },

    async importAny(kind, text, name) {
      const r = await ask(() => api().apiImport(kind, text, name), "Couldn't import that");
      if (!r) return false;
      if ("method" in r) {
        get().open(fromApi(r));
        toast("Made a request from the curl command", "ok");
      } else {
        setCol(r);
        const n = flatRequests(r.tree).length;
        toast(`Imported ${r.name}: ${n} ${n === 1 ? "request" : "requests"}`, "ok");
        for (const w of r.warnings.slice(0, 2)) toast(w, "info");
      }
      return true;
    },
    async link() {
      const c = await ask(() => api().apiLinkCollection(), "Couldn't open that folder");
      if (!c) return;
      setCol(c);
      toast(`Opened ${c.name}. Changes you save go to its files, so Bruno sees them too.`, "ok");
      for (const w of c.warnings.slice(0, 2)) toast(w, "info");
    },
    async code(tabId, lang) {
      const t = get().tabs.find((x) => x.id === tabId);
      if (!t) return "";
      const col = colFor(get(), tabId);
      const env = col ? (get().envByCol[col.id] ?? undefined) : undefined;
      return (await ask(() => api().apiCode(toApi(t.draft), lang, { ...(col ? { collectionId: col.id } : {}), ...(env ? { environment: env } : {}) }), "Couldn't make the code")) ?? "";
    },

    async loadRoutes(refresh) {
      const root = get().root;
      const v = await api()?.apiRoutes?.(refresh).catch(() => undefined);
      if (v && get().root === root) set({ routes: v });
    },
    async guess(routes) {
      if (get().guessing || !routes.length) return;
      set({ guessing: true });
      const got = await ask(() => api().apiGuessRoutes(routes.map((r) => ({ method: r.method, path: r.path }))), "Couldn't fill in examples");
      set({ guessing: false, ...(got ? { guesses: got } : {}) });
    },
    async acceptGuess(g) {
      const v = await ask(() => api().apiSaveGuess(g), "Couldn't save that");
      if (!v) return;
      set((s) => ({ routes: v, guesses: s.guesses.filter((x) => x !== g) }));
      void get().refresh();
    },
    skipGuess: (g) => set((s) => ({ guesses: s.guesses.filter((x) => x !== g) })),
    async saveTest(req, folder) {
      let col = get().collections.find((c) => c.owned) ?? (await ask(() => api().apiCreateCollection(useProject.getState().project?.name ?? "Requests"), "Couldn't make a collection"));
      if (!col) return;
      if (folder && !col.tree.some((n) => n.type === "folder" && n.name === folder)) col = await ask(() => api().apiCreateFolder(col!.id, folder), "Couldn't make the folder");
      if (!col) return;
      const dir = col.tree.find((n) => n.type === "folder" && n.name === folder)?.path;
      const r = await ask(() => api().apiSaveRequest(col!.id, toApi(req), dir), "Couldn't save the test");
      if (!r) return;
      setCol(r.collection);
      toast(`Saved ${req.name} as a test in ${r.collection.name}. Flows can replay it.`, "ok");
    },
  };
});

let timer: ReturnType<typeof setTimeout> | undefined;
useApi.subscribe((s) => {
  if (!s.root) return;
  clearTimeout(timer);
  const root = s.root;
  const out: Local = { tabs: s.tabs.map((t) => ({ ...t, draft: scrubReq(t.draft), base: scrubReq(t.base) })), active: s.active, envByCol: s.envByCol };
  timer = setTimeout(() => {
    try {
      localStorage.setItem(key(root), JSON.stringify(out));
    } catch {}
  }, 300);
});

const sync = () => useApi.getState().load(useProject.getState().project?.root ?? null);
sync();
useProject.subscribe(sync);

export const isDirty = (t: Tab): boolean => !sameReq(t.draft, t.base);

/** Show the client: the right dock's API tab when that's open, otherwise the A sheet. */
export function showClient(): void {
  const d = useDock.getState();
  if (d.open && d.tab === "api") return;
  useUi.setState({ sheet: "api", file: null });
}

/** /api, /api /todos, /api curl …: open the client, on a new request when something follows. */
export function openApi(rest = ""): void {
  const t = rest.trim();
  if (looksLikeCurl(t)) void useApi.getState().importAny("curl", t);
  else if (t) useApi.getState().open(blankReq({ url: t, params: paramsFromUrl(t, []), name: nameFor("GET", t) }));
  showClient();
}

export function openInClient(req: Req, o?: { resendOf?: string }): void {
  useApi.getState().open(req, o);
  showClient();
}

/** Every HTTP call Shrike captured, oldest first (redacted at ingest). */
export function capturedCalls(byId: Record<string, ActionView>, order: string[]): Captured[] {
  const out: (Captured & { at: number })[] = [];
  for (const id of order) {
    const a = byId[id];
    if (!a) continue;
    for (const e of allEvents(a)) if (e.kind === "http_request" && e.http) out.push({ ...e.http, at: e.startMs });
  }
  return out.sort((x, y) => x.at - y.at);
}

/** AP2: a scanner route as a new tab, filled from the last real call to it. */
export function openRoute(route: Route): void {
  const { byId, order } = useActions.getState();
  openInClient(fromRoute(route, capturedCalls(byId, order)));
}

/** AP20 Try it: a documented route in a new tab, examples filled. Never sends. */
export function tryRoute(doc: RouteDoc): void {
  const { byId, order } = useActions.getState();
  openInClient(reqFromDoc(doc, capturedCalls(byId, order)));
}

/** The history entry's request (redacted) in a new tab. */
export const openHistory = (h: ApiHistoryEntry): void => void useApi.getState().open({ ...fromApi(h.request), path: "" });
