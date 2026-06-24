const { EventEmitter } = require('events')

class TaskManager extends EventEmitter {
  constructor(store) {
    super()
    this.store = store
    this._hadOverdue = false
    this._lastId = 0

    // Check overdue tasks every 30s
    setInterval(() => this._checkOverdue(), 30_000)
    this._checkOverdue()
  }

  addTask(name, durationMinutes) {
    const now = Math.max(Date.now(), this._lastId + 1)
    this._lastId = now
    const task = {
      id: now,
      name: String(name).trim(),
      durationMinutes: Number(durationMinutes),
      deadlineAt: new Date(now + durationMinutes * 60_000).toISOString(),
      createdAt: new Date(now).toISOString(),
      done: false,
      dismissed: false
    }
    const tasks = this.store.get('tasks') || []
    tasks.push(task)
    this.store.set('tasks', tasks)
    this._checkOverdue()
    return task
  }

  completeTask(id) {
    const tasks = this.store.get('tasks') || []
    const idx = tasks.findIndex(t => t.id === id)
    if (idx === -1) return false
    tasks[idx].done = true
    this.store.set('tasks', tasks)
    this._checkOverdue()
    return true
  }

  dismissTask(id) {
    const tasks = this.store.get('tasks') || []
    const idx = tasks.findIndex(t => t.id === id)
    if (idx === -1) return
    tasks[idx].dismissed = true
    this.store.set('tasks', tasks)
    this._checkOverdue()
  }

  getTasks() {
    return (this.store.get('tasks') || []).filter(t => !t.dismissed)
  }

  getOverdueTasks() {
    const now = new Date().toISOString()
    return this.getTasks().filter(t => !t.done && t.deadlineAt < now)
  }

  _checkOverdue() {
    const overdue = this.getOverdueTasks()
    const hasOverdue = overdue.length > 0
    if (hasOverdue !== this._hadOverdue) {
      this._hadOverdue = hasOverdue
      this.emit('nagging-changed', hasOverdue)
    }
  }
}

module.exports = TaskManager
