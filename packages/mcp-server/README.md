# @shrike/mcp-server

The single tool surface for every agent: Shrike's own brains and outside clients (Claude Code in your terminal, Cursor) all connect over Streamable HTTP on `127.0.0.1`, path `/mcp`, with a bearer token, while Shrike is open.

## Owns

- Every tool in [docs/05-agent.md](../../docs/05-agent.md#tools), zod schemas → JSON Schema
- Autonomy gate and approvals (block the call until the user answers in the Shrike UI)
- Network scope from `.shrike/config.json`; path restrictions for patches
- Redaction of every tool output via `@shrike/redact`
- Compact output formats (timeline-like trees, not raw JSON dumps)
- `ask_options` (docs/13 M1): option cards with plain-HTML mockups; blocks like an approval, loops on each answer, times out after 9 minutes with `action: "waiting"` (`src/options.ts` writes what goes back to the agent)
- `self_review` (docs/13 RL5): the repo's review lessons for the likely reviewers and the changed files; called with results it records them on the self-check card (only when the host sets `selfReview`)

Outside clients get Recordings, Code, API, App and Fix tools, plus the drive tools (`src/drive.ts`: `open_project`, `run_app`, `list_trips` with optional `status` (broke, slow or worked) and `match` (case-insensitive label text) filters, `focus_trip`, flows, `open_file`, `ask_agent`). `propose_patch` still waits for the user's click in Shrike, and the approval card says who sent it (the client's `clientInfo` name, or "Shrike agent"). The start agent's tools (`src/start.ts`, guarded shell and preflight) are registered only for Shrike's own runs, which send `x-shrike-internal: 1`.

```
src/
├── index.ts    # startMcpServer: HTTP transport, bearer check, sessions, port and token reuse
├── tools.ts    # every contract tool
├── drive.ts    # B5: tools that operate Shrike itself (outside clients only)
├── start.ts    # R: the start agent's tools (Shrike's own runs only)
├── skills.ts   # skill files and the skills host
└── options.ts  # M1 ask_options reply text
```

`startMcpServer(host, { port, token, onClient })` tries `port` first and takes a random one if it's in use (then `movedFrom` is the port it asked for); `rotateToken()` makes a new token and closes every session an outside client opened. Shrike's own brains use `internalToken`, which never rotates, so a reset doesn't cut off a run in flight.

## Connecting an outside client

The desktop app keeps its main server's address and token in `<Shrike user data>/mcp.json` (macOS: `~/Library/Application Support/<app name>/mcp.json`, mode 0600, the standard `mcpServers` shape) and reuses both on the next launch, so a client set up once keeps working after a restart. Worktree and start servers stay on random ports and tokens.

Tools → **Use from your own Claude Code** (MCP9) has three things to copy. Shrike puts them on the clipboard only and never writes Claude Code's files:

1. `claude mcp add --transport http --scope user shrike http://127.0.0.1:<port>/mcp --header "Authorization: Bearer <token>"`, or for one session `claude --mcp-config '<user data>/mcp.json'`
2. A skill (`prompts/connect/SKILL.md`) to save as `~/.claude/skills/shrike/SKILL.md`: reproduce, read the trip, change code only through `propose_patch`, re-run to verify
3. Settings for the project's `.claude/settings.local.json` that turn off Claude Code's own edits and shell, so every change comes through `propose_patch`:

```json
{ "permissions": { "deny": ["Edit", "Write", "MultiEdit", "NotebookEdit", "Bash"] } }
```

The panel also shows the plugin route, which needs no pasting: [integrations/claude-code](../../integrations/claude-code/README.md) bridges stdio to this server by reading `mcp.json` itself, and its mod polls `list_trips` (a trip that broke ends `at file:line`). The panel lists clients by name with their last call. **New token** cuts off every outside client using the old one (a running Shrike agent keeps going on its own token); run `claude mcp remove shrike -s user` and paste step 1 again. Reads of trips by an outside client show a "watched by" eye with its name (A11).
