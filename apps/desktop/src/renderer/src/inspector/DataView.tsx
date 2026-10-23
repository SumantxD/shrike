import { useEffect, useMemo, useState } from "react";
import type { ActionView, Cell } from "@shrike/schema";
import { api, errorMessage } from "../lib/api.ts";
import { Spinner } from "../components/ui.tsx";
import { toast } from "../stores/ui.ts";
import { changedFields, changeSummary, dataChanges, dataFocus, rowAsInsert, rowAsJson, rowKey, rowMatches, unseenWriter, type ChangeRow } from "./logic.ts";
import { Problem, Quiet, useDebounced, useLook } from "./look.tsx";

const PAGE = 100;
const show = (v: Cell) => (v === null ? "null" : String(v));

/** I2-copy: a row as JSON or an SQL INSERT, from the redacted cells the grid shows (#93). */
function copyRow(table: string, columns: string[], row: Cell[], as: "json" | "sql") {
  const text = as === "json" ? rowAsJson(columns, row) : rowAsInsert(table, columns, row);
  const what = as === "json" ? "the row as JSON" : "the row as SQL INSERT";
  void navigator.clipboard.writeText(text).then(
    () => toast(`Copied ${what}.`, "ok"),
    () => toast("Couldn't copy to the clipboard.", "error"),
  );
}

/** I2 the database's tables and rows, I3 what the focused click changed. */
export function DataView({ placeId, view, stationIds, tick }: { placeId: string; view?: ActionView; stationIds: string[]; tick: number }) {
  const focus = useMemo(() => dataFocus(view, placeId, stationIds), [view, placeId, stationIds]);
  const changes = useMemo(() => dataChanges(view, placeId), [view, placeId]);
  const [tab, setTab] = useState<"rows" | "changed">("rows");
  const [picked, setPicked] = useState<string | null>(null);
  const [sort, setSort] = useState<{ col: string; desc: boolean } | null>(null);
  const [search, setSearch] = useState("");
  const q = useDebounced(search.trim(), 250);

  const tables = useLook<"tables">({ op: "tables", placeId }, [placeId, tick]);
  const list = tables.data?.tables ?? [];
  const table = (picked && list.some((t) => t.name === picked) ? picked : undefined) ?? list.find((t) => t.name === focus.table)?.name ?? list[0]?.name;
  const rows = useLook<"rows">(table ? { op: "rows", placeId, table, limit: PAGE, orderBy: sort?.col, desc: sort?.desc, search: q || undefined } : null, [placeId, table, sort?.col, sort?.desc, q, tick]);
  const [more, setMore] = useState<Cell[][]>([]);
  const [loadingMore, setLoadingMore] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number; columns: string[]; row: Cell[] } | null>(null);
  useEffect(() => setMore([]), [rows.data]);
  useEffect(() => setMenu(null), [rows.data]);

  const data = rows.data?.table === table ? rows.data : undefined;
  const all = data ? [...data.rows, ...more] : [];
  const touched = new Map<string, ChangeRow["kind"]>();
  for (const g of changes) if (g.table === table) for (const r of g.rows) if (r.pk) touched.set(r.pk, r.kind);
  const nChanged = changes.reduce((n, g) => n + g.added + g.changed + g.removed, 0);

  const loadMore = async () => {
    if (!data || !table) return;
    setLoadingMore(true);
    try {
      const r = await api().inspect({ op: "rows", placeId, table, limit: PAGE, offset: all.length, orderBy: sort?.col, desc: sort?.desc, search: q || undefined });
      if (r.op === "rows") setMore((m) => [...m, ...r.rows]);
    } catch (e) {
      toast(`Couldn't load more rows: ${errorMessage(e)}`, "error");
    } finally {
      setLoadingMore(false);
    }
  };

  if (tables.error && !tables.data) return <Problem text={tables.error} again={tables.again} />;
  if (!tables.data) return <Quiet text="Reading the database" busy />;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="insp-bar" role="tablist" aria-label="Database views">
        <button type="button" role="tab" className="hud-btn" aria-selected={tab === "rows"} aria-pressed={tab === "rows"} onClick={() => setTab("rows")}>
          Rows
        </button>
        <button type="button" role="tab" className="hud-btn" aria-selected={tab === "changed"} aria-pressed={tab === "changed"} onClick={() => setTab("changed")}>
          What this click changed{nChanged ? ` · ${nChanged}` : ""}
        </button>
        {(tables.loading || rows.loading) && <Spinner size={10} className="text-faint" />}
      </div>
      <p className="insp-how">Read only · {tables.data.how}</p>

      {tab === "changed" ? (
        <Changes view={view} groups={changes} unseen={unseenWriter(view, placeId)} />
      ) : (
        <>
          <div className="insp-bar pt-0" style={{ borderBottom: 0 }}>
            {list.map((t) => (
              <button key={t.name} type="button" className={`insp-chip${t.name === focus.table ? " touched" : ""}`} aria-pressed={t.name === table} title={t.name === focus.table ? "This click used this table" : undefined} onClick={() => (setPicked(t.name), setSort(null))}>
                {t.name}
                <b>{t.rows}</b>
              </button>
            ))}
            {!list.length && <span className="text-[12px] text-dim">This database has no tables yet.</span>}
          </div>
          {table && (
            <div className="insp-bar pt-0">
              <input type="search" className="insp-search" placeholder={`Search ${table}`} aria-label={`Search ${table}`} value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
          )}
          {rows.error && !data ? (
            <Problem text={rows.error} again={rows.again} />
          ) : data ? (
            <div className="min-h-0 flex-1 overflow-auto">
              <table className="insp-grid" aria-label={`Rows of ${table}`}>
                <thead>
                  <tr>
                    {data.columns.map((c) => (
                      <th key={c} aria-sort={sort?.col === c ? (sort.desc ? "descending" : "ascending") : undefined}>
                        <button type="button" onClick={() => setSort((s) => (s?.col === c ? (s.desc ? null : { col: c, desc: true }) : { col: c, desc: false }))}>
                          {c}
                          {sort?.col === c ? (sort.desc ? " ↓" : " ↑") : ""}
                        </button>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {all.map((r, i) => {
                    const key = rowKey(data.columns, data.pk, r);
                    const kind = key ? touched.get(key) : undefined;
                    const cls = kind === "added" || kind === "changed" ? kind : table === focus.table && rowMatches(data.columns, r, focus.filters) ? "hit" : undefined;
                    const openMenu = (x: number, y: number) => setMenu({ x, y, columns: data.columns, row: r });
                    return (
                      <tr
                        key={key ?? i}
                        className={cls}
                        data-hit={cls ? "" : undefined}
                        tabIndex={0}
                        aria-label={`Row ${key ?? i + 1} of ${table}`}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          openMenu(e.clientX, e.clientY);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || (e.shiftKey && e.key === "F10")) {
                            e.preventDefault();
                            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                            openMenu(rect.left + 8, rect.bottom + 4);
                          }
                        }}
                      >
                        {r.map((v, j) => (
                          <td key={j} className={v === null ? "null" : undefined} title={show(v)}>
                            {show(v)}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {!all.length && <p className="p-4 text-[12px] text-dim">{q ? `No rows in ${table} match "${q}".` : `${table} is empty.`}</p>}
              <div className="flex items-center gap-3 px-2.5 py-2">
                <span className="lbl text-faint">
                  {all.length} of {data.total} rows
                </span>
                {all.length < data.total && (
                  <button type="button" className="hud-btn" disabled={loadingMore} onClick={() => void loadMore()}>
                    {loadingMore ? "Loading" : "Show more"}
                  </button>
                )}
              </div>
              {menu && table && (
                <div className="fixed inset-0 z-40" onClick={() => setMenu(null)} onContextMenu={(e) => (e.preventDefault(), setMenu(null))}>
                  <div
                    role="menu"
                    aria-label="Copy row"
                    className="ap-menu glass solid absolute"
                    style={{ left: Math.min(menu.x, window.innerWidth - 220), top: Math.min(menu.y, window.innerHeight - 120) }}
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => e.key === "Escape" && setMenu(null)}
                  >
                    <button
                      role="menuitem"
                      type="button"
                      autoFocus
                      onClick={() => {
                        copyRow(table, menu.columns, menu.row, "json");
                        setMenu(null);
                      }}
                    >
                      Copy as JSON
                    </button>
                    <button
                      role="menuitem"
                      type="button"
                      onClick={() => {
                        copyRow(table, menu.columns, menu.row, "sql");
                        setMenu(null);
                      }}
                    >
                      Copy as SQL INSERT
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <Quiet text="Reading rows" busy />
          )}
        </>
      )}
    </div>
  );
}

function Changes({ view, groups, unseen }: { view?: ActionView; groups: ReturnType<typeof dataChanges>; unseen?: string }) {
  if (!view) return <Quiet text="Click something in your app, then come back to see what it changed here." />;
  if (!groups.length && unseen) return <Quiet text={`This click went through ${unseen}, where Shrike can't see row changes, so it can't tell what changed in the database.`} sub={view.label} />;
  if (!groups.length) return <Quiet text="Nothing changed in the database during this click." sub={view.label} />;
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-2.5" aria-label="What this click changed">
      {groups.map((g) => (
        <section key={g.table} className="insp-change">
          <header>
            {g.table}
            <small>{changeSummary(g)}</small>
          </header>
          {g.rows.map((r, i) => (
            <div key={i} className={`insp-crow ${r.kind}`}>
              <span>{r.kind}</span>
              <code>{r.kind === "changed" ? <Diff before={r.before} after={r.after} /> : fields(r.after ?? r.before)}</code>
            </div>
          ))}
          {!g.rows.length && <p className="px-2.5 py-2 text-[11.5px] text-dim">Shrike counted the rows but couldn't tell which ones.</p>}
        </section>
      ))}
      {unseen && <p className="px-2.5 text-[11.5px] text-dim">This click also went through {unseen}, where Shrike couldn't see every row change, so there may be more.</p>}
    </div>
  );
}

const fields = (r: Record<string, Cell> | undefined) => (r ? Object.entries(r).map(([k, v]) => `${k}: ${show(v)}`).join("  ") : "");

function Diff({ before, after }: { before?: Record<string, Cell>; after?: Record<string, Cell> }) {
  const diff = new Set(changedFields(before, after));
  const row = after ?? before ?? {};
  return (
    <>
      {Object.keys(row).map((k, i) => (
        <span key={k}>
          {i > 0 && "  "}
          {k}:{" "}
          {diff.has(k) ? (
            <>
              <s>{show(before?.[k] ?? null)}</s> → <i>{show(after?.[k] ?? null)}</i>
            </>
          ) : (
            show(row[k] ?? null)
          )}
        </span>
      ))}
    </>
  );
}
