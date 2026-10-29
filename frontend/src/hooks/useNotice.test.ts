import { act, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useNotice } from './useNotice'

afterEach(() => vi.useRealTimers())

it('starts without a notice and exposes a notification callback', () => {
  vi.useFakeTimers()
  const { result } = renderHook(() => useNotice())
  expect(vi.getTimerCount()).toBe(0)
  expect(result.current.message).toBe('')
  expect(result.current.notify).toEqual(expect.any(Function))
})

it('shows a notice and clears it after four seconds', () => {
  vi.useFakeTimers()
  const { result } = renderHook(() => useNotice())
  act(() => result.current.notify('Saved.'))
  expect(result.current.message).toBe('Saved.')
  act(() => vi.advanceTimersByTime(3999))
  expect(result.current.message).toBe('Saved.')
  act(() => vi.advanceTimersByTime(1))
  expect(result.current.message).toBe('')
})

it('restarts the four-second timer for a new notice', () => {
  vi.useFakeTimers()
  const { result } = renderHook(() => useNotice())
  act(() => result.current.notify('First.'))
  act(() => vi.advanceTimersByTime(3000))
  act(() => result.current.notify('Second.'))
  act(() => vi.advanceTimersByTime(3000))
  expect(result.current.message).toBe('Second.')
  act(() => vi.advanceTimersByTime(1000))
  expect(result.current.message).toBe('')
})

it('restarts the timer when the same message is repeated', () => {
  vi.useFakeTimers()
  const { result } = renderHook(() => useNotice())
  act(() => result.current.notify('Saved.'))
  act(() => vi.advanceTimersByTime(3000))
  act(() => result.current.notify('Saved.'))
  act(() => vi.advanceTimersByTime(3000))
  expect(result.current.message).toBe('Saved.')
})

it('keeps a stable notify callback across renders', () => {
  const { result, rerender } = renderHook(() => useNotice())
  const first = result.current.notify
  act(() => result.current.notify('Saved.'))
  rerender()
  expect(result.current.notify).toBe(first)
})

it('cancels the pending timer on unmount', () => {
  vi.useFakeTimers()
  const { result, unmount } = renderHook(() => useNotice())
  act(() => result.current.notify('Saved.'))
  expect(vi.getTimerCount()).toBe(1)
  unmount()
  expect(vi.getTimerCount()).toBe(0)
})
