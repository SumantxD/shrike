# Changelog

Notable changes to Shrike. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/). While Shrike is 0.x, a minor version can change behaviour.

## [Unreleased]

Thanks to our outside contributors, [@AK-Lmn](https://github.com/AK-Lmn), [@ShlokGhadekar](https://github.com/ShlokGhadekar), [@tingtingtingtin](https://github.com/tingtingtingtin), [@yashexc2002](https://github.com/yashexc2002), [@AkashGowdaNC](https://github.com/AkashGowdaNC), [@iamcipherdev](https://github.com/iamcipherdev), [@Yuren0312](https://github.com/Yuren0312), [@reney-0202](https://github.com/reney-0202), [@Amandot](https://github.com/Amandot) and [@saimskywalker](https://github.com/saimskywalker).

### Added

- The browser recorder reads `Server-Timing` and `traceresponse` headers, so the grey "not visible from your browser" station on a live trip shows real server numbers (like "db 53ms") when the host sends them ([#71](https://github.com/SumantxD/shrike/pull/71), thanks [@ShlokGhadekar](https://github.com/ShlokGhadekar)).
- `navigator.sendBeacon` calls (analytics, saving on page leave) show up on the trip, and a beacon the browser refused is marked failed ([#90](https://github.com/SumantxD/shrike/pull/90), thanks [@ShlokGhadekar](https://github.com/ShlokGhadekar)).
- Each trip header shows how long ago it started ("just now", "4m ago"), with the clock time on hover ([#101](https://github.com/SumantxD/shrike/pull/101), thanks [@iamcipherdev](https://github.com/iamcipherdev)).
- The API client's History has a Clear button, which asks first and leaves saved requests alone ([#102](https://github.com/SumantxD/shrike/pull/102), thanks [@iamcipherdev](https://github.com/iamcipherdev)).
- Copy a trip as a few lines of text (verdict, steps, where it broke) to paste into a chat or your agent; a live trip is copied with its values masked ([#103](https://github.com/SumantxD/shrike/pull/103), thanks [@iamcipherdev](https://github.com/iamcipherdev)).
- Right-click a row in the inspector to copy it as JSON or as an SQL INSERT ([#104](https://github.com/SumantxD/shrike/pull/104), thanks [@iamcipherdev](https://github.com/iamcipherdev)).
- Find works in the Raw view and in non-JSON responses, with a match count and next and previous ([#105](https://github.com/SumantxD/shrike/pull/105), thanks [@Amandot](https://github.com/Amandot)).
- An "N broke" badge on the trip list shows how many trips broke and jumps to the latest failing step ([#106](https://github.com/SumantxD/shrike/pull/106), thanks [@iamcipherdev](https://github.com/iamcipherdev)).
- Save an API response body to a file, byte for byte for binary answers ([#107](https://github.com/SumantxD/shrike/pull/107), thanks [@iamcipherdev](https://github.com/iamcipherdev)).
- Press `?` to see every keyboard shortcut, built from the real key map so it can't drift ([#108](https://github.com/SumantxD/shrike/pull/108), thanks [@saimskywalker](https://github.com/saimskywalker)).
- `list_actions` shows each trip's warnings (swallowed errors, N+1 queries and the rest) and can filter by them ([#109](https://github.com/SumantxD/shrike/pull/109), thanks [@iamcipherdev](https://github.com/iamcipherdev)).
- `list_trips` takes optional `status` (broke, slow or worked) and `match` filters, so your agent can ask for only the broken trips on one route ([#92](https://github.com/SumantxD/shrike/pull/92), thanks [@iamcipherdev](https://github.com/iamcipherdev)).
- Live trips hide emails, phone numbers and IBANs as `[email#1]`, `[phone#1]` and `[iban#1]`, numbered so the same person reads the same across a trip. Local trips keep the real values. The Vercel preview bypass token is hidden everywhere ([#75](https://github.com/SumantxD/shrike/pull/75), thanks [@ShlokGhadekar](https://github.com/ShlokGhadekar)).
- The cache inspector marks keys written by RedisJSON commands like `JSON.SET` and `JSON.DEL` ([#72](https://github.com/SumantxD/shrike/pull/72), thanks [@yashexc2002](https://github.com/yashexc2002)).
- A request the browser blocked explains why in plain words: a cross-origin call with no CORS answer, or an http call from a live https page (mixed content) ([#74](https://github.com/SumantxD/shrike/pull/74), thanks [@AkashGowdaNC](https://github.com/AkashGowdaNC)).

### Fixed

- The Routes page no longer asks a spec-less app for its spec every 10 seconds for as long as it's open. It checks a few times while the app starts (2, 5, 10 and 20 seconds), then stops; a new Run, a changed address or the refresh button looks again ([#49](https://github.com/SumantxD/shrike/pull/49), thanks [@AK-Lmn](https://github.com/AK-Lmn)).
- `F` focuses the trip list, as the docs always said it would; ↑ ↓ move between trips and Esc goes back to the Thread ([#76](https://github.com/SumantxD/shrike/pull/76), thanks [@tingtingtingtin](https://github.com/tingtingtingtin)).
- Home and End jump to the first and last trip in the trip list ([#91](https://github.com/SumantxD/shrike/pull/91), thanks [@iamcipherdev](https://github.com/iamcipherdev)).
- Live trips no longer hide file names like `logo@2x.png` as emails, and emails with accented letters (`jöhn@shop.com`) are hidden fully instead of partly ([#86](https://github.com/SumantxD/shrike/pull/86), [#87](https://github.com/SumantxD/shrike/pull/87), thanks [@iamcipherdev](https://github.com/iamcipherdev)).
- Coordinates and decimals like `+37.774912` are no longer hidden as phone numbers on live trips ([#89](https://github.com/SumantxD/shrike/pull/89), thanks [@Yuren0312](https://github.com/Yuren0312)).
- Emails with non-English domains like `user@münchen.de` are hidden on live trips too ([#100](https://github.com/SumantxD/shrike/pull/100), thanks [@reney-0202](https://github.com/reney-0202)).

## [0.2.0] - 2026-10-12

Shrike now debugs Python backends and anything that speaks OpenTelemetry, works from your own Claude Code, and has Linux builds.

Thanks to the Reddit folks whose feedback shaped this release: brainDDump, DaRKoN_, streamer3222, joeyda3rd, Expensive-County4890, LatentSpaceLeaper, Hairy_Glove2064, samarijackfan, Southern_Arm_5726, samas69420 and not-a-painting.

### Added

- **Python function steps** for Python 3.12+ on FastAPI, Flask and Django: every call into your own code with argument and return values and the exact line, nested under the request, plus sqlite3 queries. No code changes needed.
- **Python database capture**: queries from psycopg, psycopg2, asyncpg, PyMySQL, mysqlclient, SQLAlchemy and the Django ORM on Postgres, MySQL and SQLite, with the rows each write changed. Outgoing HTTP calls (httpx, requests) show up as outside calls, and a React page in front of FastAPI or Django is one trip, proxied or cross-origin.
- **Any backend through OpenTelemetry**: .NET, Go, Java and others that already use an OpenTelemetry SDK show their requests, queries, outside calls and errors in the Thread (basic tracing).
- **Use Shrike from your own Claude Code**: a Tools panel section with the `claude mcp add` command, a Shrike skill and a settings snippet that keeps code changes behind your click. The connection survives restarts; approval cards say which agent is asking.
- **Claude Code plugin**: `/plugin install shrike@shrike` brings Shrike's tools and its debugging skill into Claude Code, plus a small mod that shows the latest trip above the prompt and adds `/shrike`.
- **Routes page** in the API client: lists every route, loads an OpenAPI spec on its own when the app has one, fills in example bodies from the schema and real calls, and checks a JSON body against the route's schema before sending.
- **Linux and Windows builds**: AppImage and `.deb` for Linux, an NSIS installer for Windows (not yet run on real Windows hardware). The Linux AppImage and `.deb` are attached to this release. Voice stays macOS only.
- **Checks before Run**: Shrike says in plain words when Node, a package manager, Python, Docker or git is missing or too old, how to get it, and offers Check again. It never installs anything itself.
- CI on macOS, Linux and Windows.

### Fixed

- Shrike no longer shows a crash dialog for errors in its main process; it logs them and keeps running. A crashed window reloads itself.
- Apps left running by a force-quit Shrike are stopped on the next launch, so their ports are free again.
- A damaged settings or project file is kept aside instead of being wiped, and saves are atomic.
- Clear reasons for a taken port, a dev command that asks a question, a URL on an unexpected port, expired Claude Code sign-in, rate limits, an offline network, GitHub failures and API client network errors. A failed agent run keeps its reason on screen with Try again.
- A run can no longer change files in another workspace after you switch.
- Large trips and output floods are capped, so the app stays responsive.
- Tools installed with nvm, fnm or asdf are found when Shrike is opened from Finder.
- The agent's quick send no longer follows redirects to outside servers.
- Fixes found while recording the tutorials: Found it stays up through later runs until you hide it, the agent's re-run matches a broken click recorded as a form submit, Ship uses the Commit box message, Undone shows on the History row after an undo, the next project starts clean after a switch, Show me options applies to the next ask only, the Thread camera follows every focus move, and Esc or a click elsewhere closes System windows at once.
- A React 19 click points at its JSX line, Enter in a form field counts as a submit, and a cross-origin 500 the browser couldn't read shows the server's error.

## [0.1.0] - 2026-10-11

First public release for macOS on Apple Silicon, signed and notarised.

[Unreleased]: https://github.com/SumantxD/shrike/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/SumantxD/shrike/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/SumantxD/shrike/releases/tag/v0.1.0
