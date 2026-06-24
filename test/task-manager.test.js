const TaskManager = require('../src/task-manager')

function makeStore() {
  let tasks = []
  return {
    get: (key) => key === 'tasks' ? tasks : undefined,
    set: (key, val) => { if (key === 'tasks') tasks = val }
  }
}

describe('TaskManager — CRUD and deadline logic', () => {
  let store, manager

  beforeEach(() => {
    jest.useFakeTimers()
    store = makeStore()
    manager = new TaskManager(store)
  })

  afterEach(() => {
    jest.useRealTimers()
    if (manager._checkInterval) clearInterval(manager._checkInterval)
  })

  test('addTask creates a task with absolute deadlineAt', () => {
    const before = Date.now()
    const task = manager.addTask('Write essay', 60)
    const after = Date.now()

    expect(task.name).toBe('Write essay')
    expect(task.durationMinutes).toBe(60)
    expect(task.done).toBe(false)
    expect(task.dismissed).toBe(false)

    const deadline = new Date(task.deadlineAt).getTime()
    const created = new Date(task.createdAt).getTime()
    // deadlineAt = createdAt + 60 * 60000 (±1s for test timing)
    expect(deadline - created).toBeGreaterThanOrEqual(59 * 60000)
    expect(deadline - created).toBeLessThanOrEqual(61 * 60000)
  })

  test('task ID uses Date.now() (milliseconds, avoids collision)', () => {
    const t1 = manager.addTask('Task 1', 30)
    jest.advanceTimersByTime(10)
    const t2 = manager.addTask('Task 2', 30)
    expect(t1.id).not.toBe(t2.id)
    expect(typeof t1.id).toBe('number')
  })

  test('getTasks returns only non-dismissed tasks', () => {
    manager.addTask('Keep', 30)
    const t2 = manager.addTask('Dismiss me', 30)
    manager.dismissTask(t2.id)
    const visible = manager.getTasks()
    expect(visible.length).toBe(1)
    expect(visible[0].name).toBe('Keep')
  })

  test('completeTask marks task as done', () => {
    const task = manager.addTask('Finish report', 45)
    const result = manager.completeTask(task.id)
    expect(result).toBe(true)
    const tasks = manager.getTasks()
    expect(tasks.find(t => t.id === task.id).done).toBe(true)
  })

  test('completeTask returns false for unknown id', () => {
    expect(manager.completeTask(9999999)).toBe(false)
  })

  test('getOverdueTasks returns tasks past deadlineAt', () => {
    // Task with deadline 1 second in the future
    const task = manager.addTask('Quick task', 1/60) // 1 second
    // Advance past the deadline
    jest.advanceTimersByTime(2000)
    // Force the deadline to be in the past by backdating it
    const tasks = store.get('tasks')
    tasks[0].deadlineAt = new Date(Date.now() - 1000).toISOString()
    store.set('tasks', tasks)

    const overdue = manager.getOverdueTasks()
    expect(overdue.length).toBe(1)
    expect(overdue[0].name).toBe('Quick task')
  })

  test('done tasks are not reported as overdue', () => {
    const task = manager.addTask('Done task', 1)
    manager.completeTask(task.id)
    // Backdate the deadline
    const tasks = store.get('tasks')
    tasks[0].deadlineAt = new Date(Date.now() - 1000).toISOString()
    store.set('tasks', tasks)
    expect(manager.getOverdueTasks()).toHaveLength(0)
  })

  test('emits nagging-changed when overdue status changes', () => {
    const events = []
    manager.on('nagging-changed', (v) => events.push(v))

    const task = manager.addTask('Task', 1)
    const tasks = store.get('tasks')
    tasks[0].deadlineAt = new Date(Date.now() - 1000).toISOString()
    store.set('tasks', tasks)
    manager._checkOverdue()

    expect(events).toContain(true)

    manager.completeTask(task.id)
    manager._checkOverdue()
    expect(events).toContain(false)
  })

  test('trimmed task names are stored correctly', () => {
    const task = manager.addTask('  spaces  ', 30)
    expect(task.name).toBe('spaces')
  })
})
