import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { and, desc, eq, gte, inArray, like, lt } from 'drizzle-orm'
import { toIsoDate } from '../../../shared/dates.ts'
import type { AiChatDTO, ChatSource, DayCount, ImportCounts, ImportReport } from '../../../shared/types.ts'
import { db } from '../../db/client.ts'
import { aiChats } from '../../db/schema.ts'
import { isZip, withZip, type ZipMember } from '../zip.ts'
import { listAntigravity, parseAntigravity } from './antigravity.ts'
import { oneLine, type ParsedChat } from './chat.ts'
import { CLAUDE_RENDER_VERSION, isClaudeExport, parseClaudeConversation, parseClaudeExport } from './claudeConversation.ts'
import { fetchConversation, listConversations, NotSignedInError } from './claudeWeb.ts'
import { desktopTitles, parseClaudeCode } from './claudeCode.ts'
import { isGeminiActivity, parseGeminiActivity } from './geminiTakeout.ts'
import { antigravityRoots, claudeCodeFiles, claudeDesktopSessionFiles, exportFiles } from './sources.ts'

// The AI history: every chat found on this machine (Claude Code, Antigravity, claude.ai, Gemini Takeout), kept as what
// it was (source, model, title, when each prompt was sent) rather than its transcript, which logcadence's AI tab keeps.
// The sources and parsers are the same as logcadence's (copied, not shared: the two apps are separate projects).

type Outcome = 'created' | 'updated' | 'unchanged' | 'skipped'

/** sourceStamp prefix of chats synced live from claude.ai (the render version and the conversation's updated_at follow). */
const LIVE_STAMP = 'live:'

/** Where a chat lives at its source; only claude.ai chats have an address. */
function sourceUrl(source: string, externalId: string): string | null {
  return source === 'claude' ? `https://claude.ai/chat/${externalId}` : null
}

/** The chat in logcadence's AI tab. */
export const logcadenceUrl = (id: string) => `logcadence://ai/${encodeURIComponent(id)}`

export function upsertChat(p: ParsedChat, stamp: string | null = null): Outcome {
  const prompts = p.messages.filter((m) => m.role === 'user')
  if (!prompts.length) return 'skipped'
  const id = `${p.source}:${p.externalId}`
  const row = {
    title: oneLine(p.title || prompts[0]!.text, 120),
    model: p.meta.model ?? null,
    startedAt: p.startedAt,
    updatedAt: p.updatedAt,
    turns: prompts.length,
    promptTimes: prompts.map((m) => m.ts ?? p.startedAt),
    sourceStamp: stamp,
    importedAt: Date.now(),
  }
  const existing = db.select().from(aiChats).where(eq(aiChats.id, id)).get()
  if (!existing) {
    db.insert(aiChats)
      .values({ id, source: p.source, externalId: p.externalId, ...row })
      .run()
    return 'created'
  }
  const same = existing.title === row.title && existing.turns === row.turns && existing.model === row.model
  // An export never replaces a live sync of the same moment: it lacks the model.
  const outdated = p.updatedAt < existing.updatedAt || (!stamp && !!existing.sourceStamp?.startsWith(LIVE_STAMP) && p.updatedAt <= existing.updatedAt)
  if (same || outdated) {
    if (stamp && stamp !== existing.sourceStamp) db.update(aiChats).set({ sourceStamp: stamp }).where(eq(aiChats.id, id)).run()
    return 'unchanged'
  }
  db.update(aiChats).set(row).where(eq(aiChats.id, id)).run()
  return 'updated'
}

// ── reports ────────────────────────────────────────────────────────────────

function counts(report: ImportReport, source: ChatSource): ImportCounts {
  return (report[source] ??= { found: 0, created: 0, updated: 0, unchanged: 0, errors: [] })
}

function tally(report: ImportReport, source: ChatSource, outcome: Outcome) {
  if (outcome === 'skipped') return
  const c = counts(report, source)
  c.found++
  c[outcome]++
}

function fail(report: ImportReport, source: ChatSource, what: string, err: unknown) {
  counts(report, source).errors.push(`${what}: ${(err as Error).message}`)
}

function importParsed(report: ImportReport, list: ParsedChat[]) {
  for (const p of [...list].sort((a, b) => a.startedAt - b.startedAt)) tally(report, p.source, upsertChat(p))
}

const stampOf = (file: string) => {
  const st = statSync(file)
  return `${Math.round(st.mtimeMs)}:${st.size}`
}

const storedStamps = (ids: string[]) =>
  new Map(
    ids.length
      ? db
          .select({ id: aiChats.id, stamp: aiChats.sourceStamp })
          .from(aiChats)
          .where(inArray(aiChats.id, ids))
          .all()
          .map((r) => [r.id, r.stamp])
      : [],
  )

// ── exports (Claude data export, Google Takeout) ───────────────────────────

function importMembers(report: ImportReport, members: ZipMember[], label: string) {
  let recognized = false
  for (const m of members) {
    const base = m.name.split('/').at(-1)!
    if (base === 'conversations.json' || (/MyActivity\.json$/i.test(m.name) && /gemini/i.test(m.name))) {
      recognized = true
      importJson(report, m.read().toString('utf8'))
    } else if (/MyActivity\.html$/i.test(m.name) && /gemini/i.test(m.name)) {
      recognized = true
      counts(report, 'gemini').errors.push(`${label}: Takeout was exported as HTML; export “My Activity” again with format JSON`)
    }
  }
  return recognized
}

function importJson(report: ImportReport, text: string): boolean {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return false
  }
  if (isClaudeExport(data)) importParsed(report, parseClaudeExport(data))
  else if (isGeminiActivity(data)) importParsed(report, parseGeminiActivity(data))
  else return false
  return true
}

/** An uploaded file: Claude export (zip / conversations.json), Takeout (zip / MyActivity.json) or a Claude Code .jsonl. */
export async function importUpload(name: string, buf: Buffer): Promise<ImportReport> {
  const report: ImportReport = {}
  if (isZip(buf)) {
    if (!withZip(buf, (members) => importMembers(report, members, name))) throw new Error(`${name}: no conversations.json or Gemini MyActivity.json inside`)
  } else if (name.endsWith('.jsonl')) {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'cc-'))
    try {
      const file = path.join(dir, path.basename(name))
      writeFileSync(file, buf)
      const p = await parseClaudeCode(file)
      if (p) tally(report, 'claude-code', upsertChat(p))
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  } else if (!importJson(report, buf.toString('utf8'))) throw new Error(`${name}: not a Claude export, Gemini Takeout or Claude Code transcript`)
  return report
}

// ── scan of local sources ──────────────────────────────────────────────────

let running: Promise<ImportReport> | null = null

/** Imports everything found on this machine. Concurrent calls share one run. */
export function scanLocal(): Promise<ImportReport> {
  return (running ??= doScan().finally(() => (running = null)))
}

async function doScan(): Promise<ImportReport> {
  const report: ImportReport = {}

  const files = claudeCodeFiles()
  const titles = desktopTitles(claudeDesktopSessionFiles())
  const known = storedStamps(files.map((f) => `claude-code:${f.sessionId}`))
  for (const f of files) {
    try {
      const stamp = stampOf(f.file)
      if (known.get(`claude-code:${f.sessionId}`) === stamp) {
        tally(report, 'claude-code', 'unchanged')
        continue
      }
      const p = await parseClaudeCode(f.file, titles, f.origin)
      if (p) tally(report, 'claude-code', upsertChat(p, stamp))
    } catch (err) {
      fail(report, 'claude-code', path.basename(f.file), err)
    }
  }

  for (const root of antigravityRoots()) {
    try {
      const convs = listAntigravity(root)
      const seen = storedStamps(convs.map((c) => `antigravity:${c.id}`))
      for (const c of convs) {
        try {
          const stamp = `${stampOf(c.file)}:${c.title}`
          if (seen.get(`antigravity:${c.id}`) === stamp) {
            tally(report, 'antigravity', 'unchanged')
            continue
          }
          const p = parseAntigravity(c)
          if (p) tally(report, 'antigravity', upsertChat(p, stamp))
        } catch (err) {
          fail(report, 'antigravity', c.title || c.id, err)
        }
      }
    } catch (err) {
      fail(report, 'antigravity', root, err)
    }
  }

  for (const file of exportFiles()) {
    try {
      if (file.endsWith('.json')) importJson(report, readFileSync(file, 'utf8'))
      else withZip(file, (members) => importMembers(report, members, path.basename(file)))
    } catch (err) {
      fail(report, /takeout/i.test(file) ? 'gemini' : 'claude', path.basename(file), err)
    }
  }

  await syncClaudeWeb(report)
  return report
}

/** claude.ai, when the desktop app is signed in: fetches the conversations changed since the last sync. */
async function syncClaudeWeb(report: ImportReport) {
  let listed: Awaited<ReturnType<typeof listConversations>>
  try {
    listed = await listConversations()
  } catch (err) {
    return fail(report, 'claude', 'claude.ai', err)
  }
  if (!listed) return
  const known = storedStamps(listed.list.map((c) => `claude:${c.uuid}`))
  for (const c of listed.list) {
    const stamp = `${LIVE_STAMP}v${CLAUDE_RENDER_VERSION}:${c.updatedAt}`
    if (c.updatedAt && known.get(`claude:${c.uuid}`) === stamp) {
      tally(report, 'claude', 'unchanged')
      continue
    }
    try {
      const p = parseClaudeConversation(await fetchConversation(listed.org, c.uuid))
      if (p) tally(report, 'claude', upsertChat(p, stamp))
    } catch (err) {
      if (err instanceof NotSignedInError) return fail(report, 'claude', 'claude.ai', err)
      fail(report, 'claude', c.name || c.uuid, err)
    }
  }
}

// ── queries ────────────────────────────────────────────────────────────────

const toDTO = (r: typeof aiChats.$inferSelect): AiChatDTO => ({
  id: r.id,
  source: r.source as ChatSource,
  model: r.model,
  title: r.title,
  startedAt: r.startedAt,
  updatedAt: r.updatedAt,
  turns: r.turns,
  url: sourceUrl(r.source, r.externalId),
  logcadenceUrl: logcadenceUrl(r.id),
})

/** Chats active in [from, to) (epoch ms), newest first. */
export function listChats(from: number, to: number, q?: string, limit = 2000): AiChatDTO[] {
  return db
    .select()
    .from(aiChats)
    .where(and(gte(aiChats.updatedAt, from), lt(aiChats.startedAt, to), q ? like(aiChats.title, `%${q}%`) : undefined))
    .orderBy(desc(aiChats.startedAt))
    .limit(limit)
    .all()
    .map(toDTO)
}

/** Prompts sent per local day from `from` on, across all chats. */
export function promptDays(from: string): DayCount[] {
  const since = new Date(from + 'T00:00:00').getTime()
  const counts = new Map<string, number>()
  for (const r of db.select({ times: aiChats.promptTimes }).from(aiChats).where(gte(aiChats.updatedAt, since)).all())
    for (const ts of r.times) {
      if (ts < since) continue
      const date = toIsoDate(new Date(ts))
      counts.set(date, (counts.get(date) ?? 0) + 1)
    }
  return [...counts].map(([date, count]) => ({ date, count }))
}
