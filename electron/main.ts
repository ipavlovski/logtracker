import { app, BrowserWindow, ipcMain, Menu, powerMonitor, session, shell, dialog, type WebContents } from 'electron'
import path from 'node:path'
import type { AppInfo, TrayPrefs, UpdateStatus } from '../shared/desktop.ts'
import type { RunningServer } from '../server/start.ts'
import { APP_NAME, BUILD_LABEL, IS_DEV_CHANNEL, PORT } from './channel.ts'
import { claudeWebClient, connectClaude, disconnectClaude } from './claudeWeb.ts'
import { dataDir, readConfig, writeConfig } from './config.ts'
import { createTray, destroyTray } from './tray.ts'
import { checkForUpdates, initUpdater, installRelease, installUpdate, updateStatus } from './updater.ts'

// The desktop app, meant to run in the background: it runs the API server in this process (server/start.ts) on
// 127.0.0.1:PORT (3012, or 3013 for LogtrackerDev, see channel.ts), records activity, and lives in the tray. Closing
// the window hides it; Quit in the tray menu (or an update, or Windows shutting down) is what ends the app.

// LogtrackerDev keeps its settings (and so its data folder and single-instance lock) apart from the released app's.
if (IS_DEV_CHANNEL) {
  app.setName(APP_NAME)
  app.setPath('userData', path.join(app.getPath('appData'), APP_NAME))
}
// Read by the server when it loads (Google Drive's redirect URI).
process.env.PORT = String(PORT)
// Set by `pnpm dev:electron`: the renderer comes from Vite (hot reload), which proxies the API to PORT.
const DEV_URL = process.env.ELECTRON_DEV_URL
const APP_URL = DEV_URL ?? `http://127.0.0.1:${PORT}`
const RESOURCES = app.isPackaged ? process.resourcesPath : app.getAppPath()
// Read lazily by server/db/open.ts.
process.env.LOGTRACKER_MIGRATIONS_DIR = app.isPackaged ? path.join(RESOURCES, 'migrations') : path.join(RESOURCES, 'server/db/migrations')
// Started with Windows: stay in the tray.
const START_HIDDEN = process.argv.includes('--hidden')

let server: RunningServer | undefined
let win: BrowserWindow | undefined
let quitting = false

if (!app.requestSingleInstanceLock()) app.quit()
else {
  // Launching it again (Start menu, a second click) brings the window back.
  app.on('second-instance', () => showWindow())
  app.whenReady().then(main, (err: Error) => fatal(err))
}

async function main() {
  registerIpc()
  process.env.LOGTRACKER_DATA_DIR ??= dataDir()

  // Imported only now: the server opens the database when it loads.
  const { startServer } = await import('../server/start.ts')
  try {
    server = await startServer({
      port: PORT,
      staticDir: DEV_URL ? undefined : path.join(RESOURCES, 'dist'),
      idleSeconds: () => powerMonitor.getSystemIdleTime(),
      claudeWeb: claudeWebClient,
    })
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EADDRINUSE')
      return fatal(new Error(`Port ${PORT} is in use. Is the app (or the dev server from \`pnpm dev\`) already running?`))
    throw err
  }
  if (readConfig().recordingPaused) server.activity?.stop()
  watchPower()

  setMenu()
  createTray({
    show: showWindow,
    quit: () => app.quit(),
    paused: () => !!readConfig().recordingPaused,
    setPaused,
    launchAtLogin: () => app.getLoginItemSettings().openAtLogin,
    setLaunchAtLogin,
  })
  await clearCacheAfterUpdate()
  if (!START_HIDDEN) showWindow()
  if (!IS_DEV_CHANNEL) initUpdater((s) => send('update-status', s))
}

/** A new version's first start drops the web cache, so the window can't keep showing the previous version's page. */
async function clearCacheAfterUpdate() {
  if (readConfig().lastVersion === app.getVersion()) return
  await session.defaultSession.clearCache()
  writeConfig({ lastVersion: app.getVersion() })
}

function showWindow() {
  if (win) {
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
    return
  }
  win = new BrowserWindow({
    width: 1280,
    height: 860,
    show: false,
    backgroundColor: '#282c34',
    autoHideMenuBar: true,
    title: APP_NAME,
    webPreferences: { preload: path.join(import.meta.dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false },
  })
  if (IS_DEV_CHANNEL) {
    win.on('page-title-updated', (e) => e.preventDefault())
    win.setTitle(`${APP_NAME} ${BUILD_LABEL}`)
  }
  win.once('ready-to-show', () => win?.show())
  // Closing hides it to the tray; the app keeps recording.
  win.on('close', (e) => {
    if (quitting) return
    e.preventDefault()
    win?.hide()
  })
  win.on('closed', () => (win = undefined))
  guardNavigation(win.webContents)
  win.webContents.on('did-finish-load', () => send('update-status', updateStatus()))
  // Vite may still be starting in dev.
  if (DEV_URL) win.webContents.on('did-fail-load', () => setTimeout(() => win?.loadURL(APP_URL), 500))
  void win.loadURL(APP_URL)
}

/** The app's own pages only; web links and logcadence:// links open outside. */
function guardNavigation(wc: WebContents) {
  const allowed = (url: string) => {
    const u = new URL(url)
    return u.origin === new URL(APP_URL).origin || u.origin === `http://127.0.0.1:${PORT}`
  }
  const external = (url: string) => /^(https?|logcadence):/.test(url) && void shell.openExternal(url)
  wc.on('will-navigate', (e, url) => {
    if (!allowed(url)) e.preventDefault(), external(url)
  })
  wc.setWindowOpenHandler(({ url }) => {
    external(url)
    return { action: 'deny' }
  })
}

function setMenu() {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      { label: 'File', submenu: [{ label: 'Close window', accelerator: 'CmdOrCtrl+W', click: () => win?.hide() }, { type: 'separator' }, { label: `Quit ${APP_NAME}`, accelerator: 'CmdOrCtrl+Q', click: () => app.quit() }] },
      { label: 'View', submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }] },
      {
        label: 'Help',
        submenu: [
          { label: 'Check for updates…', click: () => void checkForUpdates() },
          { label: 'Show data folder', click: () => void shell.openPath(process.env.LOGTRACKER_DATA_DIR!) },
          { label: `Version ${app.getVersion()}`, enabled: false },
        ],
      },
    ]),
  )
}

// ── tray settings ───────────────────────────────────────────────────────────

function setPaused(paused: boolean) {
  writeConfig({ recordingPaused: paused })
  if (paused) server?.activity?.stop()
  else server?.activity?.start()
}

function setLaunchAtLogin(on: boolean) {
  // Unpackaged (pnpm dev:electron) there is no installed exe to start.
  if (!app.isPackaged) return
  app.setLoginItemSettings({ openAtLogin: on, args: ['--hidden'] })
}

const trayPrefs = (): TrayPrefs => ({ launchAtLogin: app.getLoginItemSettings().openAtLogin, recordingPaused: !!readConfig().recordingPaused })

/** Screen locks and sleep end the open activity spans; while locked, input doesn't count. */
function watchPower() {
  powerMonitor.on('lock-screen', () => server?.activity?.setLocked(true))
  powerMonitor.on('unlock-screen', () => server?.activity?.setLocked(false))
  powerMonitor.on('suspend', () => server?.activity?.close())
}

// ── plumbing ────────────────────────────────────────────────────────────────

function registerIpc() {
  ipcMain.handle('app-info', (): AppInfo => ({ version: app.getVersion(), channel: IS_DEV_CHANNEL ? 'dev' : 'release', dataDir: process.env.LOGTRACKER_DATA_DIR ?? dataDir() }))
  ipcMain.handle('check-for-updates', () => checkForUpdates())
  ipcMain.handle('install-release', (_e, tag: string) => installRelease(tag))
  ipcMain.handle('install-update', async () => {
    quitting = true
    await stopServer()
    installUpdate()
  })
  ipcMain.handle('tray-prefs', () => trayPrefs())
  ipcMain.handle('set-tray-prefs', (_e, p: Partial<TrayPrefs>) => {
    if (p.recordingPaused !== undefined) setPaused(p.recordingPaused)
    if (p.launchAtLogin !== undefined) setLaunchAtLogin(p.launchAtLogin)
    return trayPrefs()
  })
  ipcMain.handle('show-data-folder', () => void shell.openPath(process.env.LOGTRACKER_DATA_DIR ?? dataDir()))
  ipcMain.handle('claude-connect', () => connectClaude(win))
  ipcMain.handle('claude-disconnect', () => disconnectClaude())
}

function send(channel: string, value: UpdateStatus) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, value)
}

async function stopServer() {
  const s = server
  server = undefined
  await s?.stop()
}

// Close the activity spans and the database before quitting.
app.on('before-quit', (e) => {
  quitting = true
  if (!server) return destroyTray()
  e.preventDefault()
  void stopServer().finally(() => app.quit())
})
// The window closing (it's hidden, not closed, unless quitting) never ends the app: it lives in the tray.
app.on('window-all-closed', () => {})

function fatal(err: Error) {
  dialog.showErrorBox(APP_NAME, err.message)
  app.exit(1)
}
