import Database from 'better-sqlite3'
import { copyFileSync, existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { and, desc, gte, like, lt, or } from 'drizzle-orm'
import type { ScanReport, WebVisitDTO } from '../../../shared/types.ts'
import { db } from '../../db/client.ts'
import { webVisits } from '../../db/schema.ts'
import { homes } from '../ai/sources.ts'
import { getSetting, setSetting } from '../settings.ts'
import { addChromeWatches } from './youtube.ts'

// Chrome history, read straight from each profile's `History` sqlite file (on a copy: Chrome keeps it locked while
// it runs). Visits are imported incrementally from the last visit id seen per profile; Chrome itself keeps about
// 90 days, so a scan every so often keeps the whole history. YouTube watch pages also go to the YouTube history.

/** Chrome's visit_time: microseconds since 1601-01-01 UTC. */
export const chromeTimeToMs = (t: number) => Math.round(t / 1000 - 11_644_473_600_000)

// Core transition types that aren't the user going to a page: frames loaded inside a page.
const SUBFRAME = new Set([3, 4])
const SKIP_URL = /^(chrome|chrome-extension|devtools|about|edge|data|blob|file):/i

export interface HistoryFile {
  /** "<user>/<profile directory>", e.g. "ip/Default". */
  profile: string
  file: string
}

/** The History file of every Chrome profile in the homes the AI scan uses (Windows profiles included under WSL). */
export function historyFiles(): HistoryFile[] {
  const out: HistoryFile[] = []
  for (const home of homes()) {
    for (const root of [path.join(home, 'AppData', 'Local', 'Google', 'Chrome', 'User Data'), path.join(home, '.config', 'google-chrome')]) {
      if (!existsSync(root)) continue
      let dirs: string[]
      try {
        dirs = readdirSync(root)
      } catch {
        continue
      }
      for (const dir of dirs) {
        const file = path.join(root, dir, 'History')
        if ((dir === 'Default' || dir.startsWith('Profile ')) && existsSync(file)) out.push({ profile: `${path.basename(home)}/${dir}`, file })
      }
    }
  }
  return out
}

export interface ChromeVisit {
  visitId: number
  at: number
  url: string
  title: string
}

/** Visits after `afterId` in a History file, oldest first. */
export function readVisits(file: string, afterId: number): ChromeVisit[] {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'chrome-history-'))
  try {
    const copy = path.join(dir, 'History')
    copyFileSync(file, copy)
    if (existsSync(file + '-journal')) copyFileSync(file + '-journal', copy + '-journal')
    const sqlite = new Database(copy, { readonly: true })
    try {
      const rows = sqlite
        .prepare(
          `SELECT v.id AS visitId, v.visit_time AS t, v.transition AS transition, u.url AS url, u.title AS title
           FROM visits v JOIN urls u ON u.id = v.url WHERE v.id > ? ORDER BY v.id`,
        )
        .all(afterId) as { visitId: number; t: number; transition: number; url: string; title: string }[]
      return rows
        .filter((r) => !SUBFRAME.has(r.transition & 0xff) && !SKIP_URL.test(r.url))
        .map((r) => ({ visitId: r.visitId, at: chromeTimeToMs(r.t), url: r.url, title: r.title || r.url }))
    } finally {
      sqlite.close()
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const lastKey = (profile: string) => `chrome.lastVisit.${profile}`

let running: Promise<ScanReport> | null = null

/** Imports new visits from every profile. Concurrent calls share one run. */
export function scanChrome(files = historyFiles()): Promise<ScanReport> {
  return (running ??= Promise.resolve()
    .then(() => doScan(files))
    .finally(() => (running = null)))
}

function doScan(files: HistoryFile[]): ScanReport {
  const report: ScanReport = { added: 0, errors: [] }
  for (const { profile, file } of files) {
    try {
      const after = getSetting<number>(lastKey(profile), 0)
      const visits = readVisits(file, after)
      if (!visits.length) continue
      db.transaction(() => {
        for (const v of visits)
          report.added += db.insert(webVisits).values({ profile, chromeVisitId: v.visitId, at: v.at, title: v.title, url: v.url }).onConflictDoNothing().run().changes
        setSetting(lastKey(profile), visits.at(-1)!.visitId)
      })
      addChromeWatches(visits)
    } catch (err) {
      report.errors.push(`${profile}: ${(err as Error).message}`)
    }
  }
  return report
}

export function listVisits(from: number, to: number, q?: string, limit = 2000): WebVisitDTO[] {
  const text = q ? `%${q}%` : undefined
  return db
    .select({ id: webVisits.id, at: webVisits.at, title: webVisits.title, url: webVisits.url, profile: webVisits.profile })
    .from(webVisits)
    .where(and(gte(webVisits.at, from), lt(webVisits.at, to), text ? or(like(webVisits.title, text), like(webVisits.url, text)) : undefined))
    .orderBy(desc(webVisits.at))
    .limit(limit)
    .all()
}
