// I1-I7 place inspector in the BUILT app on throwaway copies of todo-app and shop-app (offset ports, overridable with
// INSPECT_PORTS=todoWeb,todoApi,shopWeb,shopApi,shopAuth,shopPay). Run `pnpm build` first.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { ElectronApplication, Page } from "playwright";
import type { ActionView, RunStatus } from "@shrike/schema";
import { addTodoAction, dismissResult, fixtureCopy, key, launch, listening, openFolder, shot, sleep, typeTodo, waitFor } from "./helpers.ts";

const [TW, TA, SW, SA, SU, SP] = (process.env.INSPECT_PORTS ?? "5373,3301,5480,4400,4401,4499").split(",").map(Number) as [number, number, number, number, number, number];
const acts = (win: Page) => win.evaluate(() => window.shrike.getActions()) as Promise<ActionView[]>;
const lane = (win: Page, text: RegExp) => win.locator(".th-lanehead button.th-lanebtn", { hasText: text });
const panel = (win: Page) => win.locator(".insp");
const title = (win: Page) => win.locator("section[aria-label='Your app'] > div").first().innerText();
const snap = async (app: ElectronApplication, name: string) => (await sleep(500), shot(app, name, "inspector"));

test("todo-app: the SQLITE lane shows the todos, and the broken Add Todo changed nothing; 0 returns to the live app", { timeout: 300_000 }, async () => {
  assert.equal(listening([TW, TA]), "", `ports ${TW} ${TA} must be free`);
  const proj = fixtureCopy("todo-app", { ports: { 5173: TW, 3001: TA } });
  const { app, win, cleanup } = await launch({ SHRIKE_OPEN_FOLDER: proj });
  try {
    await win.emulateMedia({ reducedMotion: "reduce" });
    await openFolder(win);
    await win.getByRole("banner").getByRole("button", { name: "Run", exact: true }).click();
    const guest = await waitFor("the todo app in the dock", () => app.windows().find((p) => p.url().startsWith(`http://localhost:${TW}`)), 90_000);
    await guest.getByText("Fix the signup page on mobile").waitFor({ timeout: 30_000 });

    const t0 = Date.now();
    await typeTodo(guest, "buy milk");
    await guest.getByRole("button", { name: "Add Todo" }).click();
    const add = await addTodoAction(win, t0 - 1);
    assert.equal(add.status, "error");
    await win.locator(`.th-trip[data-trip="${add.id}"]`).waitFor();
    await sleep(1200);

    // I1: the DATABASE lane header is a button; the dock says what it shows.
    const db = lane(win, /DATABASE/);
    await db.click();
    assert.equal(await db.getAttribute("aria-pressed"), "true");
    await panel(win).getByRole("table", { name: "Rows of todos" }).waitFor({ timeout: 15_000 });
    assert.match(await title(win), /SQLITE\s*·\s*:memory:/);
    const rows = await panel(win).locator("tbody tr").allInnerTexts();
    assert.equal(rows.length, 4, `four seeded todos, the new one never landed: ${rows.join(" | ")}`);
    assert.match(rows[1]!, /Fix the signup page on mobile/);
    assert.match(await panel(win).innerText(), /Read only · your app's in-memory database, reading only/);
    assert.match(await panel(win).locator(".insp-chip[aria-pressed=true]").innerText(), /todos\s+4/);
    await snap(app, "todo-01-sqlite-rows");

    // #93: right-click the row and copy it as JSON, then as an SQL INSERT.
    const fixRow = panel(win).locator("tbody tr", { hasText: "Fix the signup page on mobile" });
    await fixRow.click({ button: "right" });
    await panel(win).getByRole("menuitem", { name: "Copy as JSON" }).click();
    const copiedJson = await waitFor("the row as JSON", async () => {
      const text = await app.evaluate(({ clipboard }) => clipboard.readText());
      return text.startsWith('{"id":2') ? text : undefined;
    }, 5000);
    assert.deepEqual(JSON.parse(copiedJson), { id: 2, title: "Fix the signup page on mobile", done: 0, user_id: 2 });
    await fixRow.click({ button: "right" });
    await panel(win).getByRole("menuitem", { name: "Copy as SQL INSERT" }).click();
    const copiedSql = await waitFor("the row as SQL", async () => {
      const text = await app.evaluate(({ clipboard }) => clipboard.readText());
      return text.startsWith("INSERT INTO") ? text : undefined;
    }, 5000);
    assert.equal(copiedSql, `INSERT INTO "todos" ("id", "title", "done", "user_id") VALUES (2, 'Fix the signup page on mobile', 0, 2);`);

    // I3: the planted bug, told by the database: nothing was added.
    await panel(win).getByRole("tab", { name: /What this click changed/ }).click();
    await panel(win).getByText("Nothing changed in the database during this click.").waitFor();
    await snap(app, "todo-02-nothing-changed");

    // I5 by key: 3 is SERVER; the createTodo log line is lit.
    await key(win, "3");
    await panel(win).locator(".insp-out").waitFor();
    assert.match(await title(win), /SERVER|APP/);
    assert.match(await panel(win).locator(".insp-out div.hit").first().innerText(), /creating todo/);
    await snap(app, "todo-03-server-output");

    // 0: back to the app; the webview was never torn down, so the next click still records.
    await key(win, "0");
    await panel(win).waitFor({ state: "detached" });
    assert.match(await title(win), /YOUR APP/i);
    await guest.getByText("Fix the signup page on mobile").waitFor();
    const t1 = Date.now();
    await guest.getByPlaceholder("What needs doing?").click();
    await guest.keyboard.press("Meta+A");
    await guest.keyboard.press("Backspace"); // the failed add kept "buy milk" in the field
    await typeTodo(guest, "after inspecting");
    await guest.getByRole("button", { name: "Add Todo" }).click();
    const again = await addTodoAction(win, t1 - 1);
    assert.ok(again.id !== add.id, "a new trip recorded after returning");
    await sleep(800);
    await snap(app, "todo-04-back-to-app");
  } finally {
    await cleanup();
  }
});

test("shop-app: POSTGRES rows, LRU sessions with the hit, STRIPE's refusal, API output, events.db change", { timeout: 400_000 }, async () => {
  assert.equal(listening([SW, SA, SU, SP]), "", "shop ports must be free");
  const proj = fixtureCopy("shop-app", { ports: { 5180: SW, 4100: SA, 4101: SU, 4199: SP } });
  const { app, win, cleanup } = await launch({ SHRIKE_OPEN_FOLDER: proj });
  try {
    await win.emulateMedia({ reducedMotion: "reduce" });
    await win.getByRole("button", { name: "Open a folder" }).click();
    await win.getByRole("dialog", { name: "Set up shop-app" }).getByRole("button", { name: "Run all" }).click();
    const st = await waitFor("all four processes running", async () => {
      const s = (await win.evaluate(() => window.shrike.getRunStatus())) as RunStatus;
      return s.state === "error" ? s : s.state === "running" && s.processes?.every((p) => p.state === "running") ? s : undefined;
    }, 120_000);
    assert.equal(st.state, "running", st.error);
    const guest = await waitFor("the shop page", () => app.windows().find((p) => p.url().startsWith(`http://localhost:${SW}`)), 60_000);
    await guest.getByRole("button", { name: "Pay now" }).waitFor({ timeout: 30_000 });
    await dismissResult(win, 5000);
    await waitFor("the page-load trip", async () => (await acts(win)).find((a) => a.label === "Opened /" && a.complete), 30_000);
    await guest.getByRole("button", { name: "Pay now" }).click();
    await guest.getByText("Payment failed").waitFor({ timeout: 20_000 });
    const pay = await waitFor("the Pay now trip", async () => (await acts(win)).find((a) => a.label === 'Clicked "Pay now"' && a.complete), 20_000);
    await win.locator(`.th-trip[data-trip="${pay.id}"]`).waitFor();
    await sleep(1500);

    // I2: POSTGRES · orders; the cart the click read is pre-selected and its row lit.
    await lane(win, /POSTGRES/).click();
    await panel(win).getByRole("table", { name: /Rows of / }).waitFor({ timeout: 15_000 });
    assert.match(await title(win), /POSTGRES\s*·\s*orders/);
    const chips = await panel(win).locator(".insp-chip").allInnerTexts();
    assert.deepEqual(chips.map((c) => c.replace(/\s+/g, " ")).sort(), ["cart_items 2", "carts 1", "orders 2"]);
    assert.match(await panel(win).locator(".insp-chip[aria-pressed=true]").innerText(), /^carts/);
    assert.match(await panel(win).locator("tbody tr.hit").innerText(), /cart-1/);
    assert.match(await panel(win).innerText(), /read-only transaction/);
    await snap(app, "shop-01-postgres-carts");
    await panel(win).locator(".insp-chip", { hasText: /^orders/ }).click();
    await panel(win).getByRole("table", { name: "Rows of orders" }).waitFor();
    assert.equal(await panel(win).locator("tbody tr").count(), 2);
    await snap(app, "shop-02-postgres-orders");

    // Keys never fire while typing in the inspector's own search box.
    const search = panel(win).getByRole("searchbox", { name: "Search orders" });
    await search.click();
    await win.keyboard.type("1");
    await sleep(400);
    assert.match(await title(win), /POSTGRES/);
    await search.fill("");

    // I4: LRU · sessions in auth; the session this click read is the lit hit.
    await lane(win, /sessions/i).click();
    const hit = panel(win).locator("li[data-mark=hit]");
    await hit.waitFor({ timeout: 15_000 });
    assert.match(await hit.innerText(), /demo-token/);
    assert.match(await hit.innerText(), /\[redacted/, "a key named like a token has its value masked");
    assert.match(await panel(win).innerText(), /peeked, so nothing moves up the queue/);
    await snap(app, "shop-03-lru-sessions-hit");

    // I6: STRIPE, the refused charge open with its bodies.
    await lane(win, /STRIPE/).click();
    const call = panel(win).locator(".insp-call.focus");
    await call.waitFor({ timeout: 10_000 });
    assert.match(await call.innerText(), /POST/);
    assert.match(await call.innerText(), /400/);
    assert.match(await call.innerText(), /Amount must be at least 50 cents/);
    assert.match(await call.innerText(), /"amount": 49/);
    await snap(app, "shop-04-stripe-refused");

    // I5: API, its output with the refusal line lit.
    await lane(win, /^API/).click();
    await panel(win).locator(".insp-out div.hit").first().waitFor({ timeout: 10_000 });
    assert.match(await panel(win).locator(".insp-out div.hit").first().innerText(), /payment refused/);
    assert.match(await panel(win).innerText(), /Running/);
    await snap(app, "shop-05-api-output");

    // I3 with a real write: the checkout event landed in events.db during this click.
    await lane(win, /events\.db|SQLITE/).click();
    await panel(win).getByRole("tab", { name: /What this click changed · 1/ }).click({ timeout: 15_000 });
    const added = panel(win).locator(".insp-crow.added");
    await added.waitFor();
    assert.match(await added.innerText(), /checkout_started/);
    await snap(app, "shop-06-events-added");

    // 0: back to the app, still alive and recording.
    await key(win, "0");
    await panel(win).waitFor({ state: "detached" });
    const n = (await acts(win)).length;
    await guest.getByRole("button", { name: "Refresh orders" }).click();
    await waitFor("a new trip after returning", async () => (await acts(win)).length > n && (await acts(win)).some((a) => a.label === 'Clicked "Refresh orders"' && a.complete), 20_000);
    await sleep(800);
    await snap(app, "shop-07-back-to-app");
  } finally {
    await cleanup();
  }
});
