# LOGTRACKER

- purpose: activity tracker, the counterpart of logcadence (the knowledge base, ../logcadence)
- split off from logcadence on 2026-10-23: maps, activity, progress, dashboard and checklists moved here
- a desktop app that normally runs in the background
  closing the window minimizes it to the tray; quit from the tray menu
  recording and imports keep going while the window is closed
- no API between logcadence and logtracker for now (maybe later, if the need arises)
  shared logic (AI chat import) is duplicated, each project has its own implementation


## UI DESCRIPTION
- one window, tab bar on the left, one tab at a time (ctrl+1 … ctrl+0)
- dashboard is the primary/default tab


## TABS

### DASHBOARD
- graphic charts only
  computer activity and travel for the last 7 days (bars)
  AI prompts, web pages, YouTube videos for up to a year (heatmaps)
  tasks done this week, upcoming events, this month's spending

### CHECKLISTS
- all the checklist logic (was the dashboard's checklists section in logcadence)
- checkboxes and counters with a target
- counters can count on their own: AI prompts, YouTube watched, web pages visited, tasks done

### TASKS
- bullet point overview of tasks, organized into projects
- progress notes per project per day

### PROGRESS
- one line per project, one circle per day with progress (tasks ticked, progress notes)
- fed by tasks (no longer by tasks:progress journal entries in logcadence)

### CALENDAR
- event scheduling: month view, agenda, repeats (daily/weekly/monthly)

### FINANCE
- expenditure tracker
- pull in bank statements (CSV), expenditure logs (by hand), scheduled payments
- to do: more statement formats (OFX/QFX), budgets per category, recurring-payment detection from statements

### COMMUNICATIONS
- email, sms, calls, whatsapp messages
- focus on 'outgoing': emails written, sms conversations, calls made
- imports: SMS Backup & Restore xml (sms + calls), WhatsApp chat export txt, mbox (Gmail Takeout)
- to do: live sources (Gmail API, phone sync) instead of exports

### DIGITAL ACTIVITY
- chrome history: timestamp, title, url (read from Chrome's History db directly)
- youtube history: timestamp, channel-title, video-title, url (Chrome visits + Takeout watch history)
- ai history: timestamp, ai/model, title, url (logcadence url: logcadence://ai/<chat id>)

### ACTIVITY
- keyboard/mouse activity in 5-minute slots, grouped into sessions (recorded by the desktop app)

### MAP
- a day of GPS (GPSLogger files, Google Drive sync) as a timetable of stays and trips
- A=homebase, B=place, A->B, B->B, B->A, A->A


## IMPLEMENTATION
- stack: typescript, react, css-modules, hono, sqlite (drizzle), electron
- one database: tracker.db
- data folder: db/, gps/, google.json, gps-drive.json
- import from logcadence: pnpm import:logcadence <library> (gps, activity, checklists)


## FOR LATER DEVELOPMENT
- logcadence:// links opening chats and days in logcadence
- an API between the apps, if the need arises
- more sources per tab (see the to-do lines above)
