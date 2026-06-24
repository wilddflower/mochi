const SessionTracker = require('../src/session-tracker')

// Session tracker imports powerMonitor from electron — the mock handles that.
// We also need a stub MoodEngine (it only receives events from the engine; in tests
// we call onMoodChange directly).

function makeStore() {
  let stats = {}
  const today = new Date().toISOString().slice(0, 10)
  stats[today] = { focusMinutes: 0, distractionMinutes: 0, longestStreak: 0, currentStreak: 0 }

  return {
    _stats: stats,
    get: (key) => {
      if (key === 'stats') return stats
    },
    getTodayStats: () => {
      const k = new Date().toISOString().slice(0, 10)
      if (!stats[k]) stats[k] = { focusMinutes: 0, distractionMinutes: 0, longestStreak: 0, currentStreak: 0 }
      return stats[k]
    },
    setTodayStats: (data) => {
      const k = new Date().toISOString().slice(0, 10)
      stats[k] = { ...stats[k], ...data }
    }
  }
}

describe('SessionTracker — stats accumulation', () => {
  let store, tracker

  beforeEach(() => {
    jest.useFakeTimers()
    store = makeStore()
    tracker = new SessionTracker(store, {})
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  test('getTodayStats returns defaults on first call', () => {
    const stats = tracker.getTodayStats()
    expect(stats.focusMinutes).toBe(0)
    expect(stats.distractionMinutes).toBe(0)
  })

  test('focus time accumulates when mood was happy', () => {
    tracker._currentMood = 'happy'
    // Simulate 10 minutes passing
    tracker._moodStartTime = Date.now() - 10 * 60 * 1000
    tracker.onMoodChange('encouraging')
    const stats = tracker.getTodayStats()
    expect(stats.focusMinutes).toBeGreaterThan(9)
  })

  test('distraction time accumulates when mood was sad', () => {
    tracker._currentMood = 'sad'
    tracker._moodStartTime = Date.now() - 5 * 60 * 1000
    tracker.onMoodChange('encouraging')
    const stats = tracker.getTodayStats()
    expect(stats.distractionMinutes).toBeGreaterThan(4)
  })

  test('streak resets when entering distraction', () => {
    tracker._currentMood = 'happy'
    tracker._moodStartTime = Date.now() - 15 * 60 * 1000
    tracker.onMoodChange('sad')
    const stats = tracker.getTodayStats()
    expect(stats.currentStreak).toBe(0)
  })

  test('longest streak updates correctly', () => {
    tracker._currentMood = 'focused'
    tracker._moodStartTime = Date.now() - 20 * 60 * 1000
    tracker.onMoodChange('happy')
    const stats = tracker.getTodayStats()
    expect(stats.longestStreak).toBeGreaterThanOrEqual(stats.currentStreak)
  })

  test('checkDateRollover does not reset on same day', () => {
    store.setTodayStats({ focusMinutes: 30 })
    tracker.checkDateRollover()
    expect(tracker.getTodayStats().focusMinutes).toBe(30)
  })
})
