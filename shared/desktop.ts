// The desktop app's bridge (electron/preload.ts → window.desktop). Only the Electron build has it: the page
// served by `pnpm dev` feature-detects it, so nothing outside electron/ depends on Electron.

export type UpdateStatus =
  | { state: 'checking' | 'none' }
  | { state: 'available' | 'ready'; version: string }
  | { state: 'downloading'; percent: number }
  | { state: 'error'; message: string }

export interface AppInfo {
  /** Semver: 0.1.0, 0.2.0-dev.3 (a dev build), 0.2.0-preview.3 (LogtrackerDev). */
  version: string
  /** "dev" is LogtrackerDev, which is updated by pnpm preview rather than from GitHub. */
  channel: 'release' | 'dev'
  /** Where the database and GPS files are. */
  dataDir: string
}

/** The tray app's own settings (electron/config.ts). */
export interface TrayPrefs {
  /** Started with Windows, hidden in the tray. */
  launchAtLogin: boolean
  /** Activity recording paused from the tray menu. */
  recordingPaused: boolean
}

export interface DesktopApi {
  platform: string
  appInfo(): Promise<AppInfo>
  checkForUpdates(): Promise<void>
  /** Downloads one release (by tag, e.g. a dev build) as the next update; progress comes through onUpdate. */
  installRelease(tag: string): Promise<void>
  /** Restarts into a downloaded update. */
  installUpdate(): Promise<void>
  onUpdate(cb: (s: UpdateStatus) => void): () => void
  trayPrefs(): Promise<TrayPrefs>
  setTrayPrefs(prefs: Partial<TrayPrefs>): Promise<TrayPrefs>
  /** Shows the data folder in Explorer. */
  showDataFolder(): Promise<void>
  /** Opens claude.ai's sign-in for live chat sync; true once signed in, false if the window was closed first. */
  connectClaude(): Promise<boolean>
  /** Signs the app out of claude.ai. */
  disconnectClaude(): Promise<void>
}

declare global {
  interface Window {
    desktop?: DesktopApi
  }
}
