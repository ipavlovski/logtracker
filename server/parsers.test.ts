import { describe, expect, it } from 'vitest'
import { detectMapping, parseAmount, parseCsv, parseDate, readStatement } from './lib/finance/csv.ts'
import { parseMbox, parseSmsBackup, parseWhatsApp } from './lib/comms/parsers.ts'

describe('bank statement CSVs', () => {
  it('splits quoted cells, doubled quotes, CRLF and semicolons', () => {
    expect(parseCsv('a,"b, c","say ""hi"""\r\n1,2,3\r\n\r\n')).toEqual([
      ['a', 'b, c', 'say "hi"'],
      ['1', '2', '3'],
    ])
    expect(parseCsv('date;amount\n2026-01-02;-1,50')).toEqual([
      ['date', 'amount'],
      ['2026-01-02', '-1,50'],
    ])
  })

  it('reads amounts and dates the ways banks write them', () => {
    expect([parseAmount('$1,234.56'), parseAmount('(12.00)'), parseAmount('12.00 DR'), parseAmount('-3'), parseAmount('1.234,56'), parseAmount('n/a')]).toEqual([123456, -1200, -1200, -300, 123456, null])
    expect(parseDate('2026-03-04', 'mdy')).toBe('2026-03-04')
    expect(parseDate('03/04/2026', 'mdy')).toBe('2026-03-04')
    expect(parseDate('03/04/26', 'dmy')).toBe('2026-04-03')
    expect(parseDate('13/13/2026', 'mdy')).toBeNull()
  })

  it('finds the columns from the header, or from the cells', () => {
    const split = parseCsv('Transaction Date,Description,Debit,Credit\n10/02/2026,GROCER,45.10,\n10/03/2026,PAYROLL,,1500.00')
    expect(detectMapping(split).mapping).toEqual({ date: 0, description: 1, amount: null, debit: 2, credit: 3 })
    const r = readStatement('Transaction Date,Description,Debit,Credit\n10/02/2026,GROCER,45.10,\n10/03/2026,PAYROLL,,1500.00\n,total,,')
    expect(r.lines).toEqual([
      { date: '2026-10-02', payee: 'GROCER', amount: -4510 },
      { date: '2026-10-03', payee: 'PAYROLL', amount: 150000 },
    ])
    expect(r.skipped).toBe(1)

    // No header: D/M/Y told apart by a day over 12.
    const bare = readStatement('25/09/2026,"COFFEE  SHOP",-4.50\n01/10/2026,RENT,-1200.00')
    expect(bare.lines).toEqual([
      { date: '2026-09-25', payee: 'COFFEE SHOP', amount: -450 },
      { date: '2026-10-01', payee: 'RENT', amount: -120000 },
    ])
  })
})

describe('message imports', () => {
  it('reads SMS Backup & Restore texts and calls', () => {
    const xml = `<?xml version='1.0'?><smses count="2">
      <sms protocol="0" address="+15551234" date="1760000000000" type="2" body="On my way &amp; late" contact_name="Sam" />
      <sms address="+15551234" date="1760000100000" type="1" body="ok" contact_name="(Unknown)" />
      <call number="+15559999" duration="125" date="1760000200000" type="2" contact_name="Mum" />
      <call number="+15559999" duration="0" date="1760000300000" type="3" />
    </smses>`
    expect(parseSmsBackup(xml)).toEqual([
      { channel: 'sms', direction: 'out', counterpart: 'Sam (+15551234)', subject: '', snippet: 'On my way & late', at: 1760000000000, durationS: null },
      { channel: 'sms', direction: 'in', counterpart: '+15551234', subject: '', snippet: 'ok', at: 1760000100000, durationS: null },
      { channel: 'call', direction: 'out', counterpart: 'Mum (+15559999)', subject: 'outgoing', snippet: '', at: 1760000200000, durationS: 125 },
      { channel: 'call', direction: 'in', counterpart: '+15559999', subject: 'missed', snippet: '', at: 1760000300000, durationS: 0 },
    ])
  })

  it('reads WhatsApp exports from Android and iPhone, with multi-line messages', () => {
    const android = '10/22/26, 9:41 PM - Ilya: see you\nat 8\n10/22/26, 9:45 PM - Sam: 👍\n10/22/26, 9:46 PM - Messages are end-to-end encrypted'
    const m = parseWhatsApp(android, 'WhatsApp Chat with Sam.txt', ['ilya'])
    expect(m.map((x) => [x.direction, x.counterpart, x.snippet])).toEqual([
      ['out', 'Sam', 'see you\nat 8'],
      ['in', 'Sam', '👍'],
    ])
    expect(m[0]!.at).toBe(new Date(2026, 9, 22, 21, 41).getTime())

    const iphone = '[22/10/2026, 21:41:05] Ilya: hello'
    expect(parseWhatsApp(iphone, 'WhatsApp Chat - Sam.txt', ['Ilya'])[0]).toMatchObject({ direction: 'out', counterpart: 'Sam', at: new Date(2026, 9, 22, 21, 41, 5).getTime() })
  })

  it('reads mbox headers, sent when From is one of your addresses', () => {
    const mbox = [
      'From 123@xxx Thu Oct 22 10:00:00 +0000 2026',
      'From: Ilya <ME@example.com>',
      'To: Sam <sam@example.org>',
      'Subject: =?UTF-8?B?UXVvdGUg4oCU?=',
      'Date: Thu, 22 Oct 2026 10:00:00 +0000',
      'Content-Type: text/plain',
      '',
      'Here is the quote.',
      'From 456@xxx Thu Oct 22 11:00:00 +0000 2026',
      'From: Sam <sam@example.org>',
      'Subject: Re: Quote',
      'Date: Thu, 22 Oct 2026 11:00:00 +0000',
      '',
      'Thanks',
    ].join('\n')
    expect(parseMbox(mbox, ['me@example.com'])).toEqual([
      { channel: 'email', direction: 'out', counterpart: 'Sam <sam@example.org>', subject: 'Quote —', snippet: 'Here is the quote.', at: Date.parse('2026-10-22T10:00:00Z'), durationS: null },
      { channel: 'email', direction: 'in', counterpart: 'Sam <sam@example.org>', subject: 'Re: Quote', snippet: 'Thanks', at: Date.parse('2026-10-22T11:00:00Z'), durationS: null },
    ])
  })
})
