const MoodEngine = require('../src/mood-engine')
const WindowMonitor = require('../src/window-monitor')

// Minimal store mock
function makeStore(overrides = {}) {
  const data = {
    productiveApps: ['code.exe'],
    distractionApps: ['discord.exe'],
    productiveSites: ['github.com'],
    distractionSites: ['youtube.com'],
    settings: { activeHoursStart: 0, activeHoursEnd: 23, paused: false },
    ...overrides
  }
  return {
    get: (key) => {
      const parts = key.split('.')
      let v = data
      for (const p of parts) v = v ? v[p] : undefined
      return v
    },
    set: jest.fn()
  }
}

describe('MoodEngine — state transitions', () => {
  let store, engine

  beforeEach(() => {
    jest.useFakeTimers()
    store = makeStore()
    engine = new MoodEngine(store)
    // Distraction/focus reactions only happen during an active work session.
    engine.setSessionState('working')
  })

  afterEach(() => {
    jest.useRealTimers()
    // Clean up timers to prevent open handles
    if (engine._idleTimer) clearInterval(engine._idleTimer)
    if (engine._distractionTimerTick) clearInterval(engine._distractionTimerTick)
  })

  test('starts in encouraging mood', () => {
    expect(engine.getCurrentMood()).toBe('encouraging')
  })

  test('switches to happy on productive app', () => {
    const transitions = []
    engine.on('mood-transition', (s) => transitions.push(s.mood))
    engine.onWindowChanged({ processName: 'Code', windowTitle: 'main.js' })
    expect(engine.getCurrentMood()).toBe('happy')
    expect(transitions).toContain('happy')
  })

  test('switches to sad on distraction app', () => {
    engine.onWindowChanged({ processName: 'Discord', windowTitle: 'Discord' })
    expect(engine.getCurrentMood()).toBe('sad')
  })

  test('escalates from sad to angry after 5 minutes', () => {
    engine.onWindowChanged({ processName: 'Discord', windowTitle: 'Discord' })
    expect(engine.getCurrentMood()).toBe('sad')

    // Fast-forward 5 minutes
    jest.advanceTimersByTime(5 * 60 * 1000 + 1)
    engine._recalculateMood()
    expect(engine.getCurrentMood()).toBe('angry')
  })

  test('auto-escalates sad → angry from the tick (no window change)', () => {
    engine.onWindowChanged({ processName: 'Discord', windowTitle: 'Discord' })
    expect(engine.getCurrentMood()).toBe('sad')

    // Advance past 5 min so the 1s tick recalculates without any window change
    jest.advanceTimersByTime(5 * 60 * 1000 + 1000)
    expect(engine.getCurrentMood()).toBe('angry')
  })

  test('auto-escalates happy → focused from the tick (no window change)', () => {
    engine.onWindowChanged({ processName: 'Code', windowTitle: 'main.js' })
    expect(engine.getCurrentMood()).toBe('happy')

    jest.advanceTimersByTime(10 * 60 * 1000 + 1000)
    expect(engine.getCurrentMood()).toBe('focused')
  })

  test('escalates from happy to focused after 10 minutes', () => {
    engine.onWindowChanged({ processName: 'Code', windowTitle: 'main.js' })
    expect(engine.getCurrentMood()).toBe('happy')

    jest.advanceTimersByTime(10 * 60 * 1000 + 1)
    engine._recalculateMood()
    expect(engine.getCurrentMood()).toBe('focused')
  })

  test('nagging state has highest priority over everything else', () => {
    engine.onWindowChanged({ processName: 'Code', windowTitle: 'main.js' })
    expect(engine.getCurrentMood()).toBe('happy')

    engine.setNagging(true)
    expect(engine.getCurrentMood()).toBe('nagging')
  })

  test('idle session state is always encouraging (no nagging off the clock)', () => {
    engine.setSessionState('idle')
    engine.onWindowChanged({ processName: 'Discord', windowTitle: 'Discord' })
    expect(engine.getCurrentMood()).toBe('encouraging')
  })

  test('break session state stays happy even on a distraction', () => {
    engine.setSessionState('break')
    engine.onWindowChanged({ processName: 'Discord', windowTitle: 'Discord' })
    expect(engine.getCurrentMood()).toBe('happy')
  })

  test('nagging only applies while working, not when idle', () => {
    engine.setNagging(true)
    expect(engine.getCurrentMood()).toBe('nagging')
    engine.setSessionState('idle')
    expect(engine.getCurrentMood()).toBe('encouraging')
  })

  test('returns to encouraging when switching to an unknown/neutral app', () => {
    engine.onWindowChanged({ processName: 'Code', windowTitle: 'main.js' })
    expect(engine.getCurrentMood()).toBe('happy')

    // Switching to an unknown app immediately resets to encouraging
    engine.onWindowChanged({ processName: 'explorer', windowTitle: 'Desktop' })
    expect(engine.getCurrentMood()).toBe('encouraging')
  })

  test('stays encouraging on neutral app after 30s (idle timer is no-op for neutral)', () => {
    engine.onWindowChanged({ processName: 'explorer', windowTitle: 'Desktop' })
    expect(engine.getCurrentMood()).toBe('encouraging')

    jest.advanceTimersByTime(30 * 1000 + 1)
    jest.runOnlyPendingTimers()
    engine._recalculateMood()
    expect(engine.getCurrentMood()).toBe('encouraging')
  })

  test('pause prevents mood change', () => {
    engine.pause()
    engine.onWindowChanged({ processName: 'Discord', windowTitle: 'Discord' })
    expect(engine.getCurrentMood()).toBe('encouraging')
  })

  test('resume allows mood changes again', () => {
    engine.pause()
    engine.resume()
    engine.onWindowChanged({ processName: 'Discord', windowTitle: 'Discord' })
    expect(engine.getCurrentMood()).toBe('sad')
  })

  test('emits distraction-timer events during distraction', () => {
    const times = []
    engine.on('distraction-timer', (s) => times.push(s))
    engine.onWindowChanged({ processName: 'Discord', windowTitle: 'Discord' })
    jest.advanceTimersByTime(3000)
    jest.runOnlyPendingTimers()
    expect(times.length).toBeGreaterThan(0)
  })
})

describe('WindowMonitor.classify — site/app matching', () => {
  function makeClassifyStore(overrides = {}) {
    const data = {
      productiveApps: ['code.exe', 'notion.exe'],
      distractionApps: ['discord.exe'],
      productiveSites: ['github.com'],
      distractionSites: ['youtube.com', 'reddit.com'],
      ...overrides
    }
    return { get: (k) => data[k] }
  }

  const s = makeClassifyStore()

  test('productive app returns productive', () => {
    expect(WindowMonitor.classify({ processName: 'Code', windowTitle: '' }, s)).toBe('productive')
  })

  test('distraction app returns distraction', () => {
    expect(WindowMonitor.classify({ processName: 'Discord', windowTitle: '' }, s)).toBe('distraction')
  })

  test('neutral app returns neutral', () => {
    expect(WindowMonitor.classify({ processName: 'notepad', windowTitle: 'Untitled' }, s)).toBe('neutral')
  })

  test('distraction site domain in title wins over neutral app', () => {
    expect(WindowMonitor.classify({ processName: 'chrome', windowTitle: 'youtube.com - Home' }, s)).toBe('distraction')
  })

  test('productive site domain in title matches', () => {
    expect(WindowMonitor.classify({ processName: 'chrome', windowTitle: 'github.com - pull request' }, s)).toBe('productive')
  })

  test('word boundary prevents "notgithub.com" matching github.com', () => {
    expect(WindowMonitor.classify({ processName: 'chrome', windowTitle: 'notgithub.com' }, s)).toBe('neutral')
  })

  test('null windowInfo returns neutral', () => {
    expect(WindowMonitor.classify(null, s)).toBe('neutral')
  })

  test('distraction site beats productive site (first match wins)', () => {
    expect(WindowMonitor.classify({ processName: 'chrome', windowTitle: 'youtube.com - github.com' }, s)).toBe('distraction')
  })
})
