import { useMemo, useRef, useState, type DragEvent, type ReactNode } from "react";
import { ChevronRight, Folder as FolderIcon, Library, MoreHorizontal, Plus, Search } from "lucide-react";
import type { ApiCollection, ApiTreeNode } from "@shrike/schema";
import { MethodTag, cx } from "../components/ui.tsx";
import { basename, httpPath, relativeTime } from "../lib/format.ts";
import { api, errorMessage } from "../lib/api.ts";
import { useActions } from "../stores/actions.ts";
import { useProject } from "../stores/project.ts";
import { toast } from "../stores/ui.ts";
import { blankReq, routePattern, toApi } from "./model.ts";
import { appAddress, capturedCalls, openHistory, openRoute, useApi } from "./store.ts";
import { keys } from "../lib/platform.ts";

// AP-tree: the project's collections (main reads them from disk), the scanner's routes and history. Requests drag to reorder or move.

const MIME = "application/x-shrike-request";
type Drop = { key: string; where: "before" | "inside" } | null;
type Item = { col: ApiCollection; node: ApiTreeNode };
const nodeKey = (colId: string, path: string) => `${colId}:${path}`;
const dirOf = (path: string) => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");

async function newRequestIn(colId: string, folder: string) {
  try {
    const r = await api().apiSaveRequest(colId, toApi(blankReq()), folder || undefined);
    useApi.setState((s) => ({ collections: s.collections.map((c) => (c.id === colId ? r.collection : c)) }));
    await useApi.getState().openItem(colId, r.path);
  } catch (e) {
    toast(`Couldn't make the request: ${errorMessage(e)}`, "error");
  }
}

function findFolder(nodes: ApiTreeNode[], path: string): (ApiTreeNode & { type: "folder" }) | undefined {
  for (const n of nodes) {
    if (n.type !== "folder") continue;
    if (n.path === path) return n;
    const f = findFolder(n.children, path);
    if (f) return f;
  }
  return undefined;
}
const folderPaths = (nodes: ApiTreeNode[]): string[] => nodes.flatMap((n) => (n.type === "folder" ? [n.path, ...folderPaths(n.children)] : []));

function freeName(col: ApiCollection, parent: string): string {
  const names = new Set((parent ? (findFolder(col.tree, parent)?.children ?? []) : col.tree).filter((n) => n.type === "folder").map((n) => n.name));
  let name = "New folder";
  for (let i = 2; names.has(name); i++) name = `New folder ${i}`;
  return parent ? `${parent}/${name}` : name;
}

function Menu({ item, onClose, onRename }: { item: Item; onClose(): void; onRename(): void }) {
  const cols = useApi((s) => s.collections);
  const [moving, setMoving] = useState(false);
  const a = useApi.getState();
  const { col, node } = item;
  const act = (fn: () => void) => () => {
    fn();
    onClose();
  };
  return (
    <div role="menu" className="ap-menu glass solid" onMouseLeave={onClose}>
      {moving ? (
        cols.flatMap((c) =>
          ["", ...folderPaths(c.tree)].map((f) => (
            <button key={`${c.id}:${f}`} role="menuitem" type="button" onClick={act(() => void a.move(col.id, node.path, c.id, f))}>
              {cols.length > 1 ? `${c.name}${f ? ` / ${f}` : ""}` : f || "Top level"}
            </button>
          )),
        )
      ) : (
        <>
          {node.type === "folder" && (
            <>
              <button role="menuitem" type="button" onClick={act(() => void newRequestIn(col.id, node.path))}>
                New request here
              </button>
              <button role="menuitem" type="button" onClick={act(() => void a.createFolder(col.id, freeName(col, node.path)))}>
                New folder inside
              </button>
            </>
          )}
          <button role="menuitem" type="button" onClick={act(onRename)}>
            Rename
          </button>
          {node.type === "request" && (
            <>
              <button role="menuitem" type="button" onClick={act(() => void a.duplicate(col.id, node.path))}>
                Duplicate
              </button>
              <button role="menuitem" type="button" onClick={() => setMoving(true)}>
                Move to…
              </button>
            </>
          )}
          <button role="menuitem" type="button" className="danger" onClick={act(() => void a.remove(col.id, node.path, node.name))}>
            Delete
          </button>
        </>
      )}
    </div>
  );
}

function Row({ item, depth, open, onToggle, drop, setDrop, children }: { item: Item; depth: number; open?: boolean; onToggle?(): void; drop: Drop; setDrop(d: Drop): void; children?: ReactNode }) {
  const { col, node } = item;
  const k = nodeKey(col.id, node.path);
  const active = useApi((s) => {
    const t = s.tabs.find((x) => x.id === s.active);
    return t?.colId === col.id && t.draft.path === node.path;
  });
  const [menu, setMenu] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(node.name);
  const dropped = useRef(false);
  const startRename = () => ((dropped.current = false), setName(node.name), setRenaming(true));
  const finish = () => {
    setRenaming(false);
    if (!dropped.current && name.trim() && name !== node.name) void useApi.getState().rename(col.id, node.path, name.trim());
  };
  const onDragOver = (e: DragEvent) => {
    if (!e.dataTransfer.types.includes(MIME)) return;
    e.preventDefault();
    setDrop({ key: k, where: node.type === "folder" ? "inside" : "before" });
  };
  return (
    <>
      <div className="relative">
        <div
          className={cx("ap-row", active && "on", drop?.key === k && `drop-${drop.where}`)}
          style={{ paddingLeft: 6 + depth * 12 }}
          draggable={node.type === "request" && !renaming}
          onDragStart={(e) => {
            e.dataTransfer.setData(MIME, JSON.stringify({ colId: col.id, path: node.path }));
            e.dataTransfer.effectAllowed = "move";
          }}
          onDragOver={onDragOver}
          onDragLeave={() => setDrop(null)}
          onDrop={(e) => {
            e.preventDefault();
            setDrop(null);
            const raw = e.dataTransfer.getData(MIME);
            if (!raw) return;
            const from = JSON.parse(raw) as { colId: string; path: string };
            if (from.path === node.path && from.colId === col.id) return;
            const a = useApi.getState();
            if (node.type === "folder") void a.move(from.colId, from.path, col.id, node.path);
            else if (from.colId === col.id) void a.reorder(col.id, from.path, node.path);
            else void a.move(from.colId, from.path, col.id, dirOf(node.path));
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            setMenu(true);
          }}
        >
          {renaming ? (
            <input
              autoFocus
              className="ap-rename"
              value={name}
              aria-label="New name"
              onChange={(e) => setName(e.target.value)}
              onBlur={finish}
              onKeyDown={(e) => {
                if (e.key === "Enter") finish();
                if (e.key === "Escape") ((dropped.current = true), setRenaming(false));
                e.stopPropagation();
              }}
            />
          ) : (
            <button
              type="button"
              className="ap-row-main"
              aria-expanded={node.type === "folder" ? open : undefined}
              onClick={() => (node.type === "folder" ? onToggle?.() : void useApi.getState().openItem(col.id, node.path))}
              onDoubleClick={startRename}
              title={node.path}
            >
              {node.type === "folder" ? (
                <>
                  <ChevronRight size={11} className={cx("ap-chev", open && "open")} aria-hidden />
                  <FolderIcon size={12} className="shrink-0 text-faint" aria-hidden />
                </>
              ) : (
                <MethodTag method={node.method} className="w-[38px]! text-[9.5px]!" />
              )}
              <span className="truncate">{node.name}</span>
            </button>
          )}
          <button type="button" className="ap-row-more" aria-label={`More for ${node.name}`} aria-haspopup="menu" onClick={() => setMenu(!menu)}>
            <MoreHorizontal size={12} />
          </button>
        </div>
        {menu && <Menu item={item} onClose={() => setMenu(false)} onRename={startRename} />}
      </div>
      {children}
    </>
  );
}

function Collection({ col, needle, drop, setDrop }: { col: ApiCollection; needle: string; drop: Drop; setDrop(d: Drop): void }) {
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const [shut, setShut] = useState(false);
  const [menu, setMenu] = useState(false);
  const hit = (n: ApiTreeNode): boolean => !needle || n.name.toLowerCase().includes(needle) || (n.type === "folder" && n.children.some(hit));
  const sorted = (nodes: ApiTreeNode[]) => [...nodes].sort((a, b) => (a.type === b.type ? (a.seq ?? 0) - (b.seq ?? 0) || a.name.localeCompare(b.name) : a.type === "folder" ? -1 : 1));
  const render = (nodes: ApiTreeNode[], depth: number): ReactNode =>
    sorted(nodes)
      .filter(hit)
      .map((n) => {
        const open = !closed.has(n.path) || !!needle;
        return (
          <Row
            key={n.path}
            item={{ col, node: n }}
            depth={depth}
            open={open}
            drop={drop}
            setDrop={setDrop}
            onToggle={() => setClosed((c) => (c.has(n.path) ? new Set([...c].filter((x) => x !== n.path)) : new Set([...c, n.path])))}
          >
            {n.type === "folder" && open && render(n.children, depth + 1)}
          </Row>
        );
      });
  const k = nodeKey(col.id, "");
  return (
    <div className="relative">
      <div
        className={cx("ap-row ap-colhead", drop?.key === k && "drop-inside")}
        onDragOver={(e) => e.dataTransfer.types.includes(MIME) && (e.preventDefault(), setDrop({ key: k, where: "inside" }))}
        onDragLeave={() => setDrop(null)}
        onDrop={(e) => {
          e.preventDefault();
          setDrop(null);
          const raw = e.dataTransfer.getData(MIME);
          if (!raw) return;
          const from = JSON.parse(raw) as { colId: string; path: string };
          void useApi.getState().move(from.colId, from.path, col.id, "");
        }}
      >
        <button type="button" className="ap-row-main pl-1.5" aria-expanded={!shut} onClick={() => setShut(!shut)} title={col.root}>
          <ChevronRight size={11} className={cx("ap-chev", !shut && "open")} aria-hidden />
          <Library size={12} className="shrink-0 text-faint" aria-hidden />
          <span className="truncate font-medium">{col.name}</span>
          {!col.owned && (
            <span className="ap-tag" title="A Bruno folder opened in place: saves go to its files">
              Bruno
            </span>
          )}
        </button>
        <button type="button" className="ap-row-more" aria-label={`More for ${col.name}`} aria-haspopup="menu" onClick={() => setMenu(!menu)}>
          <MoreHorizontal size={12} />
        </button>
      </div>
      {menu && (
        <div role="menu" className="ap-menu glass solid" onMouseLeave={() => setMenu(false)}>
          <button role="menuitem" type="button" onClick={() => (void newRequestIn(col.id, ""), setMenu(false))}>
            New request
          </button>
          <button role="menuitem" type="button" onClick={() => (void useApi.getState().createFolder(col.id, freeName(col, "")), setMenu(false))}>
            New folder
          </button>
          <button role="menuitem" type="button" onClick={() => (useApi.setState({ dialog: "env" }), setMenu(false))}>
            Environments…
          </button>
          {!col.owned && (
            <button role="menuitem" type="button" onClick={() => (void api().apiUnlinkCollection(col.id).then(() => useApi.getState().refresh()), setMenu(false))}>
              Close this folder (files stay)
            </button>
          )}
        </div>
      )}
      {col.warnings.length > 0 && !shut && (
        <p className="ap-warn" title={col.warnings.join("\n")}>
          {col.warnings[0]}
          {col.warnings.length > 1 ? ` (+${col.warnings.length - 1} more)` : ""}
        </p>
      )}
      {!shut && (col.tree.length ? render(col.tree, 1) : <p className="ap-hint">Empty. Save a request here with {keys("⌘S")}.</p>)}
    </div>
  );
}

export function Tree({ onPicked }: { onPicked?(): void }) {
  const cols = useApi((s) => s.collections);
  const history = useApi((s) => s.history);
  const routes = useProject((s) => s.project?.routes ?? []);
  const byId = useActions((s) => s.byId);
  const order = useActions((s) => s.order);
  const [q, setQ] = useState("");
  const [plus, setPlus] = useState(false);
  const [drop, setDrop] = useState<Drop>(null);
  const [section, setSection] = useState({ routes: true, history: true });
  const needle = q.trim().toLowerCase();

  const calls = useMemo(() => capturedCalls(byId, order), [byId, order]);
  const called = (path: string, method: string) => {
    const re = routePattern(path);
    return calls.some((c) => c.method.toUpperCase() === method.toUpperCase() && re.test(c.url.replace(/^[a-z]+:\/\/[^/]*/i, "")));
  };
  const shownRoutes = routes.filter((r) => !needle || r.path.toLowerCase().includes(needle));
  const shownHistory = history.filter((h) => !needle || h.url.toLowerCase().includes(needle)).slice(0, 200);
  const owned = cols.find((c) => c.owned);
  const here = /^https?:\/\/([^/]+)/.exec(appAddress() ?? "")?.[1];
  const shortUrl = (url: string) => (here && httpPath(url).startsWith(`${here}/`) ? httpPath(url).slice(here.length) : httpPath(url)); // the app's own host is noise

  return (
    <nav aria-label="Collections" className="ap-tree">
      <div className="ap-tree-head">
        <div className="ap-search">
          <Search size={11} aria-hidden />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" aria-label="Search requests" spellCheck={false} />
        </div>
        <div className="relative">
          <button type="button" className="ap-icon" aria-label="New" aria-haspopup="menu" title="New request, folder or import" onClick={() => setPlus(!plus)}>
            <Plus size={13} />
          </button>
          {plus && (
            <div role="menu" className="ap-menu right glass solid" onMouseLeave={() => setPlus(false)}>
              <button role="menuitem" type="button" onClick={() => (useApi.getState().newTab(), setPlus(false), onPicked?.())}>
                New request
              </button>
              {owned && (
                <button role="menuitem" type="button" onClick={() => (void useApi.getState().createFolder(owned.id, freeName(owned, "")), setPlus(false))}>
                  New folder
                </button>
              )}
              <button role="menuitem" type="button" onClick={() => (useApi.setState({ dialog: "import" }), setPlus(false))}>
                Import…
              </button>
              <button role="menuitem" type="button" onClick={() => (void useApi.getState().link(), setPlus(false))}>
                Open a Bruno folder…
              </button>
            </div>
          )}
        </div>
      </div>
      <div className="ap-tree-body" onClick={(e) => (e.target as HTMLElement).closest(".ap-row-main:not([aria-expanded])") && onPicked?.()}>
        {cols.length ? (
          cols.map((c) => <Collection key={c.id} col={c} needle={needle} drop={drop} setDrop={setDrop} />)
        ) : (
          <p className="ap-hint">
            Nothing saved yet. Press <b>{keys("⌘S")}</b> on a request to keep it in <code>.shrike/api/</code>, or{" "}
            <button type="button" className="ap-link" onClick={() => useApi.setState({ dialog: "import" })}>
              import
            </button>{" "}
            from Bruno, Postman or OpenAPI.
          </p>
        )}

        {routes.length > 0 && (
          <>
            <button type="button" className="ap-sec" aria-expanded={section.routes} onClick={() => setSection({ ...section, routes: !section.routes })}>
              <ChevronRight size={10} className={cx("ap-chev", section.routes && "open")} aria-hidden />
              <span className="micro">Routes in your code</span>
              <span className="ml-auto font-mono text-[10px] text-faint">{routes.length}</span>
            </button>
            {section.routes &&
              shownRoutes.map((r) => {
                const seen = called(r.path, r.method);
                return (
                  <button
                    key={`${r.method} ${r.path}`}
                    type="button"
                    className={cx("ap-row ap-row-main", !seen && "never")}
                    style={{ paddingLeft: 6 }}
                    title={`${r.handler ? `${basename(r.handler.file)}:${r.handler.line}` : r.path}${seen ? "" : " · never called yet"}`}
                    onClick={() => openRoute(r)}
                  >
                    <MethodTag method={r.method} className="w-[38px]! text-[9.5px]!" />
                    <span className="truncate font-mono text-[11px]">{r.path}</span>
                  </button>
                );
              })}
          </>
        )}

        <div className="ap-sec-wrap">
          <button type="button" className="ap-sec" aria-expanded={section.history} onClick={() => setSection({ ...section, history: !section.history })}>
            <ChevronRight size={10} className={cx("ap-chev", section.history && "open")} aria-hidden />
            <span className="micro">History</span>
            {shownHistory.length > 0 && <span className="ml-auto font-mono text-[10px] text-faint">{shownHistory.length}</span>}
          </button>
          {shownHistory.length > 0 && (
            <button type="button" className="ap-clear" aria-label="Clear history" title="Clear history" onClick={() => void useApi.getState().clearHistory()}>
              Clear
            </button>
          )}
        </div>
        {section.history &&
          (shownHistory.length ? (
            shownHistory.map((h) => (
              <button key={h.id} type="button" className="ap-row ap-row-main" style={{ paddingLeft: 6 }} title={h.url} onClick={() => openHistory(h)}>
                <MethodTag method={h.method} className="w-[38px]! text-[9.5px]!" />
                <span className="truncate font-mono text-[11px]">{shortUrl(h.url)}</span>
                <span className={cx("ml-auto shrink-0 font-mono text-[10px]", h.status == null || h.status >= 500 ? "text-fail" : h.status >= 400 ? "text-slow" : "text-faint")}>{h.status ?? "×"}</span>
                <span className="shrink-0 pr-1 text-right font-mono text-[9.5px] text-faint">{relativeTime(h.at).replace(" ago", "").replace("just now", "now")}</span>
              </button>
            ))
          ) : (
            <p className="ap-hint">Requests you and your agent send show up here.</p>
          ))}
      </div>
    </nav>
  );
}
