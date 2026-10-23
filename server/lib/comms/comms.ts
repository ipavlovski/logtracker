import { createHash } from 'node:crypto'
import { and, desc, eq, gte, inArray, like, lt, or } from 'drizzle-orm'
import { newId } from '../../../shared/id.ts'
import type { Channel, CommsImportResult, MessageDTO } from '../../../shared/types.ts'
import { db } from '../../db/client.ts'
import { messages } from '../../db/schema.ts'
import { getIdentity } from '../settings.ts'
import { bad, notFound } from '../validate.ts'
import { parseMbox, parseSmsBackup, parseWhatsApp, type ParsedMessage } from './parsers.ts'

// Communications: messages and calls imported from backups and exports, plus ones logged by hand.

type Row = typeof messages.$inferSelect
const toDTO = ({ importHash: _h, ...r }: Row): MessageDTO => r

const hashOf = (m: ParsedMessage) => createHash('sha256').update(`${m.channel}|${m.direction}|${m.at}|${m.counterpart}|${m.subject}|${m.snippet}`).digest('hex').slice(0, 32)

/** Adds the messages not imported before. */
export function addMessages(list: ParsedMessage[]): CommsImportResult {
  const hashes = list.map(hashOf)
  const have = new Set<string>()
  for (let i = 0; i < hashes.length; i += 500)
    for (const r of db.select({ h: messages.importHash }).from(messages).where(inArray(messages.importHash, hashes.slice(i, i + 500))).all()) have.add(r.h)
  let added = 0
  db.transaction(() => {
    list.forEach((m, i) => {
      if (have.has(hashes[i]!)) return
      have.add(hashes[i]!)
      db.insert(messages).values({ id: newId(), ...m, importHash: hashes[i]! }).run()
      added++
    })
  })
  return { added, duplicates: list.length - added, errors: [] }
}

/** An uploaded backup or export, told apart by its name and contents. */
export function importFile(name: string, text: string): CommsImportResult {
  const me = getIdentity()
  if (/<smses|<calls|<sms\s|<call\s/.test(text.slice(0, 4000))) return addMessages(parseSmsBackup(text))
  if (/\.mbox$/i.test(name) || /^From \S+/.test(text)) {
    if (!me.emails.length) bad('Set your email addresses in Communications → Settings first, so sent mail can be told apart')
    return addMessages(parseMbox(text, me.emails))
  }
  if (/\.txt$/i.test(name)) {
    if (!me.names.length) bad('Set your WhatsApp name in Communications → Settings first, so your messages can be told apart')
    const parsed = parseWhatsApp(text, name, me.names)
    if (!parsed.length) bad(`${name}: no WhatsApp messages found`)
    return addMessages(parsed)
  }
  bad(`${name}: not an SMS Backup & Restore XML, a WhatsApp chat export (.txt) or an mbox file`)
}

export interface MessageQuery {
  from: number
  to: number
  direction?: 'out' | 'in'
  channel?: Channel
  q?: string
}

export function listMessages({ from, to, direction, channel, q }: MessageQuery, limit = 1000): MessageDTO[] {
  const text = q ? `%${q}%` : undefined
  return db
    .select()
    .from(messages)
    .where(
      and(
        gte(messages.at, from),
        lt(messages.at, to),
        direction ? eq(messages.direction, direction) : undefined,
        channel ? eq(messages.channel, channel) : undefined,
        text ? or(like(messages.counterpart, text), like(messages.subject, text), like(messages.snippet, text)) : undefined,
      ),
    )
    .orderBy(desc(messages.at))
    .limit(limit)
    .all()
    .map(toDTO)
}

/** A message or call logged by hand. */
export function logMessage(m: ParsedMessage): MessageDTO {
  const row = { id: newId(), ...m, importHash: `manual:${newId()}` }
  db.insert(messages).values(row).run()
  return toDTO(row)
}

export function deleteMessage(id: string) {
  db.select({ id: messages.id }).from(messages).where(eq(messages.id, id)).get() ?? notFound('message')
  db.delete(messages).where(eq(messages.id, id)).run()
}
