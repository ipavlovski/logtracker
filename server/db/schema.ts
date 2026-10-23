import { index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

// tracker.db: everything logtracker records. The GPS, activity and checklist tables have the same shape as they had in
// logcadence's content.db, so scripts/import-logcadence.ts copies their rows as they are.

// ── Map (GPS days, classified into stays and movements: server/lib/gps/classify.ts) ─────────────────────────

// Places stayed at (≥ 5 min within 120 m), shared across days so they can be named once.
export const gpsPlaces = sqliteTable('gps_places', {
  id: text('id').primaryKey(),
  lat: real('lat').notNull(),
  lon: real('lon').notNull(),
  name: text('name'),
  createdAt: integer('created_at').notNull(),
})

export const gpsDays = sqliteTable('gps_days', {
  date: text('date').primaryKey(), // YYYY-MM-DD
  // Source file fingerprint (mtime:size); an unchanged file is not processed again.
  sourceStamp: text('source_stamp').notNull(),
  dayStart: integer('day_start').notNull(), // local midnight, epoch ms
  homebaseId: text('homebase_id'),
  // Set when the homebase was picked by hand (e.g. a hotel while travelling).
  homebaseOverride: integer('homebase_override', { mode: 'boolean' }).notNull().default(false),
  pointCount: integer('point_count').notNull(),
  processedAt: integer('processed_at').notNull(),
})

// The day's timeline: rows tile the day (A, B, A->B, B->B, B->A, A->A, gap).
export const gpsSegments = sqliteTable(
  'gps_segments',
  {
    date: text('date')
      .notNull()
      .references(() => gpsDays.date, { onDelete: 'cascade' }),
    idx: integer('idx').notNull(),
    kind: text('kind').notNull(),
    startAt: integer('start_at').notNull(),
    endAt: integer('end_at').notNull(),
    placeId: text('place_id'),
    fromPlaceId: text('from_place_id'),
    toPlaceId: text('to_place_id'),
    distanceM: integer('distance_m').notNull(),
    // Movements: simplified [lon, lat, seconds since day start].
    path: text('path', { mode: 'json' }).$type<[number, number, number][]>().notNull(),
  },
  (t) => [primaryKey({ columns: [t.date, t.idx] })],
)

// Trips: stretches of a day's timeline grouped by hand. Kept as times, not segment indexes, so they
// survive the day being classified again (a changed file or homebase).
export const gpsTrips = sqliteTable(
  'gps_trips',
  {
    id: text('id').primaryKey(),
    date: text('date')
      .notNull()
      .references(() => gpsDays.date, { onDelete: 'cascade' }),
    startAt: integer('start_at').notNull(),
    endAt: integer('end_at').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [index('gps_trips_date_idx').on(t.date)],
)

// ── Activity (server/lib/activity.ts) ───────────────────────────────────────────────────────────────────────

// `input` spans are stretches of keyboard/mouse input (pauses under a minute included); `tracked` spans are when the
// recorder was running with the machine awake, so idle time can be told apart from time that was not recorded.
export const activitySpans = sqliteTable(
  'activity_spans',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    device: text('device').notNull(), // host name
    kind: text('kind', { enum: ['input', 'tracked'] }).notNull(),
    startAt: integer('start_at').notNull(), // epoch ms
    endAt: integer('end_at').notNull(),
  },
  (t) => [index('activity_spans_end_idx').on(t.endAt)],
)

// ── Checklists (shared/checklists.ts, server/lib/checklists.ts) ─────────────────────────────────────────────

export const checklists = sqliteTable('checklists', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  position: real('position').notNull(),
  startDate: text('start_date').notNull(), // YYYY-MM-DD, first day it is due
  endDate: text('end_date'), // last day it is due; null runs on
  weekdays: integer('weekdays').notNull().default(127), // bit i = weekday i, Sunday first
  archived: integer('archived', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
})

// An item is part of its checklist on the days from addedDate up to (not including) removedDate, and on any earlier
// day it was ticked. Items with ticks are kept when removed, so past days still show what they had.
export const checklistItems = sqliteTable(
  'checklist_items',
  {
    id: text('id').primaryKey(),
    checklistId: text('checklist_id')
      .notNull()
      .references(() => checklists.id, { onDelete: 'cascade' }),
    label: text('label').notNull(),
    target: integer('target').notNull().default(1), // 1 = a checkbox, more = a counter
    source: text('source'), // ChecklistSource: counts on its own from the app's data
    position: real('position').notNull(),
    addedDate: text('added_date').notNull(),
    removedDate: text('removed_date'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [index('checklist_items_list_idx').on(t.checklistId, t.position)],
)

// What was done of an item on a day (by hand; a sourced item's automatic count is added when read).
export const checklistMarks = sqliteTable(
  'checklist_marks',
  {
    itemId: text('item_id')
      .notNull()
      .references(() => checklistItems.id, { onDelete: 'cascade' }),
    date: text('date').notNull(),
    count: integer('count').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.itemId, t.date] }), index('checklist_marks_date_idx').on(t.date)],
)

// ── Tasks and Progress ──────────────────────────────────────────────────────────────────────────────────────

export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  color: text('color'),
  archived: integer('archived', { mode: 'boolean' }).notNull().default(false),
  position: real('position').notNull(),
  createdAt: integer('created_at').notNull(),
})

export const tasks = sqliteTable(
  'tasks',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    text: text('text').notNull().default(''),
    doneAt: integer('done_at'), // epoch ms; null while open
    indent: integer('indent').notNull().default(0),
    position: real('position').notNull(), // fractional order within the project
    due: text('due'), // YYYY-MM-DD
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [index('tasks_project_idx').on(t.projectId, t.position), index('tasks_done_idx').on(t.doneAt)],
)

// A line of progress written for a project on a day; the Progress tab shows them with the tasks done that day.
export const progressNotes = sqliteTable(
  'progress_notes',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    date: text('date').notNull(),
    text: text('text').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [index('progress_notes_date_idx').on(t.date)],
)

// ── Calendar ────────────────────────────────────────────────────────────────────────────────────────────────

export const events = sqliteTable(
  'events',
  {
    id: text('id').primaryKey(),
    title: text('title').notNull(),
    startAt: integer('start_at').notNull(), // epoch ms
    endAt: integer('end_at').notNull(),
    allDay: integer('all_day', { mode: 'boolean' }).notNull().default(false),
    location: text('location').notNull().default(''),
    notes: text('notes').notNull().default(''),
    recurrence: text('recurrence', { enum: ['none', 'daily', 'weekly', 'monthly'] }).notNull().default('none'),
    until: text('until'), // last day a recurring event repeats
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [index('events_start_idx').on(t.startAt)],
)

// ── Finance ─────────────────────────────────────────────────────────────────────────────────────────────────

export const accounts = sqliteTable('accounts', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  currency: text('currency').notNull().default('CAD'),
  createdAt: integer('created_at').notNull(),
})

export const transactions = sqliteTable(
  'transactions',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id').references(() => accounts.id, { onDelete: 'set null' }),
    date: text('date').notNull(), // YYYY-MM-DD
    amount: integer('amount').notNull(), // cents; negative is money out
    payee: text('payee').notNull().default(''),
    category: text('category').notNull().default(''),
    notes: text('notes').notNull().default(''),
    source: text('source', { enum: ['manual', 'csv', 'scheduled'] }).notNull(),
    // Statement lines: account + date + amount + description, so importing an overlapping statement adds nothing twice.
    importHash: text('import_hash'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [index('transactions_date_idx').on(t.date), uniqueIndex('transactions_import_idx').on(t.importHash)],
)

export const scheduledPayments = sqliteTable('scheduled_payments', {
  id: text('id').primaryKey(),
  payee: text('payee').notNull(),
  amount: integer('amount').notNull(), // cents; negative is money out
  category: text('category').notNull().default(''),
  accountId: text('account_id').references(() => accounts.id, { onDelete: 'set null' }),
  cadence: text('cadence', { enum: ['weekly', 'monthly', 'quarterly', 'yearly'] }).notNull(),
  nextDue: text('next_due').notNull(), // YYYY-MM-DD
  archived: integer('archived', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at').notNull(),
})

// ── Communications ──────────────────────────────────────────────────────────────────────────────────────────

export const messages = sqliteTable(
  'messages',
  {
    id: text('id').primaryKey(),
    channel: text('channel', { enum: ['email', 'sms', 'call', 'whatsapp'] }).notNull(),
    direction: text('direction', { enum: ['out', 'in'] }).notNull(),
    counterpart: text('counterpart').notNull(),
    subject: text('subject').notNull().default(''),
    snippet: text('snippet').notNull().default(''),
    at: integer('at').notNull(), // epoch ms
    durationS: integer('duration_s'),
    // channel + time + counterpart + text, so importing the same backup again adds nothing twice.
    importHash: text('import_hash').notNull(),
  },
  (t) => [index('messages_at_idx').on(t.at), uniqueIndex('messages_import_idx').on(t.importHash)],
)

// ── Digital activity ────────────────────────────────────────────────────────────────────────────────────────

// Chrome history visits (server/lib/digital/chrome.ts).
export const webVisits = sqliteTable(
  'web_visits',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    profile: text('profile').notNull(), // which History file: "<windows user>/<chrome profile>"
    chromeVisitId: integer('chrome_visit_id').notNull(),
    at: integer('at').notNull(), // epoch ms
    title: text('title').notNull(),
    url: text('url').notNull(),
  },
  (t) => [uniqueIndex('web_visits_source_idx').on(t.profile, t.chromeVisitId), index('web_visits_at_idx').on(t.at)],
)

// YouTube videos watched: from Chrome visits to youtube.com/watch and from Takeout's watch history.
export const ytWatches = sqliteTable(
  'yt_watches',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    at: integer('at').notNull(), // epoch ms
    videoId: text('video_id').notNull(),
    title: text('title').notNull(),
    channel: text('channel'), // null until known (oEmbed fills it in for Chrome visits)
    source: text('source', { enum: ['chrome', 'takeout'] }).notNull(),
  },
  (t) => [uniqueIndex('yt_watches_video_at_idx').on(t.videoId, t.at), index('yt_watches_at_idx').on(t.at)],
)

// AI chats (server/lib/ai/): what each chat was and when its prompts were sent; the transcripts stay in logcadence.
export const aiChats = sqliteTable(
  'ai_chats',
  {
    id: text('id').primaryKey(), // `${source}:${externalId}`, as logcadence keys them
    source: text('source').notNull(),
    externalId: text('external_id').notNull(),
    model: text('model'),
    title: text('title').notNull(),
    startedAt: integer('started_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    turns: integer('turns').notNull(),
    // When each prompt was sent (epoch ms; a prompt without a time counts on the chat's start).
    promptTimes: text('prompt_times', { mode: 'json' }).$type<number[]>().notNull(),
    // Source file fingerprint (mtime:size), or the claude.ai sync stamp; an unchanged source is not parsed again.
    sourceStamp: text('source_stamp'),
    importedAt: integer('imported_at').notNull(),
  },
  (t) => [index('ai_chats_started_idx').on(t.startedAt)],
)

// ── Settings ────────────────────────────────────────────────────────────────────────────────────────────────

// Small values: where each Chrome profile's import got to, the user's own names and addresses for Communications…
export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value', { mode: 'json' }).$type<unknown>().notNull(),
})
