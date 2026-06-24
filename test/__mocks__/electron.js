// Minimal Electron mock for Jest unit tests (Node environment, no Electron runtime)

const EventEmitter = require('events')

const powerMonitor = new EventEmitter()

const app = {
  getVersion: () => '1.0.0.0',
  getPath: (name) => `/tmp/mochi-test-${name}`,
  quit: jest.fn()
}

const ipcMain = new EventEmitter()
ipcMain.handle = jest.fn()
ipcMain.removeHandler = jest.fn()

const ipcRenderer = new EventEmitter()
ipcRenderer.invoke = jest.fn()
ipcRenderer.send = jest.fn()

module.exports = { app, ipcMain, ipcRenderer, powerMonitor }
