// Which app this build is. "release" is Logtracker as published on GitHub; "dev" is LogtrackerDev, the preview
// build of the dev branch (pnpm preview): its own name, settings, data folder and port, so both run side by side,
// and no auto-update. Set at bundle time by scripts/build-electron.ts (--channel, --label).

declare const __CHANNEL__: string | undefined
declare const __BUILD_LABEL__: string | undefined

export const IS_DEV_CHANNEL = typeof __CHANNEL__ !== 'undefined' && __CHANNEL__ === 'dev'
export const APP_NAME = IS_DEV_CHANNEL ? 'LogtrackerDev' : 'Logtracker'
/** The dev version as tagged (0.2.0.3), shown in the title bar; empty for release builds. */
export const BUILD_LABEL = typeof __BUILD_LABEL__ !== 'undefined' ? __BUILD_LABEL__ : ''
// Fixed ports: Google Drive's login redirect comes back to them.
export const PORT = IS_DEV_CHANNEL ? 3013 : 3012
