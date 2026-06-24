const { BrowserWindow, screen } = require('electron')
const path = require('path')

class WindowManager {
  constructor(store) {
    this.store = store
    this.overlayWindow = null
    this.dashboardWindow = null
  }

  async createOverlay() {
    // Use full display bounds (not workArea) so Mochi can sit ON the taskbar,
    // bottom-right by the clock.
    const display = screen.getPrimaryDisplay()
    const { width: sw, height: sh, x: bx, y: by } = display.bounds
    const WIN_W = 320
    const WIN_H = 520
    const x = bx + sw - WIN_W - 6
    const y = by + sh - WIN_H

    this.overlayWindow = new BrowserWindow({
      width: WIN_W,
      height: WIN_H,
      x,
      y,
      transparent: true,
      frame: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      focusable: true,
      webPreferences: {
        preload: path.join(__dirname, '..', 'overlay', 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false
      }
    })

    this.overlayWindow.setAlwaysOnTop(true, 'screen-saver')
    this.overlayWindow.setIgnoreMouseEvents(true, { forward: true })
    if (process.env.MOCHI_DEBUG) {
      this.overlayWindow.webContents.on('console-message', (_e, _lvl, msg) => {
        console.log('[overlay console]', msg)
      })
    }
    await this.overlayWindow.loadFile(path.join(__dirname, '..', 'overlay', 'index.html'))

    this.overlayWindow.on('closed', () => { this.overlayWindow = null })

    // Auto-recreate on renderer crash
    this.overlayWindow.webContents.on('render-process-gone', () => {
      console.error('[overlay] renderer crashed, recreating...')
      setTimeout(() => this.createOverlay(), 500)
    })
  }

  async createDashboard() {
    this.dashboardWindow = new BrowserWindow({
      width: 700,
      height: 550,
      show: false,
      frame: true,
      resizable: true,
      title: 'Mochi Dashboard',
      webPreferences: {
        preload: path.join(__dirname, '..', 'dashboard', 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false
      }
    })

    await this.dashboardWindow.loadFile(path.join(__dirname, '..', 'dashboard', 'index.html'))

    this.dashboardWindow.on('close', (e) => {
      e.preventDefault()
      this.dashboardWindow.hide()
    })
  }

  showDashboard(tab) {
    if (!this.dashboardWindow) return
    this.dashboardWindow.show()
    this.dashboardWindow.focus()
    if (tab) {
      this.dashboardWindow.webContents.send('switch-tab', tab)
    }
  }

  getOverlayWindow() { return this.overlayWindow }
  getDashboardWindow() { return this.dashboardWindow }

  sendToOverlay(channel, data) {
    if (this.overlayWindow && !this.overlayWindow.isDestroyed()) {
      this.overlayWindow.webContents.send(channel, data)
    }
  }

  sendToDashboard(channel, data) {
    if (this.dashboardWindow && !this.dashboardWindow.isDestroyed() && this.dashboardWindow.isVisible()) {
      this.dashboardWindow.webContents.send(channel, data)
    }
  }
}

module.exports = WindowManager
