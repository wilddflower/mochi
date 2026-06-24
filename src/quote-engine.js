class QuoteEngine {
  constructor(store) {
    this.store = store
    this._recentIndices = []
  }

  getQuote(trigger) {
    const quotes = this.store.get('quotes') || []
    if (quotes.length === 0) return null

    // Prefer trigger-specific quotes, fall back to general
    let candidates = quotes

    // Avoid repeating recent quotes
    const maxRecent = Math.min(5, Math.floor(quotes.length / 2))
    const available = candidates.filter((_, i) => !this._recentIndices.includes(i))
    const pool = available.length > 0 ? available : candidates

    const idx = Math.floor(Math.random() * pool.length)
    const quote = pool[idx]

    // Track to avoid repeats
    const originalIdx = quotes.indexOf(quote)
    this._recentIndices.push(originalIdx)
    if (this._recentIndices.length > maxRecent) this._recentIndices.shift()

    return quote
  }
}

module.exports = QuoteEngine
