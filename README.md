# logtracker

Logtracker is an activity tracker that runs in the background: computer activity, travel, daily checklists, tasks and
their progress, a calendar, finances, communications and digital activity (Chrome, YouTube, AI chats). It split off from
[logcadence](../logcadence), which stays the knowledge base; the two are separate projects with no API between them.

Stack: TypeScript, React + CSS modules (Vite), Hono, SQLite via drizzle (better-sqlite3), Electron.

See [PROJECT.md](PROJECT.md) for the product spec.

## Status

First pass (0.1.0 dev builds). Activity, Map, Progress, the dashboard and checklists came over from logcadence working.
Finance, Tasks, Communications, Calendar and Digital activity are rough but working end to end: each has its storage,
routes, importers with tests, and a plain UI. Next steps are listed per tab in PROJECT.md. The GitHub repository
(`ipavlovski/logtracker`) that releases publish to doesn't exist yet.

## Run

```sh
pnpm install
pnpm dev            # API on :3012, web on http://localhost:5175
pnpm test
pnpm dev:electron   # desktop app with the renderer from Vite (restart it after electron/ or server changes)
pnpm preview        # builds LogtrackerDev and (re)starts it on Windows (see Desktop app)
pnpm import:logcadence <logcadence library>   # once: GPS, activity and checklists from logcadence (see below)
```

Data lives in one folder (`data/` under `pnpm dev`; `%APPDATA%/Logtracker/data` in the desktop app; `LOGTRACKER_DATA_DIR`
overrides both): `db/tracker.db`, `gps/` (raw GPS days) and `google.json` (the Google Drive login). After changing the
schema (`server/db/schema.ts`): `pnpm db:generate`; migrations run on start.

## Tabs

`Ctrl+1` … `Ctrl+0` switch between them.

- **Dashboard**: charts. Computer activity and travel for the last 7 days; a year of AI prompts, web pages and YouTube
  videos as heatmaps; tasks done this week, what's coming up in the calendar and this month's spending.
- **Checklists**: the daily checklists (from logcadence's dashboard), with counters that can count on their own:
  AI prompts sent, YouTube videos watched, web pages visited, tasks done.
- **Tasks**: one bullet list per project. Enter adds a task below, Tab / Shift+Tab indent, Backspace on an empty task
  deletes it, a click on the bullet ticks it. A project's "progress today" line logs a progress note.
- **Progress**: one line per project, one circle per day with tasks ticked or progress notes written.
- **Calendar**: a month of events (daily, weekly or monthly repeats; a monthly one on the 31st skips shorter months) and
  the picked day's agenda. Double-click a day to add an event.
- **Finance**: transactions by month with totals by category; expenses logged by hand; bank statements imported from CSV
  (date, description and amount, or debit + credit columns, are detected; a preview shows what's new, and lines imported
  before are left out); scheduled payments, which log a transaction and move to their next due date when marked paid.
  Imported lines take the category their payee last had when categorized by hand.
- **Communications**: what was sent (and, toggled, received), by day: SMS Backup & Restore XML (texts and calls),
  WhatsApp "Export chat" `.txt` files and `.mbox` mail (Gmail Takeout; headers and the start of plain-text bodies), plus
  calls and messages logged by hand. Set your WhatsApp name and email addresses under **me** first, so outgoing can be
  told from incoming.
- **Digital activity**:
  - **Chrome**: timestamp, title, url, read from each Chrome profile's `History` file (on a copy, as Chrome keeps it
    locked) under every Windows profile and the WSL home, incrementally from the last visit seen. Chrome keeps about 90
    days, so regular scans keep the whole history.
  - **YouTube**: timestamp, channel, title, url: watch pages from the Chrome history (channels looked up through
    YouTube's oEmbed, no API key) and Google Takeout's watch history (drop it on the tab), which has channels and other
    devices. Visits to one video within 30 minutes are one watch.
  - **AI**: timestamp, AI/model, title, url: the same sources as logcadence's AI tab (Claude Code, Antigravity, claude.ai
    exports or live sync in the desktop app, Gemini Takeout), with the import logic copied rather than shared. Only what
    each chat was is kept, not its transcript. The url is a `logcadence://ai/<chat id>` link (both apps key chats as
    `source:externalId`) and, for claude.ai, the chat's address. Logcadence doesn't register that link yet.
  Chrome and AI are scanned 10 s after start and every 15 minutes; **Scan** does it now.
- **Activity**, **Map**: as they were in logcadence, below.

The **Activity** tab shows computer use for a day. While the desktop app runs it polls the OS's time since the last keyboard/mouse input every 5 s (Electron's `powerMonitor.getSystemIdleTime`, so no native hooks; it can't tell the mouse from the keyboard) and stores spans of input in `activity_spans`: input less than a minute apart is one span, a locked screen doesn't count, and sleep ends the spans. It also stores when it was recording, so idle time reads differently from time the app was closed. The tab bins the day into 5-minute slots (input minutes per slot), groups input into sessions (pauses under 20 min stay inside a session, sessions with under 10 min of input are dropped; named morning/afternoon/evening/night by their midpoint; click a session's band or table row to zoom the chart into it at 48 slots, or 4 hours, across, scrolling sideways when it's longer), and shows the last 14 days as strips. `pnpm dev` doesn't record; the tray menu can pause recording.

The **Map** tab turns a day of GPS into a timetable of stays and trips (the day is shared with Activity). Drop GPSLogger files (`YYYYMMDD.zip` or `.gpx`) into the data folder's `gps/` (`LOGTRACKER_GPS_DIR` overrides), or connect a Google Drive folder with the ⚙ button: the server classifies new and changed files at startup and on **Scan**. Staying within 120 m for 5+ minutes is a place; the place slept at (around 03:00) is the homebase **A**, others are **B**; trips between them are **A→B**, **B→B**, **B→A**, or **A→A** for a round trip without a stop, and missing data shows as gaps. Rows tile the day, so the durations sum to 24 h. Places are shared across days and can be named by clicking them; a place can be made the day's homebase (a hotel while travelling). Rows can be grouped into trips: click a row, Shift+click another to select the rows between, and press the **+** that appears in the unlabelled first column; the trip shows as a bracket there (overlapping trips merge). Click a bracket to select its trip and **×** to remove it. Trips are stored as time ranges, so they survive the day being classified again. The map uses free OpenFreeMap tiles with deck.gl layers on MapLibre (kept on 5.x until deck.gl supports MapLibre 6).

## Desktop app

The desktop app (Windows) is Electron around the same code: the main process runs the API server in-process on
`127.0.0.1:3012` (LogtrackerDev: 3013) and the window shows the web app from it.

- **Tray**: closing the window hides it; the app keeps running in the tray, recording and importing. The tray menu opens
  the window, pauses activity recording, turns **Start with Windows** on or off (it then starts hidden) and quits. A
  second launch brings the window back.
- **Dev previews**: `pnpm preview` (from WSL or Windows) builds the working tree as **LogtrackerDev** into
  `%LOCALAPPDATA%\Programs\LogtrackerDev`, closing a running one first (gracefully, so the database is closed), and
  starts it. It has its own settings and data folder (`%APPDATA%\LogtrackerDev`), port 3013 and no auto-update.
- **Releases**: the same pipeline as logcadence (`shared/versions.ts`, `scripts/release.ts`, `.github/workflows/release.yml`):
  `pnpm release:dev` tags dev builds, `pnpm release` tags releases, and a pushed tag builds the installer and publishes
  it to the GitHub Releases of `ipavlovski/logtracker`, which installed apps update from. That repository has to exist
  first.

## Moving data from logcadence

Logcadence's GPS days, places and trips, activity spans and checklists (with their items and ticks) move here, with the
raw GPS files, the Google Drive login and the GPS Drive folder settings:

```sh
# for example
pnpm import:logcadence "/mnt/c/Users/IP/Documents/Logcadence" --data-dir "/mnt/c/Users/IP/AppData/Roaming/Logtracker/data"
```

It opens the library's `content.db` read-only and refuses to import into a database that already has those rows. Checklist
items that counted Reddit posts, bookmarks or YouTube annotations become items ticked by hand (their ticks are kept). Run
it **before** a logcadence build with migration `0013_drop_tracker_tables` opens the library: that migration drops the
tables. Compare the row counts it prints with the library first.

## Layout

```
electron/        desktop app: main process (runs the server, records activity), tray, preload bridge, updater, claude.ai sign-in
shared/          domain types, dates, ids, activity binning, checklists, desktop bridge types, versions
server/
  db/            schema + migrations for tracker.db
  lib/           activity recorder, checklists, tasks, calendar, settings
  lib/gps/       GPS classification and Google Drive import (lib/gdrive/)
  lib/finance/   statements (csv.ts) and the ledger
  lib/comms/     message importers (parsers.ts) and storage
  lib/digital/   Chrome history and YouTube watches
  lib/ai/        AI chat sources and parsers (copied from logcadence), importer
  routes/        Hono routes; `AppType` feeds the typed `hc` client
src/
  components/    one folder per tab; Tab/ holds the shared tab layout
  state/         small stores: open tab and prefs, the day shared by Activity and Map, progress, updates
scripts/         build, dev, preview, release, import-logcadence
```
