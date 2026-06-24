let AutoLaunchLib
try {
  AutoLaunchLib = require('electron-auto-launch')
} catch {
  AutoLaunchLib = null
}

let launcher = null

function getLauncher() {
  if (!launcher && AutoLaunchLib) {
    launcher = new AutoLaunchLib({ name: 'Mochi' })
  }
  return launcher
}

async function enableIfFirstRun(store) {
  if (!store.get('settings.firstRun')) return
  store.set('settings.firstRun', false)
  await enable()
}

async function enable() {
  try {
    const l = getLauncher()
    if (!l) return
    const already = await l.isEnabled()
    if (!already) await l.enable()
  } catch (err) {
    console.error('[auto-launch] enable failed:', err.message)
  }
}

async function disable() {
  try {
    const l = getLauncher()
    if (!l) return
    await l.disable()
  } catch (err) {
    console.error('[auto-launch] disable failed:', err.message)
  }
}

async function toggle(enabled) {
  if (enabled) await enable()
  else await disable()
}

async function isEnabled() {
  try {
    const l = getLauncher()
    if (!l) return false
    return await l.isEnabled()
  } catch {
    return false
  }
}

module.exports = { enableIfFirstRun, enable, disable, toggle, isEnabled }
