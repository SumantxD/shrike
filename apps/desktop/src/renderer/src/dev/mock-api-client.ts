// AP: the API client in the browser mock. One in-memory collection; sends go through the mock's sendRequest so they still make trips.
import type { ApiCollection, ApiEnvironment, ApiHistoryEntry, ApiRequest, ApiSendResult, ApiTreeNode, HttpRequestSpec, HttpResponseSpec, ShrikeApi } from "@shrike/schema";

type ApiPart = Pick<ShrikeApi, Extract<keyof ShrikeApi, `api${string}`>>;
const ID = "a1b2c3d4e5f6";
const blank = (over: Partial<ApiRequest>): ApiRequest => ({ path: "", name: "Untitled", method: "GET", url: "", params: [], pathParams: [], headers: [], body: { type: "none" }, auth: { type: "inherit" }, vars: { pre: [], post: [] }, assertions: [], scripts: {}, settings: {}, ...over });

export function apiClientMock(sendRequest: (r: HttpRequestSpec) => Promise<{ response: HttpResponseSpec; actionId: string }>): ApiPart {
  const files = new Map<string, ApiRequest>([
    ["todos/List todos.bru", blank({ path: "todos/List todos.bru", name: "List todos", seq: 1, url: "{{baseUrl}}/api/todos", assertions: [{ expr: "res.status", op: "eq", value: "200", enabled: true }] })],
    ["todos/Add todo.bru", blank({ path: "todos/Add todo.bru", name: "Add todo", seq: 2, method: "POST", url: "{{baseUrl}}/api/todos", body: { type: "json", data: '{\n  "title": "Buy milk"\n}' } })],
    ["todos/Delete todo.bru", blank({ path: "todos/Delete todo.bru", name: "Delete todo", seq: 3, method: "DELETE", url: "{{baseUrl}}/api/todos/:id", pathParams: [{ name: "id", value: "1", enabled: true }] })],
    ["Health.bru", blank({ path: "Health.bru", name: "Health", seq: 2, url: "{{baseUrl}}/api/health" })],
  ]);
  const envs = new Map<string, ApiEnvironment>([["Local", { name: "Local", vars: [{ name: "baseUrl", value: "http://localhost:3001", enabled: true }, { name: "token", value: "dev-token", enabled: true, secret: true }] }]]);
  const history: ApiHistoryEntry[] = [];
  const tree = (): ApiTreeNode[] => {
    const root: ApiTreeNode[] = [];
    const folders = new Map<string, ApiTreeNode & { type: "folder" }>();
    for (const r of [...files.values()].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0))) {
      const dir = r.path.includes("/") ? r.path.slice(0, r.path.lastIndexOf("/")) : "";
      const node: ApiTreeNode = { type: "request", name: r.name, path: r.path, method: r.method, ...(r.seq === undefined ? {} : { seq: r.seq }) };
      if (!dir) root.push(node);
      else {
        let f = folders.get(dir);
        if (!f) root.unshift((f = { type: "folder", name: dir, path: dir, seq: 1, children: [] }));
        folders.set(dir, f);
        f.children.push(node);
      }
    }
    return root;
  };
  const col = (): ApiCollection => ({ id: ID, root: "/mock/todo-app/.shrike/api/Todo API", name: "Todo API", format: "bru", owned: true, tree: tree(), environments: [...envs.keys()], defaults: { headers: [], auth: { type: "bearer", token: "{{token}}" }, vars: [] }, warnings: [] });
  const interp = (s: string, env?: string) => s.replace(/\{\{\s*([^{}\s]+)\s*\}\}/g, (m, n: string) => envs.get(env ?? "")?.vars.find((v) => v.name === n)?.value ?? m);

  return {
    async apiCollections() {
      return [col()];
    },
    async apiCreateCollection() {
      return col();
    },
    async apiLinkCollection() {
      return null;
    },
    async apiUnlinkCollection() {},
    async apiReadRequest(_id, path) {
      const r = files.get(path);
      if (!r) throw new Error("That request isn't there anymore.");
      return structuredClone(r);
    },
    async apiSaveRequest(_id, req, folder) {
      const path = req.path || `${folder ? `${folder}/` : ""}${req.name}.bru`;
      files.set(path, { ...req, path });
      return { path, collection: col() };
    },
    async apiDeleteItem(_id, path) {
      for (const k of [...files.keys()]) if (k === path || k.startsWith(`${path}/`)) files.delete(k);
      return col();
    },
    async apiCreateFolder() {
      return col();
    },
    async apiRenameItem(_id, path, name) {
      const r = files.get(path);
      if (r) files.set(path, { ...r, name });
      return col();
    },
    async apiReadEnvironment(_id, name) {
      const e = envs.get(name);
      if (!e) throw new Error(`There's no environment called ${name}.`);
      return structuredClone(e);
    },
    async apiSaveEnvironment(_id, env) {
      envs.set(env.name, env);
      return col();
    },
    async apiSend(req, opts): Promise<ApiSendResult> {
      let url = interp(req.url, opts?.environment);
      for (const p of req.pathParams) if (p.enabled) url = url.replace(`:${p.name}`, encodeURIComponent(p.value));
      const q = req.params.filter((p) => p.enabled).map((p) => `${encodeURIComponent(p.name)}=${encodeURIComponent(p.value)}`).join("&");
      if (q) url = `${url.split("?")[0]}?${q}`;
      const headers = Object.fromEntries(req.headers.filter((h) => h.enabled).map((h) => [h.name, interp(h.value, opts?.environment)]));
      const body = req.body.type === "json" || req.body.type === "text" || req.body.type === "xml" ? req.body.data : undefined;
      const t0 = performance.now();
      try {
        const { response, actionId } = await sendRequest({ method: req.method, url, headers, ...(body ? { body } : {}) });
        const total = performance.now() - t0;
        history.unshift({ id: Math.random().toString(16).slice(2), at: Date.now(), method: req.method, url, status: response.status, durationMs: Math.round(total), actionId, request: req });
        return {
          sent: { method: req.method, url, headers },
          response: { status: response.status, statusText: response.statusText, headers: response.headers, body: response.body, bodyEncoding: "text", contentType: response.headers["content-type"], size: new Blob([response.body]).size, truncated: false, url, redirects: 0, timings: { dnsMs: 1, connectMs: 1, ttfbMs: Math.max(1, total - 3), downloadMs: 1, totalMs: total } },
          actionId,
          assertions: req.assertions.filter((a) => a.enabled).map((a) => ({ ...a, ok: a.expr === "res.status" ? String(response.status) === a.value : true, actual: a.expr === "res.status" ? String(response.status) : "" })),
          setVars: {},
          logs: [],
        };
      } catch (err) {
        return { sent: { method: req.method, url, headers }, error: (err as Error).message, assertions: [], setVars: {}, logs: [] };
      }
    },
    async apiCancel() {},
    async apiHistory() {
      return history.slice(0, 200);
    },
    async apiClearHistory() {
      history.length = 0;
    },
    async apiImport(kind, text) {
      if (kind === "curl") {
        const url = /https?:\/\/[^\s'"]+/.exec(text ?? "")?.[0] ?? "";
        return blank({ name: url || "From curl", url, method: /-X\s+(\w+)/.exec(text ?? "")?.[1]?.toUpperCase() ?? "GET" });
      }
      return col();
    },
    async apiCode(req) {
      return `curl -X ${req.method} '${req.url}'`;
    },
    async apiPickFile() {
      return null;
    },
    async apiRoutes() {
      return { routes: [{ method: "GET", path: "/api/todos", tag: "todos", sources: ["code"], params: [], responses: [] }], notes: [] };
    },
    async apiGuessRoutes() {
      throw new Error("The browser mock has no agent.");
    },
    async apiSaveGuess() {
      return { routes: [], notes: [] };
    },
  };
}
