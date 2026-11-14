import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  updateMany: vi.fn(),
  verifyHash: vi.fn(),
  verifyRefresh: vi.fn(),
}))

vi.mock('../src/lib/prisma.js', () => ({
  prisma: { refreshToken: { findMany: mocks.findMany, updateMany: mocks.updateMany } },
}))
vi.mock('../src/lib/hash.js', () => ({ hash: vi.fn(), verifyHash: mocks.verifyHash }))
vi.mock('../src/lib/jwt.js', () => ({
  signAccess: vi.fn(),
  signRefresh: vi.fn(),
  verifyRefresh: mocks.verifyRefresh,
}))

import { logoutByToken } from '../src/services/auth.js'

describe('logoutByToken', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.verifyRefresh.mockReturnValue({ sub: 'user-1' })
    mocks.findMany.mockResolvedValue([
      { id: 'refresh-1', family: 'family-1', tokenHash: 'hash-1' },
      { id: 'refresh-2', family: 'family-2', tokenHash: 'hash-2' },
    ])
    mocks.verifyHash.mockResolvedValue(false)
    mocks.updateMany.mockResolvedValue({ count: 1 })
  })

  it('revokes the matching refresh-token family', async () => {
    mocks.verifyHash.mockResolvedValueOnce(false).mockResolvedValueOnce(true)

    await logoutByToken('valid-refresh')

    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', family: 'family-2', revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    })
  })

  it('revokes all active sessions when a valid token is no longer recognized', async () => {
    await logoutByToken('replayed-refresh')

    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    })
  })

  it('does not change sessions for an invalid refresh token', async () => {
    mocks.verifyRefresh.mockImplementation(() => { throw new Error('invalid token') })

    await logoutByToken('invalid-refresh')

    expect(mocks.findMany).not.toHaveBeenCalled()
    expect(mocks.updateMany).not.toHaveBeenCalled()
  })
})
