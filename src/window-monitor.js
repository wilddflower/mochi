const { EventEmitter } = require('events')
const { spawn } = require('child_process')

// PowerShell script injected once at startup. Add-Type compiles C# once (~200ms),
// then subsequent polls are near-instant.
const PS_FUNCTION = `
Add-Type -ErrorAction SilentlyContinue @"
  using System;
  using System.Runtime.InteropServices;
  public class MochiWin32 {
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern int GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
  }
"@
function Get-ForegroundWindowInfo {
  $hwnd = [MochiWin32]::GetForegroundWindow()
  $winPid = 0
  [MochiWin32]::GetWindowThreadProcessId($hwnd, [ref]$winPid) | Out-Null
  $proc = Get-Process -Id $winPid -ErrorAction SilentlyContinue
  if ($proc) {
    [PSCustomObject]@{ ProcessName = $proc.ProcessName; WindowTitle = $proc.MainWindowTitle } | ConvertTo-Json -Compress
  } else {
    "null"
  }
}
Write-Host "MOCHI_READY"
`

function matchSiteInTitle(site, title) {
  const s = site.toLowerCase()
  // X/Twitter never put their domain in window titles — tabs read "Home / X",
  // "Post / X", etc. The generic name-part rule can't help either ("x" is too
  // short to match safely), so match the "… / X" suffix explicitly.
  if ((s === 'x.com' || s === 'twitter.com') && /\/ x$/i.test(title.trim())) return true
  const escaped = site.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  if (new RegExp(`\\b${escaped}\\b`, 'i').test(title)) return true
  // Also match the domain name without TLD — "youtube.com" → "youtube"
  const name = site.replace(/\.(com|org|net|io|tv|gg|co|app|dev|space|site|xyz)$/i, '')
  if (name !== site && name.length >= 3) {
    const nameEscaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    if (new RegExp(`\\b${nameEscaped}\\b`, 'i').test(title)) return true
  }
  return false
}

class WindowMonitor extends EventEmitter {
  constructor(store) {
    super()
    this.store = store
    this.ps = null
    this.pollTimer = null
    this.watchdogTimer = null
    this.lastOutput = Date.now()
    this.restartCount = 0
    this.paused = false
    this._buffer = ''
    this._ready = false
  }

  start() {
    this._spawnProcess()
  }

  pause() { this.paused = true }
  resume() { this.paused = false }

  stop() {
    if (this.pollTimer) clearInterval(this.pollTimer)
    if (this.watchdogTimer) clearInterval(this.watchdogTimer)
    this.pollTimer = null
    this.watchdogTimer = null
    if (this.ps) {
      try { this.ps.kill() } catch {}
      this.ps = null
    }
  }

  _spawnProcess() {
    try {
      this.ps = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '-'], {
        stdio: ['pipe', 'pipe', 'pipe']
      })
    } catch (err) {
      console.error('[window-monitor] spawn failed:', err.message)
      this._scheduleRestart()
      return
    }

    this._buffer = ''
    this._ready = false

    this.ps.stdout.on('data', (chunk) => {
      this.lastOutput = Date.now()
      this._buffer += chunk.toString()
      const lines = this._buffer.split('\n')
      this._buffer = lines.pop()
      lines.forEach(line => this._handleLine(line.trim()))
    })

    this.ps.stderr.on('data', (d) => {
      console.warn('[window-monitor] ps stderr:', d.toString().slice(0, 200))
    })

    this.ps.on('exit', (code) => {
      console.error('[window-monitor] ps exited, code:', code)
      this._scheduleRestart()
    })

    // Inject the function definition
    this.ps.stdin.write(PS_FUNCTION + '\n')

    // Start polling once the process signals it's ready
    this._startPolling()

    // Watchdog: restart if no output for 10s
    this.watchdogTimer = setInterval(() => {
      if (Date.now() - this.lastOutput > 10000) {
        console.warn('[window-monitor] watchdog timeout, restarting...')
        this._restartNow()
      }
    }, 5000)
  }

  _startPolling() {
    if (this.pollTimer) clearInterval(this.pollTimer)
    this.pollTimer = setInterval(() => {
      if (this.paused) return
      if (this.ps && this.ps.stdin.writable) {
        try {
          this.ps.stdin.write('Get-ForegroundWindowInfo\n')
        } catch (err) {
          console.error('[window-monitor] write failed:', err.message)
        }
      }
    }, 2500)
  }

  _handleLine(line) {
    if (!line) return
    if (line === 'MOCHI_READY') {
      this._ready = true
      return
    }
    if (line === 'null' || line === '') {
      this.emit('foreground-changed', null)
      return
    }
    try {
      const data = JSON.parse(line)
      if (data && data.ProcessName !== undefined) {
        this.emit('foreground-changed', {
          processName: data.ProcessName || '',
          windowTitle: data.WindowTitle || ''
        })
      }
    } catch {
      // Ignore non-JSON lines (PS startup messages, etc.)
    }
  }

  _scheduleRestart() {
    this.stop()
    this.restartCount++
    const delay = Math.min(1000 * this.restartCount, 10000)
    console.error('[window-monitor] restarting in', delay, 'ms (attempt', this.restartCount, ')')
    setTimeout(() => this._spawnProcess(), delay)
  }

  _restartNow() {
    if (this.ps) {
      try { this.ps.kill() } catch {}
      this.ps = null
    }
    this._spawnProcess()
  }

  // Classify a window info object against the app/site lists in the store.
  // Returns: 'productive' | 'distraction' | 'neutral'
  static classify(windowInfo, store) {
    if (!windowInfo) return 'neutral'

    const { processName, windowTitle } = windowInfo
    const pName = (processName || '').toLowerCase()
    const title = (windowTitle || '').toLowerCase()

    const productiveApps = store.get('productiveApps') || []
    const distractionApps = store.get('distractionApps') || []
    const productiveSites = store.get('productiveSites') || []
    const distractionSites = store.get('distractionSites') || []

    // Site match wins over app match.
    // Match both the full domain ("youtube.com") and the name part ("youtube")
    // because browser titles typically show "Video - YouTube" not "youtube.com".
    for (const site of distractionSites) {
      if (matchSiteInTitle(site, title)) return 'distraction'
    }
    for (const site of productiveSites) {
      if (matchSiteInTitle(site, title)) return 'productive'
    }

    // App match (case-insensitive substring)
    for (const app of distractionApps) {
      if (pName.includes(app.toLowerCase().replace('.exe', ''))) return 'distraction'
    }
    for (const app of productiveApps) {
      if (pName.includes(app.toLowerCase().replace('.exe', ''))) return 'productive'
    }

    return 'neutral'
  }
}

module.exports = WindowMonitor
