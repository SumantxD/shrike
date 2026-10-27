// The Thread's camera follows every focus move, even onto the step already in focus after the feed was scrolled away
// (by the wheel, or a click on another trip's header): ! and "where did it break" land on the break it was on.
// Run `pnpm build` first (or SHRIKE_E2E_APP=<a build kept apart from out/>).
import { test } from "node:test";
import type { Page } from "playwright";
import { addTodoAction, dismissResult, fixtureCopy, freePort, key, launch, openFolder, shot, sleep, typeTodo, waitFor } from "./helpers.ts";

const inView = (win: Page) =>
  win.evaluate(() => {
    const st = document.querySelector(".th-trip.focus .th-st.focus")?.getBoundingClientRect();
    const feed = document.querySelector(".th-feed")?.getBoundingClientRect();
    return !!st && !!feed && st.top >= feed.top && st.bottom <= feed.bottom;
  });

test("thread camera: ! brings the break into view after the feed scrolled away from it", { timeout: 300_000 }, async () => {
  const [web, api] = [Number(process.env.SHRIKE_E2E_WEB) || (await freePort()), Number(process.env.SHRIKE_E2E_API) || (await freePort())];
  const proj = fixtureCopy("todo-app", { ports: { 5173: web, 3001: api } });
  const { app, win, cleanup } = await launch({ SHRIKE_OPEN_FOLDER: proj });
  try {
    await openFolder(win);
    await win.getByRole("banner").getByRole("button", { name: "Run", exact: true }).click();
    const guest = await waitFor("the todo app in the app pane", () => app.windows().find((p) => p.url().startsWith(`http://localhost:${web}`)), 120_000);
    await guest.getByText("Fix the signup page on mobile").waitFor({ timeout: 30_000 });
    await dismissResult(win, 4000);
    await typeTodo(guest, "buy milk");
    await guest.getByRole("button", { name: "Add Todo" }).click();
    const broke = await addTodoAction(win);
    await win.locator(`.th-trip[data-trip="${broke.id}"]`).waitFor();
    await dismissResult(win, 4000);
    await sleep(2500);
    await key(win, "Escape"); // surface from the auto-dive
    await sleep(800);
    await waitFor("the break in view", () => inView(win), 5000);

    await win.locator(".th-feed").hover();
    for (let i = 0; i < 10; i++) await win.mouse.wheel(0, -400);
    await waitFor("the break scrolled out of view", async () => !(await inView(win)), 5000);
    await key(win, "!");
    await waitFor("! to focus the break", async () => (await win.locator(".th-trip.focus").getAttribute("data-trip")) === broke.id, 5000);
    await waitFor("the camera on the break", () => inView(win), 3000);

    // #15: clicking a step's label selects it exactly as clicking its dot does.
    const other = await win.evaluate(() => {
      const focus = document.querySelector(".th-trip.focus .th-st.focus")?.getAttribute("data-i");
      const lab = [...document.querySelectorAll(".th-trip.focus .th-lab[data-i]")].find((el) => el.getAttribute("data-i") !== focus);
      return lab?.getAttribute("data-i") ?? null;
    });
    if (other !== null) {
      await win.locator(`.th-trip.focus .th-lab[data-i="${other}"]`).click();
      await waitFor("the label click to focus its step", async () => (await win.locator(".th-trip.focus .th-st.focus").getAttribute("data-i")) === other, 5000);
    }
  } catch (err) {
    await shot(app, "failure", "tc").catch(() => {});
    throw err;
  } finally {
    await cleanup();
  }
});
