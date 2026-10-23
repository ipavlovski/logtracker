// Copies what moved from logcadence to logtracker out of a logcadence library: GPS days, places, segments and trips;
// activity spans; checklists with their items and marks. Also the raw GPS files (gps/), the Google Drive login
// (google.json) and the GPS Drive folder settings (gps-drive.json). Run it once, before a logcadence build that drops those tables opens the library.
// Usage: pnpm import:logcadence <logcadence library dir> [--data-dir <logtracker data dir>]
//
// The library's content.db is opened read-only, so this is safe while logcadence runs (an older build of it keeps
// writing activity until it's updated). It refuses to import into a logtracker database that already has any of
// these rows. Checklist items counted from logcadence's data (Reddit posts, bookmarks, YouTube annotations) become
// items ticked by hand; what was ticked is kept.

import Database from 'better-sqlite3'
import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs'
import path from 'node:path'
import type { SQLiteTable } from 'drizzle-orm/sqlite-core'
import { CHECKLIST_SOURCES } from '../shared/checklists.ts'
import { openTrackerDb, ROOT } from '../server/db/open.ts'
import * as schema from '../server/db/schema.ts'

const args = process.argv.slice(2)
const flag = args.indexOf('--data-dir')
const dataDir = path.resolve(flag >= 0 ? args[flag + 1]! : (process.env.LOGTRACKER_DATA_DIR ?? path.join(ROOT, 'data')))
const library = args.find((a, i) => !a.startsWith('--') && i !== flag + 1)
if (!library) {
  console.error('Usage: pnpm import:logcadence <logcadence library dir> [--data-dir <logtracker data dir>]')
  process.exit(1)
}

const contentDb = path.join(library, 'db', 'content.db')
if (!existsSync(contentDb)) {
  console.error(`${library} is not a logcadence library (no db/content.db)`)
  process.exit(1)
}

// Insert order: parents before the rows that reference them. Column names are the same in both databases.
const TABLES: [string, SQLiteTable][] = [
  ['gps_places', schema.gpsPlaces],
  ['gps_days', schema.gpsDays],
  ['gps_segments', schema.gpsSegments],
  ['gps_trips', schema.gpsTrips],
  ['activity_spans', schema.activitySpans],
  ['checklists', schema.checklists],
  ['checklist_items', schema.checklistItems],
  ['checklist_marks', schema.checklistMarks],
]

const source = new Database(contentDb, { readonly: true, fileMustExist: true })
const present = new Set((source.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all() as { name: string }[]).map((r) => r.name))
const missing = TABLES.map(([name]) => name).filter((n) => !present.has(n))
if (missing.length === TABLES.length) {
  console.error(`${library} has none of the tables to copy: it was already updated past the logtracker split (or never had them).`)
  process.exit(1)
}

mkdirSync(path.join(dataDir, 'db'), { recursive: true })
const db = openTrackerDb(path.join(dataDir, 'db'))
const target = db.$client

for (const [name] of TABLES) {
  const n = (target.prepare(`SELECT count(*) AS n FROM ${name}`).get() as { n: number }).n
  if (n) {
    console.error(`${dataDir} already has ${name} rows: import into an empty logtracker database.`)
    process.exit(1)
  }
}

const known = new Set<string>(CHECKLIST_SOURCES)
const counts: Record<string, number> = {}
let manual = 0

// Raw rows, copied with SQL: the columns are the same, and drizzle's mapping would only round-trip them.
target.transaction(() => {
  for (const [name] of TABLES) {
    if (!present.has(name)) continue
    const rows = source.prepare(`SELECT * FROM ${name}`).all() as Record<string, unknown>[]
    counts[name] = rows.length
    if (!rows.length) continue
    const cols = Object.keys(rows[0]!)
    const insert = target.prepare(`INSERT INTO ${name} (${cols.map((c) => `"${c}"`).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`)
    for (const r of rows) {
      if (name === 'checklist_items' && r.source != null && !known.has(r.source as string)) {
        r.source = null
        manual++
      }
      insert.run(...cols.map((c) => r[c]))
    }
  }
})()
source.close()

// GPS files: source data, re-read by the scan. Existing ones are left alone.
let gpsFiles = 0
const gpsFrom = path.join(library, 'gps')
const gpsTo = path.join(dataDir, 'gps')
if (existsSync(gpsFrom)) {
  mkdirSync(gpsTo, { recursive: true })
  for (const f of readdirSync(gpsFrom, { withFileTypes: true })) {
    if (!f.isFile() || existsSync(path.join(gpsTo, f.name))) continue
    copyFileSync(path.join(gpsFrom, f.name), path.join(gpsTo, f.name))
    gpsFiles++
  }
}

// Settings files, unless logtracker has its own already.
const copied = (name: string) => {
  const from = path.join(library, name)
  const ok = existsSync(from) && !existsSync(path.join(dataDir, name))
  if (ok) copyFileSync(from, path.join(dataDir, name))
  return ok
}
const settingsCopied = ['google.json', 'gps-drive.json'].map((name) => [name, copied(name)] as const)

db.$client.close()

console.log(`Imported into ${dataDir}:`)
for (const [name] of TABLES) console.log(`  ${name.padEnd(16)} ${present.has(name) ? String(counts[name] ?? 0).padStart(8) : '   (none in the library)'}`)
console.log(`  gps files        ${String(gpsFiles).padStart(8)}`)
for (const [name, ok] of settingsCopied) console.log(`  ${name.padEnd(16)} ${ok ? '  copied' : '    kept'}`)
if (manual) console.log(`\n${manual} checklist item(s) counted from logcadence's data now count by hand.`)
console.log('\nCompare these with the library before running a logcadence build that drops the tables (migration 0013).')
