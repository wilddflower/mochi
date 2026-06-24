const GUILT_QUOTES = [
  "you said you'd focus...",
  "come on, not again",
  "i believe in you, but...",
  "this wasn't the plan...",
  "hey... focus?",
  "you're better than this",
  "the task isn't gonna do itself...",
  "i'm watching you...",
  "*taps foot*",
  "back to work maybe?",
  "you promised...",
  "mochi is disappointed...",
  "really? right now?",
  "we were doing so well...",
  "i thought you wanted to be the coolest 🐐",
  "this ain't it, pavni",
  "the coolest people aren't scrolling rn",
  "future pavni is judging present pavni",
]

const RETURN_QUOTES = [
  "back on track, let's go!",
  "welcome back!",
  "that's more like it",
  "knew you'd come back",
  "ok let's lock in",
  "reset and go!",
  "we're back baby",
  "focus mode: reactivated",
]

const TASK_NAG_QUOTES = [
  "this was due already...",
  "you said you'd finish this!",
  "tick tock...",
  "the deadline passed btw",
  "still waiting on that task...",
  "hello?? the task??",
  "mochi remembers what you said...",
  "overdue and counting...",
]

const TASK_COMPLETE_QUOTES = [
  "nice one!",
  "DONE! let's gooo",
  "checked off!",
  "one less thing!",
  "you did it!",
  "productive queen",
  "crushed it",
]

class QuoteEngine {
  constructor(store) {
    this.store = store
    this._recentByCategory = {}
  }

  getQuote(trigger) {
    let pool
    switch (trigger) {
      case 'guilt':
        pool = GUILT_QUOTES
        break
      case 'return':
        pool = RETURN_QUOTES
        break
      case 'task-nag':
        pool = TASK_NAG_QUOTES
        break
      case 'task-complete':
        pool = TASK_COMPLETE_QUOTES
        break
      default:
        pool = this.store.get('quotes') || []
        break
    }

    if (pool.length === 0) return null

    const category = trigger || 'general'
    if (!this._recentByCategory[category]) this._recentByCategory[category] = []

    const recent = this._recentByCategory[category]
    const maxRecent = Math.min(3, Math.floor(pool.length / 2))
    const available = pool.filter((_, i) => !recent.includes(i))
    const candidates = available.length > 0 ? available : pool

    const pick = candidates[Math.floor(Math.random() * candidates.length)]
    const idx = pool.indexOf(pick)

    recent.push(idx)
    if (recent.length > maxRecent) recent.shift()

    return pick
  }
}

module.exports = QuoteEngine
