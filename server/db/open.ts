import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as schema from './schema.ts'

// Opening (and migrating) tracker.db, without side effects on import, so the logcadence import can build one in a
// folder other than the running app's.

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
// The desktop build ships the migrations as resources, outside the source tree. Read when used, so the desktop app
// can set it after this module has loaded.
const migrationsDir = () => (process.env.LOGTRACKER_MIGRATIONS_DIR ? path.resolve(process.env.LOGTRACKER_MIGRATIONS_DIR) : path.join(ROOT, 'server/db/migrations'))

export function openTrackerDb(dbDir: string) {
  const sqlite = new Database(path.join(dbDir, 'tracker.db'))
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')
  sqlite.pragma('busy_timeout = 5000')
  const db = drizzle(sqlite, { schema })
  migrate(db, { migrationsFolder: migrationsDir() })
  return db
}

export type TrackerDb = ReturnType<typeof openTrackerDb>
