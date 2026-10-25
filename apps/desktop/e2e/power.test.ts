// Power features on the sample todo app, in the BUILT app: telemetry strip (A17), point mode (O1), drag to Ask (O8),
// slash palette (A10), quick open (O5), the issue card (O6) and the shortcuts card (H17). Run `pnpm build` first. Uses ports 5173/3001.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { actions, addTodoAction, launch, listening, openSampleAndRun, shot, sleep, typeTodo, waitFor } from "./helpers.ts";


test("power: telemetry, point mode, drag to Ask, slash palette, quick open, issue copy, shortcuts card", { timeout: 300_000 }, async () => {
  assert.equal(listening([5173, 3001]), "", "todo ports must be free");
  const { app, win, userData, cleanup } = await launch();
  const ISSUES = join(userData, "sample/todo-app/.shrike/issues"); // the sample opens as a copy in userData
  try {
    await win.emulateMedia({ reducedMotion: "no-preference" });
    const guest = await openSampleAndRun(app, win);
    await typeTodo(guest, "buy milk");
    await guest.getByRole("button", { name: "Add Todo" }).click();
    const broke = await addTodoAction(win);
    await win.locator(".th-trip.focus .th-dive").waitFor({ timeout: 15_000 });
    await win.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await win.keyboard.press("Escape"); // surface from the auto-dive


    // O1: X starts point mode; hovering outlines the element, the click is caught and becomes Ask context.
    await win.keyboard.press("x");
    await sleep(300);
    const add = guest.getByRole("button", { name: "Add Todo" });
    await add.hover();
    const tag = guest.locator('[data-shrike-point="tag"]');
    await waitFor("the hover label", async () => (await tag.textContent()) === "button · Add Todo", 5000);
    await sleep(300);
    await shot(app, "power-01-point-hover");
    const before = (await actions(win)).length;
    await add.click();
    const ask = win.getByRole("dialog", { name: "Ask your agent" });
    await ask.waitFor();
    const chips = ask.getByLabel("Context for the agent");
    await chips.getByText(/Add Todo/).waitFor();
    assert.match(await chips.innerText(), /TodoForm\.tsx:31/);
    assert.equal(await ask.getByRole("textbox", { name: "Ask your agent" }).inputValue(), "Why doesn't this work?", "the last Add Todo broke");
    await sleep(800);
    assert.equal((await actions(win)).length, before, "the picked click never reached the page");
    await shot(app, "power-02-point-chip");

    // A10: "/" opens the command palette; typing filters it.
    const input = ask.getByRole("textbox", { name: "Ask your agent" });
    await input.fill("");
    await input.pressSequentially("/");
    const palette = ask.getByRole("listbox", { name: "Commands" });
    await palette.waitFor();
    const rows = await palette.getByRole("option").allInnerTexts().then((x) => x.map((s) => s.split(/\s/)[0]));
    assert.deepEqual(rows.slice(0, 7), ["/explain", "/fix", "/replay", "/compare", "/record", "/time", "/issue"], "built-ins first; saved commands and skills follow (S6)");
    assert.ok(rows.length <= 9);
    await shot(app, "power-03-slash-palette");
    await input.pressSequentially("fi");
    assert.deepEqual(await palette.getByRole("option").allInnerTexts().then((x) => x.map((s) => s.split(/\s/)[0])), ["/fix", "/files", "/fix-conflicts"], "the built-ins, then the Fix merge conflicts skill");
    await input.fill("");
    await win.keyboard.press("Escape"); // closes Ask; chips stay for the next ask
    await ask.waitFor({ state: "detached" });

    // O8: drag the failing station onto the top bar's Ask button; it becomes a context chip.
    // The real dragstart/dragover/drop handlers run with one DataTransfer (Playwright's mouse drag doesn't start HTML5 drags over Electron reliably).
    await win.evaluate((id) => {
      const from = document.querySelector<HTMLElement>(`.th-trip[data-trip="${id}"] .th-st.error`)!;
      const to = [...document.querySelectorAll<HTMLElement>("header button")].find((b) => /Ask/.test(b.textContent ?? ""))!;
      const dataTransfer = new DataTransfer();
      from.dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer }));
      for (const type of ["dragenter", "dragover", "drop"]) to.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer }));
      from.dispatchEvent(new DragEvent("dragend", { bubbles: true, dataTransfer }));
    }, broke.id);
    await win.keyboard.press("Meta+k");
    await ask.waitFor();
    await waitFor("the dropped station as a chip", async () => (await chips.getByRole("button", { name: /^Remove / }).count()) >= 2, 5000);
    console.log(`chips: ${await chips.innerText()}`);
    assert.match(await chips.innerText(), /insertTodo\(\)|INSERT INTO todos/);
    await sleep(300);
    await shot(app, "power-04-drag-chip");
    await win.keyboard.press("Escape");
    await ask.waitFor({ state: "detached" });

    // O5: ⌘P finds files fuzzily and opens them in the in-app file view.
    await win.keyboard.press("Meta+p");
    const qo = win.getByRole("dialog", { name: "Quick open" });
    await qo.waitFor();
    await qo.getByRole("combobox").pressSequentially("todcon");
    const firstOption = qo.getByRole("option").first();
    await waitFor("todos.controller.ts first", async () => /todos\.controller\.ts/.test(await firstOption.innerText()), 5000);
    await shot(app, "power-05-quick-open");
    await win.keyboard.press("Enter");
    await win.locator(".fv").waitFor();
    assert.match(await win.locator(".fv-head .f").innerText(), /server\/todos\.controller\.ts/i);
    await sleep(400);
    await shot(app, "power-06-file-view");
    await win.keyboard.press("Escape");
    await win.locator(".fv").waitFor({ state: "detached" });

    // O6: the share icon writes the trip up; Copy for GitHub puts the markdown on the clipboard and the file is saved.
    await win.getByRole("banner").getByRole("button", { name: "Write this trip up as an issue" }).click();
    const card = win.getByRole("dialog", { name: "Issue for this trip" });
    await card.getByRole("button", { name: "Copy for GitHub" }).and(card.locator(":enabled")).waitFor({ timeout: 10_000 });
    await app.evaluate(({ clipboard }) => clipboard.writeText(""));
    await card.getByRole("button", { name: "Copy for GitHub" }).click();
    const copied = await waitFor("the clipboard", async () => {
      const t = await app.evaluate(({ clipboard }) => clipboard.readText());
      return t.includes(broke.id) ? t : undefined;
    }, 5000);
    console.log(copied.split("\n").slice(0, 12).join("\n"));
    assert.match(copied, /^# /);
    assert.match(copied, /todos\.controller\.ts:18/);
    assert.ok(readdirSync(ISSUES).some((f) => f.endsWith(".md")), "the issue is saved under .shrike/issues");
    await sleep(300);
    await shot(app, "power-07-issue-card");
    await win.keyboard.press("Escape");

    // H17: ? lists every key, Esc or ? closes it, focus goes back where it was, and it never opens while typing.
    const share = win.getByRole("banner").getByRole("button", { name: "Write this trip up as an issue" });
    await share.focus();
    await win.keyboard.press("?");
    const keys = win.getByRole("dialog", { name: "Keyboard shortcuts" });
    await keys.waitFor();
    for (const g of ["Move", "Look", "Panels", "Agent"]) await keys.getByRole("heading", { name: g }).waitFor();
    await keys.getByText("Next failure").waitFor();
    assert.ok(await keys.evaluate((el) => el.contains(document.activeElement)), "focus moves into the card");
    await sleep(300);
    await shot(app, "power-08-shortcuts");
    await win.keyboard.press("Escape");
    await keys.waitFor({ state: "detached" });
    assert.ok(await share.evaluate((el) => el === document.activeElement), "focus goes back on close");
    await win.keyboard.press("?");
    await keys.waitFor();
    await win.keyboard.press("?");
    await keys.waitFor({ state: "detached" });
    await win.keyboard.press("Meta+k");
    await waitFor("the composer to take focus", () => win.evaluate(() => /^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName ?? "")), 5000);
    await win.keyboard.type("?");
    await sleep(300);
    assert.equal(await keys.count(), 0, "? types into the composer instead");
    assert.match(await win.evaluate(() => (document.activeElement as HTMLTextAreaElement).value), /\?$/);
    await win.keyboard.press("Backspace");
    await win.keyboard.press("Escape");

    await win.getByRole("banner").getByRole("button", { name: "Stop", exact: true }).click();
    await waitFor("todo ports to close", () => listening([5173, 3001]) === "", 20_000);
  } catch (err) {
    await shot(app, "power-failure").catch(() => {});
    throw err;
  } finally {
    await cleanup();
  }
  await waitFor("todo ports to close", () => listening([5173, 3001]) === "", 20_000);
});
