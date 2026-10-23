import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { DesktopApi, UpdateStatus } from '../shared/desktop.ts'

// Sandboxed preload: the page gets window.desktop and nothing else from Electron or Node.

function subscribe<T>(channel: string, cb: (v: T) => void) {
  const listener = (_e: IpcRendererEvent, v: T) => cb(v)
  ipcRenderer.on(channel, listener)
  return () => void ipcRenderer.off(channel, listener)
}

const api: DesktopApi = {
  platform: process.platform,
  appInfo: () => ipcRenderer.invoke('app-info'),
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  installRelease: (tag) => ipcRenderer.invoke('install-release', tag),
  installUpdate: () => ipcRenderer.invoke('install-update'),
  onUpdate: (cb) => subscribe<UpdateStatus>('update-status', cb),
  trayPrefs: () => ipcRenderer.invoke('tray-prefs'),
  setTrayPrefs: (prefs) => ipcRenderer.invoke('set-tray-prefs', prefs),
  showDataFolder: () => ipcRenderer.invoke('show-data-folder'),
  connectClaude: () => ipcRenderer.invoke('claude-connect'),
  disconnectClaude: () => ipcRenderer.invoke('claude-disconnect'),
}

contextBridge.exposeInMainWorld('desktop', api)
