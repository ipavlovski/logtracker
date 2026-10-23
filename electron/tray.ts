import { app, Menu, nativeImage, Tray } from 'electron'
import path from 'node:path'
import { APP_NAME, BUILD_LABEL } from './channel.ts'

// The tray icon: the app lives here while its window is closed. Clicking it shows the window; its menu pauses
// activity recording, starts the app with Windows and quits (the only way to actually close it).

export interface TrayActions {
  show(): void
  quit(): void
  paused(): boolean
  setPaused(paused: boolean): void
  launchAtLogin(): boolean
  setLaunchAtLogin(on: boolean): void
}

let tray: Tray | undefined

const iconFile = () => (app.isPackaged ? path.join(process.resourcesPath, 'tray.png') : path.join(app.getAppPath(), 'build', 'tray.png'))

export function createTray(a: TrayActions) {
  tray = new Tray(nativeImage.createFromPath(iconFile()))
  tray.on('click', a.show)
  tray.on('double-click', a.show)
  const refresh = () => {
    tray!.setToolTip(`${APP_NAME}${BUILD_LABEL ? ` ${BUILD_LABEL}` : ''}${a.paused() ? ' · recording paused' : ''}`)
    tray!.setContextMenu(
      Menu.buildFromTemplate([
        { label: `Open ${APP_NAME}`, click: a.show },
        { type: 'separator' },
        {
          label: 'Pause activity recording',
          type: 'checkbox',
          checked: a.paused(),
          click: (item) => {
            a.setPaused(item.checked)
            refresh()
          },
        },
        {
          label: 'Start with Windows',
          type: 'checkbox',
          checked: a.launchAtLogin(),
          click: (item) => {
            a.setLaunchAtLogin(item.checked)
            refresh()
          },
        },
        { type: 'separator' },
        { label: `Quit ${APP_NAME}`, click: a.quit },
      ]),
    )
  }
  refresh()
  return { refresh }
}

export function destroyTray() {
  tray?.destroy()
  tray = undefined
}
