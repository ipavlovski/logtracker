import { gte } from 'drizzle-orm'
import { Hono } from 'hono'
import { validator } from 'hono/validator'
import { isIsoDate, toIsoDate } from '../../shared/dates.ts'
import type { DayCount } from '../../shared/types.ts'
import { db } from '../db/client.ts'
import { webVisits, ytWatches } from '../db/schema.ts'
import { claudeWebConnected } from '../lib/ai/claudeWeb.ts'
import { importUpload, listChats, promptDays, scanLocal } from '../lib/ai/importer.ts'
import { describeSources } from '../lib/ai/sources.ts'
import { historyFiles, listVisits, scanChrome } from '../lib/digital/chrome.ts'
import { fillChannels, importTakeout, listWatches } from '../lib/digital/youtube.ts'
import { bad } from '../lib/validate.ts'

const MAX_UPLOAD = 2 * 1024 * 1024 * 1024
const DAY_MS = 86_400_000

function range(q: (k: string) => string | undefined) {
  const from = Number(q('from'))
  const to = Number(q('to'))
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) bad('from and to must be epoch ms, from < to')
  if (to - from > 400 * DAY_MS) bad('range too long')
  return { from, to, q: q('q') || undefined }
}

function sinceDate(q: (k: string) => string | undefined): number {
  const from = q('from') ?? ''
  if (!isIsoDate(from)) bad('from must be YYYY-MM-DD')
  return new Date(from + 'T00:00:00').getTime()
}

const perDay = (times: number[]): DayCount[] => {
  const m = new Map<string, number>()
  for (const t of times) m.set(toIsoDate(new Date(t)), (m.get(toIsoDate(new Date(t))) ?? 0) + 1)
  return [...m].map(([date, count]) => ({ date, count }))
}

const fileForm = validator('form', (v) => {
  const file = v.file
  if (!(file instanceof File)) bad('file is required')
  if (file.size > MAX_UPLOAD) bad('file too large')
  return { file }
})

export const digitalRoutes = new Hono()
  // ── Chrome ──
  .get('/digital/chrome/visits', (c) => {
    const r = range((k) => c.req.query(k))
    return c.json({ visits: listVisits(r.from, r.to, r.q) })
  })
  .get('/digital/chrome/profiles', (c) => c.json({ profiles: historyFiles() }))
  .get('/digital/chrome/days', (c) => {
    const since = sinceDate((k) => c.req.query(k))
    return c.json({ days: perDay(db.select({ at: webVisits.at }).from(webVisits).where(gte(webVisits.at, since)).all().map((r) => r.at)) })
  })
  // Chrome history (YouTube watch pages included), then channels for watches without one.
  .post('/digital/scan', async (c) => {
    const chrome = await scanChrome()
    const channels = await fillChannels()
    return c.json({ chrome, channels })
  })

  // ── YouTube ──
  .get('/digital/youtube/watches', (c) => {
    const r = range((k) => c.req.query(k))
    return c.json({ watches: listWatches(r.from, r.to, r.q) })
  })
  .get('/digital/youtube/days', (c) => {
    const since = sinceDate((k) => c.req.query(k))
    return c.json({ days: perDay(db.select({ at: ytWatches.at }).from(ytWatches).where(gte(ytWatches.at, since)).all().map((r) => r.at)) })
  })
  .post('/digital/youtube/import', fileForm, async (c) => {
    const { file } = c.req.valid('form')
    try {
      return c.json(importTakeout(file.name, Buffer.from(await file.arrayBuffer())))
    } catch (err) {
      bad((err as Error).message)
    }
  })

  // ── AI ──
  .get('/digital/ai/chats', (c) => {
    const r = range((k) => c.req.query(k))
    return c.json({ chats: listChats(r.from, r.to, r.q) })
  })
  .get('/digital/ai/prompt-days', (c) => {
    const from = c.req.query('from') ?? ''
    if (!isIsoDate(from)) bad('from must be YYYY-MM-DD')
    return c.json({ days: promptDays(from) })
  })
  .get('/digital/ai/sources', async (c) => {
    const connected = await claudeWebConnected()
    return c.json({ sources: describeSources().map((s) => (s.source === 'claude' && connected !== undefined ? { ...s, connected } : s)) })
  })
  .post('/digital/ai/scan', async (c) => c.json({ report: await scanLocal() }))
  .post('/digital/ai/import', fileForm, async (c) => {
    const { file } = c.req.valid('form')
    try {
      return c.json({ report: await importUpload(file.name, Buffer.from(await file.arrayBuffer())) })
    } catch (err) {
      bad((err as Error).message)
    }
  })
