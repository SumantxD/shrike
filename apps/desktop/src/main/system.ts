import { app, dialog, shell, type BrowserWindow } from "electron";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { resolveInside } from "./files.ts";
import { defaultShell, isWin } from "./platform.ts";

// Tries each editor CLI in order; prints the one that opened the file. File and line arrive as $1 and $2, never interpolated.
const EDITOR_SCRIPT = `
f="$1"; l="$2"
has() { command -v "$1" >/dev/null 2>&1; }
if has cursor; then cursor -g "$f:$l" >/dev/null 2>&1 && { echo Cursor; exit 0; }; fi
if has code; then code -g "$f:$l" >/dev/null 2>&1 && { echo "VS Code"; exit 0; }; fi
if has zed; then zed "$f:$l" >/dev/null 2>&1 && { echo Zed; exit 0; }; fi
if has webstorm; then webstorm --line "$l" "$f" >/dev/null 2>&1 && { echo WebStorm; exit 0; }; fi
exit 3
`;

function tryCli(abs: string, line: number): Promise<string | undefined> {
  if (isWin) return Promise.resolve(undefined); // ponytail: Windows opens the file in its default app. Upgrade: try code.cmd -g through cmd.exe.
  return new Promise((resolve) => {
    execFile(defaultShell(), ["-lc", EDITOR_SCRIPT, "shrike", abs, String(line)], { timeout: 15_000 }, (err, stdout) => {
      resolve(err ? undefined : stdout.trim().split("\n").pop() || undefined);
    });
  });
}

export async function openInEditor(root: string, file: string, line: number): Promise<{ ok: boolean; editor?: string; error?: string }> {
  let abs: string;
  try {
    abs = resolveInside(root, file);
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
  if (!existsSync(abs)) return { ok: false, error: `That file doesn't exist: ${file}` };
  // ponytail: test-only stand-in for the editor CLI.
  if (process.env.SHRIKE_EDITOR_LOG) {
    await appendFile(process.env.SHRIKE_EDITOR_LOG, `${file}:${line}\n`);
    return { ok: true, editor: "test editor" };
  }
  const editor = await tryCli(abs, line);
  if (editor) return { ok: true, editor };
  const failed = await shell.openPath(abs);
  return failed ? { ok: false, error: `Couldn't open ${file}: ${failed}` } : { ok: true, editor: "default app" };
}

export async function saveClip(win: BrowserWindow | undefined, project: string, bytes: Uint8Array, ext: "webm" | "mp4"): Promise<string | null> {
  const d = new Date();
  const time = new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 19).replace(/[T:]/g, "-"); // local time
  const safe = project.replace(/[^\w.-]+/g, "-") || "app";
  const name = `shrike-${safe}-${time}.${ext}`;
  let path: string | undefined;
  // ponytail: test-only bypass of the save dialog.
  if (process.env.SHRIKE_SAVE_DIR) path = join(process.env.SHRIKE_SAVE_DIR, name);
  else {
    const opts = { title: "Save clip", defaultPath: join(app.getPath("videos"), name), filters: [{ name: "Video", extensions: [ext] }] };
    const r = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts);
    if (r.canceled || !r.filePath) return null;
    path = r.filePath;
  }
  await writeFile(path, bytes);
  return path;
}

/** AP-res: a save dialog for a response body, text as it came back or binary as bytes. */
export async function saveResponseBody(win: BrowserWindow | undefined, bytes: Uint8Array, name: string): Promise<string | null> {
  const safe = name.replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "") || "response.txt";
  let path: string;
  // ponytail: test-only bypass of the save dialog, like saveClip.
  if (process.env.SHRIKE_SAVE_DIR) path = join(process.env.SHRIKE_SAVE_DIR, safe);
  else {
    const opts = { title: "Save response body", defaultPath: join(app.getPath("downloads"), safe) };
    const r = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts);
    if (r.canceled || !r.filePath) return null;
    path = r.filePath;
  }
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, bytes);
  return path;
}
