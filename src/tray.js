const { Tray, Menu, nativeImage, app } = require('electron')
const path = require('path')

class TrayManager {
  constructor(windowManager, store, onToggle) {
    this.windowManager = windowManager
    this.store = store
    this.onToggle = onToggle  // (paused: boolean) => void — lets main actually pause the engine
    this.tray = null
  }

  create() {
    const iconPath = path.join(__dirname, '..', 'assets', 'tray-icon.png')
    let icon
    try {
      icon = nativeImage.createFromPath(iconPath)
    } catch {
      // Fallback to a tiny empty icon if the file is missing
      icon = nativeImage.createEmpty()
    }

    this.tray = new Tray(icon)
    this.tray.setToolTip('Mochi — your focus buddy')
    this._buildMenu()

    this.tray.on('double-click', () => this.windowManager.showDashboard())
  }

  _buildMenu() {
    const paused = this.store.get('settings.paused')
    const menu = Menu.buildFromTemplate([
      { label: '📋 Dashboard', click: () => this.windowManager.showDashboard() },
      {
        label: paused ? '▶  Resume Mochi' : '⏸  Pause Mochi',
        click: () => this._togglePause()
      },
      { type: 'separator' },
      { label: 'Quit', click: () => app.quit() }
    ])
    this.tray.setContextMenu(menu)
  }

  _togglePause() {
    const next = !this.store.get('settings.paused')
    this.store.set('settings.paused', next)
    this._buildMenu()
    if (this.onToggle) this.onToggle(next)
  }

  updatePauseLabel(paused) {
    this._buildMenu()
  }
}

module.exports = TrayManager
