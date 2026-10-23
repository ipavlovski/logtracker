import { eq } from 'drizzle-orm'
import { db } from '../db/client.ts'
import { settings } from '../db/schema.ts'

// Small values kept in the database (where each Chrome profile's import got to, your own names and addresses…).

export function getSetting<T>(key: string, fallback: T): T {
  const r = db.select({ value: settings.value }).from(settings).where(eq(settings.key, key)).get()
  return r ? (r.value as T) : fallback
}

export function setSetting(key: string, value: unknown) {
  db.insert(settings).values({ key, value }).onConflictDoUpdate({ target: settings.key, set: { value } }).run()
}

/** Who "me" is, for telling outgoing messages from incoming ones (Communications). */
export interface Identity {
  /** Names your own WhatsApp messages show under. */
  names: string[]
  /** Addresses you send email from. */
  emails: string[]
}

export const getIdentity = () => getSetting<Identity>('identity', { names: [], emails: [] })
export const setIdentity = (i: Identity) => setSetting('identity', i)
