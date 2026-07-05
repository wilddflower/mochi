const SessionManager = require('../src/session-manager')

function makeStore() {
  const data = {}
  return {
    get: (k) => data[k],
    set: (k, v) => { data[k] = v },
    getTodayKey: () => '2026-07-05'
  }
}

describe('SessionManager — locked sessions', () => {
  let sm, now, realNow

  beforeEach(() => {
    realNow = Date.now
    now = 1_000_000
    Date.now = () => now
    sm = new SessionManager(makeStore())
  })

  afterEach(() => {
    sm.stop()
    Date.now = realNow
  })

  test('locked session refuses break and end until the lock expires', () => {
    const denied = []
    sm.on('locked-denied', () => denied.push(1))

    sm.startWork(60) // 🔒 60 min
    expect(sm.isLocked()).toBe(true)
    expect(sm.takeBreak()).toBe(false)
    expect(sm.endWork()).toBe(false)
    expect(sm.state).toBe('working')
    expect(denied.length).toBe(2)

    now += 61 * 60000 // lock expired
    expect(sm.isLocked()).toBe(false)
    expect(sm.endWork()).toBe(true)
    expect(sm.state).toBe('idle')
  })

  test('unlocked sessions end normally and ending clears any lock', () => {
    sm.startWork()
    expect(sm.isLocked()).toBe(false)
    expect(sm.endWork()).toBe(true)
    expect(sm.lockedUntil).toBe(null)
  })

  test('status reports lock remaining minutes', () => {
    sm.startWork(60)
    now += 20 * 60000
    const st = sm.getStatus()
    expect(st.locked).toBe(true)
    expect(st.lockRemainingMin).toBe(40)
  })

  test('resuming from... a locked state cannot sneak out via break', () => {
    sm.startWork(30)
    expect(sm.takeBreak()).toBe(false) // still locked
    now += 31 * 60000
    expect(sm.takeBreak()).toBe(true)  // lock expired → break allowed
    expect(sm.state).toBe('break')
  })
})
