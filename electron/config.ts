import { app } from 'electron'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

// The desktop app's own settings (userData/config.json).

interface Config {
  /** Where tracker.db and the GPS files live; defaults to userData/data. */
  dataDir?: string
  /** Activity recording paused from the tray. */
  recordingPaused?: boolean
  /** The version that last ran, to notice an update (main.ts clears the web cache then). */
  lastVersion?: string
}

const file = () => path.join(app.getPath('userData'), 'config.json')

export function readConfig(): Config {
  try {
    return JSON.parse(readFileSync(file(), 'utf8')) as Config
  } catch {
    return {}
  }
}

/** Updates the given settings, keeping the others. */
export function writeConfig(c: Config) {
  mkdirSync(path.dirname(file()), { recursive: true })
  writeFileSync(file(), JSON.stringify({ ...readConfig(), ...c }, null, 2))
}

export const dataDir = () => readConfig().dataDir ?? path.join(app.getPath('userData'), 'data')
