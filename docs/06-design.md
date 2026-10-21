# 06 · Design: the Thread

Visual language: [`design-system/`](../design-system/README.md) (tokens, component IDs). Interactive prototype: `design-system/prototype-thread.html`.

## Why not a 3D world

A free 3D camera (orbit, pan, dolly) is the native interface of 3D modelling software. It gives six degrees of freedom to someone with two questions, and every extra degree is a way to get lost. Code is text, and text is only readable face-on, so tilting it costs the one thing we can't spend. **Shrike has no user-controlled camera.** Depth is used only for focus and transitions.

## First principles

1. **Every click is a round trip.** Your screen → your page's code → the server → the database → back to your screen. Vibe coders already think in exactly these places.
2. **The data has two real dimensions:** time (what happened next) and layer (how deep into the system it went). The layout uses exactly those two.
3. **The questions come as a funnel:** did it work? → where did it break? → which value was wrong? → fix it. The view lands at the bottom of the funnel and lets you widen out.
4. **Scrolling and semantic zoom** are the most practised navigation humans have. Nobody orbits a map.
5. **ADHD:** one focal point, and working memory kept on screen (where you came from, where you're going), never in the user's head.

## The layout

```
┌─ ◢ SHRIKE  todo-app ● LIVE ─────────────────────────────── REC  ⌘K ─┐
│ YOUR APP  │  SCREEN      PAGE         SERVER        DATABASE     │ ▮ │
│ (live)    │    ┊           ┊             ┊              ┊        │ ▯ │
│           │  [before]━━━━━━●             ┊              ┊        │ ▮ │  ← minimap:
│           │    ┊   onClick · TodoForm:31 ┊              ┊        │ ▯ │    one glyph
│           │    ┊           ●━━━━━━━━━━━━━●              ┊        │ ▮ │    per trip
│           │    ┊   fetch · api.ts:12     ● createTodo   ┊        │ ◆ │
│           │    ┊           ┊             ●━━━━━━━━━━━━━━✕ snap   │   │
│           │    ┊           ┊             ┊   INSERT · NOT NULL   │   │
│           │  [after] ◀━ ━ ━ ━ ━ ━ ━ ━ ━ ━  red return line       │   │
│           │                                                      │   │
│           │  insertTodo() failed: the database refused …         │   │
└───────────┴──────────────────────────────────────────────────────┴───┘
```

- **Lanes (T1)** are vertical columns of light, one per layer, with sticky labels: SCREEN, PAGE (browser code), SERVER, DATABASE, plus OUTSIDE (third-party APIs) when used. Lanes that a trip never touches stay dim.
- **Time runs downward.** Each trip is a block in an endless vertical feed, newest at the bottom (chat and terminal muscle memory). New trips arrive at the bottom and the feed follows them.
- **The thread (T2)** is one glowing line per trip. A horizontal segment is a call crossing into a deeper lane (or a response coming back); a vertical segment is time spent in that lane. Nested calls inside a lane step slightly right within the lane (up to 3 sub-columns).
- **Stations (T3)** are nodes on the thread where your code ran: a function, a log, a query. Each has a short label (`createTodo`, `INSERT INTO todos`) and, when useful, one value chip (`userId: undefined`).
- **The SCREEN lane holds screenshots (T10):** the app at the moment of the click with a reticle on what you clicked, and the app after the trip came back. Before and after, in your own UI.
- **The app dock** on the left is your live app (collapsible with P). The minimap (T9) on the right edge is a column of tiny trip shapes, green or red, for jumping.

## The shape of a bug (T12)

Because every trip uses the same lanes, the outline of the thread is the diagnosis, readable before any words:

| Shape | Meaning | Caption |
|---|---|---|
| Full loop to the deepest lane and back, green | It worked | "Everything worked (19ms)." |
| Never leaves PAGE | Your click didn't reach the server | "Your page never called the server." |
| Snaps red in SERVER | Your server code failed | "The server failed in createTodo()." |
| Snaps red in DATABASE | The database refused | "The database refused: NOT NULL constraint failed." |
| Coil ×N in DATABASE (T5) | The same question asked N times | "The same database question was asked 47 times." |
| Very tall in time view | Slow | "Most of the 1.2s was spent in fetchActivity()." |
| Returns green, SCREEN after unchanged | The page didn't update | "The server saved it, but your page didn't show it." |
| Returns amber, verdict in amber; the return reads "Your page asked Supabase directly" | Supabase answered with no rows (`empty_result`); wins over every "worked" shape | "Supabase answered with 0 rows from orders." |
| Snaps red on a page call that got no status (`blocked_request`) | The browser blocked the call (CORS or mixed content), or the server didn't answer | "The browser blocked this request, or api.x.com didn't answer. If the server is up, it's CORS: it doesn't allow requests from this page." On a live page, an http call reads "The browser blocked an http request from an https page (mixed content)." |
| Ends at a grey dashed station in SERVER (T22, live projects) | The live server answered; nothing inside it is visible from the browser | "Your page called the server. What happened inside isn't visible from your browser." A page load or Next.js page data says "Rendered on the server" |

## Navigation: three verbs, no camera

| Verb | How | What happens |
|---|---|---|
| **Scroll** (through time) | Wheel/trackpad, ↑ ↓ to step station by station, PgUp/PgDn for trips | The feed moves; the focused station sits at the reading line (40% from the top). Stations snap into focus. |
| **Dive** (into detail) | Enter, click a station, or pinch in | **T8**: the station's lane widens (others compress to slim light columns) and its code unfolds face-on: the function, the live line lit, values inline, the thread entering at the calling line and leaving at the next call. Previous and next stations peek at the top and bottom edges. Esc or pinch out surfaces. |
| **Jump** | Click a minimap glyph, `!` next failure, `F` trip list | The feed glides there. |

Zoom levels are semantic, not geometric: **Z0 Session** (every trip as a one-line glyph row with its verdict), **Z1 Trip** (lanes, stations, labels, chips), **Z2 Station** (dived, code readable). Esc steps out a level; Enter steps in.

Long trips stay readable: plumbing (framework code, repeated helpers) collapses into an **express track (T11)**, a thin segment labelled "12 steps", that expands on click. In a fork (T17), the branch that goes deepest (or breaks) draws in full; a side branch longer than three steps folds into one express station ("fetch GET /api/orders · 17 steps"), stacked beside the fork, so parallel requests never print over each other. Unnamed inline callbacks (`.map((r) => ...)`) are not drawn, and two quick repeats of a call show as "×2" without the amber coil, which is kept for real waste.

## Motion (each one explains something)

| ID | Moment | What it shows |
|---|---|---|
| M1 Drop | A new trip arrives: a pulse drops from the reticle on the SCREEN shot and runs the thread at readable speed (~1.5s for the whole trip) | Where your click went |
| M2 Snap | At a failure the thread breaks: sparks, the station flashes red, the rest of the outbound path never draws | Where it broke |
| M3 Return | A dashed red line runs back up to the SCREEN lane and lands on the "after" shot | What you saw as a result ("Something went wrong") |
| M4 Auto-dive | After a snap, the view dives into the failing station with the bad value typing in (on by default; "Calm" turns it off) | Why it broke |
| M5 Time stretch | T morphs vertical spacing from even to real time; a ruler appears | Where time went |
| M6 Coil | Repeated identical work winds into a coil with ×N | Waste |
| M7 Probe | The agent appears as a small violet probe walking the thread, ticking stations, stopping at the break with a FOUND IT bracket | What the agent is looking at |
| M8 Re-knit | After an approved fix, the re-run trip draws below; its thread knits green top to bottom and back, and its "after" shot shows the result | It's fixed, provably |
| M9 Recede | Trips above the focused one fade and soften into the fog | Focus |

`prefers-reduced-motion` / Calm: M1–M8 become instant state changes (no sparks, no glide), the feed jumps instead of gliding.

## HUD and summoned surfaces

- Top bar (44px, the macOS traffic lights centred in it at x 16, y 15): wordmark, project, run state, REC, ⌘K. Nothing else. Under 1280px the wordmark and the voice hint go, so Ask always fits. On Windows and Linux the top bar is the title bar: no left inset, and the system window buttons sit over its right end in the theme's `void` and `ink` (title bar overlay). Shortcut labels there read Ctrl, Alt and Shift instead of ⌘ ⌥ ⇧, and voice (macOS only for now) is hidden.
- Caption (bottom of the feed area): the focused station's caption in plain words, at most three lines (the full text is in its tooltip). The key hints sit in its flow on the right, above the trip label.
- Narrow windows: the stage keeps about 480px. The workspaces rail folds to icons first, then the app pane and the dock shrink. Nothing scrolls sideways.
- Toasts stack at the top of the stage, centred on it, above everything else on it.
- Summoned sheets, one at a time, Esc closes: Logs (G), Network (N), API explorer (A), Terminal (\`), Details (D: full args, headers, bodies of the focused station).
- Composer (Q1, always docked under the stage; ⌘K or / focuses it): the one place you talk to your agent. It shows the worktree you are in, the agent and what it is doing, how many prompts are up next, and Show me options. Focused, it opens a tray above it: Plan first, Think, Add to up next (⌘⇧Enter), Make it a chain, `/` commands and `@` files, plus anything dropped on it as context. Enter sends and clears it. The agent's steps appear as a slim stream on the right; FOUND IT pins the probe on the station; the diff card sits next to the dived code; Apply → M8.
- Conversation (Q2, the speech-bubble button on the composer): this worktree's asks and the agent's answers, oldest first, steps folded, branches marked with their colour and a Show button.
- Appearance (Z7, palette button in the top bar and on the welcome screen, Z8): six themes (Abyss, Void, Tokyo, Mocha, Daylight, High contrast) and Match system. A theme swaps the design tokens at the root, so everything follows, including code colours and the macOS window chrome. The user's app and mockups keep their own look.
- E opens the focused station's file:line in the user's own editor.
- REC exports the trip as a 9:16 or 16:9 clip: M1 → M2 → M3 → M4 with captions (and M8 if a fix follows). Four lanes in a portrait frame fit naturally. A live trip's clip masks its values and leaves out the page screenshot; the menu shows a preview frame and a Show the page box (LV3, #52). Save card in the same menu makes the still image people post: the trip verdict big, the trip drawn small, time, steps and rows, and a github.com/SumantxD/shrike footer, at 1200x630 or 1080x1350, copied and saved as a PNG; local vs live gets both trips with both numbers. Cards are shapes only (no values or query strings) unless Show values on the card is ticked, and a live trip stays masked either way (LV4, #64).

## Keyboard

Scroll/↑/↓ step · PgUp/PgDn trip · Enter dive · Esc surface · Space replay the trip (M1) · T time view · ! next failure · F trips (↑ ↓ move between them, Home and End jump to the first and last, Esc goes back to the Thread) · P app dock · O app in its own window (O again docks it back) · G N A \` D sheets · E editor · R record · V Thread or Files view · ⌘K focus the composer. Never fire while typing. In the Files view ← → also step, Home and End jump to the first and last step, Space plays the steps and pauses, and Esc steps out from the file cards to the tree, then the whole route.

## Files view (FV)

The Thread, redrawn on the project's own folder tree. Same trip, same focused step, same verbs; only the units change: lanes become the real folder tree (pinned left, as the editor shows it) and file cards (left to right in the order the trip first reached them), and each station becomes the lit lines inside its file, with the function name, `file:line` and a value chip on the live line. The Thread stays the default. A **THREAD | FILES** toggle sits at the top of the stage; V, `/files`, `/thread` and voice ("show the files view", "files dikhao") switch too, always on the same step.

- **A timeline both ways.** ← → (and ↑ ↓), the scrubber at the bottom (click a tick or drag), Home and End, a tree row, a call stack frame, a card. Every step is a function of the step alone, so going back plays the same moves in reverse: folders close, the camera pans back, threads retract.
- **What a step shows.** The card's window scrolls to the live line, the function that ran is banded, the value sits under its line. Facts under the card: call, arguments, what it returned or sent, logs, time, the error. The breadcrumb says where (`todo-app › server › todos.controller.ts › insertTodo() L18`), the call stack row says how it got there (frames that returned are struck through), the count line says how big the project is and how many files ran.
- **Where a step lights.** A call lights its call site in the caller's file and opens a band where it entered its own file; a function with no call site lights where it starts; a database, cache or outside service is a place card on the shelf past the OUTSIDE YOUR PROJECT gate, hung from the line that asked it. Red only where it broke (the snap, the call that got the bad value, the Thread's landing step).
- **The tree.** Git's own file list (dotfiles in, `.gitignore` respected, ignored folders one dimmed row, `.git` never). Only folders on the trip's route open; other folders are one row with their file count; a folder with more than 40 files keeps 3 rows round each touched file and folds the rest into `+ N more`. No cap: what is big folds.
- **Camera.** Planes face the camera: REPO (the tree, pinned left), FILES (the cards, panning), CODE (Enter lifts the section). Depth is a 2D translate and scale per plane, never CSS 3D; nothing rotates but a folder's chevron; the plane you read rests at scale 1 on whole pixels. Focus drives the camera, never the user. The Z0 tilt and the clip 3/4 reveal are Thread only.
- **Motion.** Forward: folders open, then the camera pans (`clamp(hop × √slots, 360, 1100)` ms), then the line lights and the thread draws with one white-hot comet; at the snap the place card sparks. Back: the same in reverse. Calm and reduced motion: no motion, every step is a cut.
- **Narrow and short stages.** Under 640px wide the tree folds away and the card takes the stage; the path bar names the file, and Esc brings the tree back. The code window shows as many lines as fit (5 to 16), so the card's facts always sit above the caption.
- **Copy.** "Used here" (a clicked element's line), "Roughly here" (no function found round the line), "Hidden: this file holds secrets" (`.env`: never shown), "This file is gone".
- Spec and prototype: `~/Desktop/shrike-map/project-map-spec.md` and `prototype-map.html`. ponytail: sections come from brace counting, not a parser; compact folders, `.vscode` sort orders, the Tour, REC clips of this view and the browser frame chain (TodoForm.tsx L15 before api.ts L12) are the spec's later phases.

## Rotation: only where it means something

The foundation is flat, layered and face-on. Rotation is allowed only in a few moments where turning *is* the meaning, never as a way to navigate:

| Moment | Why rotation fits |
|---|---|
| Before/after compare (a fixed trip next to the failing one) | The trip card flips like a page to show "then" and "now" on its two faces |
| Overview of the whole session (Z0) | The feed tilts back slightly (≤ 12°) like a deck on a table, so many trips fit; it tilts upright again when you pick one |
| Clip intro (REC) | One slow 3/4 reveal of the lanes before the trip plays, for the hook in the first second |

Nothing else rotates. No user-controlled camera, ever.

## Rendering

**The live view is DOM + SVG** (as in `design-system/prototype-thread.html`): crisp text, real accessibility, simple hit-testing. Geometry comes from the pure layout core `apps/desktop/src/renderer/src/lib/thread-layout.ts` (`buildTrip`, `layoutTrip`, `glyphPath`). **Clips** are painted by a Canvas2D painter that reuses the same layout (paths via `new Path2D(d)`) at 1080×1920 or 1920×1080, so recording needs no screen capture permission. An offscreen accessible list mirrors every trip and station, and the focused caption is announced with `aria-live`.

## Copy rules

Lead with what happened to the user's thing. Status codes with words ("Server error (500)"). No jargon (span, middleware, payload, stack trace), no "simply"/"just", no em dashes. Lane names are the plain words above.
