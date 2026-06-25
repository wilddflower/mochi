const { EventEmitter } = require('events')
const WindowMonitor = require('./window-monitor')

// Priority: Nagging > Sleeping > Angry > Sad > Focused > Happy > Encouraging
const MOODS = ['nagging', 'sleeping', 'angry', 'sad', 'focused', 'happy', 'encouraging']

const DISTRACTION_ESCALATE_MS = 1 * 60 * 1000  // 1 min on a blocked site → Angry
const FOCUS_ESCALATE_MS = 10 * 60 * 1000        // 10 min → Focused
const IDLE_THRESHOLD_MS = 30 * 1000              // 30s no change → Encouraging
const MILESTONE_INTERVALS = [15, 30, 45, 60]    // minutes

class MoodEngine extends EventEmitter {
  constructor(store) {
    super()
    this.store = store
    this.currentMood = 'encouraging'
    this.paused = false

    // Internal timers and state
    this._hasNagging = false
    this._sessionState = 'idle'   // idle | working | break — only 'working' triggers reactions
    this._lastWindowInfo = null
    this._lastClassification = 'neutral'
    this._lastWindowChangeTime = Date.now()
    this._distractionStartTime = null
    this._focusStartTime = null
    this._distractionTimerTick = null
    this._idleTimer = null
    this._milestoneMinutes = 0
    this._nextMilestone = MILESTONE_INTERVALS[0]

    this._startIdleTimer()
    this._startDistractionTick()
    // Compute initial mood (e.g. sleeping if outside active hours on launch)
    this.currentMood = this._computeMood()
  }

  pause() { this.paused = true }
  resume() { this.paused = false; this._recalculateMood() }

  setSessionState(state) {
    this._sessionState = state
    if (state !== 'working') {
      // Leaving work mode: stop tracking focus/distraction timers.
      this._distractionStartTime = null
      this._focusStartTime = null
      this._lastClassification = 'neutral'
    }
    this._recalculateMood()
  }

  onWindowChanged(windowInfo) {
    if (this.paused) return
    this._lastWindowInfo = windowInfo
    this._lastWindowChangeTime = Date.now()
    this._resetIdleTimer()

    const classification = WindowMonitor.classify(windowInfo, this.store)
    const prev = this._lastClassification
    this._lastClassification = classification

    if (classification === 'distraction') {
      if (prev !== 'distraction') this._distractionStartTime = Date.now()
      this._focusStartTime = null
    } else if (classification === 'productive') {
      if (prev !== 'productive') {
        // Fresh focus streak → restart milestone tracking
        this._focusStartTime = Date.now()
        this._nextMilestone = MILESTONE_INTERVALS[0]
        this._milestoneMinutes = 0
      }
      if (this._distractionStartTime) this.emit('distraction-timer', 0)
      this._distractionStartTime = null
    } else {
      // neutral
      this._focusStartTime = null
      if (this._distractionStartTime) this.emit('distraction-timer', 0)
      this._distractionStartTime = null
    }

    this._recalculateMood()
  }

  setNagging(hasOverdue) {
    this._hasNagging = hasOverdue
    this._recalculateMood()
  }

  _recalculateMood() {
    const mood = this._computeMood()
    if (mood !== this.currentMood) {
      const prev = this.currentMood
      this.currentMood = mood
      this.emit('mood-transition', { mood, prevMood: prev, classification: this._lastClassification })
    }
  }

  _computeMood() {
    // Outside an active work session, Mochi is calm and never nags.
    if (this._sessionState === 'idle') return 'encouraging'
    if (this._sessionState === 'break') return 'happy'

    if (this._hasNagging) return 'nagging'

    if (this._lastClassification === 'distraction' && this._distractionStartTime) {
      const elapsed = Date.now() - this._distractionStartTime
      if (elapsed >= DISTRACTION_ESCALATE_MS) return 'angry'
      return 'sad'
    }

    if (this._lastClassification === 'productive' && this._focusStartTime) {
      const elapsed = Date.now() - this._focusStartTime
      if (elapsed >= FOCUS_ESCALATE_MS) return 'focused'
      return 'happy'
    }

    return 'encouraging'
  }

  _startIdleTimer() {
    this._idleTimer = setInterval(() => {
      if (this.paused) return
      // Only go idle when classification is already neutral (desktop, lock screen, unknown app).
      // Staying on a productive or distraction app for a long time without switching is not "idle".
      if (this._lastClassification === 'neutral' &&
          Date.now() - this._lastWindowChangeTime >= IDLE_THRESHOLD_MS) {
        this._recalculateMood()
      }
    }, 5000)
  }

  _resetIdleTimer() {
    // Timer keeps running; last-change-time is what matters
  }

  _startDistractionTick() {
    this._distractionTimerTick = setInterval(() => {
      if (this.paused || this._sessionState !== 'working') return

      if (this._lastClassification === 'distraction' && this._distractionStartTime) {
        const elapsed = Math.floor((Date.now() - this._distractionStartTime) / 1000)
        this.emit('distraction-timer', elapsed)
        // Escalate sad → angry at the 5-min mark even with no window change.
        this._recalculateMood()
      }

      // Focus milestones + happy → focused escalation
      if (this._lastClassification === 'productive' && this._focusStartTime) {
        const mins = Math.floor((Date.now() - this._focusStartTime) / 60000)
        if (mins >= this._nextMilestone) {
          this._milestoneMinutes = mins
          this._nextMilestone = MILESTONE_INTERVALS.find(m => m > mins) || (mins + 15)
          this.emit('milestone', `focus-${mins}`)
        }
        this._recalculateMood()
      }
    }, 1000)
  }

  getCurrentMood() { return this.currentMood }
}

module.exports = MoodEngine
