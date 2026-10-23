import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { openTrackerDb, ROOT } from './open.ts'

export { ROOT }
// Data layout: db/tracker.db, gps/ (raw GPS days), google.json (Google Drive login).
export const DATA_DIR = process.env.LOGTRACKER_DATA_DIR ? path.resolve(process.env.LOGTRACKER_DATA_DIR) : path.join(ROOT, 'data')
export const DB_DIR = path.join(DATA_DIR, 'db')

mkdirSync(DB_DIR, { recursive: true })

export const db = openTrackerDb(DB_DIR)

/** Closes the database (before quitting, or before an update replaces the app). */
export function closeDb() {
  db.$client.close()
}
