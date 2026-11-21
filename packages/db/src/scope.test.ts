import { describe, expect, it } from 'vitest'
import type { Db } from './client.ts'
import { OrgScope, withOrg } from './scope.ts'

describe('withOrg', () => {
  it('refuses anything that is not an org id, before touching the database', async () => {
    const db = { transaction: () => { throw new Error('should not be called') } } as unknown as Db
    for (const bad of ['', 'org_', 'site_0193b0a0-0000-7000-8000-000000000000', "org_x' OR '1'='1"]) {
      await expect(withOrg(db, bad, async () => 1)).rejects.toThrow(TypeError)
    }
  })

  it('is the only way to make an OrgScope', () => {
    expect(() => new OrgScope(Symbol('OrgScope'), {} as never, 'org_x')).toThrow(/withOrg/)
  })
})
