const WindowMonitor = require('../src/window-monitor')

// WindowMonitor.classify is a pure static function — no spawning needed.
// The spawn tests are covered by mood-engine integration tests.

function makeStore(overrides = {}) {
  const data = {
    productiveApps: ['code.exe', 'notion.exe'],
    distractionApps: ['discord.exe'],
    productiveSites: ['github.com', 'stackoverflow.com'],
    distractionSites: ['youtube.com', 'reddit.com', 'twitter.com'],
    ...overrides
  }
  return { get: (k) => data[k] }
}

describe('WindowMonitor.classify — comprehensive matching', () => {
  const s = makeStore()

  describe('null / empty input', () => {
    test('null windowInfo → neutral', () => {
      expect(WindowMonitor.classify(null, s)).toBe('neutral')
    })
    test('undefined processName → handles gracefully', () => {
      expect(WindowMonitor.classify({ processName: undefined, windowTitle: '' }, s)).toBe('neutral')
    })
    test('empty strings → neutral', () => {
      expect(WindowMonitor.classify({ processName: '', windowTitle: '' }, s)).toBe('neutral')
    })
  })

  describe('app matching', () => {
    test('case-insensitive productive app match', () => {
      expect(WindowMonitor.classify({ processName: 'Code', windowTitle: '' }, s)).toBe('productive')
      expect(WindowMonitor.classify({ processName: 'CODE', windowTitle: '' }, s)).toBe('productive')
      expect(WindowMonitor.classify({ processName: 'code', windowTitle: '' }, s)).toBe('productive')
    })

    test('partial process name match works (code matches code.exe entry)', () => {
      expect(WindowMonitor.classify({ processName: 'code', windowTitle: '' }, s)).toBe('productive')
    })

    test('distraction app match', () => {
      expect(WindowMonitor.classify({ processName: 'Discord', windowTitle: '' }, s)).toBe('distraction')
      expect(WindowMonitor.classify({ processName: 'discord', windowTitle: '' }, s)).toBe('distraction')
    })

    test('unknown app → neutral', () => {
      expect(WindowMonitor.classify({ processName: 'explorer', windowTitle: '' }, s)).toBe('neutral')
      expect(WindowMonitor.classify({ processName: 'notepad', windowTitle: '' }, s)).toBe('neutral')
    })
  })

  describe('site matching (word boundary)', () => {
    test('productive site in title → productive', () => {
      expect(WindowMonitor.classify({ processName: 'chrome', windowTitle: 'github.com - Microsoft' }, s)).toBe('productive')
    })

    test('distraction site domain in title → distraction', () => {
      expect(WindowMonitor.classify({ processName: 'chrome', windowTitle: 'youtube.com - Home' }, s)).toBe('distraction')
      expect(WindowMonitor.classify({ processName: 'chrome', windowTitle: 'reddit.com - front page' }, s)).toBe('distraction')
    })

    test('word boundary prevents false positive: notgithub.com does NOT match github.com', () => {
      expect(WindowMonitor.classify({ processName: 'chrome', windowTitle: 'notgithub.com' }, s)).toBe('neutral')
    })

    test('word boundary prevents false positive: myyoutube.com does NOT match youtube.com', () => {
      expect(WindowMonitor.classify({ processName: 'chrome', windowTitle: 'myyoutube.com' }, s)).toBe('neutral')
    })

    test('site match takes priority over app match', () => {
      // chrome is neutral app, but youtube.com domain in title → distraction
      expect(WindowMonitor.classify({ processName: 'chrome', windowTitle: 'youtube.com - Home' }, s)).toBe('distraction')
    })

    test('distraction site beats productive site when both present', () => {
      // First distraction match wins
      expect(WindowMonitor.classify({ processName: 'chrome', windowTitle: 'youtube.com and github.com' }, s)).toBe('distraction')
    })
  })

  describe('edge cases', () => {
    test('regex special chars in site names are escaped', () => {
      const sSpecial = makeStore({ distractionSites: ['site.com/path?q=1'] })
      // Should not throw
      expect(() => WindowMonitor.classify({ processName: 'chrome', windowTitle: 'site.com/path?q=1' }, sSpecial)).not.toThrow()
    })
  })
})
