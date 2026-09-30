import { request, type FullConfig } from '@playwright/test'
import { mkdirSync } from 'node:fs'

export const ADMIN = { username: 'e2e_admin', password: 'e2e-pass-1' }

// The backend starts with an empty DB, so the first registration becomes the admin.
export default async function globalSetup(config: FullConfig) {
  const baseURL = config.projects[0].use.baseURL!
  const ctx = await request.newContext({ baseURL })
  const r = await ctx.post('/api/auth/register', { data: ADMIN })
  if (!r.ok()) throw new Error(`admin registration failed: ${r.status()} ${await r.text()}`)
  // The trainer tests count requests for the site's audio files, so the admin keeps the site
  // voice (the default is the device voice; e2e/voice.spec.ts covers it).
  const v = await ctx.put('/api/me/settings/voice', {
    data: { value: { device: false, male: false, speed: -10 } },
  })
  if (!v.ok()) throw new Error(`voice setting failed: ${v.status()}`)
  mkdirSync('e2e/.auth', { recursive: true })
  await ctx.storageState({ path: 'e2e/.auth/admin.json' })
  await ctx.dispose()
}
