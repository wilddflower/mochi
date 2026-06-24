# Mochi — Implementation Plan

<!-- /autoplan restore point: /c/Users/Pavni/.gstack/projects/wilddflower-moch/HEAD-autoplan-restore-20260624-005635.md -->

## Overview

Build Mochi: a personal Windows desktop focus companion. A pixel-art white bunny (Mochi) lives as a transparent, always-on-top overlay. She monitors your active window, reacts to productive vs. distraction apps, guilt-trips you when slacking, tracks tasks with deadlines, and drops motivational quotes.

**User:** Solo personal tool (Pavni only). No accounts, no cloud, no onboarding. All data local.

**Stack:** Electron + Vanilla HTML/CSS/JS + electron-store + PowerShell (window detection)

---

## Premises

1. Electron is the right choice for a personal Windows desktop pet — no need for native Win32 APIs beyond what PowerShell can expose.
2. Pixel art character style is correct — low-res characters read as cute and expressive, not try-hard.
3. PowerShell polling every 2.5s (persistent process, not new spawn) is sufficient for window detection.
4. electron-store (JSON on disk) is enough persistence for a solo personal tool.
5. No hard blocking — soft emotional pressure from a character you care about is the core product mechanism.
6. No cloud, no accounts, no onboarding — this is a personal tool.
7. Auto-session (no manual start/stop) reduces friction to zero.

---

## Feature Scope

### In Scope (v1)

1. **Pet overlay window** — transparent, frameless, always-on-top, draggable, 120×120px default, resizable
2. **Active window monitoring** — persistent PowerShell process polled every 2.5s, returns process name + window title
3. **Mood state machine** — 7 states with priority rules
4. **App & website list config** — productive/distraction/neutral matching by process name and window title
5. **Soft blocking (guilt trip mode)** — distraction timer overlay, mood escalation at 5 min
6. **Auto-session tracking** — focus time / distraction time / current streak, daily reset at midnight
7. **Motivational quote system** — ~50 quotes in speech bubble, triggered on milestones/returns/streaks
8. **System tray** — tray icon, right-click menu (Dashboard / Pause / Quit)
9. **Task system** — add tasks with duration estimates, deadlines computed at creation, nagging on overdue, celebration on complete
10. **Settings dashboard** — manage app lists, site lists, tasks, stats, quotes
11. **Character click interaction** — clicking Mochi opens a mini pet menu (Dashboard / Pause / Task quick-add)
12. **Windows startup** — auto-launch on login via `electron-auto-launch` package

### NOT In Scope (v1)

- Hard website blocking (hosts file modification) — out of scope by product decision, not an oversight
- Break/pomodoro timer — separate product category, deferred
- Sound effects — explicitly excluded from PRD; deferred to v2
- Cloud sync or multi-device — solo personal tool, intentionally excluded
- Custom character skins — deferred to v2
- Streak history beyond today — deferred; requires history UI not worth the effort now
- Browser extension for direct URL detection — deferred to TODOS.md; window title matching is sufficient for personal use
- Multi-monitor position persistence — edge case; TODOS.md

---

## Architecture

### Process Structure

```
Electron Main Process (main.js)
├── window-manager.js      — creates/manages overlay + dashboard windows
├── tray.js               — system tray icon + context menu
├── window-monitor.js     — persistent PowerShell process, stdin/stdout, emits foreground-changed
├── mood-engine.js        — state machine: tracks mood, timers, transitions, priority rules
├── session-tracker.js    — focus/distraction time accumulation, streak logic, midnight reset
├── task-manager.js       — task CRUD, deadline tracking (absolute timestamps), overdue detection
├── quote-engine.js       — quote pool, trigger logic, selection (avoid repeats)
├── auto-launch.js        — Windows startup via electron-auto-launch
└── store.js              — electron-store wrapper with schema defaults

Overlay Renderer (pet-overlay/index.html)
├── preload.js            — contextBridge: exposes only allowed IPC channels
├── mochi-renderer.js     — spritesheet animation by mood state
├── speech-bubble.js      — renders quote/nagging/milestone bubbles above character
├── distraction-timer.js  — counter shown below speech bubble during distraction
└── task-badge.js         — small badge (top-right) showing overdue task count

Dashboard Renderer (dashboard/index.html)
├── preload.js            — contextBridge: exposes only allowed IPC channels
└── tabs: App Lists | Site Lists | Tasks | Stats | Quotes
     └── Communicates with main via ipcRenderer/ipcMain (contextBridge only)
```

### System Architecture Diagram

```
  ┌─────────────────────────────────────────────────────────────┐
  │                    ELECTRON MAIN PROCESS                    │
  │                                                             │
  │  ┌─────────────┐   ┌───────────────┐   ┌────────────────┐ │
  │  │   window-   │   │  mood-engine  │   │ session-tracker│ │
  │  │  monitor.js │──▶│    .js        │──▶│     .js        │ │
  │  │(PS process) │   │(state machine)│   │(focus/distract)│ │
  │  └─────────────┘   └──────┬────────┘   └────────────────┘ │
  │                           │                                 │
  │  ┌─────────────┐   ┌──────▼────────┐   ┌────────────────┐ │
  │  │task-manager │   │  quote-engine │   │    store.js    │ │
  │  │    .js      │──▶│     .js       │   │(electron-store)│ │
  │  └─────────────┘   └──────┬────────┘   └────────────────┘ │
  │                           │                                 │
  └───────────────────────────┼─────────────────────────────────┘
                              │ IPC (contextBridge)
              ┌───────────────┼──────────────────┐
              ▼                                  ▼
  ┌───────────────────────┐        ┌─────────────────────────┐
  │   OVERLAY WINDOW      │        │   DASHBOARD WINDOW      │
  │   (always-on-top)     │        │   (on-demand)           │
  │                       │        │                         │
  │  ┌─────────────────┐  │        │  App Lists | Site Lists │
  │  │ Mochi character │  │        │  Tasks | Stats | Quotes │
  │  │  (spritesheet)  │  │        │                         │
  │  └─────────────────┘  │        └─────────────────────────┘
  │  ┌─────────────────┐  │
  │  │ Speech bubble   │  │
  │  └─────────────────┘  │
  │  ┌─────────────────┐  │
  │  │Distraction timer│  │
  │  └─────────────────┘  │
  └───────────────────────┘
```

### IPC Message Flow

```
Main → Overlay:    mood-changed(state, mood)
                   quote-show(text)
                   task-nagging(taskName)
                   distraction-timer-update(seconds)
                   character-pet(reaction)  [on click response]

Overlay → Main:    drag-position-update(x, y)
                   character-clicked()
                   task-badge-clicked()

Main → Dashboard:  stats-update(dayStats)
                   tasks-update(tasks[])

Dashboard → Main:  add-task(name, durationMinutes)
                   complete-task(id)
                   dismiss-task(id)
                   update-productive-apps(list)
                   update-distraction-apps(list)
                   update-productive-sites(list)
                   update-distraction-sites(list)
                   update-quotes(list)
```

### Data Model (electron-store)

```json
{
  "productiveApps": ["code.exe", "notion.exe"],
  "distractionApps": ["discord.exe"],
  "productiveSites": ["github.com", "docs.google.com"],
  "distractionSites": ["youtube.com", "twitter.com", "reddit.com"],
  "quotes": ["you got this!", "lock in.", "back on track, let's go", "10 min streak!"],
  "tasks": [
    {
      "id": 1750726800000,
      "name": "Finish essay",
      "durationMinutes": 120,
      "deadlineAt": "2026-06-24T04:30:00.000Z",
      "createdAt": "2026-06-24T02:30:00.000Z",
      "done": false
    }
  ],
  "settings": {
    "activeHoursStart": 9,
    "activeHoursEnd": 22,
    "overlayX": 100,
    "overlayY": 100,
    "overlaySize": 120,
    "paused": false
  },
  "stats": {
    "2026-06-24": {
      "focusMinutes": 0,
      "distractionMinutes": 0,
      "longestStreak": 0,
      "currentStreak": 0
    }
  }
}
```

**Data model notes:**
- `tasks[].id` uses `Date.now()` (milliseconds timestamp), not sequential integer — avoids collision on restart
- `tasks[].deadlineAt` is an ISO timestamp computed at creation time as `createdAt + durationMinutes * 60000`. This is what the nagging system checks against. A relative `deadlineMs` field would break across app restarts.
- `stats` keys are ISO date strings (YYYY-MM-DD). Only today's entry is active; history is kept for reference but not displayed.

---

## Mood State Machine

| State | Trigger | Duration/Condition | Animation |
|---|---|---|---|
| Happy | Productive app active | While on productive | Bounce, smile, sparkles |
| Focused | 10+ min uninterrupted productive | Sustained | Intense face, glow aura |
| Encouraging | Idle (no window change for 30s, no classification) | While idle | Wave, motivational bubble |
| Sad | Distraction app/site | First 5 min | Droopy, frown, slump |
| Angry | 5+ min on distraction | Escalation | Steam, red tint, scowl |
| Nagging | Any task is overdue | While overdue tasks exist | Arms crossed, tapping foot |
| Sleeping | Outside active hours (activeHoursStart/End) | Time-based | Zzz animation |

**Priority (highest → lowest):** Nagging > Sleeping > Angry > Sad > Focused > Happy > Encouraging

**"Idle" definition:** No foreground window classification change for 30+ seconds. This covers: desktop, unknown apps, locked screen, or when Mochi is paused.

### State Machine Diagram

```
  ┌──────────────────────────────────────────────────────────────────┐
  │                    MOOD STATE MACHINE                            │
  │                                                                  │
  │  ENCOURAGING ──── productive app ──▶ HAPPY                      │
  │      ▲                                  │                        │
  │    idle/start                      10+ min uninterrupted         │
  │      │                                  ▼                        │
  │  ◀── any                           FOCUSED                       │
  │                                                                  │
  │  HAPPY/FOCUSED ── distraction ──▶ SAD ── 5+ min ──▶ ANGRY       │
  │                                    │                    │        │
  │                              back to productive    back to prod  │
  │                                    └────────────────────┘        │
  │                                         ▼                        │
  │                                     HAPPY/FOCUSED                │
  │                                                                  │
  │  ANY ── overdue task exists ──▶ NAGGING (highest priority)      │
  │  ANY ── outside active hours ──▶ SLEEPING (2nd priority)        │
  └──────────────────────────────────────────────────────────────────┘
```

---

## Sprite Art Pipeline

**Status:** Pavni has a reference image (pixel-art bunny). Will drop in when coding starts.

**Approach:** Animate from reference image. The reference image defines Mochi's appearance — the task is creating animated variations.

**Specs:**
- Each sprite: **32×32 pixels** logical size. CSS scales to display size using `image-rendering: pixelated`.
- Format: **PNG spritesheet** — one file per mood state, frames laid out horizontally.
- Frames per state: **4–6 frames** at ~150ms per frame = natural-feeling loop.
- Tool: **Aseprite** (preferred, $20, industry standard) or **Piskel** (free, browser-based).
- Tray icon: 16×16 PNG derived from the reference image base pose.

**Mood states to animate (7 total):**

| State | Frames | Key Visual |
|---|---|---|
| Happy | 6 | Small bounce up-down, sparkles on frame 3+4 |
| Focused | 4 | Minimal movement, faint glow pulse on edges |
| Encouraging | 6 | Arm wave (alternating frames), wide eyes |
| Sad | 4 | Slow slump downward, droopy eyes |
| Angry | 6 | Steam puff (top), slight horizontal shake |
| Nagging | 6 | Foot tap (alternating), arms folded |
| Sleeping | 4 | Zzz bubble floats up, eyes closed |

**Development placeholder:** During Phase 1–2, use a colored square (`#FFB6C1` light pink, 32×32) as a placeholder sprite so the window management and mood engine can be built before art is ready. The renderer code should be art-agnostic — just swap in the spritesheet when it's ready.

---

## Active Window Detection

**Implementation:** Keep a single persistent PowerShell process open (stdin/stdout), send a poll command every 2500ms. Do NOT spawn a new process each poll — that adds ~200ms overhead and creates process churn.

```javascript
// window-monitor.js
const { spawn } = require('child_process')

const ps = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '-'])

// Write the detection function once at startup
ps.stdin.write(`
function Get-ForegroundWindowInfo {
  Add-Type @"
    using System;
    using System.Runtime.InteropServices;
    public class Win32 {
      [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
      [DllImport("user32.dll")] public static extern int GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
    }
"@
  $hwnd = [Win32]::GetForegroundWindow()
  $pid = 0
  [Win32]::GetWindowThreadProcessId($hwnd, [ref]$pid) | Out-Null
  $proc = Get-Process -Id $pid -ErrorAction SilentlyContinue
  if ($proc) {
    [PSCustomObject]@{ ProcessName = $proc.ProcessName; WindowTitle = $proc.MainWindowTitle } | ConvertTo-Json -Compress
  } else {
    "null"
  }
}
`)

// Poll by writing the function call
setInterval(() => {
  ps.stdin.write('Get-ForegroundWindowInfo\n')
}, 2500)
```

**Matching logic:**
- **Apps:** `processName.toLowerCase().includes(entry.toLowerCase())` — e.g., "code" matches "Code.exe"
- **Sites:** window title word-boundary check. Use `\b${site}\b` regex, not plain `.includes()`, to avoid "notgithub.com" matching "github.com"
- **Priority:** Site match wins over app match. If Chrome is neutral but tab title contains "youtube.com", distraction wins.
- **Null/unknown:** If `GetForegroundWindow` returns null (desktop, lock screen), treat as neutral — no mood change.

---

## Character Overlay Window

### Layout

```
  ┌────────────────────────┐  ← transparent, frameless, 160×200px
  │                        │
  │  ┌──────────────────┐  │  ← speech bubble (shown when quoting/nagging)
  │  │ "you got this!"  │  │    width: auto, max 140px, pixel-art border
  │  └──────┬───────────┘  │
  │         ▲              │
  │  ┌──────┴───────────┐  │  ← Mochi sprite (120×120px display, 32×32 native)
  │  │   [mochi.png]    │  │    image-rendering: pixelated
  │  └──────────────────┘  │
  │  ┌──────────────────┐  │  ← distraction timer (only during distraction states)
  │  │  ⏱ 3:42 wasted  │  │
  │  └──────────────────┘  │
  │  ┌──┐                  │  ← overdue task badge (top-right corner)
  │  │2!│                  │    only shown when tasks overdue
  │  └──┘                  │
  └────────────────────────┘
```

### Click-through + Dragging

Electron's `setIgnoreMouseEvents(true, { forward: true })` makes the transparent areas click-through. The character region must be explicitly excluded.

```javascript
// In overlay renderer: track mouse to toggle ignore-mouse-events
document.addEventListener('mousemove', (e) => {
  const isOverCharacter = isPointInCharacterBounds(e.clientX, e.clientY)
  ipcRenderer.send('set-ignore-mouse-events', !isOverCharacter)
})
```

### Character Click Interaction

Clicking Mochi (anywhere on the character sprite) opens a small pet menu:
```
  ┌────────────────────┐
  │  📋 Dashboard      │
  │  ⏸ Pause / Resume │
  │  ✅ Quick Task     │
  └────────────────────┘
```
This prevents confusion about what clicking the character does, and gives quick access to common actions without opening the full dashboard.

---

## Windows Startup

Use the `electron-auto-launch` npm package. It writes a Registry entry at `HKCU\SOFTWARE\Microsoft\Windows\CurrentVersion\Run`.

```javascript
// auto-launch.js
const AutoLaunch = require('electron-auto-launch')
const mochiAutoLauncher = new AutoLaunch({ name: 'Mochi' })

// Called on first launch or from settings dashboard
async function enableStartup() {
  const isEnabled = await mochiAutoLauncher.isEnabled()
  if (!isEnabled) await mochiAutoLauncher.enable()
}
```

Add a toggle to the Settings dashboard so Pavni can disable it. Default: enabled on first launch.

---

## IPC Security

Use `contextBridge` in preload scripts — do NOT use `nodeIntegration: true` in renderer windows. This prevents renderer code from accessing Node.js APIs directly (which is a security risk even in personal apps, since any XSS in the renderer would have full file system access).

```javascript
// preload.js (shared by both overlay and dashboard)
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('mochi', {
  // Overlay API
  onMoodChanged: (cb) => ipcRenderer.on('mood-changed', (_, data) => cb(data)),
  onQuoteShow: (cb) => ipcRenderer.on('quote-show', (_, text) => cb(text)),
  onDistractionTimer: (cb) => ipcRenderer.on('distraction-timer-update', (_, s) => cb(s)),
  sendCharacterClicked: () => ipcRenderer.send('character-clicked'),
  setIgnoreMouseEvents: (ignore) => ipcRenderer.send('set-ignore-mouse-events', ignore),
  // Dashboard API  
  addTask: (name, durationMinutes) => ipcRenderer.invoke('add-task', { name, durationMinutes }),
  completeTask: (id) => ipcRenderer.invoke('complete-task', id),
  updateLists: (lists) => ipcRenderer.invoke('update-lists', lists),
  getStats: () => ipcRenderer.invoke('get-stats'),
})
```

---

## Daily Reset Logic

Stats reset daily at midnight. Three triggers (all three needed to cover edge cases):

1. **On app launch:** Check if last session date != today → reset today's stats, write new date entry
2. **`setInterval` at runtime:** Check `new Date().toISOString().slice(0,10)` every 60s. If date changed → reset
3. **After sleep/wake:** Listen for `powerMonitor.on('resume')` → re-check date

```javascript
// session-tracker.js
const { powerMonitor } = require('electron')

let currentDate = new Date().toISOString().slice(0, 10)

function checkDateRollover() {
  const today = new Date().toISOString().slice(0, 10)
  if (today !== currentDate) {
    currentDate = today
    resetDailyStats()
  }
}

setInterval(checkDateRollover, 60_000)
powerMonitor.on('resume', checkDateRollover)
```

---

## Error & Rescue Map

| Codepath | What Can Go Wrong | Error | Rescued? | Rescue Action | User Sees |
|---|---|---|---|---|---|
| window-monitor.js | PowerShell process crashes | Process exit | ✅ | `ps.on('exit', restart)` — respawn after 1s delay | Nothing (transparent restart) |
| window-monitor.js | PS returns null/empty | Parse error | ✅ | Treat as neutral, log warning | No mood change |
| window-monitor.js | PS hangs, no output | Timeout | ✅ | Kill + restart process if no output for 10s | Nothing |
| store.js | electron-store schema corrupt | Parse error | ✅ | Reset to defaults, log error | App works with defaults |
| task-manager.js | Clock skew / invalid date | Invalid Date | ✅ | `isNaN(date)` check, skip the task | No nagging for bad task |
| window-manager.js | Overlay window crashes | Renderer crash | ✅ | `webContents.on('crashed')` → recreate window | Brief flicker, then back |
| auto-launch.js | Registry write fails (permissions) | OS error | ✅ | Log error, inform user in settings | "Startup not enabled" message in settings |

**CRITICAL GAP from original plan:** The PowerShell crash case was identified in risks but no restart logic was specified. Added above.

---

## Failure Modes Registry

| Codepath | Failure Mode | Rescued? | Tested? | User Sees | Logged? |
|---|---|---|---|---|---|
| PS process | Crash | ✅ | Unit | Nothing | Yes |
| PS output | Null window (desktop) | ✅ | Unit | No mood change | No (too noisy) |
| electron-store | Corrupt JSON | ✅ | Unit | Defaults loaded | Yes |
| mood-engine | No active hours config | ✅ | Unit | Defaults to 9-22 | No |
| task-manager | Task with past deadline on load | ✅ | Unit | Immediate nagging | No |
| overlay window | Renderer crash | ✅ | Manual | Brief gap | Yes |
| daily reset | App closed at midnight | ✅ | Unit (launch check) | Correct reset on next open | No |

No CRITICAL GAPS (RESCUED=N, TEST=N, USER SEES=Silent).

---

## Security Assessment

This is a local-only personal app. Attack surface is minimal:

- **No network requests** — no CORS, no CSRF, no data exfiltration surface
- **PowerShell command** — no user input injected into the command; it's a fixed function call
- **electron-store data** — local JSON; no sanitization needed beyond schema defaults
- **IPC** — use contextBridge (not nodeIntegration:true); renderer can't access Node.js directly
- **electron-auto-launch** — writes to `HKCU` registry (no UAC required), not `HKLM`
- **Dependency risk** — audit: `electron`, `electron-store`, `electron-auto-launch` — all mainstream, well-maintained packages

No high-severity security issues. contextBridge is the one non-negotiable security requirement.

---

## Performance Assessment

- **PowerShell polling:** ~0% CPU at steady state with persistent process. The `Add-Type` call (C# compilation) happens once at startup, ~200ms penalty on first poll.
- **Sprite animation:** CSS `will-change: transform` on the character element. GPU-composited, ~0% CPU.
- **electron-store reads:** Synchronous, <1ms for the data sizes here. Fine.
- **IPC:** `webContents.send()` is asynchronous, near-zero overhead at 2.5s interval.
- **Target:** <2% CPU at idle, <100MB RAM. Achievable with this stack.

No N+1 queries, no heavy data structures, no performance risks for a personal tool.

---

## Observability

For a personal tool, `console.log` to DevTools is sufficient. Key events to log:

```javascript
// Log these (structured, not raw strings):
logger.info('mood:transition', { from: prevMood, to: newMood, trigger: windowInfo })
logger.info('window:detected', { process: name, title, classification })
logger.info('task:overdue', { id, name, overdueBy: seconds })
logger.info('task:complete', { id, name })
logger.error('ps:crash', { restartCount })
logger.error('store:corrupt', { error: e.message })
```

Open DevTools via `Ctrl+Shift+I` on the overlay or dashboard window (dev only — disable in production build).

---

## Deployment / Distribution

This is a personal app run locally. No CI/CD needed. Options:
- **Dev:** `npm start` / `electron .`
- **Package:** `electron-builder` → produces an NSIS installer or portable `.exe`
- **Windows startup:** `electron-auto-launch` (enabled by default, toggle in settings)

No staging environment, no rollback needed. If something breaks, `git checkout` and rerun.

---

## Implementation Phases

### Phase 1: Scaffold + Core Infrastructure (Day 1)
- `package.json` with Electron 28+, electron-store, electron-auto-launch
- `main.js` entry point with app lifecycle
- window-manager.js: overlay window (transparent, frameless, always-on-top, 160×200px)
- window-manager.js: dashboard window (standard, 600×500px, hidden by default)
- System tray with menu (Dashboard / Pause / Quit)
- store.js: electron-store with schema defaults
- preload.js for both windows (contextBridge)
- **Placeholder sprite:** pink 32×32 square so overlay shows something
- electron-auto-launch wired on first run

### Phase 2: Window Monitoring + Mood Engine (Day 2)
- window-monitor.js: persistent PowerShell process, stdin/stdout polling
- App/site matching logic (word-boundary regex for sites)
- mood-engine.js: full state machine with priority rules
- Idle detection (30s no-change = Encouraging)
- IPC: main → overlay `mood-changed` events
- PowerShell crash detection + auto-restart

### Phase 3: Character Rendering + Animations (Day 3)
- mochi-renderer.js: spritesheet animation system
- Drop in actual Mochi sprites (from reference image)
- speech-bubble.js: pixel-art bubble above character
- distraction-timer.js: elapsed time counter during distraction states
- task-badge.js: overdue count badge (top-right)
- Character click → pet menu

### Phase 4: Task System + Nagging (Day 4)
- task-manager.js: CRUD with `deadlineAt` (absolute ISO timestamp)
- Overdue detection: `Date.now() > task.deadlineAt`
- Nagging state integration + escalation over time
- Task UI in dashboard (add form, task list, check/dismiss)
- Celebration on task complete (happy bounce + quote)

### Phase 5: Quote System + Session Tracking (Day 5)
- quote-engine.js: pool of ~50 quotes, trigger system
- Triggers: session start, 15-min focus milestone, return from distraction, 20-min streak random
- speech-bubble.js: auto-dismiss after 4s
- session-tracker.js: focus/distraction accumulation, streak calculation
- Daily reset logic (launch check + interval + powerMonitor.resume)

### Phase 6: Settings Dashboard + Polish (Day 6)
- Full dashboard: App Lists + Site Lists + Tasks + Stats + Quotes tabs
- Empty states for all tabs (first-run guidance)
- Stats tab: today's focus time, distraction time, streak
- Quote management: add/remove
- App/site list add/remove with live validation

---

## What Already Exists (External Dependencies)

| Sub-problem | Solution | Source |
|---|---|---|
| App state persistence | electron-store | npm package |
| Windows startup | electron-auto-launch | npm package |
| Window detection | Windows user32.dll via PowerShell | OS + child_process |
| Transparent overlay | Electron BrowserWindow | Electron built-in |
| Always-on-top | BrowserWindow.setAlwaysOnTop | Electron built-in |
| System tray | Electron Tray | Electron built-in |
| Sleep/wake events | electron powerMonitor | Electron built-in |

No existing in-repo code to leverage (new project).

---

## Dream State Delta

```
CURRENT STATE          THIS PLAN (v1)              12-MONTH IDEAL
                                                    
Empty directory  →     Working Mochi v1:        →  Mochi v2:
                        - 7 mood states              - Sound effects
                        - Window monitoring          - 20+ animated states  
                        - Task system                - Seasonal costumes
                        - Quote system               - Stats history + graphs
                        - System tray                - Possible mobile companion
                        - Settings dashboard         - Shared accountability
                        - Windows startup               with friends
```

This plan delivers ~65% of the 12-month ideal. The gap is mostly polish features correctly excluded from v1.

---

## Test Plan

### Unit Tests (Jest)
- `mood-engine.test.js`: all 7 state transitions, priority rules, idle detection
- `window-monitor.test.js`: matching logic (app, site, word-boundary, null cases, priority)
- `session-tracker.test.js`: focus time accumulation, midnight reset, streak logic
- `task-manager.test.js`: deadline creation (`createdAt + duration = deadlineAt`), overdue detection, ID collision avoidance

### Integration Tests
- IPC round-trip: `mood-changed` event flows main → overlay
- electron-store read/write: defaults load, schema validates

### Manual Tests
- Drag overlay on screen; verify position persists across restarts
- Switch to productive app → verify mood changes to Happy within 3s
- Stay on productive app for 10+ min → verify Focused state
- Open YouTube → verify Sad, then Angry after 5 min
- Add task, let deadline pass → verify Nagging
- Check task done → verify celebration
- Set active hours in past → verify Sleeping
- Kill and restart app → verify all data persisted

---

## Deferred to TODOS.md

1. **Browser extension for URL detection** — Window title matching is brittle for sites; a Chrome/Edge extension could provide direct URL. P2, MEDIUM effort.
2. **Multi-monitor overlay position** — Currently overlay saves position but doesn't remember which monitor. P3, SMALL effort.
3. **Sound effects** — Audio feedback on mood transitions and task completion. P2, SMALL effort.
4. **Streak history visualization** — Keep N days of stats history and show a simple calendar heatmap. P2, MEDIUM effort.
5. **Auto-import running apps** — When adding to app lists, offer to show currently running processes as suggestions. P2, SMALL effort.

---

## Decision Audit Trail

| # | Phase | Decision | Classification | Principle | Rationale | Rejected |
|---|-------|----------|----------------|-----------|-----------|---------|
| 1 | CEO | Mode: SELECTIVE EXPANSION | Mechanical | P6 (bias to action) | Greenfield app, full expansion appropriate | HOLD SCOPE |
| 2 | CEO | Electron + Vanilla JS approach | Mechanical | P5 (explicit over clever) | Solo tool, no build step, easier debug | React/Vue, Tauri |
| 3 | CEO | Add sprite pipeline section | Mechanical | P1 (completeness) | Sprites ARE the product; gap would block implementation | Leave as 1-liner risk |
| 4 | CEO | Fix task data model: deadlineAt (absolute) | Mechanical | P5 (explicit) | Relative deadlineMs breaks across restarts | Keep deadlineMs |
| 5 | CEO | Add character click interaction | Mechanical | P1 (completeness) | Click behavior unspecified = implementation ambiguity | Leave undefined |
| 6 | CEO | Make Windows startup concrete (electron-auto-launch) | Mechanical | P5 (explicit) | "Registry or Squirrel" is not actionable | Keep vague |
| 7 | CEO | Use contextBridge/preload, not nodeIntegration | Mechanical | P5 (explicit) | Security best practice even for personal apps | nodeIntegration: true |
| 8 | CEO | Daily reset: 3-trigger strategy | Mechanical | P1 (completeness) | 1 trigger misses midnight-during-sleep edge case | Single setInterval |
| 9 | CEO | Task IDs: Date.now() not sequential | Mechanical | P5 (explicit) | Sequential IDs collide after restart | Sequential int |
| 10 | CEO | "Idle" = 30s no foreground change | Mechanical | P5 (explicit) | Vague "idle" definition blocks mood-engine implementation | Leave undefined |
| 11 | Eng | Persistent PS process (stdin/stdout) | Mechanical | P3 (pragmatic) | Spawn-per-poll adds 200ms + process churn | New spawn each poll |
| 12 | Eng | Word-boundary regex for site matching | Mechanical | P3 (pragmatic) | .includes() causes false positives (notgithub.com) | String .includes() |
| 13 | Eng | Add PowerShell crash auto-restart | Mechanical | P1 (completeness) | Silent crash = no mood detection forever | Log and ignore |
| 14 | Design | Speech bubble above character | Mechanical | P5 (explicit) | Most natural position, doesn't obstruct character | Below |
| 15 | Design | Overlay size 160×200px (not 120×120) | Mechanical | P1 (completeness) | Need space for speech bubble + distraction timer | 120×120 |
| 16 | Design | Placeholder sprite during dev | Mechanical | P6 (bias to action) | Enables coding window/mood system before sprites ready | Block on sprites |

---

## Success Criteria

- Character visible on screen, non-intrusive
- Mood changes within 3s of switching apps
- Guilt trip actually makes you feel bad enough to switch back
- Runs quietly (<2% CPU at idle, <100MB RAM)
- All data persists across restarts
- App launches at Windows startup by default

---

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 1 | issues_open (resolved) | 16 decisions, 0 critical gaps, SELECTIVE EXPANSION |
| Codex Review | `/codex review` | Independent 2nd opinion | 0 | — | — |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | clean | 6 issues, 0 critical gaps, architecture + error map added |
| Design Review | `/plan-design-review` | UI/UX gaps | 1 | clean | Overlay layout specified, click interaction added, 2 decisions |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | N/A | Skipped — consumer app, not developer-facing |

**VERDICT:** CEO + ENG + DESIGN CLEARED — ready to implement.
