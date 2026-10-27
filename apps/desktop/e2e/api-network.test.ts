// The API client against a host that misbehaves: nothing listening, a certificate nobody trusts, a binary answer and a
// 12MB one. Each ends in a plain answer and the window keeps drawing. Run `pnpm build` first (or SHRIKE_E2E_APP=<a build>).
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { createServer as createHttps } from "node:https";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Page } from "playwright";
import { fixtureCopy, key, launch, openFolder, shot, sleep, waitFor } from "./helpers.ts";

const LINE = `${"GET /api/todos 200 ok, user 7 saved a todo called buy milk ".repeat(4)}\n`;

async function longestFrameGap(win: Page, during: () => Promise<void>): Promise<number> {
  await win.evaluate(() => {
    const w = window as unknown as { __gap: number; __last: number; __on: boolean };
    Object.assign(w, { __gap: 0, __last: performance.now(), __on: true });
    const tick = () => {
      const now = performance.now();
      w.__gap = Math.max(w.__gap, now - w.__last);
      w.__last = now;
      if (w.__on) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await during();
  await sleep(1500);
  return win.evaluate(() => {
    const w = window as unknown as { __gap: number; __on: boolean };
    w.__on = false;
    return Math.round(w.__gap);
  });
}

test("api client: unreachable, untrusted TLS, binary and a huge answer end in a clear state without freezing", { timeout: 300_000 }, async () => {
  const huge = Buffer.from(LINE.repeat(Math.ceil((12 * 1024 * 1024) / LINE.length)));
  const srv = createServer((q, r) => {
    if (q.url === "/bin") return void r.writeHead(200, { "content-type": "application/octet-stream" }).end(Buffer.from([0, 1, 2, 3, 255]));
    if (q.url === "/json") return void r.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ todos: [{ id: 1, title: "buy milk" }] }));
    if (q.url === "/text") return void r.writeHead(200, { "content-type": "text/plain" }).end("hello");
    r.writeHead(200, { "content-type": "text/plain" }).end(huge);
  }).listen(0, "127.0.0.1");
  await new Promise((r) => srv.once("listening", r));
  const port = (srv.address() as AddressInfo).port;
  const dir = mkdtempSync(join(tmpdir(), "shrike-e2e-tls-"));
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", join(dir, "k.pem"), "-out", join(dir, "c.pem"), "-days", "1", "-subj", "/CN=localhost"], { stdio: "ignore" });
  const tls = createHttps({ key: readFileSync(join(dir, "k.pem")), cert: readFileSync(join(dir, "c.pem")) }, (_q, r) => r.end("secure")).listen(0, "127.0.0.1");
  await new Promise((r) => tls.once("listening", r));
  const proj = fixtureCopy("todo-app");
  const saveDir = mkdtempSync(join(tmpdir(), "shrike-e2e-save-"));
  const { app, win, cleanup } = await launch({ SHRIKE_OPEN_FOLDER: proj, SHRIKE_SAVE_DIR: saveDir });
  try {
    await win.emulateMedia({ reducedMotion: "reduce" });
    await openFolder(win);
    const closeSetup = win.getByRole("button", { name: "Close setup" });
    if (await closeSetup.isVisible({ timeout: 3000 }).catch(() => false)) await closeSetup.click();
    await key(win, "a");
    const sheet = win.getByRole("region", { name: "API client" });
    await sheet.waitFor();
    const send = async (url: string) => {
      await sheet.getByRole("textbox", { name: "URL", exact: true }).fill(url);
      await sheet.getByRole("button", { name: "Send", exact: true }).click();
    };

    await send("http://127.0.0.1:1/health");
    await sheet.getByText("Nothing is listening on 127.0.0.1:1. Is your app running?").waitFor({ timeout: 10_000 });
    await shot(app, "api-net-01-unreachable");

    await send(`https://127.0.0.1:${(tls.address() as AddressInfo).port}/`);
    await sheet.getByText(/has a certificate Shrike doesn't trust/).waitFor({ timeout: 10_000 });
    await shot(app, "api-net-02-tls");

    await send(`http://127.0.0.1:${port}/bin`);
    await sheet.getByText(/A binary answer \(application\/octet-stream, 5 B\)/).waitFor({ timeout: 10_000 });
    await shot(app, "api-net-03-binary");

    // Save writes the binary answer to a file, byte for byte, and the text answer as it came back.
    await sheet.getByRole("button", { name: "Save the response body" }).click();
    const binFile = await waitFor("the saved binary file", async () => {
      const files = readdirSync(saveDir);
      return files.length > 0 ? join(saveDir, files[0]!) : false;
    }, 5000);
    assert.deepEqual([...readFileSync(binFile)], [0, 1, 2, 3, 255]);
    const before = new Set(readdirSync(saveDir));
    await send(`http://127.0.0.1:${port}/text`);
    await sheet.getByText("hello").first().waitFor({ timeout: 10_000 });
    await sheet.getByRole("button", { name: "Save the response body" }).click();
    const textFile = await waitFor("the saved text file", async () => {
      const fresh = readdirSync(saveDir).filter((f) => !before.has(f));
      return fresh.length > 0 ? join(saveDir, fresh[0]!) : false;
    }, 5000);
    assert.equal(readFileSync(textFile, "utf8"), "hello");

    const prettyGap = await longestFrameGap(win, async () => {
      await send(`http://127.0.0.1:${port}/huge`);
      await sheet.getByText(/\(cut\)/).waitFor({ timeout: 30_000 });
    });
    await shot(app, "api-net-04-huge");
    const rawGap = await longestFrameGap(win, () => sheet.getByRole("tab", { name: "Raw" }).click());
    console.log(`longest frame gap: pretty ${prettyGap}ms, raw ${rawGap}ms`);
    assert.ok(prettyGap < 1000 && rawGap < 1000, `the window froze for ${Math.max(prettyGap, rawGap)}ms on a 12MB answer`);
    await sheet.getByText(/Showing the first/).first().waitFor();
    await shot(app, "api-net-05-huge-raw");

    const findInput = sheet.getByRole("textbox", { name: "Find in the response" });
    await findInput.waitFor();
    const typeGap = await longestFrameGap(win, () => findInput.pressSequentially("buy milk", { delay: 10 }));
    console.log(`longest frame gap: pretty ${prettyGap}ms, raw ${rawGap}ms, find typing ${typeGap}ms`);
    assert.ok(typeGap < 1000, `the window froze for ${typeGap}ms while typing in Find on a 12MB answer`);

    const count = sheet.locator(".ap-find-count");
    await count.waitFor();
    const text1 = await count.innerText();
    assert.match(text1, /^1 of \d+$/, `expected count to be '1 of M', got '${text1}'`);
    const total = text1.split(" of ")[1]!;

    await findInput.press("Enter");
    await sheet.getByText(`2 of ${total}`).waitFor({ timeout: 5000 });
    assert.equal(await count.innerText(), `2 of ${total}`);

    await findInput.press("Shift+Enter");
    await sheet.getByText(`1 of ${total}`).waitFor({ timeout: 5000 });
    assert.equal(await count.innerText(), `1 of ${total}`);

    await findInput.fill("nonexistentqueryxyz");
    await sheet.getByText("No matches").waitFor({ timeout: 5000 });

    // Esc clears Find: the text, the highlights and the count go, and the API client stays open.
    await findInput.fill("buy milk");
    await count.waitFor();
    await findInput.press("Escape");
    await count.waitFor({ state: "detached", timeout: 5000 });
    assert.equal(await findInput.inputValue(), "");
    assert.equal(await sheet.locator("mark.hit").count(), 0);
    assert.ok(await sheet.isVisible(), "the API client closed on the Esc that cleared Find");

    // The same in non-JSON Pretty.
    await sheet.getByRole("tab", { name: "Pretty" }).click();
    await findInput.waitFor({ timeout: 5000 });
    await findInput.fill("buy milk");
    await count.waitFor();
    await findInput.press("Escape");
    await count.waitFor({ state: "detached", timeout: 5000 });
    assert.equal(await findInput.inputValue(), "");
    assert.equal(await sheet.locator("mark.hit").count(), 0);
    assert.ok(await sheet.isVisible());
    await shot(app, "api-net-06-huge-find");

    // And in the Pretty JSON tree, which lights keys and values with .hit.
    await send(`http://127.0.0.1:${port}/json`);
    await sheet.locator(".ap-json").waitFor({ timeout: 10_000 });
    await findInput.fill("milk");
    await sheet.locator(".ap-json .hit").first().waitFor({ timeout: 5000 });
    await findInput.press("Escape");
    assert.equal(await findInput.inputValue(), "");
    await sheet.locator(".ap-json .hit").first().waitFor({ state: "detached", timeout: 5000 });
    assert.ok(await sheet.isVisible());
  } finally {
    await cleanup();
    srv.close();
    tls.close();
    rmSync(dir, { recursive: true, force: true });
    rmSync(saveDir, { recursive: true, force: true });
    rmSync(join(proj, ".."), { recursive: true, force: true });
  }
});
