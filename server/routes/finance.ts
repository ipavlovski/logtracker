import { Hono } from 'hono'
import { validator } from 'hono/validator'
import type { Cadence, CsvMapping, ScheduledPaymentDTO, TransactionDTO } from '../../shared/types.ts'
import {
  createAccount,
  createScheduled,
  createTransaction,
  deleteAccount,
  deleteScheduled,
  deleteTransaction,
  importStatement,
  listAccounts,
  listScheduled,
  listTransactions,
  markPaid,
  monthSummary,
  previewStatement,
  updateScheduled,
  updateTransaction,
} from '../lib/finance/finance.ts'
import { bad, date, defined, num, obj, optBool, optDate, optStr, str, type Obj } from '../lib/validate.ts'

const CADENCES: Cadence[] = ['weekly', 'monthly', 'quarterly', 'yearly']
const MAX_STATEMENT = 20 * 1024 * 1024

function cents(o: Obj, k: string): number {
  const n = num(o, k)
  if (!Number.isInteger(n)) bad(`${k} is a whole number of cents`)
  return n
}

const optCents = (o: Obj, k: string) => (o[k] === undefined ? undefined : cents(o, k))

function accountId(o: Obj): string | null | undefined {
  const v = o.accountId
  if (v === undefined || v === null) return v
  if (typeof v !== 'string') bad('accountId must be a string or null')
  return v
}

function cadence(o: Obj): Cadence | undefined {
  const v = o.cadence
  if (v === undefined) return undefined
  if (!CADENCES.includes(v as Cadence)) bad(`cadence is one of ${CADENCES.join(', ')}`)
  return v as Cadence
}

function mapping(v: string | undefined): CsvMapping | undefined {
  if (!v) return undefined
  try {
    const m = JSON.parse(v) as CsvMapping
    if (typeof m.date !== 'number' || typeof m.description !== 'number') throw new Error()
    return m
  } catch {
    bad('mapping must be {date, description, amount | debit + credit} column numbers')
  }
}

/** A statement upload: the CSV file, which account it is, and optionally how to read its columns (JSON, as previewed). */
const statementForm = validator('form', (v): { file: File; accountId?: string; mapping?: string } => {
  const file = v.file
  if (!(file instanceof File)) bad('file is required')
  if (file.size > MAX_STATEMENT) bad('file too large')
  return defined({ file, accountId: typeof v.accountId === 'string' && v.accountId ? v.accountId : undefined, mapping: typeof v.mapping === 'string' ? v.mapping : undefined })
})

export const financeRoutes = new Hono()
  .get('/finance/accounts', (c) => c.json({ accounts: listAccounts() }))
  .post(
    '/finance/accounts',
    validator('json', (v): { name: string; currency?: string } => {
      const o = obj(v)
      return defined({ name: str(o, 'name').trim() || bad('An account needs a name'), currency: optStr(o, 'currency') })
    }),
    (c) => {
      const b = c.req.valid('json')
      return c.json(createAccount(b.name, b.currency))
    },
  )
  .delete('/finance/accounts/:id', (c) => {
    deleteAccount(c.req.param('id'))
    return c.json({ ok: true })
  })
  .get('/finance/transactions', (c) => {
    const o = { from: c.req.query('from'), to: c.req.query('to') }
    return c.json({ transactions: listTransactions(date(o, 'from'), date(o, 'to')) })
  })
  .post(
    '/finance/transactions',
    validator('json', (v): { accountId?: string | null; date: string; amount: number; payee?: string; category?: string; notes?: string } => {
      const o = obj(v)
      return defined({ accountId: accountId(o), date: date(o, 'date'), amount: cents(o, 'amount'), payee: optStr(o, 'payee'), category: optStr(o, 'category'), notes: optStr(o, 'notes') })
    }),
    (c) => {
      const b = c.req.valid('json')
      return c.json(createTransaction({ accountId: null, payee: '', category: '', notes: '', ...b }))
    },
  )
  .patch(
    '/finance/transactions/:id',
    validator('json', (v): Partial<Omit<TransactionDTO, 'id' | 'source'>> => {
      const o = obj(v)
      return defined({ accountId: accountId(o), date: optDate(o, 'date'), amount: optCents(o, 'amount'), payee: optStr(o, 'payee'), category: optStr(o, 'category'), notes: optStr(o, 'notes') })
    }),
    (c) => c.json(updateTransaction(c.req.param('id'), c.req.valid('json'))),
  )
  .delete('/finance/transactions/:id', (c) => {
    deleteTransaction(c.req.param('id'))
    return c.json({ ok: true })
  })
  .get('/finance/summary', (c) => {
    const month = c.req.query('month') ?? ''
    if (!/^\d{4}-\d{2}$/.test(month)) bad('month must be YYYY-MM')
    return c.json(monthSummary(month))
  })
  // What a bank statement would add (nothing is saved).
  .post('/finance/import/preview', statementForm, async (c) => {
    const { file, accountId, mapping: m } = c.req.valid('form')
    return c.json(previewStatement(await file.text(), accountId ?? null, mapping(m)))
  })
  .post('/finance/import', statementForm, async (c) => {
    const { file, accountId, mapping: m } = c.req.valid('form')
    return c.json(importStatement(await file.text(), accountId ?? null, mapping(m)))
  })
  .get('/finance/scheduled', (c) => c.json({ scheduled: listScheduled() }))
  .post(
    '/finance/scheduled',
    validator('json', (v): { payee: string; amount: number; category?: string; accountId?: string | null; cadence: Cadence; nextDue: string } => {
      const o = obj(v)
      return defined({ payee: str(o, 'payee').trim() || bad('A payment needs a payee'), amount: cents(o, 'amount'), category: optStr(o, 'category'), accountId: accountId(o), cadence: cadence(o) ?? bad('cadence is required'), nextDue: date(o, 'nextDue') })
    }),
    (c) => c.json(createScheduled({ category: '', accountId: null, ...c.req.valid('json') })),
  )
  .patch(
    '/finance/scheduled/:id',
    validator('json', (v): Partial<Omit<ScheduledPaymentDTO, 'id'>> => {
      const o = obj(v)
      return defined({ payee: optStr(o, 'payee'), amount: optCents(o, 'amount'), category: optStr(o, 'category'), accountId: accountId(o), cadence: cadence(o), nextDue: optDate(o, 'nextDue'), archived: optBool(o, 'archived') })
    }),
    (c) => c.json(updateScheduled(c.req.param('id'), c.req.valid('json'))),
  )
  .delete('/finance/scheduled/:id', (c) => {
    deleteScheduled(c.req.param('id'))
    return c.json({ ok: true })
  })
  // Logs the payment (as a transaction, on `date` or today) and moves it to its next due date.
  .post(
    '/finance/scheduled/:id/paid',
    validator('json', (v): { date?: string } => defined({ date: optDate(obj(v ?? {}), 'date') })),
    (c) => c.json(markPaid(c.req.param('id'), c.req.valid('json').date)),
  )
