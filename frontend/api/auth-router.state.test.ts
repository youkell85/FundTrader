import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const USER_ID = 'auth_state_test_user'

let tempDir = ''
let previousStorePath: string | undefined

function context() {
  return {
    req: new Request('http://localhost/fund/api/trpc/auth.state'),
    resHeaders: new Headers(),
    user: { id: USER_ID, name: 'State User', username: 'state', role: 'user', avatar: null },
  } as any
}

beforeEach(() => {
  vi.resetModules()
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fundtrader-auth-state-'))
  previousStorePath = process.env.FUNDTRADER_USER_STORE
  process.env.FUNDTRADER_USER_STORE = path.join(tempDir, 'user-store.json')
})

afterEach(() => {
  if (previousStorePath === undefined) {
    delete process.env.FUNDTRADER_USER_STORE
  } else {
    process.env.FUNDTRADER_USER_STORE = previousStorePath
  }
  fs.rmSync(tempDir, { recursive: true, force: true })
})

describe('auth state persistence', () => {
  test('state returns persisted user state instead of an empty shell', async () => {
    const [{ authRouter }, { updateUserState }] = await Promise.all([
      import('./auth-router'),
      import('./lib/user-store'),
    ])

    updateUserState(USER_ID, {
      watchlistCodes: ['000001'],
      recommendationRecords: [{ id: 1, plans: [{ name: '平衡推荐', fundAllocations: [] }] }],
      preferences: { horizon: '3年' },
    })

    const caller = authRouter.createCaller(context())
    const state = await caller.state()

    expect(state.watchlistCodes).toEqual(['000001'])
    expect(state.recommendationRecords).toHaveLength(1)
    expect(state.preferences).toEqual({ horizon: '3年' })
  })

  test('savePreferences merges with persisted preferences', async () => {
    const [{ authRouter }, { updateUserState }] = await Promise.all([
      import('./auth-router'),
      import('./lib/user-store'),
    ])

    updateUserState(USER_ID, { preferences: { horizon: '3年' } })

    const caller = authRouter.createCaller(context())
    const state = await caller.savePreferences({ riskProfile: 'balanced' })

    expect(state.preferences).toEqual({ horizon: '3年', riskProfile: 'balanced' })
    await expect(caller.state()).resolves.toMatchObject({
      preferences: { horizon: '3年', riskProfile: 'balanced' },
    })
  })
})
