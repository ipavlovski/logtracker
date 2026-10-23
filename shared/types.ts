// Domain types shared by the server and the renderer.

/** A count for one day (heatmaps). */
export interface DayCount {
  date: string
  count: number
}

// ── Map tab (GPS) ───────────────────────────────────────────────────────────

/** GPS movement on one day: the A->B, B->B, B->A and A->A rows. */
export interface TravelDay {
  date: string
  distanceM: number
  movingMs: number
}

// ── Map canvas tab (GPS) ────────────────────────────────────────────────────

/** A = homebase, B = a place, X->Y = moving between them, A->A = a round trip from home, gap = no data. */
export type GpsKind = 'A' | 'B' | 'A->B' | 'B->B' | 'B->A' | 'A->A' | 'gap'
export const GPS_KINDS: GpsKind[] = ['A', 'B', 'A->B', 'B->B', 'B->A', 'A->A', 'gap']

export interface GpsPlaceDTO {
  id: string
  lat: number
  lon: number
  name: string | null
}

export interface GpsSegmentDTO {
  kind: GpsKind
  start: number
  end: number
  placeId: string | null
  fromPlaceId: string | null
  toPlaceId: string | null
  distanceM: number
  /** Movements: simplified [lon, lat, seconds since day start]. */
  path: [number, number, number][]
}

/** Rows of the timetable grouped by hand; a segment belongs to the trip its midpoint falls in. */
export interface GpsTripDTO {
  id: string
  start: number
  end: number
}

export interface GpsDayDTO {
  date: string
  dayStart: number
  homebaseId: string | null
  homebaseOverride: boolean
  pointCount: number
  segments: GpsSegmentDTO[]
  /** Places referenced by the day's segments. */
  places: GpsPlaceDTO[]
  trips: GpsTripDTO[]
  /** ms per kind; sums to the day's length. */
  totals: Record<GpsKind, number>
}

/** GPS files imported from a Google Drive folder (server/lib/gps/drive.ts). */
export interface GpsDriveStatus {
  /** A Google OAuth client is set (GOOGLE_CLIENT_ID/SECRET or saved from the settings window). */
  configured: boolean
  connected: boolean
  /** Must be an authorized redirect URI when the OAuth client is a "Web application" (Desktop clients take any). */
  redirectUri: string
  folder: { id: string; name: string } | null
  /** New files are imported in the background. */
  auto: boolean
  /** Newest day imported; automatic imports take files from this day on (it may still have grown). */
  lastDate: string | null
  running: 'new' | 'range' | null
  progress: { done: number; total: number } | null
  lastSync: number | null
  error: string | null
  result: GpsDriveResult | null
}

export interface GpsDriveResult {
  downloaded: number
  unchanged: number
  /** Days classified by the scan after the download. */
  processed: number
  errors: string[]
  /** Files in the folder dated before lastDate that aren't here: import them with a date range. */
  older: { count: number; from: string; to: string } | null
}

// ── YouTube canvas tab ──────────────────────────────────────────────────────

// ── AI chats (Digital tab) ──────────────────────────────────────────────────

export const CHAT_SOURCES = ['claude', 'claude-code', 'gemini', 'antigravity'] as const
export type ChatSource = (typeof CHAT_SOURCES)[number]

export interface ChatTool {
  name: string
  /** Short description of the call (command, file, query…). */
  summary: string
}

export interface ChatMessage {
  role: 'user' | 'assistant'
  /** Markdown. */
  text: string
  /** Epoch ms, when the source records it. */
  ts: number | null
  tools?: ChatTool[]
  /** Files sent with a prompt. */
  attachments?: ChatAttachment[]
}

export interface ChatAttachment {
  name: string
  /** Kind, type, size or pages, e.g. "document · 3 pages". */
  meta?: string
  /** Text the AI app extracted from the file (.md, .docx, .txt…). */
  text?: string
}

export interface ImportCounts {
  found: number
  created: number
  updated: number
  unchanged: number
  errors: string[]
}

export type ImportReport = Partial<Record<ChatSource, ImportCounts>>

export interface ChatSourceInfo {
  source: ChatSource
  /** Locations scanned automatically (existing ones only). */
  paths: string[]
  /** How to get chats from this source into the app. */
  hint: string
  /** Signed in for live sync (claude.ai, desktop app only); absent when the source has no live sync. */
  connected?: boolean
}

/** One chat in the AI history: what it was, not its transcript (that stays in logcadence). */
export interface AiChatDTO {
  id: string
  source: ChatSource
  model: string | null
  title: string
  startedAt: number
  updatedAt: number
  /** Number of prompts. */
  turns: number
  /** Where the chat lives at its source (claude.ai), when it has a web address. */
  url: string | null
  /** The same chat in logcadence's AI tab (both apps key chats as `source:externalId`). */
  logcadenceUrl: string
}

// ── Digital tab: browsing and YouTube ───────────────────────────────────────

export interface WebVisitDTO {
  id: number
  at: number
  title: string
  url: string
  /** Chrome profile the visit came from ("Default", "Profile 1"…). */
  profile: string
}

export interface YtWatchDTO {
  id: number
  at: number
  videoId: string
  title: string
  /** Null until known: Takeout has it, a Chrome visit is filled in from YouTube's oEmbed. */
  channel: string | null
  url: string
  source: 'chrome' | 'takeout'
}

export interface ScanReport {
  added: number
  errors: string[]
}

// ── Tasks and Progress ──────────────────────────────────────────────────────

export interface ProjectDTO {
  id: string
  title: string
  color: string | null
  archived: boolean
  position: number
}

export interface TaskDTO {
  id: string
  projectId: string
  text: string
  done: boolean
  /** Epoch ms it was ticked; null while open. */
  doneAt: number | null
  /** Bullet depth, 0 = top level. */
  indent: number
  position: number
  /** YYYY-MM-DD, optional. */
  due: string | null
}

/** A line of progress on a project, written for a day (Progress tab). */
export interface ProgressNoteDTO {
  id: string
  projectId: string
  date: string
  text: string
}

/** A day's progress on a project: the tasks done that day and the notes written for it. */
export interface ProgressItem {
  projectId: string
  date: string
  kind: 'task' | 'note'
  id: string
  text: string
}

// ── Calendar ────────────────────────────────────────────────────────────────

export type Recurrence = 'none' | 'daily' | 'weekly' | 'monthly'

export interface EventDTO {
  id: string
  title: string
  /** Epoch ms; an all-day event spans local midnights. */
  startAt: number
  endAt: number
  allDay: boolean
  location: string
  notes: string
  recurrence: Recurrence
  /** Last day a recurring event repeats (YYYY-MM-DD); null runs on. */
  until: string | null
}

/** One showing of an event in a range: recurring events have one per repeat. */
export interface OccurrenceDTO {
  eventId: string
  title: string
  startAt: number
  endAt: number
  allDay: boolean
  location: string
  recurring: boolean
}

export type EventBody = Omit<EventDTO, 'id'>

// ── Finance ─────────────────────────────────────────────────────────────────

export interface AccountDTO {
  id: string
  name: string
  currency: string
}

export interface TransactionDTO {
  id: string
  accountId: string | null
  date: string
  /** Cents; negative is money out. */
  amount: number
  payee: string
  category: string
  notes: string
  source: 'manual' | 'csv' | 'scheduled'
}

export type Cadence = 'weekly' | 'monthly' | 'quarterly' | 'yearly'

export interface ScheduledPaymentDTO {
  id: string
  payee: string
  /** Cents; negative is money out. */
  amount: number
  category: string
  accountId: string | null
  cadence: Cadence
  /** YYYY-MM-DD of the next payment. */
  nextDue: string
  archived: boolean
}

/** How a bank statement's columns were read (Finance → Import). */
export interface CsvMapping {
  date: number
  description: number
  /** One signed amount column, or separate debit/credit columns. */
  amount: number | null
  debit: number | null
  credit: number | null
}

export interface CsvPreview {
  headers: string[]
  mapping: CsvMapping
  rows: { date: string; payee: string; amount: number; duplicate: boolean }[]
  /** Lines that could not be read (no date or amount). */
  skipped: number
}

export interface MonthSummary {
  month: string // YYYY-MM
  income: number
  spent: number
  byCategory: { category: string; amount: number }[]
}

// ── Communications ──────────────────────────────────────────────────────────

export type Channel = 'email' | 'sms' | 'call' | 'whatsapp'
export const CHANNELS: Channel[] = ['email', 'sms', 'call', 'whatsapp']

export interface MessageDTO {
  id: string
  channel: Channel
  direction: 'out' | 'in'
  /** Who it was to (or from): a name, number or address. */
  counterpart: string
  subject: string
  /** The text, or the start of it. */
  snippet: string
  at: number
  /** Calls only. */
  durationS: number | null
}

export interface CommsImportResult {
  added: number
  duplicates: number
  errors: string[]
}
