# 05 · The debug agent

The agent is the product's headline. Shrike doesn't own the brain: it runs **the user's own coding agent** and gives it tools that act on the running app and read Shrike's recordings. All tools are served by `@shrike/mcp-server`, which also enforces approvals, so the rules are the same whichever brain is driving.

## Agent brains

| Brain | How Shrike runs it | Notes |
|---|---|---|
| **Claude Code** | Child process, headless (`claude -p`), `--mcp-config` pointing at Shrike, `--allowedTools` limited to `mcp__shrike__*`, `--output-format stream-json` | Default when installed. Uses the user's Claude subscription. |
| **Codex CLI** | `codex exec` with Shrike in its MCP config, read-only sandbox, JSON event output | Planned: listed in settings, can't be started yet. Uses the user's ChatGPT/OpenAI plan. |
| **OpenCode** | Headless run with Shrike as an MCP server, its edit/bash tools disabled | Planned: listed in settings, can't be started yet. Any model OpenCode supports. |
| **Built-in** | `@anthropic-ai/sdk` tool-use loop in the main process, user's API key (or hosted key on a paid plan) | Fallback when no CLI is installed. Same tools, called in-process. |

Rules for every brain:

- **Disable the brain's own file-edit and shell tools.** Code changes must go through `propose_patch` so the user sees a diff. If a CLI can't disable them, run it in a read-only sandbox or a throwaway git worktree and turn any changes it makes into a proposed patch.
- **Same system prompt** ([prompts/agent/system.md](../prompts/agent/system.md)), passed through each CLI's system-prompt option or prepended to the task.
- **Normalise the stream.** `packages/agent/src/claude-code.ts` (with `steps.ts`) turns the CLI's JSON events into `AgentStep`s for the agent panel. Detect the CLI and its auth state at startup; show "Sign in to Claude Code" rather than failing.
- Before writing an adapter, read how [stablyai/orca](https://github.com/stablyai/orca) spawns and streams these CLIs.

## The loop

```
         ┌────────────────────────────────────────────────────────────┐
 goal ──▶│ 1 Understand   restate the bug, pick or build a scenario   │
         │ 2 Reproduce    drive the app / send the request            │
         │ 3 Observe      read the Action tree, logs, errors, code    │
         │ 4 Hypothesise  name the suspected line and why             │
         │ 5 Probe        deep-capture a function, vary input, re-run │──┐
         │ 6 Explain      plain-English findings with file:line       │  │ until confident
         │ 7 Fix          propose a patch (needs approval)            │  │ or budget spent
         │ 8 Verify       re-run scenario, compare before/after       │◀─┘
         └────────────────────────────────────────────────────────────┘
```

The user watches each step stream into the agent panel. Every step that refers to a timeline row links to it, so clicking a step moves the editor highlight.

### Example run (the killer demo)

```
You: When I click Add Todo nothing shows up

Agent
 ● Reproducing: typing "buy milk" and clicking Add Todo           [action A7]
 ● The click worked. It sent POST /api/todos and got a server error (500).
 ● Reading what the server did...
 ● createTodo() at todos.controller.ts:14 ran. The database insert at line 18
   failed: "NOT NULL constraint failed: todos.user_id".
 ● Turning on detailed capture for createTodo() and trying again   [action A8]
 ● req.body = { title: "buy milk", userId: 1 }. Line 18 reads req.body.user,
   which is undefined.

 Found it  (Observed)
 Your form sends the user ID as `userId`, but the server reads `user`.
 The database won't save a todo without a user, so it errors.
 → todos.controller.ts:18

 [Show fix]  [Explain more]

You: Show fix

 ● Proposed change to todos.controller.ts (1 line)    [diff view]
 [Apply]  [Reject]

You: Apply

 ● Applied. Re-running "Add a todo"...                             [action A9]
 ● POST /api/todos returned 201 and the todo appears in the list.
 ✓ Fixed and verified. [Undo change]
```

## Autonomy levels

Planned. Today every run works at the Fix level (`packages/agent/src/index.ts`); the rule that only a click applies code already holds.

| Level | Can do | Needs approval for |
|---|---|---|
| **Explain** | Read recordings and code | (nothing else allowed) |
| **Investigate** (default) | + drive the app, send requests, deep-capture, re-run scenarios | Requests that change data and weren't part of the user's own reproduction; anything outside allowed origins. On a live origin: data-changing requests are refused outright, clicks and typing ask, and a GET asks once per path |
| **Fix** | + propose patches | Every patch apply. Always. |

There is no level that applies code without a click.

## Tools

Defined in `packages/mcp-server/src/tools.ts` (the debug agent's tools), `drive.ts` (tools that drive Shrike, for outside clients) and `start.ts` (Shrike's own start agent only), each with a zod input schema converted to JSON Schema. Agent CLIs reach them over MCP; the built-in agent calls the same functions in-process.

### Recordings

| Tool | Input | Returns |
|---|---|---|
| `list_actions` | `{ limit?, status? }` | recent Actions: id, label, status, duration, stats |
| `get_action` | `{ actionId, includeFramework? }` | the event tree, compact (names, timings, status, file:line), no payloads |
| `get_event` | `{ eventId }` | one event with redacted payloads (args, bodies, query, error) |
| `search_events` | `{ query, kind?, status? }` | matching events across the session |
| `get_logs` | `{ actionId?, level? }` | logs with source locations |
| `compare_actions` | `{ beforeId, afterId }` | structured diff: new/missing steps, status and timing changes, errors gone/added |

### App (drives the app pane through CDP)

| Tool | Input | Returns |
|---|---|---|
| `app_snapshot` | `{}` | accessibility tree of the current page with stable element refs, URL, title |
| `app_click` | `{ ref }` or `{ locator }` | the resulting actionId |
| `app_type` | `{ ref, text, submit? }` | the resulting actionId |
| `app_navigate` | `{ url }` (same origin only) | the resulting actionId |
| `run_scenario` | `{ scenarioId }` or `{ steps }` | actionIds, plus pass/fail against the scenario's `expect` |

### API

| Tool | Input | Returns |
|---|---|---|
| `list_routes` | `{ query? }` | discovered routes with handler file:line |
| `send_request` | `{ method, url, headers?, body? }` | response + actionId of the traced server work |
| `list_requests` | `{}` | requests saved in the project's API collections (`.shrike/api`, Bruno format) |
| `save_request` | request fields | saves it into the project's API collection without sending it |

### Code

| Tool | Input | Returns |
|---|---|---|
| `read_file` | `{ path, startLine?, endLine? }` | contents (recorded snapshot if the trace is older than the file) |
| `search_code` | `{ query, glob? }` | matches with file:line (ripgrep) |
| `list_files` | `{ glob? }` | repo-relative paths, respecting `.gitignore` |

### Plan, playbooks and memory

| Tool | Input | Returns |
|---|---|---|
| `plan` | 2 to 5 short checks | shown to the user as the route the agent will walk; called first |
| `load_skill` | `{ skill }` | a playbook's steps (`bad-value`, `n-plus-one`, `slow-page`, ...) |
| `propose_skill_update` | one improvement | a draft tied to this run, kept once the playbook's outcome is verified |
| `remember` | `{ text, file?, line? }` | saves one lasting fact about the project, shown as a pin on that line |

### Quests

| Tool | Input | Returns |
|---|---|---|
| `list_quests` | `{}` | the user's quests, each objective's state and the flow that proves it |
| `propose_quest` | title and 2 to 5 objectives | waits for the user to approve the plan |
| `update_objective` | `{ objectiveId?, ... }` | changes or adds an objective; only its flow passing marks it done |
| `link_flow` | a flow id, name or new steps | links the flow that proves an objective |

Planned, not built: `app_screenshot`, `save_scenario`, `deep_capture` (full args and locals for one function on the next run), `revert_patch`, `ask_user`.

### Fix

| Tool | Input | Returns |
|---|---|---|
| `propose_patch` | `{ files: [{ path, edits: [{ oldText, newText }] }], rationale }` | patchId; UI shows the diff with Apply / Reject |

`apply` is not a tool. Only the user's click applies a patch. The dev server's hot reload picks it up; the agent then calls `run_scenario` to verify.

### Reporting

| Tool | Input | Returns |
|---|---|---|
| `report_findings` | `{ findings: Finding[], summary }` | renders the Found it card; ends the investigate phase |
| `ask_options` | `{ thread?, question, header?, options: [{ id?, label, description, mockupHtml?, preview? }] (2 to 4), multi? }` | Shows the options as cards (docs/13 M) and waits. Returns one JSON line `{ action: vary \| tweak \| combine \| approve \| other \| waiting, thread, option(s)?, count?, text? }`, the mockups it points at, and what to do next. The agent calls it again with the same `thread` and the new cards until `approve`, then builds the approved mockup with `propose_patch`. After 9 minutes (under Claude Code's 10-minute MCP timeout) it returns `waiting` and the cards stay up; calling again with only `thread` keeps waiting. Mockup HTML is redacted on the way in and only ever drawn in a sandboxed iframe |
| `self_review` | `{ results?: [{ lesson, found, fixed?, where? }] }` | Review lessons before a pull request (docs/13 RL5). No results: the lessons the likely reviewers (CODEOWNERS, then recent ones) keep flagging, their conventions and the changed files. With results: recorded on Ship's self-check card ("Checked 6 repeat issues for @ana: 1 found (loading state), fixed"). Reads only; `where` is redacted |
| `preflight` | `{}` | CI lessons pre-flight (docs/13 CI3): runs the CI jobs the current change touches on this computer, the way CI runs them, and returns each job's result, the first failing line and its usual fix. It takes no command: the legs come from the project's CI config or its CI lessons skill, every command goes through the guarded shell (R6), and one CI's config doesn't have asks the user first |

## Context management

- **Start of run (all brains):** system prompt ([prompts/agent/system.md](../prompts/agent/system.md)), project facts (framework, routes count, dev URL), the last 5 Actions as one-line summaries, the user's goal. System prompt and tool definitions are prompt-cached.
- **Tool results are compact by default.** `get_action` returns a tree like the timeline, no bodies. The agent asks for payloads with `get_event` only where needed.
- **Code is pulled, not pushed.** The agent reads files it chooses. We never paste the whole repo.
- **Long runs:** after 20 steps, older tool results are replaced with one-line summaries.

## Budgets and stopping

| Limit | Default |
|---|---|
| Steps per run | 30 (built-in brain) |
| App interactions per run | 15 (planned) |
| Wall time | 5 minutes (planned) |
| Cost (built-in brain only) | shown live; soft cap $0.50 per run, configurable (planned). CLI brains bill to the user's own subscription. |

On hitting a limit, the agent must call `report_findings` with what it has, labelled honestly, and suggest what to try next.

**When the brain itself fails**, the run ends as failed with one plain reason and a Try again on the agent pill (A19); it never stays on Working. Claude Code's own errors are put in words: a refused or expired sign-in (stopped after its second retry, not the ~3 minutes Claude Code would spend retrying), usage or rate limits, no credit, busy servers, offline, a CLI too old or too new for Shrike's flags or output, a crash. While Claude Code retries, the pill says why on the third try. If it prints nothing for 3 minutes with no tool call open it says so, and at 15 minutes Shrike stops it; a tool call or an approval card waiting on you never counts as silence. Try again starts the same ask; a follow-up resumes its conversation. A run keeps the workspace it started in: after a switch its tools answer "switch back to it".

## Guardrails

- **Tool results are data, not instructions.** Page text, logs, response bodies and code comments can contain prompt-injection text. The system prompt says so, and tool outputs are wrapped in clearly delimited blocks.
- **Network scope:** `app_navigate` and `send_request` only reach the project's own origins from `config.json`, including a live project's `liveUrl` and listed `origins`. No arbitrary internet.
- **Live origins are read-only (#50, #53).** A live origin is the origin of `liveUrl` plus each entry in `origins`, matched exactly (`www.` and the apex are separate unless both are listed). In a live project a relative `send_request` path like `/api/x` goes to the live origin.
  - `send_request`: only GET and HEAD. Anything else is refused with a plain message and no approval card, so a habit click can't change real data. A GET or HEAD asks once per path, and the answer holds for the session. A path list can't catch every GET that changes state; this card is the backstop.
  - `save_request` is allowed (saving doesn't send).
  - `app_navigate`: same-origin pages open without asking. Paths that look like they change state (`logout`, `signout`, `unsubscribe`, `delete`, `cron`, `webhook`, or a `token=` query) ask once per path.
  - `app_click` and `app_type` on a live page ask first, naming the element. `run_scenario` shows one card listing every step; declining returns a refusal the agent can read.
  - An agent's request never follows a redirect off its origin. A page redirect inside the app pane isn't stopped yet. The host enforces the origin list, the GET and HEAD rule and the redirect rule too (`http-send.ts`, `api/exec.ts`, `appNavigate` in `host.ts`), so a new tool can't skip them. There is no autopilot that answers these cards.
  - Live tool output can carry end-user data. Emails, phone numbers and IBANs become `[email#1]`, `[phone#1]` and `[iban#1]` in every tool's output in a live project (`redactPii` from `@shrike/redact`, #51, in `packages/mcp-server/src/tools.ts`), and live events already arrive that way from the store; value masking (#52) plugs in at the same place.
- **No shell tool for the debug agent.** It can't run commands; it can suggest one for the user to run. Only Shrike's own start agent and `preflight` run commands, through the guarded shell (R6).
- **Data-changing requests:** `POST/PUT/PATCH/DELETE` to the local app outside a recorded user scenario need an approval click. On a live origin they're refused.
- **Secrets:** login forms. The agent asks the user to log in in the app pane, or uses a scenario step marked `secret` whose value never enters model context.
- **Redaction** runs on every tool output before it reaches the model ([07-security-privacy.md](07-security-privacy.md)).
- **Patches touch user files only** inside the project root, never `node_modules`, `.env*`, lockfiles or `.git`.
- **Undo:** every applied patch keeps the previous contents; one click reverts.

## Honesty rules

Every finding carries a confidence label:

- **Observed:** read directly from the recording ("the server returned 500").
- **Likely:** inferred from observed facts with one step of reasoning.
- **Possible:** a plausible explanation the recording doesn't confirm.

Every claim about code cites `file:line`. If the recording can't answer the question, the agent says what to record next instead of guessing.

## Other AI features (single-shot, not the loop)

| Feature | Trigger | Prompt |
|---|---|---|
| What happened? paragraph | after each Action (debounced, opt-in) | [prompts/agent/what-happened.md](../prompts/agent/what-happened.md) |
| Explain this | button on any row, chip, error, request, code selection | [prompts/agent/explain.md](../prompts/agent/explain.md) |
| Flow review | button on any successful Action; also suggested when heuristics fire | [prompts/agent/flow-review.md](../prompts/agent/flow-review.md) |
| Fix | "Show fix" on a finding (enters the loop at step 7) | [prompts/agent/fix.md](../prompts/agent/fix.md) |
| Critique (prompt chains, docs/13 P3) | a chain step's run ends and the chain decides by score | The [critique skill](../prompts/skills/critique.md) plus the rubric, the run's ask, steps, answer and diff (`critiqueAsk` in `apps/desktop/src/main/chains.ts`). A separate read-only brain call, kept off the agent panel; it ends with `SCORE: n/10` and `WHY:` |

## Deterministic heuristics (run locally, no AI)

These feed the What happened? card and flow review. The AI explains them; it doesn't invent them.

| Heuristic | Rule |
|---|---|
| Slow step | > 100ms and > 30% of its parent |
| N+1 | same normalised query shape ≥ 5× under one request |
| Sequential independent awaits | sibling async calls where the second's args don't use the first's result (from captured args), total > 200ms |
| External dominates | external_call > 50% of request time |
| Browser waterfall | fetch B starts within 20ms of fetch A ending, B's URL/body doesn't contain values from A's response |
| Duplicate requests | identical method + URL + body twice in one Action |
| Swallowed error | server error event, but HTTP status 200 |
| Empty result (Supabase) | a PostgREST read answers 2xx with `[]` (or HEAD `content-range: */0`), or an update/delete answers 2xx with `content-range: */0`: "can do this" wording points at row level security; an unknown count (`Prefer: return=minimal`) says so instead of claiming 0 |
| Blocked request (`blocked_request`) | a browser call that fails with no HTTP status, skipping analytics hosts: an `http://` URL from a live (https) page reads "The browser blocked an http request from an https page (mixed content)."; any other absolute URL reads "The browser blocked this request, or api.x.com didn't answer. If the server is up, it's CORS: it doesn't allow requests from this page."; a relative URL stays quiet (same origin, the server is down). Mixed content is live only, since a local page's protocol isn't known. The caption also leads the What happened headline. Cookies dropped by SameSite on cross-site requests are a follow-up: it needs the recorder to note credentials mode |
| Silent frontend failure | response ≥ 400 and no render or visible text change afterwards |

## Outside Shrike: MCP for any agent

The same MCP server can be added to Cursor, Claude Code or any MCP client running *outside* Shrike, while the Shrike app is open. A user in Cursor can ask "what happened when I clicked Add Todo?" and get the real trace. Outside clients get Recordings, Code, API, App and Fix tools, plus tools that drive Shrike itself (`run_app`, `list_trips` with optional `status` (broke, slow or worked) and `match` (case-insensitive label text) filters, `focus_trip`, flows). Fixes still go through the diff UI: `propose_patch` waits for the user's click in Shrike, and the approval card says who sent it ("From claude-code"). The start agent's shell and preflight tools are never offered to outside clients. Marketing line: *give your coding agent eyes*.

Tools → **Use from your own Claude Code** (MCP9) gives one command to copy, `claude mcp add --transport http --scope user shrike http://127.0.0.1:<port>/mcp --header "Authorization: Bearer <token>"`. The address and token are saved in userData `mcp.json` (0600) and reused on the next launch, so it keeps working after Shrike restarts (if that port is taken, Shrike moves to a new one and the section says to paste step 1 again); **New token** rotates the token and cuts off outside clients only. It also offers a skill ([prompts/connect/SKILL.md](../prompts/connect/SKILL.md), saved by the user as `~/.claude/skills/shrike/SKILL.md`) and settings that turn off Claude Code's own edit and shell tools, since Shrike can't switch those off for a Claude Code it didn't start:

```json
{ "permissions": { "deny": ["Edit", "Write", "MultiEdit", "NotebookEdit", "Bash"] } }
```

Everything is copied to the clipboard; Shrike never writes `~/.claude`, `~/.claude.json` or `.mcp.json`. See [packages/mcp-server/README.md](../packages/mcp-server/README.md).

**The Claude Code plugin** ([integrations/claude-code](../integrations/claude-code/README.md)) is the route with nothing to paste: `/plugin marketplace add SumantxD/shrike`, then `/plugin install shrike@shrike` (the repo root is the marketplace, `.claude-plugin/marketplace.json`). Claude Code installs it, so Shrike still writes none of its files. It holds:

- **Shrike's tools** through a stdio bridge with no dependencies that reads userData `mcp.json` on each new session and forwards to `127.0.0.1` only, so a restart or **New token** needs nothing redone. With Shrike closed, `/mcp` says "Shrike isn't running" and how to reconnect.
- **The skill** `/shrike:debug`, a copy of `prompts/connect/SKILL.md` kept equal by a test.
- **A mod** (Claude Code 2.1.287 or later): a line above the prompt with the latest trip (name, worked or broke, where it broke), fed by polling `list_trips` every 4 seconds and redrawn only when it changes, and `/shrike` with the same summary as text. `list_trips` adds `at file:line` to a trip that broke for this. Read-only.
- **An opt-in guard** (`edits_through_shrike`, off by default): while Shrike is connected, Claude's own Edit and Write on project files are turned back toward `propose_patch`. A reminder, not a lock; the deny settings above are the lock.
