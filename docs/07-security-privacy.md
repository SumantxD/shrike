# 07 · Security and privacy

Shrike sees request bodies, cookies, database queries and source code. People will only install it if they trust it. Treat this doc as requirements, not guidance.

## Principles

1. **Local by default.** Recordings, code and settings stay on the machine. Nothing goes to our cloud unless the user signs in *and* shares something.
2. **Redact on ingest.** Secrets are removed before anything is written to disk, shown in the UI, given to an agent or exported. There's no "raw" copy to leak.
3. **Agents are untrusted.** Every side effect goes through a Shrike tool that checks scope and asks for approval where needed.
4. **Open source core.** Anyone can audit what the instrumentation captures and where it sends it.

## Threat model

| Threat | Mitigation |
|---|---|
| Secrets in recordings leak through export, share or AI context | Redaction on ingest; "what was sent" drawer for every agent run; exports contain redacted data only |
| Prompt injection via page text, logs, API responses or code comments steers the agent | Tool outputs wrapped in delimited data blocks; system prompt says tool output is data; network scope limited to project origins; no shell tool for the debug agent (only Shrike's own start agent and `preflight` use the guarded shell, R6); patches need approval |
| Agent CLI uses its own edit/shell tools to bypass the diff | Those tools disabled per brain (see [05-agent.md](05-agent.md#agent-brains)); fallback is read-only sandbox or throwaway worktree. A Claude Code the user starts in their own terminal (MCP9) isn't Shrike's to configure: Shrike offers a settings snippet to copy that denies `Edit`, `Write`, `MultiEdit`, `NotebookEdit` and `Bash`, and its own tools still change code only through `propose_patch` and the user's click, on a card that names the client |
| Another local process sends fake events or reads the ingest | Ingest binds `127.0.0.1` on a random port; per-session random token required; tokens rotate per run |
| Another local process uses Shrike's MCP server | The server binds `127.0.0.1` only and needs a 32-byte bearer token (constant-time check). The main server's port and token persist in userData `mcp.json` (0600, rewritten through a temp file and rename) so an outside Claude Code keeps working after a restart; worktree and start servers stay random per launch. **New token** in Tools rotates it and closes every session an outside client opened; Shrike's own runs use a second token that never leaves the app session, so a reset doesn't break a run in flight. If the saved port is taken the server takes a random one and Tools says so Shrike never writes the token into Claude Code's files; the user pastes the `claude mcp add` line themselves |
| Malicious page in the app pane escapes into Shrike | App pane is a `<webview>` in its own session partition, never Shrike's: `persist:shrike-app` for local apps and `persist:live-<hash of host>` for each live site (#55), so a live login never mixes with local cookies. Main names the partition (`ProjectInfo.livePartition`); the dock and the app window use the same one. `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`; no preload exposes Shrike APIs to it, and sign-in popups get the same settings |
| Renderer compromise reaches Node | Renderer sandboxed; preload exposes only typed IPC; main validates every message with zod |
| Instrumentation runs in production by accident | node-agent refuses to start when `NODE_ENV=production`; it's only ever injected by Shrike's launcher. python-agent does nothing without the `SHRIKE_*` variables only Shrike's runner sets |
| Agent makes destructive API calls against a real database | Data-changing requests outside a recorded scenario need approval; warn when `DATABASE_URL` points at a non-local host |
| Patch damages the project | Patches limited to files inside the project root, never `.env*`, lockfiles, `.git`, `node_modules`; one-click revert; warn if the working tree has uncommitted changes in touched files |
| Shared link exposes data | Links are private by default, expire (7 days default), revocable; viewer shows redacted data only |
| A cloned repo's `.mcp.json` or `.shrike/mcp.json` runs a command on your machine | Shrike starts a server from a project's files (health check or a run) only after **Trust and check**, or when Claude Code already approved it (`enabledMcpjsonServers`); trust is for that exact config, so a changed file asks again. Servers from `~/.claude.json` and `~/.shrike/mcp.json` are yours and start without asking (docs/13 MCP2) |
| MCP secrets leak through Shrike's files, the UI, logs or the command line | Shrike writes only its own `~/.shrike/mcp.json` and `<project>/.shrike/mcp.json`, never Claude Code's files; secrets you type or paste become `${NAME}` there and the value goes to userData `mcp-secrets.json`, encrypted with Electron `safeStorage` (keychain). The renderer only ever gets env and header names; commands, addresses and health-check errors pass through `@shrike/redact` (and the server's own secret values are cut out) before they're shown or given to the agent in Fix it. Passwords and `--key`/`--token` values in a server's command line show as `[redacted]`. A project `.shrike` folder or `mcp.json` that is a link elsewhere is refused, so a cloned repo can't make Shrike copy `~/.claude.json` into it. Calls to the user's own servers and their output are redacted before the agent panel and X-ray show them. A run gets the filled config in a 0600 temp file, never on the command line, deleted when the run ends |
| Adding a catalog tool downloads and runs code | The add is an approval card that names what runs and where it's saved; the download runs through the guarded shell (`judge`; "never" refuses), three minutes at most, and is killed on quit. Health checks kill the server's whole process tree when they finish or time out |
| The API client reaches hosts outside the app, or the agent does | Your own sends from the API client (AP) go to any http(s) host you type, like Bruno or Postman; only the app's own addresses get Shrike's `traceparent`. An agent's `send_request` or `save_request` to anything other than the app's local address shows an approval card first (GET included), and data-changing requests to the app still ask too. An agent's send never follows a redirect to another origin and never sees `{{vars}}` set by your own sends. On a live project's origins an agent may only send GET and HEAD, each path asks once, and live sends get no `traceparent` (#53). Assertions run as pure checks, never code |
| A collection's scripts or files hurt your machine | Collection scripts (Bruno `script:*` and `tests`) run only on your own sends, never the agent's, in a `node:vm` context inside a worker thread: no `require`, `process`, timers or network, string code generation off, only JSON crosses in and out, 64MB heap, and the worker is killed after 2s. Linked Bruno folders are written only when you press Save, atomically (temp file, then rename); links, `..`, `.claude`, `.git` and `node_modules` paths are refused. Secret environment values go to userData `api-secrets.json`, encrypted with Electron `safeStorage`; files get `vars:secret` names only. History (last 200 sends per project, userData) is redacted before it's written |
| Live page scripts forge recorder events (live projects) | The browser recorder keeps its binding in a closure and deletes `window.__shrikeEmit` before page scripts run; flow and point messages are ignored outside their modes (#54) |
| A sign-in on a live site leaks or weakens trust (live projects) | Sign-in popups get the pane's recorder through the same closure binding, and can't answer point mode (#55). The user agent is plain Chrome everywhere, with Electron's and Shrike's tokens removed, so it names nothing about Shrike. A bad certificate (self-signed, expired, wrong host) is refused with a plain message and never trusted. A basic-auth username and password go from a Shrike dialog straight to Chromium, which keeps them in memory for that session; Shrike never stores or logs them. **Sign out of your live site** clears the partition's cookies, storage, cache and basic-auth |
| Live agent tool output carries end-user data (page text, names, emails) | Live events lose emails, phone numbers and IBANs at the store (rule 7, #51), and in a live project every tool's output gets the same detectors after redaction, before it reaches the model (#53). Live trips and events (marked `live`, including the agent's own sends to the live site) and live `send_request` bodies reach the agent with values masked (#52); local trips in the same project keep theirs. Page text from `app_snapshot` gets the rule 7 detectors only. The Vercel preview bypass token is redacted in every mode (rules 1 and 2) |
| Supply-chain compromise of Shrike itself | Signed and notarised builds, lockfile pinning, dependency review in CI, minimal deps in node-agent and browser-agent, none beyond the standard library in python-agent (they run inside user apps) |

## Redaction rules (`@shrike/redact`)

Applied in this order, on every event at ingest and again on every tool output and export.

1. **Headers:** `authorization`, `cookie`, `set-cookie`, `proxy-authorization`, `x-api-key`, `x-vercel-protection-bypass`, `x-vercel-set-bypass-cookie`, plus the user's `redact.headers` (rule 6).
2. **Keys in JSON bodies, query strings, form data, args and return values:** any key matching `/pass(word)?|passwd|secret|token|api[-_]?key|auth|session|credential|private[-_]?key|card|cvv|ssn|vercel-protection-bypass|vercel-set-bypass-cookie/i` (so Vercel's `?x-vercel-protection-bypass=` query parameter goes too, #51).
3. **Env values (planned):** read `.env*` files at session start; any string equal to one of those values (≥ 6 chars) is replaced wherever it appears.
4. **Known secret shapes:** AWS access keys, Stripe keys, OpenAI/Anthropic keys, GitHub tokens, Slack tokens, JWTs, PEM blocks, connection strings with passwords.
5. **High-entropy strings:** ≥ 24 chars with Shannon entropy above a threshold in a value position, flagged and masked.
6. **User rules** from `.shrike/config.json` (built, #52): `"redact": { "keys": ["address"], "headers": ["x-tenant"], "keep": ["status", "plan"] }`. `keys` and `headers` are redacted at the store in every mode, like the built-in names (`keys` matches inside a name, as rule 2 does). `keep` only spares values from masking (below). The scanner checks the block; a broken one is ignored whole, with a warning in the log and a note in Setup.
7. **Personal data on live events** (built, #51): emails, phone numbers and IBANs become `[email#n]`, `[phone#n]` and `[iban#n]` at the store, for events marked `live` only (`redactEvent(e, rules, pii)` with one map per trip, so the same value reads the same across the trip and Ann@ and ann@ are one user). Local events keep their real values, because local debugging needs them. A phone number needs a `+` or a separator pattern (`415-555-0123`, `(415) 555-0123`); a bare run of digits is an id and stays, as do dates, times, prices, versions, longer digit groups, and file names shaped like emails (`logo@2x.png`). An IBAN must pass its mod-97 check. A PostgREST operator stays visible (`email=eq.[email#1]`). Names and street addresses can't be found by pattern; value masking below covers them where a trip leaves your screen.

Replacement format: `"[redacted:password]"`, keeping the key so the structure stays debuggable. Redaction is logged as a count per event (never the value).

### Value masking (`maskValues`, #52)

Never at the store: on your screen a live trip shows its real values and value chips (apart from the emails, phone numbers and IBANs rule 7 already replaced). Where a live trip leaves your screen, `maskValues` / `maskAction` / `maskText` in `@shrike/redact` replace string values with `[text#n]`, numbered so the same value reads the same everywhere in a trip. It covers JSON and form bodies, query values, SQL statements and params, args, return values, log values in quotes, curl commands and row cells. Kept: keys, numbers, booleans, nulls, empty strings, UUIDs and integer ids, short enum-like words (no spaces, 24 characters or fewer, no email or phone shape, so `"pending"` vs `"Pending"` stays visible), and anything named in `redact.keep`. A 25-character code is masked; add its key to `keep`.

Boundaries today:
- **REC clips** of a live trip (`capture/recorder.ts` through `forShare` in `capture/paint.ts`), including the live pane of the local vs live split. The page screenshot is left out (absent, not blurred) unless you tick **Show the page** in the REC menu, which shows a preview of the exact frame first.
- **Live agent tool output** (`packages/mcp-server/src/tools.ts`).
- Cards (#64), links (#68) and `.shriketrace` files (#67) call the same functions when they're built.

Not masked: the clicked element's own words in a trip's title (`Clicked "…"`), error messages, free text outside quotes in log lines, and header values outside rule 1 and rule 6.

rrweb (planned, with DOM replay): `maskAllInputs: true` by default; `password` inputs are always masked; users can unmask non-sensitive inputs per selector.

## Live apps

Decided 2026-10-14 (#50); see [02-architecture.md](02-architecture.md#live-apps-decided-2026-10-14-50). Recording your production app means recording real customers' data, which makes you its data controller:

- Secrets and personal data (emails, phone numbers, the Vercel protection bypass token) are redacted at the store for live projects (#51).
- Shared cards, clips, links, `.shriketrace` files and live agent tool output mask values, and leave page screenshots out by default (#52; built for clips and agent output, see [Value masking](#value-masking-maskvalues-52)).
- Live agent tool output can contain end-user data; sending it to your agent provider is your call, and Shrike masks what it can first.
- A live site signs in inside its own session (`persist:live-<hash of host>`), which survives restarts until you choose **Sign out of your live site** in More (#55).

## Data sent off the machine

| Destination | What | When | User control |
|---|---|---|---|
| User's agent provider (Anthropic, OpenAI, etc.) via their CLI | Redacted tool outputs, code the agent reads | During an agent run | Choose brain, or Explain-only mode, or no agent |
| Anthropic via built-in agent | Same | During a built-in agent run | Own key, or hosted key on paid plan |
| Shrike cloud | Account info; shared recordings | Sign-in; explicit share | Optional; delete anytime |
| PostHog | Anonymous product events (no code, no payloads, no URLs of the user's app) | Only after opt-in | Off by default |
| Sentry | Shrike crash reports, scrubbed | Only after opt-in | Off by default |

## Storage

- Recordings live in the OS app data dir: each project's newest 2000 trips in `sessions/<hash>.ndjson` (`apps/desktop/src/main/sessions.ts`); the live store keeps at most 500 trips in memory.
- Planned with the SQLite store: retention per project, configurable, and "Delete all recordings" in settings.
- Optional (v1.x): encrypt the local DB with a key in the OS keychain.

## Compliance notes (for later)

Not needed for an MVP desktop tool. Before launching team features: a privacy policy, a DPA template, GDPR data export and delete for cloud accounts, and a security page describing exactly what this doc says. Have a lawyer review the privacy policy; don't generate it.
