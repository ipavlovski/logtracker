import { and, desc, eq, gte, isNull, like, lt, or } from 'drizzle-orm'
import type { ScanReport, YtWatchDTO } from '../../../shared/types.ts'
import { db } from '../../db/client.ts'
import { ytWatches } from '../../db/schema.ts'
import { isZip, withZip } from '../zip.ts'
import type { ChromeVisit } from './chrome.ts'

// YouTube history, kept apart from logcadence's YouTube tab (videos saved to playlists and annotated): what was
// watched. It comes from Chrome visits to watch pages (no channel: filled in from YouTube's oEmbed, which needs no API
// key) and from Google Takeout's watch history (YouTube and YouTube Music → history, JSON), which has channels.

/** The video id of a watch page (watch?v=, youtu.be/, /shorts/, /live/); null for other pages. */
export function videoIdOf(url: string): string | null {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return null
  }
  const host = u.hostname.replace(/^(www|m|music)\./, '')
  if (host === 'youtu.be') return /^[\w-]{11}$/.test(u.pathname.slice(1)) ? u.pathname.slice(1) : null
  if (host !== 'youtube.com') return null
  if (u.pathname === '/watch') return u.searchParams.get('v')?.match(/^[\w-]{11}$/)?.[0] ?? null
  return /^\/(shorts|live)\/([\w-]{11})/.exec(u.pathname)?.[2] ?? null
}

/** "(3) Some talk - YouTube" → "Some talk". */
export const cleanTitle = (t: string) => t.replace(/^\(\d+\)\s*/, '').replace(/\s*-\s*YouTube( Music)?$/, '').trim()

// Reloads, seeks and tab restores revisit the page: visits of one video this close together are one watch.
const SAME_WATCH_MS = 30 * 60_000

function insertWatch(w: { at: number; videoId: string; title: string; channel: string | null; source: 'chrome' | 'takeout' }): boolean {
  const near = db
    .select({ id: ytWatches.id })
    .from(ytWatches)
    .where(and(eq(ytWatches.videoId, w.videoId), gte(ytWatches.at, w.at - SAME_WATCH_MS), lt(ytWatches.at, w.at + SAME_WATCH_MS)))
    .get()
  if (near) {
    // Takeout knows the channel a Chrome visit didn't.
    if (w.channel) db.update(ytWatches).set({ channel: w.channel }).where(and(eq(ytWatches.id, near.id), isNull(ytWatches.channel))).run()
    return false
  }
  return db.insert(ytWatches).values(w).onConflictDoNothing().run().changes > 0
}

/** Chrome visits that were watch pages (a page title still reading "YouTube" means it hadn't loaded: skipped). */
export function addChromeWatches(visits: ChromeVisit[]): number {
  let added = 0
  db.transaction(() => {
    for (const v of visits) {
      const videoId = videoIdOf(v.url)
      const title = cleanTitle(v.title)
      if (videoId && title && title !== 'YouTube') added += Number(insertWatch({ at: v.at, videoId, title, channel: null, source: 'chrome' }))
    }
  })
  return added
}

interface TakeoutItem {
  header?: string
  title?: string
  titleUrl?: string
  subtitles?: { name?: string }[]
  time?: string
}

export const isWatchHistory = (data: unknown): data is TakeoutItem[] =>
  Array.isArray(data) && data.slice(0, 20).some((x) => typeof (x as TakeoutItem)?.titleUrl === 'string' && /^Watched /.test((x as TakeoutItem).title ?? ''))

export function addTakeout(items: TakeoutItem[]): number {
  let added = 0
  db.transaction(() => {
    for (const it of items) {
      const videoId = it.titleUrl ? videoIdOf(it.titleUrl) : null
      const at = Date.parse(it.time ?? '')
      if (!videoId || !Number.isFinite(at)) continue
      const title = (it.title ?? '').replace(/^Watched /, '')
      added += Number(insertWatch({ at, videoId, title, channel: it.subtitles?.[0]?.name ?? null, source: 'takeout' }))
    }
  })
  return added
}

/** A Takeout zip, or its watch-history.json. */
export function importTakeout(name: string, buf: Buffer): ScanReport {
  const parse = (text: string) => {
    const data = JSON.parse(text) as unknown
    if (!isWatchHistory(data)) throw new Error(`${name}: not a YouTube watch history (Takeout → YouTube → history, JSON format)`)
    return addTakeout(data)
  }
  if (!isZip(buf)) return { added: parse(buf.toString('utf8')), errors: [] }
  return withZip(buf, (members) => {
    const m = members.find((x) => /watch-history\.json$/i.test(x.name))
    if (!m) throw new Error(`${name}: no watch-history.json inside (export YouTube history as JSON)`)
    return { added: parse(m.read().toString('utf8')), errors: [] }
  })
}

const OEMBED = 'https://www.youtube.com/oembed?format=json&url='
// Per scan, so a long history fills in over a few scans without a burst of requests.
const OEMBED_BATCH = 40

/** Fills in the channels of watches that don't have one yet; a removed or private video gets an empty channel. */
export async function fillChannels(fetchFn: typeof fetch = fetch): Promise<number> {
  const ids = [...new Set(db.selectDistinct({ videoId: ytWatches.videoId }).from(ytWatches).where(isNull(ytWatches.channel)).limit(OEMBED_BATCH).all().map((r) => r.videoId))]
  let filled = 0
  for (const id of ids) {
    let channel = ''
    try {
      const res = await fetchFn(OEMBED + encodeURIComponent(`https://www.youtube.com/watch?v=${id}`))
      if (res.ok) channel = ((await res.json()) as { author_name?: string }).author_name ?? ''
      else if (res.status >= 500 || res.status === 429) break // try again on a later scan
    } catch {
      break // offline
    }
    db.update(ytWatches).set({ channel }).where(and(eq(ytWatches.videoId, id), isNull(ytWatches.channel))).run()
    filled++
  }
  return filled
}

export function listWatches(from: number, to: number, q?: string, limit = 2000): YtWatchDTO[] {
  const text = q ? `%${q}%` : undefined
  return db
    .select()
    .from(ytWatches)
    .where(and(gte(ytWatches.at, from), lt(ytWatches.at, to), text ? or(like(ytWatches.title, text), like(ytWatches.channel, text)) : undefined))
    .orderBy(desc(ytWatches.at))
    .limit(limit)
    .all()
    .map((w) => ({ ...w, url: `https://www.youtube.com/watch?v=${w.videoId}` }))
}
