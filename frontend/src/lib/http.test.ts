import { afterEach, describe, expect, it, vi } from 'vitest'
import { request } from './http'

const connectionError = 'Cannot connect to the server. Please try again.'
const genericError = 'The operation failed. Please try again.'

afterEach(() => vi.unstubAllGlobals())

function respond(status: number, body?: unknown) {
  const text = typeof body === 'string' ? body : JSON.stringify(body)
  const response = new Response(text ?? null, { status })
  const fetch = vi.fn().mockResolvedValue(response)
  vi.stubGlobal('fetch', fetch)
  return fetch
}

function failNetwork(error: unknown = new TypeError('Failed to fetch')) {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(error))
}

describe('request', () => {
  it('prefixes the API path, sends JSON headers and parses the body', async () => {
    const fetch = respond(200, { ok: true })
    const result = await request('/todos', { method: 'POST', body: '{}' })
    expect(result).toEqual({ ok: true })
    expect(fetch).toHaveBeenCalledWith('/api/todos', {
      method: 'POST',
      body: '{}',
      headers: { 'Content-Type': 'application/json' },
    })
  })

  it('sends JSON headers when called without options', async () => {
    const fetch = respond(200, [])
    await expect(request('/todos')).resolves.toEqual([])
    expect(fetch).toHaveBeenCalledWith('/api/todos', {
      headers: { 'Content-Type': 'application/json' },
    })
  })

  it('merges caller headers over the default content type', async () => {
    const fetch = respond(200, {})
    const headers = { 'Content-Type': 'text/plain', 'X-Trace': '1' }
    await request('/todos', { headers })
    expect(fetch).toHaveBeenCalledWith('/api/todos', { headers })
  })

  it('resolves undefined for 204 No Content', async () => {
    respond(204)
    const result = await request('/todos/1', { method: 'DELETE' })
    expect(result).toBeUndefined()
  })

  it('reports a connection problem when fetch fails', async () => {
    failNetwork()
    await expect(request('/todos')).rejects.toThrow(connectionError)
  })

  it('reports a connection problem for a request without a signal', async () => {
    failNetwork()
    const pending = request('/todos', { method: 'DELETE' })
    await expect(pending).rejects.toThrow(connectionError)
  })

  it('reports a connection problem when the signal is not aborted', async () => {
    failNetwork()
    const signal = new AbortController().signal
    const pending = request('/todos', { signal })
    await expect(pending).rejects.toThrow(connectionError)
  })

  it('rethrows the original error for an aborted request', async () => {
    const abort = new DOMException('Aborted', 'AbortError')
    failNetwork(abort)
    const controller = new AbortController()
    controller.abort()
    const pending = request('/todos', { signal: controller.signal })
    await expect(pending).rejects.toBe(abort)
  })

  it('explains validation limits on 422 regardless of the body', async () => {
    respond(422, { detail: 'title too long' })
    await expect(request('/todos')).rejects.toThrow(
      'Check the task details: title up to 120 characters, description up to 2000 characters, and a valid due date.',
    )
  })

  it('passes through a string detail from the server', async () => {
    respond(404, { detail: 'Task not found.' })
    await expect(request('/todos/9')).rejects.toThrow('Task not found.')
  })

  it('falls back to a generic message for a non-string detail', async () => {
    respond(400, { detail: [{ msg: 'bad' }] })
    await expect(request('/todos')).rejects.toThrow(genericError)
  })

  it('falls back to a generic message when the error body is not JSON', async () => {
    respond(500, 'Internal Server Error')
    await expect(request('/todos')).rejects.toThrow(genericError)
  })
})
