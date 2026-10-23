import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import type { Context } from 'hono'
import path from 'node:path'
import { app } from './app.ts'
import { closeDb, db } from './db/client.ts'
import { startRecorder, stopRecorder, type ActivityRecorder } from './lib/activity.ts'
import { scanLocal } from './lib/ai/importer.ts'
import { setClaudeWeb, type ClaudeWebClient } from './lib/ai/claudeWeb.ts'
import { scanChrome } from './lib/digital/chrome.ts'
import { fillChannels } from './lib/digital/youtube.ts'
import { autoReady, importNew } from './lib/gps/drive.ts'
import { scanGps } from './lib/gps/scan.ts'

// Starts the API (and, given staticDir, the built web app) plus the background jobs. Shared by the dev server
// (server/index.ts) and the desktop app, which runs it inside Electron's main process.

// GPS files from Google Drive: GPSLogger uploads on its own schedule, so every half hour is plenty.
const GPS_DRIVE_SYNC_MS = 30 * 60_000
// Chrome history and AI chats: the digital activity tab should be close to current whenever it's opened.
const DIGITAL_SYNC_MS = 15 * 60_000

export interface StartOptions {
  port: number
  /** Built web app (vite's dist/) to serve next to the API. */
  staticDir?: string
  /** Seconds since the last keyboard/mouse input; given (by the desktop app), activity is recorded. */
  idleSeconds?: () => number
  /** The claude.ai session the desktop app signs in to; given, the AI scan syncs claude.ai chats. */
  claudeWeb?: ClaudeWebClient
  /** Off for tests: no background imports. */
  background?: boolean
}

export interface RunningServer {
  port: number
  /** Set when recording activity, for the desktop app to report screen locks, sleep and pauses. */
  activity?: ActivityRecorder
  /** Stops the jobs and the server and closes the database. */
  stop(): Promise<void>
}

const warn = (what: string) => (err: Error) => console.warn(`${what}: ${err.message}`)

export function startServer({ port, staticDir, idleSeconds, claudeWeb, background = true }: StartOptions): Promise<RunningServer> {
  setClaudeWeb(claudeWeb)
  if (staticDir) {
    const root = path.relative(process.cwd(), staticDir)
    // Built files under static/ have content hashes in their names, so they never change. Everything else (the
    // page itself) must be re-checked, or an updated app keeps showing the old page from the browser cache.
    const onFound = (file: string, c: Context) =>
      c.header('Cache-Control', /[\\/]static[\\/]/.test(file) ? 'public, max-age=31536000, immutable' : 'no-cache')
    app.use('/*', serveStatic({ root, onFound }))
    app.get('*', serveStatic({ path: path.join(root, 'index.html'), onFound }))
  }

  const timers: NodeJS.Timeout[] = []
  const every = (ms: number, fn: () => void) => {
    const t = setInterval(fn, ms)
    t.unref()
    timers.push(t)
  }

  if (background) {
    // GPS days dropped into the gps folder while the app was off, then new ones from Google Drive.
    const gpsDriveTick = () => {
      if (autoReady()) importNew().then((r) => r.downloaded && console.log(`gps drive: ${r.downloaded} file(s) imported`), warn('gps drive import'))
    }
    scanGps()
      .then((r) => r.processed && console.log(`gps: ${r.processed} day(s) classified`), warn('gps scan'))
      .finally(gpsDriveTick)
    every(GPS_DRIVE_SYNC_MS, gpsDriveTick)

    const digitalTick = () => {
      scanChrome()
        .then((r) => {
          if (r.added) console.log(`chrome: ${r.added} visit(s)`)
          for (const e of r.errors) console.warn(`chrome history: ${e}`)
          return fillChannels()
        })
        .catch(warn('chrome history'))
      scanLocal().catch(warn('ai scan'))
    }
    // A moment after start, so the window comes up first.
    setTimeout(digitalTick, 10_000).unref()
    every(DIGITAL_SYNC_MS, digitalTick)
  }

  const activity = idleSeconds && startRecorder(db, idleSeconds)

  return new Promise((resolve, reject) => {
    // Bound to 127.0.0.1 explicitly: Google Drive's login redirect uses that address, and WSL only
    // forwards a Linux 127.0.0.1 listener to Windows' 127.0.0.1 (an IPv6 "::" one becomes [::1] only).
    const server = serve({ fetch: app.fetch, port, hostname: '127.0.0.1' }, () => {
      console.log(`API listening on http://127.0.0.1:${port}`)
      server.off('error', reject)
      let stopped: Promise<void> | undefined
      resolve({
        port,
        activity,
        stop: () =>
          (stopped ??= new Promise<void>((done) => {
            for (const t of timers) clearInterval(t)
            stopRecorder()
            server.close(() => {
              closeDb()
              done()
            })
            // Open keep-alive connections would hold close() back.
            ;(server as { closeAllConnections?: () => void }).closeAllConnections?.()
          })),
      })
    })
    server.once('error', reject)
  })
}
