# Shrike design system

The single visual reference for Shrike. **Every screen, component and 3D element is designed from here.** It records everything we extracted from the mood references, whether we use it today or not, so future work picks from a known vocabulary instead of inventing a new one.

- `tokens.ts`: colours, gradients, type, spacing, radii, glows, motion, 3D scene constants, looks. Import it; don't copy hex values.
- `specimen.html`: a living specimen of the elements that can be drawn in a browser. Open it locally or via the published link.
- `references/`: the mood references. Drop the original images there with the file names listed below.

How the app is laid out (screens, keys, flows) lives in [docs/06-design.md](../docs/06-design.md). This folder is the **visual language** that doc draws with.

## The vibe in one paragraph

Dark, deep space lit only by information. Light is the material: glass panes catch it on their edges, fiber bundles carry it, wireframes are drawn with it, and the thing that matters right now glows white-hot at its centre. Everything else recedes into navy and fog. It feels like looking at a running system from a god's-eye vantage point, cinematic enough to screenshot, calm enough to think in.

## Rules that never bend

1. **One thing glows.** Exactly one focal element is white-hot at a time. Everything else sits at `dimOpacity` or below (ADHD-first).
2. **Light carries meaning.** A glow, a fiber or a trace always means data is flowing or something happened. Never glow for decoration.
3. **Amber is the path you're on.** Active route = amber trace. Inactive routes = teal at low opacity. (From R2 and R6.)
4. **Red is reserved for failure.** Red alert mode (R9) appears only when something actually failed.
5. **Glass over flat.** Surfaces are translucent glass with a lit edge, never opaque grey boxes.
6. **Caps micro-labels, thin big numbers, bold rare headlines.** See Type.
7. **Depth is a tool for focus.** Depth of field and fog push secondary things back; they are never just style.

## References

| ID | Reference | What it gave us |
|---|---|---|
| R1 | "AI + FIGMA" poster: exploded glass layers of a phone wireframe in a grid-walled room, AI Agent node fanning cyan fibers into it, side cards (Input Field, Text, Responsive Grid, Theme Tokens), "New" badge | Exploded glass layers, agent node with wireframe glyph, fiber fan-out with branch terminals, grid tunnel room with floor reflection, bold headline + badge |
| R2 | Node-graph video (blurred, tilted): dark rounded node tiles with icons, orthogonal routed lines, one highlighted cyan node, orange active path, teal inactive paths | Node tiles, Manhattan-routed traces, active vs inactive path colour, tilt-shift depth of field, selected node glow |
| R3 | "Share of Model / AI Search Positioning" dashboard: metric list, glowing orb "Your brand", violet→cyan fiber fans, journey arc over particle wave terrain, bar list, line chart, insights | Orb, metric cards, list cards with edge ports, spectrum fibers, journey arc timeline, particle terrain, spike markers, gradient bars, chart tooltip, caps heading with spaced coloured subtitle and accent underline |
| R4 | AI processing flow: glass search pill → data sources (icons + caps labels) → wireframe dot-matrix cube → violet output fibers → glass answer cards. Also: "AI Search" glass panel feeding holographic pedestals; "AI Search Citations" constellation | Pill input, labelled source list, processing core cube, colour shift through a processor (blue in, violet out), holographic pedestals, constellation network with hex hub |
| R5 | Hands typing with thick acrylic code panes floating in the air, shallow depth of field | Thick clear acrylic panes with bevel refraction, white code on glass, photographic DOF |
| R6 | Isometric glass code windows (traffic-light dots) linked by orange circuit traces to icon tiles and chart cards over a glowing floor | Code window chrome, orange traces with rounded corners, icon tiles, glass chart cards, floor light lines, vertical light pillars, bokeh dot grid |
| R7 | Exploded isometric wireframe: stacked electric-blue translucent planes, white edges with vertex dots, circle grids, long construction lines | Wireframe mode, vertex dots, construction lines, stacked translucent planes, electric blue on pure black |
| R8 | Data warp tunnel: glowing rectangles streaming towards a bright vanishing point in a grid corridor | Warp transition, data blocks, perspective grid corridor, star points |
| R9 | Red alert set: red circuit traces and dense red code walls in perspective; "CRITICAL SYSTEM FAILURE" banner with warning triangle, corner brackets, barcode, STANDBY box; matrix green and neon katakana columns | Alert mode, alert banner, corner brackets, barcode, segmented status box, code walls, matrix/katakana columns |
| R10 | Isometric grid of glowing stacked blue tiles with floating white cards linked by thin lines, person for scale | Isometric tile grid (overview of many files), floating label cards, navy radial ground |
| R11 | Vertical light beam of blue-white fibers crashing onto a reflective data floor; spectral stripe and curved line thumbnails | Light column, splash on a reflective floor, particle floor, spectral stripes, sweeping curves |
| R12 | God's Eye View (uhrichsam4/gods-eye-view): bezel frame over contour backdrop, circular lens, dim mono telemetry, tags on tracked objects, bottom look switcher with mic | Bezel frame, telemetry strip, tracking tags, looks bar, mic/ask control (frames in the session scratchpad `gev/`) |

## Foundations

### F1 Colour

See `tokens.ts → color`. Grounds go `void → abyss → navy`. Ink goes `core → ink → inkDim → inkFaint`. The **signal spectrum** is `violet → blue → cyan` (R3, R4), with `magenta` for AI output (R4) and `amber` for the active path (R2, R6). `teal` is for quiet secondary data. Semantic `ok / slow / fail` are separate and never decorative.

| Use | Token |
|---|---|
| Live line, comet head, focus | `cyan` with `core` centre |
| Agent / AI | `violet` → `magenta` |
| Data, wireframes | `blue` |
| Active route | `amber` |
| Inactive route, secondary data | `teal` at 30–45% |
| Success moment | `ok` |
| Failure, alert mode | `fail` on `failDeep` |

### F2 Gradients

`spectrum` (fibers, journey arc, underlines), `aiOut` (through the processing core), `beam` (light column), `radialGlow` (stage ground), `alert` (red ground). Gradients run along the direction of flow: origin colour at the source, destination colour at the target.

### F3 Type

| Role | Spec | From |
|---|---|---|
| Hero headline | Space Grotesk 700, tight tracking, white, rare | R1 |
| Section heading | Space Grotesk 300, caps, wide tracking | R3 |
| Spaced subtitle | 12px caps, 0.32em tracking, coloured (violet or teal) + 24px accent underline | R3 |
| Micro-label / telemetry | JetBrains Mono 11px caps, 0.16em tracking, `inkDim` | R3, R4, R12 |
| Big numeral | Space Grotesk 300, 40px, coloured, delta below in `ok` with ↑ | R3 |
| Caption | Space Grotesk 500, 18px, `ink` | Shrike playback |
| Code | JetBrains Mono 13px / 1.55, syntax colours on glass | R5, R6 |

### F4 Light and glow

- **White-hot core:** anything at peak focus has a `core` white centre with a coloured halo (R1 orb, R4 cube, R11 beam).
- **Bloom:** threshold high (0.62) so only intentional lights bloom. Values in `glow.bloom`.
- **Additive blending** for fibers, particles, beams, traces.
- **Rim light** on spheres and pane edges (R3 orb, R5 acrylic).

### F5 Materials

| ID | Material | Look | From |
|---|---|---|---|
| M1 | Frosted glass | `glass` fill, 1px `glassEdge` border, backdrop blur, faint top highlight | R1, R3, R4 |
| M2 | Clear acrylic | Thick slab, bright bevelled edges, slight refraction, white text | R5, R6 |
| M3 | Wireframe | Thin white/blue edges, vertex dots, translucent fills | R7 |
| M4 | Dot-matrix | Grid of glowing dots filling a volume or a plane | R4, R3 |
| M5 | Matte tile | Dark rounded square, soft inner shadow, icon in colour | R2 |
| M6 | Hologram | Concentric rings, scanline shimmer, upward light cone | R4 pedestals |
| M7 | Reflective floor | Dark glossy plane mirroring glows with streaks | R1, R6, R11 |

### F6 Depth and camera

- **Depth of field** (tilt-shift) around the focused object (R2, R5): `scene.dofFocusRange`.
- **Exploded isometric** for overviews (R1, R7, R10).
- **Three-quarter perspective** for follow shots (R6).
- **Fog** fades distant things into `void` (`fogNear`, `fogFar`).

### F7 Environments (backgrounds)

| ID | Environment | Use in Shrike | Status |
|---|---|---|---|
| E1 | Grid tunnel room (walls + floor grid, faint) | Default stage behind the flight | Retired with the 3D space |
| E2 | Radial navy glow on void | Behind everything, subtle | Now |
| E3 | Reflective data floor | Under panes in overview | Retired with the 3D space |
| E4 | Starfield / constellation of files | Idle state | Retired with the 3D space |
| E5 | Warp tunnel with data blocks | Transition when a new flight loads | Retired with the 3D space |
| E6 | Particle wave terrain | Under the journey arc / summary | Later |
| E7 | Contour lines backdrop | Outside the bezel frame (R12) | Now |
| E8 | Code walls in perspective | Alert mode background | Later |
| E9 | Matrix rain / katakana columns | Night look easter egg | Later |
| E10 | Light pillars and bokeh dot grid | Welcome screen depth | Later |

## Components

Each has an ID to reference in specs and PRs. **Shrike use** says where it belongs; **Status** says whether it's in the current build.

### Surfaces

| ID | Component | Anatomy | Shrike use | Status |
|---|---|---|---|---|
| C1 | **Code pane** | M1/M2 glass slab, `pane` radius, traffic-light dots (muted), mono caps file label top-left, syntax-coloured code, live-line glow bar, value chip at line end | Every function in a flight | Now |
| C2 | Exploded layer stack | 3–5 translucent planes offset in depth, edges lit | A file's history or nested calls in overview | Later |
| C3 | Floating component card | Small glass card: icon, label, 2–3 placeholder lines, port dot on one edge | Logs, queries, requests attached beside panes | Now |
| C4 | Glass chart card | Glass card with sparkline or bar chart | Timing per step in Details | Later |
| C5 | Metric card | Circle-outline icon badge, caps label, big thin numeral, delta line | Summary stats (files, functions, queries, errors, total ms) | Now |
| C6 | List card with port | Circular icon badge, name, small label + value, delta; glowing port dot on the edge where a fiber lands | Flights list, brain picker, routes | Now |
| C7 | Insight row | Circle icon + two lines | Flags ("same database question asked 47 times") | Now |
| C8 | Bezel frame | Rounded inner frame, hairline, contour backdrop outside | App shell | Now |

### Layout frame: the stage and what floats on it

Code: `hud/Shell.tsx`, `theme.css`. The row is rail, app pane, stage column (the Thread, its caption and the composer), right dock.

- **Stage min width.** The stage column asks for `--stage-min` (480px, `theme.css`). Short of it, the workspaces rail folds to its icons first (its toggle then reads "Widen the window to show workspaces"), then the app pane (floor 260px, the inspector shrinks back to it) and the open dock (floor 280px) shrink, three times faster than the stage. Nothing scrolls sideways at the 1100px minimum window.
- **Solid on the stage.** Every `.glass` inside the stage (`section[aria-label="Shrike"]`) is solid (the `glass solid` fill), so lanes and labels never read through a card. The caption's backing is solid `void` behind its text and fades only in its top 34px.
- **Caption.** Text clamps to 3 lines (full text in its tooltip); the key hints and `trip · n/N` sit in its flow on the right, so a long caption pushes them up instead of running under them. The hints hide when the caption is under 640px wide.
- **Toasts** stack at the top of the stage, centred on it, `--s-2` below its top edge (centred in the window when there is no stage). The New trip pill is the first toast in that stack. While one shows, the lane header's labels fade out, so nothing reads half under it; cards that open at the top (System windows, the quest board) start below the 46px header band.
- **Sheets** (Logs, Network, Details, Terminal, API, Skills, Flows) sit `--s-2` in from the stage's sides, which covers the Thread's outermost cards (they keep `--s-2` from the edge too).
- **System windows wait for the boards.** While the quest board or the options board is open, a System window (other than Quest complete) queues until it closes instead of landing on the board.
- **System windows step aside.** Esc, a click outside the window, or a sheet or Setup opening sends the one on screen away at once, with no fade, so it never sits over a sheet's header, the Thread or the New trip pill. The skill log keeps it.

Stage z scale. Use these steps for anything positioned over the stage; don't invent new ones.

| Layer | z | Who |
|---|---|---|
| Thread internals | 0 to 6 | lines, labels, probe (`thread.css`) |
| Caption | `z-[7]` | `Caption.tsx` (key hints live inside it) |
| Cards | `z-10` to `z-20` | agent cards, Found it, branch probes, inspector |
| Agent aside | `z-30` | checkpoint rail, chain panel, options, open agent card |
| Composer, sheets | `z-40` to `z-[46]` | composer and its tray, sheets, Ship, Setup, right dock (`z-[45]`), quest scrim (`z-[46]`) |
| System windows | `z-[47]` | `.sys` windows (skill acquired, quest results) |
| Approvals | `z-[48]` | Allow / Deny cards |
| Toasts | `z-50` | `Toasts.tsx` |
| Modal over all | `z-[60]` | profile, result screen, agent cursor |

### Nodes and glyphs

| ID | Component | Anatomy | Shrike use | Status |
|---|---|---|---|---|
| N1 | Node tile | M5 rounded square, coloured icon, tiny label below, ports | Collapsed function in overview, MCP tools | Later |
| N2 | Active node | Same, filled with `cyan`, white-hot centre, bloom | The step under the camera in overview | Later |
| N3 | Router node | Circle with chevron icon | Branches (if/else) later | Later |
| N4 | Orb | Sphere, rim light, spectrum gradient, label inside | The agent's "mind" while thinking; the app at the start of a flight | Now |
| N5 | Agent glyph | Wireframe icosahedron / network in a glass tile | The agent's identity in Ask and captions | Now |
| N6 | Processing core | Wireframe hex prism filled with dot-matrix, white-hot centre; colour shifts as fibers pass through | Realm gate (browser → server), and the agent analysing | Now |
| N7 | Holographic pedestal | M6 rings and dome with icon, caps label | Files or services in the starfield overview | Later |
| N8 | Constellation node | Glowing dot + label + faint sub-label; hub is a hexagon | File stars; current file is the hub | Now |
| N9 | Isometric tile | Stacked glowing blue tiles | Folder districts in the full-project overview | Later |

### Connectors (how flow is drawn)

| ID | Component | Anatomy | Shrike use | Status |
|---|---|---|---|---|
| L1 | **Fiber bundle** | `fiberCount` thin curves with slight random spread, converging at a port; gradient along length; particles travel along it | Beams between panes; wider bundles for heavier steps | Now |
| L2 | Orthogonal trace | Manhattan routing with rounded corners, dot ports at joins | Clean overview mode; Blueprint look | Now |
| L3 | Active path | L1 or L2 in `amber` with bloom and travelling pulse | The route already travelled in this flight | Now |
| L4 | Inactive path | `teal` at 30–45%, no particles | Routes not taken | Now |
| L5 | Circuit trace | PCB-style 45° traces with pads | Alert mode | Later |
| L6 | Comet | White-hot head, coloured fading trail | The playhead moving between steps | Now |
| L7 | Light beam | Vertical column of fibers splashing on a floor | Welcome hero; the "fixed and verified" moment | Now |
| L8 | Branch terminals | Fibers splitting into short branches ending in dots on cards | Fan-out to logs/queries from a function | Now |

### HUD and controls

| ID | Component | Anatomy | Shrike use | Status |
|---|---|---|---|---|
| H1 | Pill input | Glass pill, search icon, glowing edge on focus | The docked composer (Q1, ⌘K) | Now |
| H2 | Badge pill | Small dark pill, white bold text ("New") | New flight, beta labels | Now |
| H3 | Section heading | Thin caps heading + spaced coloured subtitle + short accent underline | Sheets, summary card | Now |
| H4 | Journey arc | Curved line with nodes and caps labels above, colour following the spectrum, spike markers below | Playback scrubber (steps along the arc; red spikes for failures) | Now |
| H5 | Spike markers | Vertical hairlines with dot tops, height = duration | Timing above the scrubber | Now |
| H6 | Gradient bar list | Label, gradient bar, % | Where time went (thermal summary) | Later |
| H7 | Line chart + tooltip pill | Thin line, area fade, endpoint dot, rounded tooltip with value + date | Duration over runs | Later |
| H8 | Corner brackets | L-shaped hairline corners around a target | Detection boxes, tracking tags, reticle | Now |
| H9 | Tracking tag | Bracketed caps label with value (`FN createTodo() · 6MS`) | Detection overlay | Now |
| H10 | Telemetry strip | Dim mono caps line of facts (`TRACE 9F2C // POST /API/TODOS // 15MS`) | Top bar right, recording overlay | Now |
| H11 | Looks bar | Row of square icon toggles with caps labels | NORMAL / THERMAL / NIGHT / BLUEPRINT | Now |
| H12 | Alert banner | Warning triangle, red filled caps bar, corner brackets, barcode, segmented STANDBY box | The first failure of a flight lands with this, then fades to the caption | Now |
| H13 | Footer tagline | Wide-tracked caps line with gradient underline | Welcome, clip outro | Now |
| H14 | Activity (`components/Activity.tsx`) | A steady dot (solid in its tone = busy, hollow `inkFaint` = idle), a plain label, and while busy ` · 0:42` in faint mono from one shared 1s clock. No loops anywhere: no pulse, blink, breathe, ping or sweep on a status. A state change may fade once (200ms). Spinners only on a button waiting for a reply | Agent working, check running, Starting, Checking, Recording, the Ask ✦ (steady violet ring plus the timer) | Now |
| H15 | Live badge | Mono caps `LIVE` in `slow` with a 1px `slow` border, 6px radius, next to the project name; tooltip names the site and adds "(not secure)" for `http://` | Top bar of a live project (#54), and of a local project while its pane shows Live (#62) | Now |
| H16 | Local / Live switch | Two mono caps buttons (`LOCAL`, `LIVE`) in one 1px `hair` box, 6px radius, in the app dock bar after the URL; the pressed side fills: `glass` with `ink` for Local, `slow` at 14% with `slow` text for Live; the other side `inkFaint`, `ink` on hover. Shown only while a project with a dev command and a `liveUrl` runs | App dock bar (#62) | Now |
| LV1 | Basic-auth sign-in dialog | WS2's centred solid glass card (`card` radius) over a void scrim, 380px: thin caps title `SIGN IN TO host`, one `dim` line (the site's own realm in quotes, then "It's never saved"), Username and Password `field`s with `lbl` captions, Cancel `btn` and the cyan `btn go` **Sign in**; Esc cancels (#55) | Built |
| LV2 | Sign out of your live site | A `hud-btn` row at the end of the top bar's More menu, lucide `LogOut` (13px), shown only for a live project; a green toast "Signed out of your live site." after (#55) | Built |
| LV3 | REC share preview | In the REC menu for a live trip or the local vs live split, under Captions: one frame of the clip exactly as it will be saved (early in the drop), max 200px tall, `hair` border, `r-control` radius; under it a `Show the page` checkbox (off each time the menu opens) that redraws the preview with the page screenshot. The faint note says live values are hidden, and the page too while the box is off (#52). With LV4's `Show values on the card` ticked it previews the card instead | Built |
| LV4 | **Trip card** (#64) | One still image of the trip for posts, 1200x630 (16:9 in the REC menu) or 1080x1350 (9:16), always in the Abyss colours. Navy to `void` radial ground. Left column: a caps mono kicker in `inkDim` (the trip title, then `LIVE` in `slow` for a live trip), the trip verdict in display 600 as big as fits (56px down to 30px, `ink`, fail-tinted for a broken trip), and three stats as caps `inkDim` labels over 44px mono values: TIME, STEPS, ROWS (the last read's count, `slow` at 0; left out when no step said). Right: the trip painted by the clip painter at the verdict, with no header, caption or watermark, in a `hair` frame with `pane` radius; 20+ steps show the path to where it broke. Local vs live: the verdict across the top, the two trips left and right, and between them `LOCAL` / `LIVE` (`slow`) over each stat with both values, the live value in `slow` where it differs. Footer under a `hair` rule: "Seen with Shrike · see what your app does" in `inkDim`, `github.com/SumantxD/shrike` in cyan on the right. Shapes only by default (no value chips, row cells, bodies or query strings), masked like clips on a live trip and without its page unless LV3's Show the page is on. REC menu: a `Show values on the card` checkbox (off each time) and a `Save card` `btn` under Record, which copies the PNG and opens the save dialog | Built |

### Motion patterns

| ID | Pattern | Spec |
|---|---|---|
| P1 | Particle flow | Dots travel along fibers at `motion.particleSpeed`; only on the active path |
| P2 | Comet hop | `motion.hop`, ease-in-out, trail fades over 600ms |
| P3 | Focus pull | DOF focus moves to the new pane over `motion.camera` |
| P4 | Warp in | New flight: 600ms data-block warp (E5), then cut to the first pane |
| P5 | Beam splash | Fixed and verified: L7 beam drops onto the re-run's first pane, floor ripples once |
| P6 | Alert flash | Failure: H12 banner in 180ms, holds 900ms, collapses into the caption; one red shockwave; glitch ≤ 120ms |
| P7 | Type-on | Value chips and captions type in over 200ms |
| P8 | Calm | `prefers-reduced-motion`: P1–P6 become instant state changes; no shockwave, no glitch, no warp |

### The Thread (the core view, see docs/06-design.md and `prototype-thread.html`)

| ID | Component | Anatomy | Status |
|---|---|---|---|
| T1 | Lane | Vertical 1px light column with a faint glow band, sticky mono caps label (SCREEN, PAGE, SERVER, DATABASE, OUTSIDE); dim when unused by the focused trip. Discovered projects use D1–D11 instead | Now |
| T2 | Thread | One line per trip, spectrum gradient (violet → cyan) with soft glow; horizontal = crossing into a lane, vertical = time in a lane | Now |
| T3 | Station | 14px ring on the thread (cyan; amber when slow; red when failed), label + `file:line · ms` to the side, optional value chip. Where it broke, the label's name sits level with the station and its chip wraps downward, at most three lines (all of it in the tooltip) | Now |
| T4 | Snap | The thread stops at the innermost failure: red station, spark burst (22 sparks, 0.5–0.8s), one ring pulse | Now |
| T5 | Coil | Repeated identical work drawn as overlapping amber loops with ×N | Now |
| T6 | Return line | Back to SCREEN: solid green when it worked, dashed red with the status words when it failed | Now |
| T7 | Re-knit | After a fix, the re-run's thread draws in green top to bottom, then settles to the spectrum | Now |
| T8 | Dive card | Glass code card unfolding from the station (scale from the station point, 0.42s ease-out), live line lit, inline value chips, "why" line at the bottom; other trips fade to 15%. It opens under the station's label and chip, ends above the caption (the code scrolls), and the trip's own text it covers fades out instead of peeking round its edges | Now |
| T9 | Trip glyph | 26×30 mini path of the trip's shape, green or red, in the minimap column | Now |
| T10 | Screen shot | Small light card of the user's own UI: BEFORE with a cyan reticle on what was clicked, AFTER with what they saw. Light in every theme: `core` on dark themes, white `abyss` with `ink` text in Daylight (CSS `light-dark()` on the theme's `color-scheme`) | Now |
| T11 | Express track | Collapsed routine steps as one station labelled "12 steps" | Now |
| T12 | Shape of a bug | The outline-to-meaning table in docs/06-design.md; captions use its verdict sentences | Now |
| T13 | Probe | Violet glowing dot walking the thread with ✓ ticks (each beside its station, on the side away from its label), ending in a red FOUND IT bracket (H8) tight round the station, the words on the side away from its label | Now |
| T14 | Trip header | Title, BROKE/WORKED verdict pill, total ms | Now |

#### Shapes on discovered lanes (T15–T20, see docs/12-feature-map.md)

| ID | Shape | Anatomy | Status |
|---|---|---|---|
| T15 | **Bounce** (cache hit) | The thread pokes into a CACHE lane and straight back on one row: out 4px above the row, back 4px below (`lane.pokeHeight`). 10px filled `ok` dot with a soft green glow, green `hit` chip | Build |
| T16 | **Pass-through** (cache miss, then filled) | Hollow `amber` ring in CACHE with an amber `miss` chip, the thread carries on to DATA, then comes back through CACHE with a 10px filled `cyan` dot (set) | Build |
| T17 | **Fork** (at the same time) | At the split the thread steps down in its lane and runs two parallel lines `lane.forkGap` apart; the side branch rejoins the lane after its station. Caps label `AT THE SAME TIME` in `inkDim` left of the split (between the lines when there is no room). Each branch keeps its own station and chip | Build |
| T18 | **Handoff** (background job) | Dashed violet segment (`3 6`) from the lane that queued the job into QUEUE. The job is its own trip; its header adds "started by Clicked "Pay now" · 1.2s later" in `inkDim` | Design |
| T19 | **Crossing** | A plain horizontal hop between two SERVICE lanes (API → AUTH); no new mark, the lane headers carry the meaning | Build |
| T20 | **Terminal card** | Replaces the T10 screen shot for non-browser callers: 168px dark card (`#0B0F17`), JetBrains Mono 9px, cyan `$`/`cron`, caps tag (`COMMAND` / `REPLY` / `SCHEDULE` / `EXIT` / `HANDOFF`), red or green status words in the reply | Build |
| T21 | **Your trail** | While you step through a trip (arrow keys or clicks), a dotted `cyan` line (1.6px, dash 1.5/6, soft cyan glow) joins the first station to the focused one, and each station you passed gets a faint dashed `cyan` ring. Cyan is you; the agent's planned route (A1) stays dotted `violet` | Build |
| T22 | **Server not visible from your browser** (live projects, D9) | A station in the SERVER lane for a live project's own origin (or a host in `origins`) when nothing inside it was recorded: 14px ring, 1.5px dashed `inkDim` on `abyss`, label in `inkDim`: "Server, not visible from your browser", or "Rendered on the server" for the page's own load and Next.js page data (RSC), or "From cache" when a CDN says it answered. Under it the status words and time; Server-Timing entries ("db 180 ms, render 40 ms") as its chip once #59 reads them. Its dive card has a "See inside" link that opens two lines: run the app locally to see inside, and nothing is installed on your live server. Never drawn when a recorder answered the request | Build |
| T23 | **Local vs live split** (#62) | Replaces the feed on the stage: a header (the verdict in 15px display `ink`, "Local: GET orders, 3 rows, 40 ms. Live: GET orders, 0 rows, 210 ms." or "No difference in the path. Live was 170 ms slower."; under it the live side's `empty_result` caption in 13px `slow`, and a faint 10.5px mono note when only requests were compared; `fv-btn` Close on the right, `hair` rule below). Two equal panes 12px apart with a `hair` divider, each with caps `LOCAL` (`inkDim`) or `LIVE` (`slow`) over its own lanes and one trip (title row without its buttons). The first differing request on each side gets `slow` H8 corner brackets (the T13 FOUND IT shape). REC records it as one 16:9 clip: the verdict on top in 34px display, two 9:16 trip clips side by side in `hair` frames, `LOCAL` and `LIVE` caps beside them; the live pane's values are masked and its screenshot left out unless LV3's Show the page is on | Build |

#### FV · Files view (docs/06 "Files view", `~/Desktop/shrike-map/prototype-map.html`)

Code: `apps/desktop/src/renderer/src/files/` (`files.css`, prefix `.fm`; `.fv` is the file view, SC6). Tokens only, all six themes; `data-glow="off"` themes drop glows and blur.

| ID | Element | Anatomy | Status |
|---|---|---|---|
| FV1 | **Pinned repo tree** | 248px panel, `panelBg`, EXPLORER header with the file count; 22px mono rows, hairline indent guides, a chevron that turns 90° (the only thing that rotates); route folders open, others one row with a faint count; ignored rows `inkFaint`; fold rows italic `+ N more`. Ran: `cyan` dot. Failed: `fail` ×. Collapsed folder with stops inside: count badge. Hot row: `cyan` wash, H8 corner brackets, a right-angle trail from the root | Built |
| FV2 | **File card** | C1 glass, caps path (folder part `inkDim`), lane tag, function and time; a 30px minimap of the whole file with lit bands per visit; a window of 10 to 16 lines at 19px, the function that ran banded `cyan` 6%, the live line `cyan` 18% with a 2px edge, the value chip on a 24px row under it; facts (CALL, ARGS, RETURNED or SENT, ERROR, TIME) under a hairline. Focus: `cyan` edge and glow; dim cards fade their lines to 16% | Built |
| FV3 | **Section lift (dive)** | Enter: the section at 13px on a C1 pane, every value inline, facts and the caption; scale .12 to 1 from the card, then rests at scale 1 | Built |
| FV4 | **Depth fiber** | Hairline curve from the hot tree row's edge to the live line, `cyan` (`fail` at the failure), drawn after the pan | Built |
| FV5 | **Lane gate** | Vertical hairline between cards where the story crosses lanes, a caps label on `abyss` | Built |
| FV6 | **Place card** | 270px, `panelBg`, 1.5px dashed `glassEdge`, place glyph and name, the statement and values, a `fail` chip when it refused | Built |
| FV7 | **Thread between cards** | Orthogonal path from the line the story left to the line it reached, violet to cyan spectrum, `fail` when it carried the failure; returns run under the strip, dashed. Drawn behind the cards, so no thread crosses code; threads that don't touch the focused card fade to 14%. One white-hot comet while it draws | Built |
| FV8 | **Breadcrumb and call stack** | Mono path with `›` separators, the function and line in `cyan` (`fail` where it broke); a row of frame chips, the current one edged, frames that returned struck through | Built |
| FV9 | **Folder error propagation** | Parent folder names in `failInk` with a × when a file inside failed | Built |
| FV14 | **Step scrubber** | 58px rail: ticks per step (square for places, a diamond where it snapped), a spectrum fill, a 20px knob, file segment labels; drag both ways | Built |
| FV15 | **Count line** | `TODO-APP · 1,284 FILES · 4 RAN · BROKE`, mono caps `inkDim` | Built |
| FV16 | **View toggle** | Segmented THREAD \| FILES at the top of the stage, the active half `cyan` on 10% `cyan`, with a faint `V switches` hint | Built |

### Discovered lanes (D1–D13)

A lane is a place where code runs or data lives. Order is fixed by kind (`lane.order`, D9). Each lane header is a 11px kind glyph (`placeGlyph`) + caps name (10px, 0.24em) + a 9px `inkFaint` sub-label (the target: `sessions`, `events.db`, `test double`). With more than six lanes the name tracks at 0.08em; when it still doesn't fit, it becomes a 3 to 5 letter short form (`PGSQL`, `STRP`), then the glyph alone, with the full name in the tooltip. A word is never cut.

| ID | Lane kind | Anatomy | Status |
|---|---|---|---|
| D1 | **Caller** | Glyph by caller: pointer (browser, lane `YOU`), `>_` (curl, Postman, scripts, lane `CURL`), clock (cron, lane `CRON`). Hosts the T10 shot or T20 terminal card; its band is never narrower than the card + 28px | Build |
| D2 | **Client** | Browser-window glyph; one lane per web origin (`WEB · shop-web`) | Build |
| D3 | **Service** | Hexagon glyph; one lane per instrumented process (`API`, `AUTH`, `WORKER`) | Build |
| D4 | **Queue** | Three-bar glyph (`JOBS · bullmq`); while unbuilt the header carries a violet `PREVIEW` tag | Design |
| D5 | **Cache** | Lightning glyph (`LRU · sessions`, `REDIS · cache`) | Build |
| D6 | **Data** | Cylinder glyph (`SQLITE · events.db`, `POSTGRES · orders`) | Build (sqlite, PGlite); Design (pg, mysql2, mongodb) |
| D7 | **Outside** | Arrow-out-of-box glyph (`STRIPE · test double`) | Build |
| D8 | **Declared place** | Same as the kind it declares; the name comes from `.shrike/config.json` | Build |
| D9 | **Ordering** | caller → client → service → queue → cache → data → outside, stable for the session | Build |
| D10 | **Accordion** | Lanes the focused trip touches share the width (line at 42% of the band, caller at 50%); the rest shrink to 26px slivers (`lane.sliver`) with a vertical 8.5px `inkFaint` label (the sub-label when two lanes share a name) at 50% opacity; with slivers the header band is solid to 88px and a sliver label ends inside it. A full lane's name ends in an ellipsis when its column is too narrow (the whole name is its tooltip). Focusing another trip re-lays out every trip. More than `lane.maxSameKind` touched lanes of one kind collapse into a group header ("3 services") that expands on click | Build (group header not drawn in the prototype: no scenario has 7 services) |
| D11 | **Ghost lane** (expected, not seen) | Dashed lane line (`lane.ghostDash`), header at 60% with a dashed outline; tooltip says why it's expected ("REDIS_URL in .env and the ioredis dependency") | Build |
| D12 | **Multi-process** | No new mark: one D3 lane per process, plus O4 process tabs in the Terminal | Build |
| D13 | **Cross-service trace** | No new mark: the trip continues into the next SERVICE lane as a T19 crossing | Build |

Labels on discovered lanes sit opposite the incoming line: right of the station when the line arrives from the left, left when it arrives from the right; when there's no room on the right they go left and drop below the line.

### Agent surface (A1–A18, Claude Code → Shrike)

| ID | Element | Anatomy | Status |
|---|---|---|---|
| A1 | **Planned route** | Before the probe walks: a dotted violet line (`1 7`, round caps, 85%) through the stations it will check, caption "Plan: check …". Removed when the probe arrives | Build |
| A2 | **Progress** | T13 ticks plus three 5px dots in the agent status pill (plan, look, fix) | Build (exists) |
| A3 | **Twin probes** | Up to 3 probes in violet, magenta and blue parked on different stations, each with a bordered verdict chip ("#1 bad value · likely", "#2 wrong route · ruled out") | Design |
| A4 | **Skill chips** | Pill chips (`N+1 hunter`, `Auth`, `Slow page`, `Bad value`) under the composer, dim; the one in use lights violet in the agent status pill and the Found it card header | Build |
| A5 | **Memory pin** | 12px violet pin glyph with a soft glow 21px above a station; hover or focus shows the note in a violet tooltip. Added after a fix ("Stripe amounts are cents") | Build |
| A6 | **Checkpoint rail** | 7px violet diamond at the bottom-right corner of a minimap glyph, one per applied patch; click opens a sheet with the diff and Rewind. Rewound = hollow diamond | Build |
| A7 | **Fuel ring** | Violet ring hugging the ✦ Ask button (track at 18%), length = context used; hidden at 0. Hover title: % used, tokens, cost, rate-limit reset (O12) | Build |
| A8 | Approval card | The Found it card with Apply / Not now. A proposed fix names who sent it after the title, "From claude-code" or "From Shrike agent" in 12px dim. It goes round the agent pill, the conversation, System windows and an open sheet (below or above them, else it waits out of sight, so a sheet's header stays clickable), and the Thread text under it fades out. Found it stays up through later runs until Hide, a newer Found it or a fix of its own | Build (exists) |
| A9 | **Watcher** | Faint eye + "when it breaks: ask" in the trip header | Design |
| A10 | **Slash palette** | Typing `/` in the composer opens a list above it: `/explain` `/fix` `/replay` `/compare` `/record` `/time` `/issue` `/chain`, each with a plain one-line description; ↑↓ Enter | Build |
| A11 | **Watched-by eye** | Cyan eye glyph + the reader's name ("Cursor") in the trip header, dim mono | Build |
| A12 | **Sandbox ribbon** | Teal filled caps tag `SANDBOX` on a trip header or fix-race column | Design |
| A13 | **Diff line comment** | Hover a diff line: violet left rule. Click: inline violet box with an input and "Send to agent"; the comment stays above the revised diff as "You: …" | Build |
| A14 | Effort dial | (on the brain picker) | Design |
| A15 | Background job trip | T18 | Design |
| A16 | Share card | Via O6 | Build (via O6) |
| A17 | **Telemetry strip** | Top bar, right: `3 trips · 1 broke · agent idle`, 10px caps mono in `inkFaint`, numbers in `inkDim`, broke count red when > 0, agent state violet when busy. Short of room, whole facts drop off the end (never a word cut in half); the full line is its tooltip | Build |
| A18 | Looked-up chip | Chip in the agent column with the source title | Design |
| A19 | **Run failed** | In the agent status pill, under its header, while the newest run on main has failed: the reason in one plain 12px `fail` sentence (`role=alert`) and a `Try again` hud-btn on its right. The pill stays fully on show (no fade) until a new run starts; the caption says the same reason for 8s. Try again starts the same ask; a follow-up resumes its conversation | Build |

### Orca → Shrike (O1–O14)

| ID | Element | Anatomy | Status |
|---|---|---|---|
| O1 | **Point mode** | X or the ⌖ in the app dock bar (shown on dock hover). Crosshair cursor, hovered element gets a 2px violet outline; click pins a cyan reticle (T10 style) and opens Ask with a cyan context chip (`⌖ button "Send"`) and a question | Build |
| O2 | **Ghost cursor** | Violet arrow with a white rim and a violet `AGENT` tag, glides to the target in the app dock (0.75s), one violet ring on click | Build |
| O3 | **Fix race** | Dashed violet card: three columns, each a T9 glyph + A12 ribbon + one line; the winner has a green border | Design |
| O4 | Process tabs | One tab per process in the Terminal sheet, status dot | Build |
| O5 | **Quick open** | ⌘P: pill like Ask in neutral glass; grouped list (Files, Trips, Routes, Logs) with caps group labels; a file opens the in-app file view (T8 card without a station) | Build |
| O6 | **Issue card** | Glass sheet over a void scrim on the stage (the sheet under it dims): caps label `Issue · GitHub or Linear`, title, plain summary, numbered steps, failing line, fix diff, clip path; "Copy issue" copies Markdown | Build (copy + file); Design (direct API) |
| O7 | Annotate AI diffs | A13 | Build |
| O8 | Drag to Ask | Context chip on the composer, same look as O1's | Build |
| O9 | **Unread dot** | 7px cyan dot with glow before a trip title and at the top-right of its minimap glyph (6px), also beside the project in the switcher; clears when focused | Build |
| O10 | Pair phone | QR in settings | Design |
| O11 | Remote badge | Small caps badge on the project name for remote runs | Design |
| O12 | Usage | In the A7 hover title | Build (A7) |
| O13 | Rich previews | In-app file view renders Markdown and images | Build |
| O14 | Orca CLI | Shrike's MCP server + A11 | Build (exists) |

### Your app in its own window (AW1–AW3)

Code: `renderer/src/appwindow/`, `hud/AppDock.tsx`, `main/index.ts` (the window), `main/app-view.ts` (`placeAppWindow`). Main adopts the window's webview exactly like the docked one, so trips, point mode, Edit and resend, flows and voice keep working.

| ID | Element | Anatomy | Status |
|---|---|---|---|
| AW1 | **App window** | Its own native window (`index.html#app-window`): a 32px `border-hair` header on `app-bg` (traffic lights inset on macOS; the system window buttons over its right end on Windows and Linux, caps `YOUR APP`, the URL in mono normal case, ⌖ point, reload, `hud-btn` **Dock back** with lucide `PanelLeftClose`), the webview below. Opens on the display, bounds and full screen state it closed with (`userData/app-window.json`); a display that is gone falls back to centred on the primary. Closing it docks the app back | Built |
| AW2 | **Pop out button** | lucide `SquareArrowOutUpRight` (11px) at the end of the app dock bar, shown on dock hover like ⌖; O does the same and docks it back | Built |
| AW3 | **Away rail** | While the app is in its own window the dock collapses to a 46px `glass` rail (same width as the closed right dock): lucide `PanelLeftOpen` (16px, 1.75 stroke) over vertical caps `YOUR APP IS IN ITS OWN WINDOW · BRING IT BACK`; the whole rail is the button. A lane opened from the Thread still shows its inspector in the dock | Built |

### Skills, git, worktrees, flows and the SDLC rail (docs/13)

The principle: the hidden power move is the obvious next button, shown at its moment, never in settings. Every button below is plain words in the `btn mv` style (violet edge) beside one cyan primary `btn on`; the row sits just above the caption (`#moves`), so the caption stays the one focal sentence. Note: the SDLC stages reuse the letter L from docs/13; they are not the connector IDs L1–L8 above.

| Moment | Hidden move | The obvious button | Where in the prototype |
|---|---|---|---|
| A fix didn't work | Rewind | **Rewind to before this fix** | Move after Prove; makes the A6 diamond hollow, rail back to Fix |
| Several files will change | Plan mode | **Plan first** toggle, on | Ask pill option row (the composer tray in the app) |
| A bug is subtle | Extended thinking | **Think harder** dial: Quick, Normal, Deep | Ask pill option row, segmented (the composer tray in the app) |
| Two fixes look plausible | Worktrees, subagents | **Try both** | Found it card; also after a rewind |
| Solved it | Skills | **Save as a skill** | Moves after Prove, Review, Ship |
| Long work | Background, /loop | **Keep watching** | Primary move at Watch |
| Second opinion | /code-review, /security-review | **Review this fix** | Found it card (early) and primary move at Review |
| Context filling | /compact | **Tidy up the agent's memory** | A7 ring turns `amber` above 70%; move at Watch |
| Same question again | Custom commands | **Save as command** | Ask pill option row (the composer tray in the app); the command then shows in `/` |
| Resume yesterday | --continue | **Pick up where you left off** | Welcome sheet when the story starts |

#### S · Skill library

| ID | Element | Anatomy | Status |
|---|---|---|---|
| S1 | **Skill shelf** | Summoned sheet (K, or Skills in the rail strip). Search field, source filter toggles (All, This project, Shrike, From Claude Code), grid of skill cards; the header wraps the filters to a second row when the sheet is narrow. Card: mono name 12px, one "when" line in `inkDim`, meta row (source tag, violet `v3`, `used 9×`, `improved 2 days ago`, `read-only`), Run and Edit (View when read-only). A just-saved skill has a violet border and glow | Build |
| S2 | **Import Claude skills** | Amber-edged banner at the top of the shelf: "You have 29 Claude Code skills in ~/.claude/skills. Use them in Shrike? Shrike only reads them and never changes that folder." Use them / Not now. Imported cards carry an amber `CLAUDE CODE` tag and `read-only`; View opens the in-app file view with a read-only note. The prototype lists the owner's real folder names (names only) | Build |
| S3 | **Skill as a live checklist** | Violet-edged glass list just above the caption: caps title `Skill · start-todo-app v3`, one row per step. States: `○` waiting (inkFaint), `•` running (slow, ink), `✓` done (ok), `!` warning (amber, with the result after a `·`), `✕` failed (fail). Steps advance every 650ms in the prototype | Build |
| S4 | **Evolving skill** | No card and no Keep step (docs/13 S4). What the agent learns waits as a row in the skill's History: `Draft` caps, the skill name, the reason, a dim "Kept by itself once a run like this works" and **Edit before keeping**. A verified outcome applies it with the SL2 [Level Up] window and its Undo; the card then shows one violet history line (`v4: checks the port first`) | Build |
| S5 | **Save as a skill** | Draft sheet: Name and When inputs, the steps lifted from the trip as a numbered list, "Saved to .shrike/skills in this project", Save skill / Not now | Build |
| S6 | **Skills in /** | In story mode the slash palette lists saved commands and every skill (`/start-todo-app`, `/xyne-pr-review` once imported) after the built-in commands; picking a skill runs S3 | Build |
| S7 | Skill marketplace | Not drawn | Design |
| S8 | **Action recipes** | Recipes tab in the skill shelf header (hud-btn, signal when on). Cards are `<details>` rows, 36px, hairline border: chevron, mono name, dim one-line description, `THIS PROJECT` / `YOUR DEFAULT` signal tag, faint `SOON` when not wired, rank badge and `Lv.n`. Open: `.field` agent select and CLI arguments (fail-coloured error line), mono prompt textarea, variable chips as hud-btns, a hairline skill box (violet ✦, meta, violet `vN` changelog lines), faint note under CLI arguments while they aren't passed on, Save / Saved (Saved only when this project has its own), Make it my default, and a hud-btn reset that reads Reset this project, Clear my default or Undo edits | Build |

#### G · Git and GitHub

| ID | Element | Anatomy | Status |
|---|---|---|---|
| G1 | **Ship sheet** | Caps `Ship this fix`, headline from the trip verdict, a step list (`✓` ok, `•` running, `○` waiting): branch `fix/add-todo-userid`, commit message, push, PR `#42` with the issue card and clip, sync with main. Push waits on an approval box. Solid glass over a void scrim on the stage; under 24rem wide the header keeps only the icons | Build |
| G2 | **Review findings** | Sheet with one bordered finding per review: caps source and count (`Code review · 1 note`, `Security review · passed` in ok), one plain sentence, the `file:line` as a quiet button that opens the in-app file view, Ask to fix it / Fine as is. "Nothing is posted anywhere" | Build |
| G3 | **Conflict view** | Sheet: the file and line, two bordered columns (Yours · branch, main · who), the agent's proposal as a diff (both sides removed, merged line added), Apply to this file; then an S3 checklist re-runs the flows | Build |
| G4 | **CI dots** | Caps `Checks`, a row of 9px dots (`ok` pass with glow, `fail`, `slow` hollow ring pending, `inkFaint` skipped), the check names in faint caps after. A failed check opens a finding with the log line in plain words, **Ask why** (violet answer line) and Re-run this check | Build |
| G5 | **Merge when green** | Primary button, disabled at 45% until every check and the flows are green; then an approval box ("This changes main for everyone") with Merge / Not now | Build |
| G6 | **Sync with main** | Approval-coloured box in the ship sheet when main moved; it merges main into the branch (never a rebase of a pushed branch, never a force-push) and hands conflicts to G3 | Build |

Approval boxes (push, merge, remove worktrees) share one look: `sdlc.approval` border, faint amber fill, a plain sentence that says what changes and what is not touched, a cyan primary and a plain "Not now".

#### W · Worktrees

| ID | Element | Anatomy | Status |
|---|---|---|---|
| W1 | Worktree tabs | Replaced by the workspaces rail (WS1) | Build |
| W2 | **Run per worktree** | No new mark: each tab's tooltip and the dock host show its own port (`:5174`, `:5175`) | Build |
| W3 | **Fix race** | Sheet with two columns, each: tab name, port, teal `SANDBOX` ribbon (A12), the approach in mono, a mini thread (four tiny lanes, the trip path drawing in, then a green return or a dashed red return ending in a red ring with "owner missing"), one result line. Winner gets a green border and glow, loser drops to 70%. **Use this fix · fix-userid** applies it the normal way (A6 checkpoint, O2 ghost cursor, T7 re-knit). Under two 240px columns the candidates stack; names truncate (full name in the tooltip) and buttons wrap. | Build |
| W4 | Sandbox fix | The W3 column ribbon; a single-fix sandbox reuses it | Build (ribbon only in the prototype) |
| W5 | **Clean up** | Sheet listing each worktree with `✓` merged or amber `!` "1 change that was never merged", "Their folders are deleted. Your main branch is not touched", Remove both / Keep them | Build |

#### WS · Workspaces (docs/13 WS1 to WS3)

| ID | Element | Anatomy | Status |
|---|---|---|---|
| WS1 | **Workspaces rail** | Glass column (`pane` radius) at the window's left edge, 244px, collapsing to 46px tiles. Header: caps `Workspaces`, + and a panel toggle. Needs you (`slow`) and Working (`violet`) micro caps groups with a count sit on top only while any workspace is in them; everything else is grouped by project: a 28px project header (12px chevron that folds it, 12px medium `inkDim` name, 11px faint folder like `~/Desktop`). Row: 12px branch glyph (`cyan` on the current row, faint otherwise), mono 12px name, a 6px breathing agent dot only while the agent works (`violet`) or waits (`slow`); one 11px faint status line under it of at most two plain facts ("Agent working", "Running on :5173" in `ok`, "551 changes not committed", "PR #42 open" in `cyan`, "3 to push"), never chips; rows in the top groups show their project on the right. Current row: glass fill and a 2px `cyan` inset bar on the left; hover: a lighter glass fill and the row's ⋯ menu. Collapsed tile: 32px square with two uppercase initials, `cyan` border on the current one, the breathing dot in its corner only while the agent works or waits; sections split by a hairline. Row menu: solid glass, plain sentence-case items, Delete in `fail`. One short faint hint with a `cyan` link when there's only one workspace | Build |
| WS2 | **New workspace dialog** | Centred solid glass card (`card` radius) over a void scrim: thin caps title, one plain line; Project select; Start from as hud-btn tabs; Smart's 36px field with a live line underneath (icon + what it understood + the PR title); PR and branch lists as hairline listboxes; Agent and First prompt side by side; Advanced in a hairline `<details>`; inline progress (`✓` ok, a solid `signal` dot running, `✕` fail). Footer: Create more checkbox, Cancel, the one cyan `btn go` Create workspace with ⌘↵ | Build |
| WS3 | **[Workspace ready]** | A System window (SL frame and tag): "Workspace ready: name", one dim line of what happens next. 3.2s, a click sends it away | Build |

#### B · Driving apps

| ID | Element | Anatomy | Status |
|---|---|---|---|
| B1 | **Record a flow** | Red `● Record a flow` in the flows sheet. While recording: a 2px red inset ring on the app dock, `REC 2` (a steady 8px red dot and the elapsed time, caps mono) in the dock bar, a live S3-style list of captured steps, Stop recording as the primary move; then a name sheet | Build |
| B2 | **Flows shelf** | Summoned sheet (F, or Flows in the rail strip): cards with the flow name in display type, steps joined by arrows, a status dot with "last run green/red", a cyan eye `watching` when B3 is on, Run (replays with the O2 ghost cursor and lands a trip) | Build |
| B3 | **Keep watching** | Sheet: segmented When (On every save, Every 10 minutes), the flows it will re-run, "A flow that turns red raises a dot and a notification", Start watching | Build |
| B4 | **My tools** | Toggle chip on the composer option row: `My tools · chrome-devtools`, off by default, joined to a 24px plug button that opens Tools (MCP1). With no servers ready: one quiet `Add tools` chip with the plug | Build |
| B5 | Shrike is drivable | No new mark (every action is an MCP tool) | Build |

#### MCP · Your agent's tools (docs/13 MCP1 to MCP8)

Glyphs: `mcpGlyph` in tokens.ts (12×12, 1.3px round strokes, keys match the catalog's `glyph`: browser, git, data, files, fetch, issue, design, pay, docs, memory, plug for anything unknown). Colour: `mcp.tone` (teal) marks the user's own servers, so they never read as Shrike's own violet agent tools. Status dots are semantic only: `ok` (with a 6px glow) working, `fail` not working, `slow` pulsing while checking or waiting on you, `inkFaint` off or not checked. Source tags take `mcp.source` borders: amber for Claude Code (read-only, as S2), ink for Just me, cyan for This project. Styles in `renderer/src/mcp/mcp.css`.

| ID | Element | Anatomy | Status |
|---|---|---|---|
| MCP1 | **Tools tab** | Right-dock tab with lucide `Plug` and the word Tools; a `warn` dock count of servers not working. Body: a dim one-line count and a `Check all` hud-btn; a full-width hairline switch row ("Your agent gets these when you ask", 26×14 pill switch, `signal` when on); then groups with 12px dim sentence-case headings (From Claude Code, This project's .mcp.json, Shrike's own) and a faint plain note beside each; servers sit in one list with hairline dividers | Build |
| MCP2 | **Server card** | A plain list row (10px vertical padding, hairline divider between rows): a 22px hairline glyph tile (teal; faint when off), 13px sentence-case name, faint 11px source word, the pill switch on the right. Purpose in 12px dim. Status line: 7px dot, the plain word in its colour, mono time. Error: a 2px `fail` left rule with `--fail-ink` text. Chip row: `▸ 12 tools` (opens details: command or address in mono, the tool list `name · description`), `NAME ••••` secret chips, then hud-btns Fix it (wrench), Check again, Remove. Off cards sit at 60%; a failing card gets a 2px `fail` left bar. Untrusted: one dim sentence and the cyan `Trust and check` | Build |
| MCP3 | **Suggested for this project** | Dashed `hair-strong` card, 12px dim heading "Might help with this project", one row each: teal glyph, name, dim why, `+ Add` hud-btn, `×` Not now. Never more than three, never glowing | Build |
| MCP4 | **Popular list and add form** | Rows: glyph, name in 12.5px ink, purpose in 11.5px dim, a faint `+`; added ones read "· added" with a faint glyph. Open row: a `signal` 35% bordered glass form: name, purpose, why (ink), the command or address in faint mono, fields (label, faint mono name, 28px mono input, password for secrets with "Goes to your keychain"), Just me or This project as a segmented control, the one cyan `btn go` Add | Build |
| MCP5 | **Paste your own** | The same form frame: one dim line of what you can paste, a 4-row mono textarea, a password field per `${NAME}` found, the scope control and Add | Build |
| MCP6 | **X-ray tools strip and step mark** | Next to the file chips: teal pills (1px teal 55% border, teal 10% fill), glyph, server, faint `×3 · 2.1s`, a 5px `fail` dot when a call failed; hover lists the tools. On a step row: the glyph and the call's time in teal mono 10px before the words | Build |
| MCP7 | **Skill uses tools** | On a skill card under "when": 20px teal pills per server, at 50% when not ready here. The needs card in Tools: a violet 45% bordered box, the skill in medium ink, Run without it, close | Build |
| MCP8 | **[New Tool Unlocked]** | A System window (SL frame, tag, scan line): the server's glyph in teal and its name in 15px ink, one dim line "Your agent used it for the first time, and it worked.", `+20 XP` in signal mono caps. 3.2s, waits for skill windows, a click sends it away, Calm shows it still | Build |
| MCP9 | **Use from your own Claude Code** | A section in Tools above Add a tool: 12px dim heading, a faint 11px note under it ("Copy and paste. Shrike never edits Claude Code's files."), a faint 11px line with the plugin commands in dim mono and a small copy hud-btn, then three numbered steps in one `hair` 10px-radius box with hairline dividers. Each step: 12.5px ink line, 11.5px dim where it goes, a copy hud-btn (lucide `Copy`, turns `Check` for 1.5s). Step 1 shows the command in a 10.5px dim mono well (wraps anywhere) (`c-well` 25%), the token as `••••` until the eye hud-btn reveals it; a faint mono `--mcp-config` line under it with its own copy. Status row under the box: the 7px `ok` dot and each connected client's name with a faint "2m ago", or an `inkFaint` dot and "Nothing connected yet"; `New token` hud-btn (lucide `RotateCcw`) on the right; after it, one faint line with the `claude mcp remove` step. Clipboard only, never a file write | Build |
| MCP10 | **Trip line in Claude Code** (the plugin's mod, `integrations/claude-code`) | Drawn by Claude Code above its prompt, not by Shrike, so it takes Claude Code's theme keys and no Shrike tokens: one truncating line, `Shrike` dim, two spaces, the trip's name, the verdict in `success` (worked), `warning` (slow) or `error` (broke), then ` at file:line` dim. Absent while Shrike is closed or has no trip; redrawn only when the trip changes, never animated. `/shrike` prints the same as one sentence | Build |

#### R · Get it running (the start quest in the app dock)

| ID | Element | Anatomy | Status |
|---|---|---|---|
| R-tools | **Missing on this computer** | Inside the start quest, one card per tool, the Your turn card's shape (3px radius, 1px border at 55%, fill at 7%): `fail` for one that stops Run (caps label "Missing on this computer" in `fail-ink`), `slow` for a note (caps label "Runs with less"). Tool name 13px `ink` medium with the version found in mono 11px `inkDim`, one plain line 12px `inkDim`, the command to paste in mono 11px with a faint `$` and a Copy hud-btn, then a quiet hud-btn "Get it from the download page" (lucide `ExternalLink`). Below the cards, when Run stopped: **Check again** (solid hud-btn, lucide `RotateCw`), which runs the check and the start again. Findings in docs/14 "Missing tools" | Built |

#### L · SDLC rail (docs/13 L1–L7)

| ID | Stage | Anatomy | Status |
|---|---|---|---|
| L1–L7 | **Rail** | One slim row across the top of the Thread, only while a change is in flight: Spot, Understand, Fix, Prove, Review, Ship, Watch. Each stage is a dot and one caps word (10px mono, 0.16em) joined by hairline segments. Idle: 7px `inkFaint` ring, word `inkFaint`. Done: 7px dot at `sdlc.doneFill`, word `inkDim`, the segment after it green at 35%. Current: 9px filled `cyan` dot with a 3px halo and glow, word `core` (the only bright thing). Failed: `fail` ring. Skipped: struck through. Clicking a stage opens its detail (the broken trip, the finding, the checkpoint, the proof checklist, the review, the ship sheet, the flows). Skills and Flows sit quiet at the right end | Build |
| L1 | Spot | Lights when a trip broke (or a watched flow turned red) | Build |
| L2 | Understand | Active while the probe walks; done at FOUND IT | Build |
| L3 | Fix | Current while the Found it card waits; done when a patch is applied (or the race winner is used) | Build |
| L4 | Prove | The re-run plus an S3 checklist: re-run, `npm test`, each saved flow | Build |
| L5 | Review | G2 sheet passed or waived | Build |
| L6 | Ship | PR open, checks green, merged | Build |
| L7 | Watch | B3 is on | Build |
| L-mode | **Fix / Build toggle** | At the rail's left end: a 20px segmented mono caps control (`opt-seg` style), the shown mode in `core` on glass, the other `inkFaint`. Only shown when both a fix and a quest are in flight | Build |
| L8–L15 | **Build rail** | Same anatomy as L1–L7 with the words Idea, Plan, Design, Build, Prove, Review, Ship, Live. The quest's title sits in the detail slot as `inkDim` 12px; the current stage's sentence replaces it | Build |

#### QB · Quest board (docs/13 QB1 to QB9)

| ID | Element | Anatomy | Status |
|---|---|---|---|
| QB-board | **Quest board** | A summoned sheet over the stage (Q, the top bar's flag, the rail's Idea and Plan stages), stage dims to `void` at 82% with a 6px blur. Centre column 560px: the focused quest card; right column 240px, a solid glass card: slivers and the new-quest field | Build |
| QB-card | **Quest card** | The SL System frame (corner brackets, scan line, `[ QUEST ]` tag; `[ QUEST COMPLETE ]` in `ok` ink when done): title 18px `sys-title`, the idea in 12.5px dim (2 lines), source chip (`#2452` mono, hairline), `n/m` and the proficiency-style bar. Planning: the violet ✦ and "Your agent is planning this · 0:42" (H14 timer); a plan waiting shows its objectives ghosted with **Start this quest** (the one cyan `btn go`) and Not this | Build |
| QB-thread | **Objective thread** | A 2px vertical thread down the card's left with an 11px node per objective. Future: dashed `inkFaint` thread at 45%, hollow node, text `inkDim`. Next: hollow `cyan` node with a halo, text `core`, its buttons under it. Passed: solid `ok` segment and filled node, text `inkDim` with a ✓. Failed: `fail` node, "Broke on the last run" in `fail-ink`. Under each text: `DONE WHEN` micro-label and the flow as a mono chip (route glyph) or "No flow yet" in faint | Build |
| QB-sliver | **Quest sliver** | 32px row, hairline, glass at 50%: a 3px left rule (`cyan` active, `violet` planning, `ok` complete, `inkFaint` dropped), title 12.5px `inkDim` truncated, `n/m` mono faint. Hover lifts to ink; click focuses | Build |
| QB-new | **New quest** | `.field` "What do you want to build?" with Plan it; under it a quiet "From a GitHub issue" that opens a hairline listbox of open issues (number mono, title, labels as faint chips) with a search field | Build |

#### I · Place inspector (docs/13 I1–I7)

| ID | Element | Anatomy | Status |
|---|---|---|---|
| I1 | **Lane header as a button** | The header label is a button; the open lane's label turns `core` with a 1.5px `cyan` underline and a glowing glyph. The dock bar reads `YOUR APP`, or a back arrow + `POSTGRES · orders` (head in caps, sub in normal case). The dock widens to `clamp(380px, 36vw, 640px)` while a lane is open | Build |
| I2 | **Rows grid** | Tab row (`Rows`, `What this click changed · N`), a faint mono line saying how it is read, table chips with counts (the table the click used has a 5px `cyan` dot), a search field, then a mono 11px table with a sticky caps header (click to sort ↑ ↓). Rows the focused trip picked: `cyan` 9% fill with a 2px `cyan` left rule. `N of M rows` and Show more | Build |
| I3 | **Change rows** | One bordered card per table (`events · 1 added`); each row a caps tag and the values: `added` `ok` rule, `changed` `slow` rule with `before → after` on changed fields, `removed` `fail` rule struck through. Empty: "Nothing changed in the database during this click." Under the cards, when a write came without its rows, a faint 11.5px line: "This click also went through localhost:4620, where Shrike couldn't see every row change, so there may be more." | Build |
| I4 | **Cache entries** | Rows of key, value preview, time left and size; this click's marks reuse T15/T16: filled `ok` dot hit, `slow` ring miss, `cyan` dot saved. A key missed and not in the cache shows on top | Build |
| I5 | **Process output** | Status dot and words, port, the route list (open, scrolls past 40vh; a row click sends that route in the API client with a `cyan` send arrow on hover, AP2), then the process output in mono; lines carrying the trip's logs and errors get the I2 highlight | Build |
| I6 | **Outside calls** | One row per call (method tag, path, status words in `ok`/`fail`, ms, time), newest first; the focused trip's call is open with Sent and Answered bodies | Build |
| I7 | **Why not** | A lane that can't be read shows one plain sentence and `Look again` | Build |

#### AP · API client (docs/13 AP1 to AP14)

Bruno's layout in Shrike's materials: one glass workspace, hairline dividers, mono for anything you type. Method colours reuse `MethodTag` (GET `ok`, POST `cyan`, PUT and PATCH `slow`, DELETE `fail`, others `inkDim`); no new tokens. Status pills are semantic only (`ok` 2xx, `slow` 4xx, `fail` 5xx or no answer). The one glow is the Send button while a request is in flight. Under 980px wide the tree floats over the client behind the collections button, and the request behind it hides while it is open, so nothing reads half covered; under 700px (the right dock) the response stacks under the request. Request and response tabs wrap to a second row rather than scroll out of sight; too narrow for the method and the URL, the URL takes its own line. Over the Thread (the A sheet) the client is solid glass. Styles in `renderer/src/api/api.css`.

| ID | Element | Anatomy | Status |
|---|---|---|---|
| AP-tree | **Collections tree** | 232px column: a search field, `+` (new request, new folder, import, open a Bruno folder), each collection as a group (lucide `Library`, a `BRUNO` hairline tag on linked folders, the first token warning in a 2px `slow` left rule), then Routes (from the scanner, handler `file:line` on hover, never-called routes at 55%), History. Rows 26px: method tag then the name in 12px `ink`; folders with a chevron and a folder glyph; the open request has the I-row hairline and 2px `cyan` inset bar. Row menu (… or right-click): Rename, Duplicate, Move to, Delete in `fail`. Drag a row to reorder: a 2px `cyan` line shows where it lands | Build |
| AP-tabs | **Request tabs** | 30px strip under the dock header: method tag + name, 6px `slow` dirty dot that turns into × on hover, `+` at the end; the open tab has a 1.5px `cyan` underline. The A sheet header carries an IconButton (lucide `Maximize2`/`Minimize2`) that lifts the sheet over the whole window (`inset 12px`, below the top bar, all four corners `--r-card`) and back | Build |
| AP-url | **URL bar** | 34px hairline box: method select (coloured by method), the URL in mono 12.5px where `{{var}}` reads in `violet` (unknown ones in `fail` with a dotted underline) and hover shows the value; then `</>`, Save, and the Send arrow as `btn go` (Cancel while in flight) | Build |
| AP-kv | **Key and value table** | Rows of a 14px checkbox, name and value fields (mono 12px, hairline bottom only), a × on hover; the last row is a ghost "Add" row. Header right: Bulk Edit toggles a textarea of `name: value` lines (`//` turns a line off). Header count badge beside the tab word | Build |
| AP-auth | **Auth panel** | A mode select (Inherit, No auth, Bearer token, Basic, API key) and the mode's fields; Inherit says where it comes from in one dim line | Build |
| AP-env | **Environment picker** | Top right hud-btn with a globe glyph and the env name (No environment in `inkFaint`); the editor is a solid glass card dropped from the top of the client, just under the picker (the import and code cards open there too): envs on the left, AP-kv with a Secret toggle on the right | Build |
| AP-res | **Response pane** | Header: status pill (plain words), time, size, then tabs Pretty, Raw, Headers, Cookies, Timeline and **Show what the app did** (hud-btn solid). Pretty is a JSON tree: keys `prop`, strings `string`, numbers `number` (code tokens), ▸ folds, a search field that lights matches in `cyan` 15%, a click on a key copies its path (`res.body.items[0].id`) | Build |
| AP-trip | **Timeline bars** | One row per step of the trip: faint 11px place word, the step name, a bar on a shared ms axis (`cyan`, `slow` for slow, `fail` for broken) | Build |
| AP-empty | **Shortcut empty state** | Centred: the Shrike emblem at 30% and three rows of word + Kbd (Send request ⌘↵, New request ⌘B, Environments ⌘E), then "Every send becomes a trip on the Thread." | Build |
| AP-secret | **Masked field** | A password-style field with an eye toggle (lucide `Eye`/`EyeOff`); the Authorization header value, auth token and password, and secret env values use it | Build |
| AP-assert | **Assertion row** | AP-kv layout with an operator select between expression and value; after a send a 16px chip on the right: `ok` PASS or `fail` FAIL with the actual value on hover | Build |
| AP-chip | **Script sandbox chip** | A quiet plain line on the Script tab: "Runs in a locked sandbox: no files, no network, 2 seconds." Then three code fields (before the request, after the response, tests) and the script output when there is some | Build |
| AP-resend | **Trip title actions** | On the focused trip's title row, right aligned: `EDIT AND RESEND`, `SAVE AS TEST` (answered under 400) and `COMPARE` (resends only) in mono 10.5px caps `inkDim`, `cyan` on hover and when pressed; a resend adds a dim `EDITED RESEND` label. Compare opens a glass list under the row (mono 11.5px, `glassEdge` border): the changed fields as `body.user: missing → 1`, then the answer. The dive card head gets the same `EDIT AND RESEND` for an HTTP step | Build |
| AP-first | **[Request Saved] / [Assertion Passed]** | A System window (SL frame, tag, scan line): the request or flow name in 15px `ink`, one dim line ("Your first saved request in this project. Your flows replay it." / "Your first API check passed. It runs again with your flows."). 3.2s, waits for skill windows, a click sends it away; once per project | Build |
| AP-routes | **Routes page** | The client's second view: a `Routes` hud-btn in the tab strip (pressed: `cyan` text) swaps the request work area for a reference. Left, a 260px list: search, one 11px `inkDim` line saying where the spec came from (or that routes come from the code), groups by tag (micro caps label and a mono count), rows 26px: method tag then the path in mono 11.5px `ink`; the selected row has the AP-tree `cyan` inset bar. Right, the reference on the same solid glass: method tag and path in mono 15px, summary 13px `ink`, description `inkDim`, AP-src chips, then actions (Try it as `btn go`, Save as test as hud-btn, the handler `file:line` in mono 11px `cyan`, opening the file view). Sections under micro caps headings: Parameters, Request body (content type, AP-schema, the example in a code block), Responses (status pill per AP-res colours, description, AP-schema, example). ↑↓ move through the list, Enter tries the route, `/` searches. Under 700px the list sits above the reference | Build |
| AP-src | **Source chips** | 16px hairline chips, mono 9.5px caps: `OPENAPI` in `ok`, `IN YOUR CODE` in `inkDim`, `SEEN IN CALLS` in `cyan`, `GUESSED FROM CODE` in `violet` with a dashed border. A guess is never shown without its chip | Build |
| AP-schema | **Schema rows** | One row per field: the name in mono 12px `ink`, indented 14px per level with a hairline guide; the type in mono 11px `inkDim`; `required` in mono 9.5px caps `slow`; enums as "one of a, b" in `inkFaint`; a description wraps under in 11.5px `inkDim`. Path, query and header params use the same row with a faint IN word | Build |
| AP-guess | **Guess review** | "Fill in examples" turns on 14px checkboxes beside routes the spec doesn't cover, with "Guess N routes" (`btn go`) and Cancel in the list header. While the agent reads, one line with the busy dot ("Your agent is reading the handlers"). Results open over the reference as a list of glass cards (glassEdge, a 2px dashed `violet` left rule, the AP-src `GUESSED FROM CODE` chip): the route, AP-schema params, the body example, responses, then Accept (`btn go`) and Skip. Nothing is saved until Accept | Build |
| AP-check | **Body check** | Under the JSON body editor when the route has a schema: up to four lines in 11.5px `slow`, each with a lucide `TriangleAlert` at 11px ("lines[0].qty should be a number, not text."); the Body tab word gets the `slow` dot. Send is never blocked | Build |

#### P · Prompt chains (docs/13 P1–P5)

The IDs carry a `P-chain` prefix so they never clash with the motion patterns P1–P8. Code: `apps/desktop/src/renderer/src/chains/` (`chains.css`).

| ID | Element | Anatomy | Status |
|---|---|---|---|
| P-chain1 | **Up next stack** | Inside the agent pill under its header (or in its own 300px glass box when there is no agent pill): caps `UP NEXT · 2` in violet (slow when paused) and a Pause/Resume hud-btn. Slim cards, 7px radius, hairline border and a 2px violet left rule: a faint `⋮⋮` grip, the prompt in 12px ink (click to edit in a `.field`), then the when chip, a teal branch toggle and ×. Dragging over a card draws a 2px violet line above it. Starting: the card turns cyan (rule, border, glow), says `NOW`, then fades up into the run (none in Calm). Missed: slow left rule, one plain line, Run it now / Skip | Build |
| P-chain2 | **When chip** | A native `<select>` styled as a 20px mono caps chip (hairline, `inkDim`); a scheduled value is cyan. "At a time…" opens a native `<input type="time">` beside it. Also on the composer's row with **Add to up next ⌘⇧↵** (or **Schedule**) and **Make it a chain** | Build |
| P-chain3 | **Chain panel and mini-Thread** | Violet-edged glass panel at the stage's top left, 392px; the stage dims to `void` at 72% behind it (as under M-opt1), and while the agent asks a question the panel steps behind the agent cards. Header: ✦, the chain name (an input while editing), Stop chain (fail-tinted hud-btn, always there while it runs), ×. Editing adds Start from… (built-in and saved chains), **Repeat until score ≥ N**, and a radio row for what decides the branch. Nodes are 9px-radius cards with a caps title and the prompt (click to edit). The spine from Ask to Critique is the spectrum (T2) and glows steadily while the critic works; the working node shows its elapsed time. Branches leave a teal trunk (L4) with a caps label (`UNDER 8`, `8 OR MORE`, `RUN FAILED` in fail ink); pass cards have a faint ok border, failure cards a faint fail border. The taken branch is amber (L3: stub, label and card glow; failure taken is fail red), the others drop to `dimOpacity`. The working node gets a cyan border and glow. A looping polish card says `↺ BACK TO CRITIQUE`. The loop guard and Start chain / Run again stay pinned at the bottom while the thread scrolls | Build |
| P-chain4 | **Score dial** | 72px ring: hairline track, a 4px arc for the score (cyan before a score, amber under the threshold, ok at or over it, with a soft glow), a white tick at the threshold once there's a score, the score as a 26px weight-300 numeral in `core` with a small `/ 10`. The critic's WHY sits beside it in 11px dim | Build |
| P-chain5 | **Loop guard line** | Under the thread, caps 9.5px: `ROUND 2 OF 3 · 48K OF 400K TOKENS · 3 OF 30 MIN`, then how it ended in one plain sentence with Run again / Edit. Editing shows Max rounds, Tokens (k) and Minutes as small `.field` number inputs | Build |
| P-chain6 | **Chain System windows** | The SL System frame (corner brackets, scan line, mono caps tag) compact: tag `[ QUEUED ]`, `[ NEXT UP ]`, `[ CRITIQUE ]`, `[ CHAIN COMPLETE ]` (ok ink; slow ink when the failure branch ended it), `[ CHAIN SAVED ]` (ok ink), `[ CHAIN STOPPED ]` / `[ SKIPPED ]` (slow ink), one 15px line under it; a critique shows `5 / 10` as a 22px weight-300 numeral then `→ polishing` in dim. Top-centre below the lane header; while the chain panel is open they sit inside it, under its header | Build |

#### M · Options and mockups (docs/13 M1 to M6)

The IDs carry an `M-opt` prefix so they never clash with the materials M1 to M7. Code: `apps/desktop/src/renderer/src/options/` (`options.css`).

| ID | Element | Anatomy | Status |
|---|---|---|---|
| M-opt1 | **Options board** | Over the stage, which dims to `void` at 72% with a 6px blur (no Thread text reads through the gutter): one violet-edged glass panel (`pane` radius, faint violet glow). Violet ✦, the header as a violet caps micro-label, the question in 18px display ink, × to put it away (a violet pill "Your agent is waiting for your pick · Show options" brings it back) | Build |
| M-opt2 | **Option card** | `card` radius, hairline border, faint void fill. Top row: the card name in a mono chip (`B2+C`), the label in 15px semibold, a faint key number, the width toggle. Then the mockup (M-opt3), one dim line of description, and the actions: **Approve this** as the one `btn`, then plain-word secondaries in 13px dim `ui` type with no border (`opt-act`: More like this, Change it, Add to combine, Pin with its glyph; cyan when on). The focused card is the one thing lit: cyan border, soft cyan glow, cyan name chip, and only its **Approve this** is the cyan primary. Picked cards get a violet border. Columns 240px to 340px, centred, wrapping | Build |
| M-opt3 | **Mockup frame** | 10px radius, hairline, void behind; the sandboxed iframe drawn at 390px (phone) or 1280px (desktop) and scaled to fit, on `core` when the mockup has no background. Width toggle: a 22px segmented mono caps control (`opt-seg`). A text preview is mono 12px in the same frame | Build |
| M-opt4 | **Option tree** | The cards a round grew from as 168px minis above it, joined to each child by SVG curves: the focused child's in the spectrum (T2) with a cyan drop glow, the rest teal at 35% (L4). A user's note sits above in dim 13px ("You said: …") | Build |
| M-opt5 | **Enlarged option** | The card fills the board: name chip, label, description, width toggle, ×; the mockup live (hover works), the same actions underneath | Build |
| M-opt6 | **History trail** | Mono caps 10.5px crumbs joined by faint ›; the round on show has a cyan hairline and `core` ink; a `.field` select lists rounds off the trail | Build |
| M-opt7 | **Footer** | Hairline on top. Pinned chips (pin glyph, mono). The combine bar: violet caps `COMBINE`, violet-edged chips with ×, a `.field` for what to take from each, **Combine B2 + C** (cyan when two or more are picked). Otherwise "None of these?" and Send. A faint caps key line | Build |
| M-opt8 | **Approved mockup** | In the fix card above the diff: caps `WHAT YOU APPROVED · B2+C` and the label, a 130px mockup frame (max 240px wide) that opens the compare view: the mockup full size over the stage with "Your app, as built, is on the left" | Build |

#### B-brand · Brand image (design-system/brand)

The owner's long-tailed shrike photo as dots. Data, source photo, mask and generator live in `brand/` (see its README); the app draws them on a canvas from `apps/desktop/src/renderer/src/brand/`. Static dots are baked once; only the eye square repaints. Pauses offscreen and in a hidden tab. Calm and `prefers-reduced-motion`: a still image with a steady soft eye glow.

| ID | Element | Anatomy | Status |
|---|---|---|---|
| B-brand1 | **Portrait** (`ShrikeBust`) | Top 42% of the bird, 128 x 128 dot grid: bird dots in their photo colours (Daylight mixes them 45% toward `ink` so the pale throat reads on paper), carved out of a dim field that runs `teal` to `blue` top to bottom at 42% (Daylight: `inkFaint` dots at 55%), with an empty one-dot halo round the bird. A `teal` 60% hairline frame, mono caps `◆  S H R I K E  ◆` above and `⊛  PIN THE BUG  ⊛` below in `teal` mixed with `ink`. Optional draw in: rows appear top to bottom over 900ms, then the eye starts. Reference: `brand/bust-sparkle.gif` | Build |
| B-brand2 | **Emblem** (`ShrikeEmblem`) | The same bust, bird only, dithered dots in the theme's `cyan` to `blue` to `violet` gradient top to bottom (the Thread's spectrum, so it follows every theme). 40-column grid from 140px tall, 28-column below; under 1.5px a dot is drawn as a solid pixel. Small with the sparkle = Shrike is working. In the terminal: the 28-column braille in 24-bit cyan to blue to violet with a ✦ on the eye, then `S H R I K E` (dev, TTY only). Reference: `brand/emblem-sparkle.gif` | Build |
| B-brand4 | **App icon** | The emblem bust in the theme spectrum (`cyan` to `blue` to `violet`) on an `abyss` squircle with a faint `navy` glow, the eye sparkle frozen at its peak (from 64px up). Fewer, bigger dots at small sizes. Source `brand/icon.py`, output `apps/desktop/resources/icon.png` | Build |
| B-brand3 | **Eye sparkle** | On the eye: a radial glow (pulses with the 1.8s loop), a 4-point star in `core` that twinkles twice a loop and slowly turns, two small satellite glints, a bright `core` dot. Glow is `cyan` mixed 30% with `core` on the portrait, `cyan` on the emblem | Build |

#### Z · Themes (themes-composer)

`tokens.ts → themes` holds each theme as overrides of the Abyss tokens (`color`, `code`); `cssVariables(theme)` writes them as `--c-*` and `--code-*` at the root, so every surface follows. DOM code reads `cssColor` (variable references); canvas exports (REC clips, share cards) keep `color`. Semantic colours keep their meaning in every theme; `themes.test.ts` checks text contrast (AA, AAA for high contrast). Code: `apps/desktop/src/renderer/src/themes/`.

| ID | Theme | Look | Status |
|---|---|---|---|
| Z1 | **Abyss** | The original: navy glow on void, cyan signal, violet agent | Build |
| Z2 | **Void** | Pure black grounds for OLED, same signals, glass a touch fainter | Build |
| Z3 | **Tokyo** | Indigo grounds and Tokyo Night hues (`#1A1B26`, blue `#7AA2F7`, cyan `#7DCFFF`), its code palette | Build |
| Z4 | **Mocha** | Catppuccin Mocha: soft warm dark (`#1E1E2E`), pastel signals, rosewater white-hot core | Build |
| Z5 | **Daylight** | Paper `#F6F4EF`, white panels, ink text; signals darkened to pass AA; `core` becomes the darkest ink so focal chips invert; glows read as soft tinted shadows; `well`/`lift` turn Tailwind black/white tints into paper tints | Build |
| Z6 | **High contrast** | Black, white text (AAA everywhere, even faint text), solid white edges, no text glows and no glow shadows on glass, pills, cards and buttons (inset row marks stay) | Build |
| Z7 | **Appearance dialog** | Glass dialog from the top bar's palette button: Match system row (Daylight when the Mac is light, the last dark pick when dark), then a card per theme: a mini Thread (three lanes, the spectrum trip, a broken red station, a code chip, the composer) drawn in that theme's tokens, name, LIGHT/DARK micro-label, one plain line; the picked card has a cyan edge and a check | Build |
| Z8 | **Appearance on the welcome screen** | A hud-btn with the palette glyph and the word APPEARANCE, top right of the welcome screen (no-drag, in the title bar strip), opens Z7 before any project is open | Build |

#### Q · Composer (themes-composer)

Code: `apps/desktop/src/renderer/src/composer/` (`composer.css`). Replaces the floating composer (H1 keeps its look, docked).

| ID | Element | Anatomy | Status |
|---|---|---|---|
| Q1 | **Composer bar** | Docked under the stage, `card` radius, violet-tinted glass with a violet hairline (brighter edge and violet glow while focused). Left: worktree chip (branch glyph in cyan, mono caps name) and `CLAUDE CODE · IDLE` with an H14 state dot (solid violet and the elapsed time when working, solid slow when it waits for you, hollow when idle). Then ✦ and the input (14px display, grows to 6 lines). Right: agent picker when there are two, `UP NEXT · n` violet chip, Show me options, the conversation button (bubble glyph, count, chevron), **Enter** as the cyan `btn go` (a solid violet dot, WORKING and the elapsed time while the agent runs). Sized by its own width (container queries), not the window: when docks narrow it, the agent state hides and Show me options moves into the open tray, so the input keeps at least 120px. An empty input's placeholder ends in an ellipsis instead of pushing Enter onto a second row | Build |
| Q2 | **Conversation** | Glass panel above the bar, up to 56% of the height: caps header with the worktree and count, ×. Each ask: your words in a right-aligned glass bubble (YOU micro-label, context lines as violet chips), then the agent's answer under a 2px violet rule (✦ AGENT, markdown), `n STEPS` folded behind a chevron (mono dim lines, tool names faint). A branch's turn wears its branch colour on the rule and bubble edge, with `BRANCH · name` and Show | Build |
| Q3 | **Composer tray** | Floats above the bar while focused: one solid glass card exactly the bar's width (nothing on the stage peeks out beside it) holding the `/` command list or the `@` file list (violet row highlight, key hint line), context chips, then the P-chain2 controls and Plan first / Think | Build |

#### SC · Source control dock (docs/13 SC1 to SC8)

Code: `apps/desktop/src/renderer/src/dock/` and `scm/` (`scm.css`).

| ID | Element | Anatomy | Status |
|---|---|---|---|
| SC1 | **Right dock** | Glass pane `clamp(320px, 25vw, 440px)`, 36px header of hud-btn tabs (13px icon at 1.75 stroke, sentence-case word, `glass` fill on the open tab, a `slow` count pill, `fail` with conflicts), faint `⌘⇧G` kbd, close. On a narrow dock the kbd goes first, then the tabs you're not on drop to their icon (the word stays as tooltip and name), and last the open tab's word ends in an ellipsis, so the tabs never run under close. Closed: a 46px glass rail of 32px icon buttons (16px icons, 1.75 stroke, tooltips; the last open tab gets a `signal` 14% fill) with the count pill on the corner | Built |
| SC2 | **Branch header and map** | Mono branch in `ink`, faint →, upstream in `inkDim`, ↑ in `cyan` and ↓ in `slow` when non-zero. Map: 44px SVG, base line `inkFaint`, this branch a `cyan` curve with a soft glow, 4px dots (`cyan` fill on GitHub, `abyss` fill with `cyan` ring only here), a dashed `slow` ring for uncommitted work, a dashed `ok` curve and caps `PR` back to the base, `inkDim` dots for the base's new commits. Status words: 12px dim lines with a 5px dot (`cyan` info, `fail` conflicts, `ok` all clear). Sync and Create PR as `hud-btn solid` | Built |
| SC3 | **Commit box** | `.field`-style mono textarea, `cyan` focus edge; a violet pill ✦ WRITE IT FOR ME on its own row under the text, right-aligned (scrolled text never runs under it); while the agent writes the box gets a violet edge and glow, and keeps a violet edge on the words it wrote | Built |
| SC4 | **Commit row** | `btn go` with the count in words, `⌘↵` kbd, then a hud-btn Undo last commit. Notes after an action: a full-width line on a 9% `ok`, `cyan` or `fail` tint with OK | Built |
| SC5 | **Section and file row** | Caps section title with chevron and a hairline count pill (Conflicts title in `fail`); hover reveals Stage all, Unstage all and throw away. Row 26px: status icon and letter in the letter's colour (U and A `ok`, M `slow`, D `fail`, R `cyan`, ! `fail`), 12.5px name, faint mono folder, `ok` +n and `fail` −n, a violet comment count. The open row has a `cyan` inset edge and 9% tint. Hover swaps the counts for icon buttons | Built |
| SC6 | **Diff view** | The file view frame (`.fv`) beside the dock, filling the space between the workspaces rail and the dock (never over the rail): path in mono, caps area word, +/- counts, a segmented Inline / Split, a violet-edged ✦ Ask about this change (just ✦ Ask under 900px). The header wraps its controls to a second row rather than squeezing the path out. Hunk headers on a faint `blue` band; added lines on 9% `ok`, removed on 9% `fail`, the changed words at 28 to 30%; split rows pad with faint hatching | Built |
| SC7 | **Commit row** | 8px dot (`cyan` filled on GitHub, hollow only here, `inkFaint` before this branch), subject in `ink` (`inkDim` when not this branch's), faint author and time; open shows its files indented on a hairline | Built |
| SC8 | **Line comment chip** | At the end of a commented line in SC6: a pill with a 1px `violet` 45% edge, 10% `violet` fill, speech glyph in `violet`, mono 10.5px `author:` in `ink` and the first words in `inkDim` (cut at 48 characters), soft violet glow on hover; inline view only on the new side, split view on the right cell | Build |

Approval in the dock: the shared approval look (`sdlc.approval` border, faint `slow` fill), title, plain reason, Allow (`btn go`) and Not now.

#### PR · Pull request and CI panel (docs/13 PR1 to PR14)

Code: `apps/desktop/src/renderer/src/pr/`. Lives in the right dock as the "PR and checks" tab.

| ID | Element | Anatomy | Status |
|---|---|---|---|
| PR1 | **PR header** | Mono `#42`, then the state as a status word: a 7px dot in the state colour with a soft glow (`ok` Open, hollow `inkFaint` Draft, `violet` Merged, `fail` Closed) and the caps word in that colour, no pill box; then the caps review decision (`ok` Approved, `slow` Changes asked), which drops whole to a second line on a narrow dock, never mid-word; 15px semibold title (two lines), dim author and faint "updated 3 h ago", then the PR11 branch thread; icon buttons Refresh, Open on GitHub, More (glass solid menu) | Built |
| PR2 | **Checks ring** | 58px SVG ring, 4px stroke on a `hair` track, one segment per state in order fail, running (steady `slow`), pass, skipped (`inkFaint`), a soft glow on fail (or on pass when all green); centre `21/22` as a weight-300 numeral; beside it caps `CHECKS`, a 15px verdict in the state colour and the dim summary line | Built |
| PR3 | **Check row** | 8px radius; failing rows have a `fail` 30% border and 4% fill, the first one glows (one thing glows); status glyph (✓ `ok`, ✕ `fail` with glow, steady hollow `slow` ring, – faint), name, faint workflow, mono duration, chevron, ↗. Open: a step rail (hairline joining 11px glyphs, the failing step in `fail`), the plain summary, a mono log tail on void, ✦ Fix it (`btn go` when focal) and ✦ Explain | Built |
| PR4 | **Who tabs** | Caps mono tabs with a 1.5px `cyan` underline when on and a count pill (`cyan` 15% when on) | Built |
| PR5 | **Comment card** | 10px radius hairline card (open threads on glass with `glassEdge`), 22px initial avatar (bots `violet`), name, violet caps `BOT` tag, faint time; the body in the safe renderer (code on void, suggestions with an `ok` edge and caps label, tables in mono 10.5px); reaction pills (`cyan` edge when yours); a row of hud-btn actions with Queue for agent on the right. Thread header: mono `cyan` file:line chip, faint caps `OUTDATED`, `ok` RESOLVED or `slow` OPEN | Built |
| PR6 | **Review progress** | Dim "N of M conversations resolved" with the count as a 15px light numeral, `slow` "K open", a 5px `ok` bar on a `hair` track (glows when all resolved) | Built |
| PR7 | **File comment count** | Hook only; the source control list draws it | Built |
| PR8 | **Compose** | Segmented Comment / Approve (`ok`) / Request changes (`slow`), a `.field` textarea, `btn go` submit, faint "Asks you first" | Built |
| PR9 | **Agent reply draft** | Violet 40% edge, 6% fill, caps `✦ YOUR AGENT'S REPLY`, the reply, Post reply / Edit / Discard | Built |
| PR10 | **Drawer and approval** | Glass solid drawer at the stage's right edge (420px); the approval box inside the panel uses a `cyan` edge and glow, the action in words and what will be posted verbatim in a void block | Built |
| PR11 | **Branch thread** | 30px SVG: base line `inkFaint` with the base name in caps mono 8.5px, this branch a `cyan` curve with a soft glow and the head name in mono `cyan` on it, the PR marker at the tip as a 5px ring in the state colour (filled `ok` open, dashed `inkFaint` draft). Merged: a `violet` curve back down into the base and a filled `violet` dot where it joins. Closed: a short `fail` cap across the tip | Build |
| PR12 | **Check stations** | A 1.5px `hair` line down the left of the check list through each row's glyph; each glyph sits in an 16px station disc of `abyss` with a 1px ring in its state colour (`fail` ring glows on the focal row, running is a steady hollow `slow` ring with its elapsed time on the row). An open row is opaque (`abyss`, a failing one 4% `fail` over it) so the line stops behind it. Steps inside an open row keep their own small rail | Build |
| PR13 | **PR moments** | System windows (SL frame, tag, 15px line, one dim line) top-centre over the stage: `[ SYSTEM ]` **Pull request opened: #42**, **All checks green: 12 of 12 passed** (the line in `ok`), **Merged: #42 is in main** (`violet` word). Waits while a skill, results or notice window is up; 3.2s, click dismisses | Build |
| PR14 | **Open pull requests** | Above the checks when asked for ("show open PRs"): caps `lbl` "Open pull requests", then one row per open PR, mono `inkFaint` `#42` and the title in `ink`, 6px radius, `glass` on hover; a row shows that PR in the panel | Built |

#### CI · CI lessons and pre-flight (docs/13 CI1 to CI8)

Code: `apps/desktop/src/renderer/src/lessons/ci/` (`ci.css`). Tokens only; every colour reads in all six themes (Daylight's darkened signals, High contrast's solid edges, no glows there).

| ID | Element | Anatomy | Status |
|---|---|---|---|
| CI1 | **Pipeline thread** | The CI as a mini Thread (T1 to T4): one lane per stage (a 1px lane line with a caps mono header `STAGE 1 · 9 JOBS`, or the GitLab stage name), jobs as T3 stations down the lane, grouped under a faint caps workflow label. A station: 12px ring in the job's colour (`ok` mostly green, `fail` failing more than 1 in 5, `slow` flaky as a dashed ring, `inkFaint` not on pull requests), the job name in 12px `ink`, a dim mono line (`node 22 · 4m · 1 in 9 failed`). `needs` draws a spectrum (T2) connector between lanes. Jobs this change touches carry a 5px `cyan` dot | Build |
| CI2 | **Lesson skill chip** | Mono `ci-lessons v3` with the SL4 rank badge, a dim "learned 2 lessons" and a hud-btn **Learn again** (violet ✦, it is an agent move) | Build |
| CI3 | **Pre-flight panel** | In the Changes dock above Sync: a `card` radius hairline box, caps `PRE-FLIGHT`, one dim line ("3 of 11 CI jobs touch this change"), `btn go` **Run pre-flight**; running: one row per leg (station ring: waiting `inkFaint`, running steady `cyan` with a soft 3px halo, ✓ `ok`, ✕ `fail` with its glow, – skipped `inkFaint`), the live last line in faint mono under the running row, Stop | Build |
| CI4 | **Result card** | The legs as one wrapping line of `name ✓` / `name ✗ (why)` joined by faint `·`, the red one with **Fix it** (violet ✦) after it; then the verdict in 15px display: `ok` **Safe to push** or `fail` **Fix 1 thing before you push**. Mismatch warnings above it on a 9% `slow` tint | Build |
| CI5 | **Local vs hosted** | Two station columns per job row, `YOU` and `GITHUB` caps headers, joined by a hairline; the first row where they differ snaps (T4): the GitHub station turns `fail` with a ring pulse and 12 sparks (none in Calm), and the hairline turns `fail`. Rows that matched carry a faint `ok` tick between the stations | Build |
| CI6 | **Track record** | A 40px weight-300 numeral (`ok` at 0, `slow` above) and the plain line "surprises from CI in your last 8 pushes"; a row of 8px dots for those pushes (filled `ok` clean, `fail` surprise, hollow waiting on CI) and the streak in caps mono | Build |
| CI7 | **[Lesson Mastered]** | A System window (SL frame, tag, scan line): `[ LESSON MASTERED ]`, the job name in 15px `ink`, "Learned: …" in `inkDim` with the word in `signal`. 3.2s, waits while another System window is up, click dismisses | Build |
| CI8 | **Learn from this** | A hud-btn on a failing check row beside Fix it and Explain, with a small graduation glyph in `violet`; after it: a dim note "Saved as a lesson. The next pre-flight tries it" | Build |

#### RL · Review lessons and reviewer profiles (docs/13 RL1 to RL9)

Code: `apps/desktop/src/renderer/src/lessons/review/` (`review.css`). The right dock's Lessons tab, chips in the PR panel, a card in Ship. Tokens only; every colour reads in all six themes (no glows in High contrast, signals darkened in Daylight).

| ID | Element | Anatomy | Status |
|---|---|---|---|
| RL-ui1 | **Burn-down** | The view's one focal element: caps `REPEAT ISSUES PER PR`, two weight-300 numerals (earlier `inkDim`, lately in `core`) joined by a faint →, a plain verdict line (`ok` "Fewer than before", `slow` "More than before", dim "About the same"), then 12 thin bars (one per reviewed PR, oldest left, 3px radius, `teal` at 45% with the newest bar in `cyan`; a PR with none is a 2px `hair` stub), PR numbers in faint mono under the first and last | Build |
| RL-ui2 | **Lesson card** | `card` radius hairline box on glass: the SL4 `RankBadge` (E to S, S with its gold frame), the title in 13.5px semibold `ink`, a mono count chip `4×`, then a dim line "3 PRs · @ana @bo · last in #12"; on the right a 64×18 sparkline (`teal` line at 60%, the last point a 3px dot in the trend colour: `ok` down, `slow` up, `inkFaint` flat). Marks: `slow` caps NOT WORKING YET, `violet` caps WAITING FOR A REVIEWER (a pending draft), `ok` caps MASTERED. Open: Spot it and Fix it (numbered, 12.5px) under caps labels, examples as mono `#12 file.ts:40` buttons with a dim quote | Build |
| RL-ui3 | **Reviewer card** | 28px initial avatar (`violet` for bots), login, dim "6 comments a PR" and a trend word (`ok` "trending down", `slow` "trending up"); a 4px split bar (blocking `fail` at 70%, question `blue`, nit `teal`, note `hair-strong`) with its legend in faint caps; top concerns as ranked chips (`1` in a mono count, hairline, the first chip `cyan` edged); conventions as dim lines with a faint bullet | Build |
| RL-ui4 | **Lesson chip** | In a PR comment's byline: a 18px hairline pill, `slow` 35% edge and 8% fill, mono caps `4TH TIME` then the lesson title in 11px `ink`; first time is `inkDim` "1ST TIME". **Learn from this** is a hud-btn with a graduation glyph in `violet` in the comment's action row | Build |
| RL-ui5 | **Self-check card** | In Ship above the primary button: hairline `card` box, caps `REVIEW SELF-CHECK`, a 13px line "Checked 6 repeat issues for @ana:" with the result in `ok` ("none found") or `slow` ("1 found (loading state)"), `ok` ", fixed" appended once fixed; while checking a solid `slow` dot and dim "Checking against 6 repeat issues"; found items as dim lines with a mono where; **Fix it first** as a violet ✦ hud-btn | Build |
| RL-ui6 | **[Lesson Mastered]** | Same System window as CI7 (SL frame, tag, scan line): `[ LESSON MASTERED ]`, the lesson title in 15px `ink`, "Not flagged in your last 5 reviewed PRs" in `inkDim`, then `+50 XP` in `signal` and the S rank badge. 3.2s, waits while another System window is up, click dismisses | Build |

#### V · Voice (docs/16-voice.md, docs/13 V)

V5 is the docs/13 feature id of the orb; the other elements are `V-ui` ids, so they never collide with the feature ids (V7 models, V8 plans, V9 planner).

Code: `apps/desktop/src/renderer/src/voice/` (`VoiceOrb.tsx`, `ui/`, `ui/voice.css`). Tokens only; every colour reads in all six themes (Daylight's glows are tinted shadows, High contrast drops every voice glow and keeps the edges). The orb is the one thing that glows while you talk. **Calm** (reduced motion, or Calm on): same states and words, no sweeps or word arrivals; the mic level is one still bar.

| ID | Element | Anatomy | Status |
|---|---|---|---|
| V5 | **Voice orb** | The N4 sphere at 14px in the top bar before Ask, then a lock (hands-free) and sliders (V-ui7) as 24px icon buttons. The ring is a 1.5px edge 3px out from the ball, in `cyan` unless the state says otherwise. Motion answers the key within one frame (ring 40ms linear, ball 50ms) | Build |
| V5.idle | Idle | Ball at 50% opacity, saturation 0.55, no ring | Build |
| V5.listening | Listening | Full colour; ring opacity and scale follow the mic level every 32ms frame (scale 1 to 1.9), cyan halo grows with it | Build |
| V5.hearing | Hearing | Speech detected or the first partial landed: the core goes white-hot (`core` 2px glow, stronger `cyan` halo), ring keeps following the level | Build |
| V5.thinking | Working it out | A steady `violet` ring; the strip shows WORKING IT OUT and the elapsed time | Build |
| V5.acting | Acting | The ring becomes a `cyan` progress arc filling as plan steps finish | Build |
| V5.confirm | Needs yes | Ball turns `amber` with a steady amber glow; amber ring | Build |
| V5.done | Done | A 10px `ok` tick pops over a dimmed ball for 700ms | Build |
| V5.miss | Didn't catch | Dim ball, `slow` ring for 1.4s; the strip shows V-ui4 | Build |
| V5.error | Needs attention | `fail` ball with a soft red halo while a problem line is up | Build |
| V-ui8 | **Hands-free indicator** | While the mic is open hands-free: a steady `cyan` halo 6px out from the orb, the ball fully lit even between turns, mono caps `LISTENING` after it with a 5px glowing `signal` dot, and the lock icon in `signal`. Always visible in the top bar; it goes the moment the mic closes | Build |
| V-ui1 | **Transcript strip** | Just above the caption (over the composer), left-aligned with it: a 10px-radius glass line, 15px display text. Left: a 5-bar level meter in `signal` (Calm: one still bar), mono caps state (`LISTENING`, `HEARING`, `WORKING IT OUT`, `HEARD`), the turn's language in faint caps (`HI`). Then the words: the newest 14, each arriving with a 140ms fade, 3px rise and 2px blur; older words collapse into a faint `…`. Hinglish in Roman script. Listening or hearing gives it a `cyan` 40% edge and soft glow; a miss a `slow` edge | Build |
| V-ui2 | **Intent chip** | After a faint → in the strip, as soon as the grammar matches: mono caps 10.5px in `signal`, 45% edge, 10% fill, 6px radius, popping in over 180ms ("OPEN PR 42") | Build |
| V-ui3 | **Plan card** | Glass card (`card` radius, max 500px) stacked above the strip: caps `PLAN · 3 STEPS`, a faint source word ("Understood instantly" or "Planned on your Mac"), the live headline on the right (`Step 2 of 3`, amber "Waiting for your yes", `ok` "Done"); what you said in quotes; a 3px spectrum progress bar; numbered rows (20px state mark, 13px step icon, 13.5px title, mono detail, `fail-ink` reason under a failed step). Marks: `○` number waiting, a solid `signal` dot running, `ok` ✓ done, `fail` ✕ failed, amber number with a steady glow for needs yes, struck-through faint for skipped. Tags: amber `↗ LEAVES YOUR MAC` on outward steps, `fail` `THROWS WORK AWAY` on destructive ones, hairline `ADDED` on a step a precondition rule inserted. Footer: waiting shows `Say "yes" or "haan", or click.` with No and an amber-edged **Yes, push to origin** (a destructive step asks for `"yes, force push"`, then a click); running shows `Say "stop" or "ruko"` and Stop; finished shows a plain line and Undo while its 5 seconds last. The card's edge is amber while it waits, `ok` when done, `fail` when a step failed | Build |
| V-ui4 | **Did you mean** | Under a missed strip: faint caps `DID YOU MEAN`, three 26px pill chips (label in `ink`, the words to say in faint quotes), then a hud-btn **What can I say?**. Never a dead end | Build |
| V-ui5 | **What can I say** | Glass card in the same stack: caps title with the key and languages in faint mono, `IN LOGS` (the focused panel, `signal` caps) rows first, then `ANYWHERE`. A row: the phrase in quotes in 13.5px display, its Hinglish form dim after "or", what it does right-aligned in dim; clicking runs it | Build |
| V-ui6 | **Voice download** | First press with the open model missing: glass card in the stack, caps `VOICE RUNS ON YOUR MAC`, the size in plain words, a 3px spectrum bar with mono `bytes of total` and `%` (or "Checking the files"), a `slow` line when the disk would drop under 1.5 GB free, the Apple English fallback note, Not now and a `btn go` **Download 1.9 GB**. In V-ui7 each model is a hairline row: name, mono size and license, a state word (`ok` READY, `signal` %, faint NOT DOWNLOADED, `fail` FAILED) and download, cancel or delete | Build |
| V-ui7 | **Voice settings** | Glass dialog from the orb's sliders, top right under the bar: caps sections split by hairlines. Mode and key and auto-off as segmented mono caps controls (the picked one `signal` on a 12% fill with an inset edge); languages as V-ui4-style toggle pills with Auto first; the V-ui6 model rows; **What can I say?** at the end | Build |

### In the prototype

`prototype-thread.html` has a project switcher (click the project name): **todo-app** (unchanged; looks exactly as before), **shop-app** (T15, T16, T17, T19, D10, D11, A5, A6, A7, A11, O9, and the T18/D4 job trip marked DESIGN PREVIEW) and **api-only** (T20, two caller lanes, D11). Ask runs A1 → probe → Found it (A4, A13) → Apply → O2 → re-knit with A5 and A6. Keys: X point mode, ⌘P quick open, I issue card, ⌘K or ✦ Ask then `/` for commands. "Coming next" in the top bar shows the Design items (A3, A9, A12, O3); it's off by default.

**Story mode (docs/13).** Press **L** on todo-app (or open `prototype-thread.html#sdlc`) for the welcome sheet, then **Pick up where you left off**. The worktree tabs and the SDLC rail appear and the trip walks spot → understand → fix → prove → review → ship → watch, with each hidden move offered at its moment: Plan first, Think harder and Save as command on the composer; Try both (fix race) and Review this fix on the Found it card; Save as a skill and Rewind to before this fix after Prove; the ship sheet with push approval, sync with main, the conflict view, CI dots with a failing e2e and Ask why, Merge when green; then Keep watching, Tidy up the agent's memory (amber fuel ring) and Clean up worktrees. **K** opens the skill shelf (import the Claude Code skills, run `start-todo-app` to see the live checklist and the evolving-skill proposal), **F** opens the flows shelf (Run, Record a flow). Nothing here is visible until summoned: the default todo-app view is pixel-identical to before. Pressing L again leaves the story; switching project leaves it too.

Deprecated: the free-orbit 3D scene (camera director, panes on an arc, looks bar as primary navigation). Rotation is allowed only in the moments listed in docs/06-design.md.

## Applying it

- New UI work cites component IDs ("H4 journey arc as the scrubber, L3 active path in amber").
- Colours come from `tokens.ts` only. If something needs a new colour, add a token here first.
- Every element marked **Later** is approved vocabulary: use it when the feature arrives, don't invent an alternative.
- When in doubt: fewer elements, more light on the one that matters.
