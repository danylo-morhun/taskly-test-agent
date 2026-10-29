import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  formatDate,
  isOverdue,
  priorityLabels,
  selectTodos,
  validateTodo,
} from './todos'
import type { Todo, TodoInput } from '../types'

const base: Todo = {
  id: 1,
  title: 'Sprint plan',
  description: '',
  priority: 'medium',
  completed: false,
  due_date: null,
  created_at: '2026-10-01T12:00:00Z',
  updated_at: '2026-10-01T12:00:00Z',
}

describe('selectTodos', () => {
  it('combines status with a case-insensitive search in the description', () => {
    const matching = { ...base, description: 'Discuss the API' }
    const todos = [
      matching,
      { ...matching, id: 2, completed: true },
      { ...base, id: 3 },
    ]
    expect(selectTodos(todos, 'active', ' api ', 'newest')).toEqual([matching])
  })

  it('sorts by priority without changing the source array', () => {
    const high: Todo = { ...base, id: 2, priority: 'high' }
    const todos = [base, high]
    expect(selectTodos(todos, 'all', '', 'priority')).toEqual([high, base])
    expect(todos).toEqual([base, high])
  })

  it('keeps only completed tasks for the completed filter', () => {
    const done = { ...base, id: 2, completed: true }
    const result = selectTodos([base, done], 'completed', '', 'newest')
    expect(result).toEqual([done])
  })

  it('keeps every status for the all filter and matches the title', () => {
    const done = { ...base, id: 2, completed: true }
    const other = { ...base, id: 3, title: 'Groceries' }
    const todos = [base, done, other]
    const result = selectTodos(todos, 'all', 'SPRINT', 'newest')
    expect(result).toEqual([done, base])
  })

  it('does not match text spanning the title and description', () => {
    const todo = { ...base, title: 'ab', description: 'cd' }
    expect(selectTodos([todo], 'all', 'abcd', 'newest')).toEqual([])
    expect(selectTodos([todo], 'all', 'ab cd', 'newest')).toEqual([todo])
  })

  it('sorts newest first by creation time, then by higher id', () => {
    const older = { ...base, id: 5, created_at: '2026-09-01T12:00:00Z' }
    const newer = { ...base, id: 1, created_at: '2026-10-02T12:00:00Z' }
    const tie = { ...base, id: 2 }
    const todos = [older, base, newer, tie]
    const result = selectTodos(todos, 'all', '', 'newest')
    expect(result).toEqual([newer, tie, base, older])
  })

  it('sorts by priority high, medium, low and breaks ties by higher id', () => {
    const low: Todo = { ...base, id: 9, priority: 'low' }
    const high: Todo = { ...base, id: 1, priority: 'high' }
    const medium: Todo = { ...base, id: 4, priority: 'medium' }
    const todos = [low, base, high, medium]
    const result = selectTodos(todos, 'all', '', 'priority')
    expect(result).toEqual([high, medium, base, low])
  })

  it('sorts by due date with undated tasks last and ties by higher id', () => {
    const late = { ...base, id: 1, due_date: '2026-12-01' }
    const soon = { ...base, id: 2, due_date: '2026-10-20' }
    const soonNewer = { ...base, id: 3, due_date: '2026-10-20' }
    const undated = { ...base, id: 4 }
    const undatedNewer = { ...base, id: 5 }
    const todos = [undated, late, soon, undatedNewer, soonNewer]
    const result = selectTodos(todos, 'all', '', 'due')
    expect(result).toEqual([soonNewer, soon, late, undatedNewer, undated])
  })
})

describe('validateTodo', () => {
  const input: TodoInput = {
    title: 'Sprint plan',
    description: '',
    priority: 'medium',
    due_date: null,
    completed: false,
  }
  const titleError = 'The title must be at most 120 characters.'
  const descriptionError = 'The description must be at most 2000 characters.'

  it('accepts a valid task', () => {
    expect(validateTodo({ ...input, due_date: '2026-02-28' })).toEqual({})
  })

  it('requires a non-blank title', () => {
    const errors = validateTodo({ ...input, title: '  ' })
    expect(errors).toEqual({ title: 'Enter a task title.' })
  })

  it('limits the trimmed title to 120 characters', () => {
    const atLimit = ` ${'a'.repeat(120)} `
    expect(validateTodo({ ...input, title: atLimit })).toEqual({})
    const tooLong = 'a'.repeat(121)
    const errors = validateTodo({ ...input, title: tooLong })
    expect(errors).toEqual({ title: titleError })
  })

  it('limits the trimmed description to 2000 characters', () => {
    const atLimit = ` ${'a'.repeat(2000)} `
    expect(validateTodo({ ...input, description: atLimit })).toEqual({})
    const tooLong = 'a'.repeat(2001)
    const errors = validateTodo({ ...input, description: tooLong })
    expect(errors).toEqual({ description: descriptionError })
  })

  const invalidDates = [
    '2026-02-30',
    '2026-13-01',
    '26-01-01',
    '2026-1-01',
    'tomorrow',
  ]

  it.each(invalidDates)('rejects the invalid due date %s', (due_date) => {
    const errors = validateTodo({ ...input, due_date })
    expect(errors).toEqual({ due_date: 'Enter a valid date.' })
  })

  it('reports every invalid field at once', () => {
    const description = 'a'.repeat(2001)
    const invalid = { ...input, title: '', description, due_date: 'x' }
    expect(validateTodo(invalid)).toEqual({
      title: 'Enter a task title.',
      description: descriptionError,
      due_date: 'Enter a valid date.',
    })
  })
})

describe('isOverdue', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-15T12:00:00Z'))
  })
  afterEach(() => vi.useRealTimers())

  it('flags an open task due before today', () => {
    expect(isOverdue({ ...base, due_date: '2026-10-14' })).toBe(true)
  })

  it('does not flag a task due today or later', () => {
    expect(isOverdue({ ...base, due_date: '2026-10-15' })).toBe(false)
    expect(isOverdue({ ...base, due_date: '2026-10-16' })).toBe(false)
  })

  it('does not flag completed or undated tasks', () => {
    const done = { ...base, completed: true, due_date: '2026-10-01' }
    expect(isOverdue(done)).toBe(false)
    expect(isOverdue(base)).toBe(false)
  })

  it('pads single-digit months and days when comparing dates', () => {
    vi.setSystemTime(new Date('2026-03-05T12:00:00Z'))
    expect(isOverdue({ ...base, due_date: '2026-03-04' })).toBe(true)
    expect(isOverdue({ ...base, due_date: '2026-03-05' })).toBe(false)
  })
})

describe('formatDate', () => {
  it('formats an ISO date in British style', () => {
    expect(formatDate('2026-10-05')).toBe('5 Oct 2026')
  })
})

describe('priorityLabels', () => {
  it('labels every priority', () => {
    const expected = { low: 'Low', medium: 'Medium', high: 'High' }
    expect(priorityLabels).toEqual(expected)
  })
})
