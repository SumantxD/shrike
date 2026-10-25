// Killer demo on the Thread, driven like a user against the BUILT app. Run `pnpm build` first, then `pnpm --filter @shrike/desktop e2e`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Page } from "playwright";
import { actions, addTodoAction, caption, flatten, isListening, launch, openSampleAndRun, shot, sleep, tripDom, typeTodo, waitFor, type StationInfo } from "./helpers.ts";

const SCREEN = "caller", PAGE = "client", SERVER = "service", DATABASE = "data"; // lanes by place kind

const key = async (win: Page, k: string) => {
  await win.keyboard.press(k);
  await sleep(150);
};
const waitCaption = (win: Page, re: RegExp) => waitFor(`the caption to match ${re}`, async () => re.test(await caption(win)), 10_000);
const focusedTrip = (win: Page) => win.locator(".th-trip.focus").getAttribute("data-trip");
const focusedStation = (win: Page) => win.locator(".th-trip.focus .th-st.focus").getAttribute("data-i");

test("killer demo: click Add Todo, the trip snaps in DATABASE and dives into the bad value", { timeout: 300_000 }, async () => {
  const tmp = mkdtempSync(join(tmpdir(), "shrike-e2e-editor-"));
  const editorLog = join(tmp, "opened.txt");
  const { app, win, cleanup } = await launch({ SHRIKE_EDITOR_LOG: editorLog });
  try {
    await win.emulateMedia({ reducedMotion: "no-preference" }); // play the motion even if this Mac has Reduce Motion on
    await win.getByRole("button", { name: "Open the sample project" }).waitFor();
    await sleep(600);
    await shot(app, "01-welcome");

    const guest = await openSampleAndRun(app, win);
    const opened = await waitFor('the "Opened /" trip', async () => (await actions(win)).find((a) => a.label === "Opened /" && a.complete));
    await win.locator(`.th-trip[data-trip="${opened.id}"]`).waitFor();
    await sleep(800);
    await shot(app, "02-running");

    // Do what the user does.
    await typeTodo(guest, "buy milk");
    await guest.getByRole("button", { name: "Add Todo" }).click();
    await guest.getByText("Something went wrong").waitFor();

    // The pipeline recorded the real story.
    const view = await addTodoAction(win);
    assert.equal(view.status, "error");
    const insert = flatten(view.tree).find((e) => e.name === "insertTodo()");
    assert.equal(`${insert?.callSite?.file}:${insert?.callSite?.line}`, "server/todos.controller.ts:18");

    // M1: the new trip arrives at the bottom and draws; caught mid-drop.
    const trip = win.locator(`.th-trip[data-trip="${view.id}"]`);
    await trip.waitFor();
    await sleep(500);
    await shot(app, "03-arriving");

    // M4: it lands on insertTodo() and dives into the controller with line 18 lit and the bad value inline.
    const dive = trip.locator(".th-dive");
    await dive.waitFor({ timeout: 15_000 });
    await waitCaption(win, /insertTodo\(\)/);
    await dive.locator(".th-ln.live").waitFor();
    const head = await dive.locator(".head .f").innerText();
    assert.match(head, /server\/todos\.controller\.ts|server\/db\.ts/i);
    const live = await dive.locator(".th-ln.live").innerText();
    assert.match(live, /^18/, `live line is 18: ${live}`);
    assert.match(live, /insertTodo/);
    assert.ok(await dive.locator(".th-ln.live.error").count(), "the live line is lit red");
    assert.match(await dive.locator(".th-chip.error").first().innerText(), /userId: undefined/);
    await sleep(700);
    await shot(app, "04-dived-line-18");

    // The trip as drawn: header, stations in order with lanes, the snap, the return words.
    const t = (await tripDom(win, view.id))!;
    assert.equal(t.title, 'Clicked "Add Todo"');
    assert.equal(t.verdict, "BROKE");
    assert.equal(t.returned, "Server error (500)");
    const order = (label: RegExp, lane: string, where?: RegExp, from = 0): number => {
      const i = t.stations.findIndex((s, k) => k >= from && label.test(s.label));
      assert.ok(i >= 0, `station ${label} after ${from}\n${t.stations.map((s: StationInfo) => `${s.lane} ${s.label} | ${s.where} | ${s.chip}`).join("\n")}`);
      const s = t.stations[i]!;
      assert.equal(s.kind, lane, `${s.label} is in lane ${lane} (${s.lane})`);
      if (where) assert.match(s.where, where);
      return i;
    };
    let i = order(/^onClick$/, PAGE, /TodoForm\.tsx:31/);
    i = order(/^fetch POST \/api\/todos$/, PAGE, /api\.ts:12/, i + 1);
    i = order(/^POST \/api\/todos$/, SERVER, undefined, i + 1);
    i = order(/^createTodo\(\)$/, SERVER, undefined, i + 1);
    i = order(/^log "creating todo/, SERVER, undefined, i + 1);
    i = order(/^insertTodo\(\)$/, SERVER, /called at todos\.controller\.ts:18/, i + 1);
    assert.match(t.stations[i]!.chip, /userId: undefined/);
    const snap = order(/^INSERT INTO todos/, DATABASE, undefined, i + 1);
    assert.match(t.stations[snap]!.cls, /\berror\b/, "the snap station is red");
    assert.match(t.stations[snap]!.chip, /NOT NULL constraint failed/);
    assert.ok(!t.stations.some((s) => s.kind === SCREEN), "SCREEN holds shots, not stations");

    // #82: Copy puts the trip on the clipboard as a few plain lines.
    await trip.locator(".th-acts button", { hasText: "Copy" }).click();
    const copied = await waitFor("the clipboard", async () => {
      const text = await app.evaluate(({ clipboard }) => clipboard.readText());
      return text.startsWith('Clicked "Add Todo"') ? text : undefined;
    }, 5000);
    assert.match(copied, /^Clicked "Add Todo": BROKE \(\d+ms\)$/m);
    assert.match(copied, /^Server error \(500\)$/m);
    assert.match(copied, /^\d+\. insertTodo\(\) .*<- broke here/m);
    assert.match(copied, /userId: undefined/);

    // BEFORE is the real screenshot of the app at the click.
    const img = trip.locator(".th-shot img").first();
    await img.waitFor({ timeout: 10_000 });
    assert.ok(await img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 100), "the BEFORE shot is a real image");

    // E opens the whole file inside Shrike, on the call line, with the bad value inline.
    await win.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await key(win, "e");
    const fv = win.locator(".fv");
    await fv.waitFor({ timeout: 5000 });
    assert.match(await fv.locator(".fv-head .f").innerText(), /server\/todos\.controller\.ts/i);
    const liveLine = fv.locator('.th-ln.live');
    await liveLine.waitFor({ timeout: 5000 });
    assert.equal(await liveLine.locator("i").innerText(), "18");
    assert.match(await liveLine.innerText(), /userId: undefined/);
    await sleep(400);
    await shot(app, "04b-file-view");
    // Esc closes the file view first, then surfaces from the dive. Nothing went to an external editor.
    await key(win, "Escape");
    await fv.waitFor({ state: "detached" });
    assert.ok(!existsSync(editorLog) || !readFileSync(editorLog, "utf8").trim(), "no external editor was opened");

    // ↑/↓ step through the stations; the caption follows.
    await key(win, "Escape");
    await dive.waitFor({ state: "detached" });
    await key(win, "ArrowDown");
    await waitCaption(win, /database refused/i);
    assert.equal(await focusedStation(win), String(snap));
    await sleep(500);
    await shot(app, "05-step-down-database");
    await key(win, "ArrowUp");
    await key(win, "ArrowUp");
    await waitCaption(win, /creating todo/);
    await sleep(500);
    await shot(app, "06-step-up-log");

    // T: time view moves stations to real time, and back.
    const ys = async () => (await tripDom(win, view.id))!.stations.map((s) => s.y).join(",");
    const even = await ys();
    await key(win, "t");
    await waitFor("stations to move in time view", async () => (await ys()) !== even, 5000);
    assert.ok(await trip.locator(".th-ruler").count(), "time view shows the ruler");
    await sleep(700);
    await shot(app, "07-time-view");
    await key(win, "t");
    await waitFor("even spacing again", async () => (await ys()) === even, 5000);

    // Minimap: jump to the page-load trip, then ! back to the failure.
    await win.getByRole("navigation", { name: "Trips" }).getByRole("button", { name: /^Opened \// }).click();
    await waitFor("the page-load trip in focus", async () => (await focusedTrip(win)) === opened.id, 5000);
    await sleep(700);
    await shot(app, "08-minimap-jump");
    await win.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await key(win, "!");
    await waitFor("! to jump to the failure", async () => (await focusedTrip(win)) === view.id && (await focusedStation(win)) === String(i), 5000);
    await waitCaption(win, /insertTodo\(\)/);
    await sleep(700);
    await shot(app, "09-next-failure");

    // T24: the broke badge counts the broken trips and jumps to the latest one.
    const minimap = win.getByRole("navigation", { name: "Trips" });
    const badge = minimap.getByRole("button", { name: /trips? broke\. Show the latest/ });
    await waitFor("the broke badge to read 1 broke", async () => (await badge.innerText()).replace(/\s+/g, " ").trim() === "1 broke", 5000);
    await minimap.getByRole("button", { name: /^Opened \// }).click();
    await waitFor("the page-load trip in focus again", async () => (await focusedTrip(win)) === opened.id, 5000);
    await badge.click();
    await waitFor("the badge to jump back to the failure", async () => (await focusedTrip(win)) === view.id, 5000);
    await waitCaption(win, /insertTodo\(\)/);

    // Sheets, one at a time, with real data.
    await key(win, "g");
    await win.getByRole("region", { name: "Logs" }).getByText(/creating todo/).first().waitFor();
    await shot(app, "10-logs");
    await key(win, "Escape");

    await key(win, "n");
    const net = win.getByRole("region", { name: "Network" });
    await net.getByText("/api/todos").first().waitFor();
    await net.getByText("Server error (500)").first().waitFor();
    await shot(app, "11-network");
    await key(win, "Escape");

    await key(win, "a");
    const apiSheet = win.getByRole("region", { name: "API client" });
    await apiSheet.getByRole("combobox", { name: "Method" }).selectOption("GET");
    await apiSheet.getByRole("textbox", { name: "URL", exact: true }).fill("/api/todos");
    await apiSheet.getByRole("button", { name: "Send", exact: true }).click();
    await waitFor("a 200 explorer action", async () => (await actions(win)).find((a) => a.label === "Sent GET /api/todos" && a.complete && a.status === "ok"));
    await apiSheet.getByText("OK (200)").first().waitFor();
    await shot(app, "12-api");
    await win.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await key(win, "Escape");
    await apiSheet.waitFor({ state: "detached" });

    await key(win, "`");
    await win.getByRole("region", { name: "Terminal" }).getByText(/API ready on port 3001/).first().waitFor();
    await shot(app, "13-terminal");
    await key(win, "Escape");

    // Stop.
    await win.getByRole("banner").getByRole("button", { name: "Stop", exact: true }).click();
    await win.getByRole("banner").getByRole("button", { name: "Run", exact: true }).waitFor({ timeout: 15_000 });
    await waitFor("ports 5173 and 3001 to close", async () => !(await isListening(5173)) && !(await isListening(3001)), 10_000);
    await shot(app, "14-stopped");
  } catch (err) {
    await shot(app, "failure").catch(() => {});
    console.error(JSON.stringify((await actions(win).catch(() => [])).map((a) => [a.label, a.status, a.complete])));
    throw err;
  } finally {
    await cleanup();
    rmSync(tmp, { recursive: true, force: true });
  }
});
