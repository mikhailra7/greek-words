import { expect, test } from '@playwright/test'
import { seedDictionary } from './helpers.ts'

test('«Озвучка» in the profile: site voice (male, speed) or the device voice', async ({
  browser,
  request,
}, testInfo) => {
  const dict = await seedDictionary(request, `Голос ${Date.now()}`, [
    { article: 'το', greek: 'νερό', translations_ru: ['вода'] },
  ])
  // Its own member: voice settings are per user, and the admin's are shared by other tests
  // running at the same time.
  const invite = await (await request.post('/api/admin/invites', { data: {} })).json()
  const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } })
  const reg = await ctx.request.post('/api/auth/register', {
    data: {
      username: `voice_${testInfo.project.name}`,
      password: 'voice-pass',
      invite_code: invite.code,
    },
  })
  expect(reg.ok()).toBeTruthy()
  const page = await ctx.newPage()
  // Record what gets played: server audio requests and device speech.
  const audio: string[] = []
  await page.route(/\/api\/(words\/\d+\/audio|tts\/sample)/, (route) => {
    if (route.request().resourceType() === 'media') audio.push(route.request().url())
    return route.fulfill({ status: 200, contentType: 'audio/mpeg', body: '' })
  })
  await page.addInitScript(() => {
    const w = window as unknown as { spoken: { text: string; rate: number }[] }
    w.spoken = []
    speechSynthesis.speak = (u: SpeechSynthesisUtterance) => {
      // rate is stored as a 32-bit float (0.8 → 0.800000011…)
      if (u.text) w.spoken.push({ text: u.text, rate: Math.round(u.rate * 100) / 100 })
    }
    // Pretend the device has a Greek voice.
    speechSynthesis.getVoices = () => [{ lang: 'el-GR', name: 'Melina' } as SpeechSynthesisVoice]
  })
  const spoken = () => page.evaluate(() => (window as unknown as { spoken: unknown[] }).spoken)

  await page.goto('/profile')
  const voice = page.getByRole('radiogroup', { name: 'Голос', exact: true })
  await voice.getByRole('radio', { name: /Голос сайта/ }).click()
  await page.getByRole('radio', { name: /Мужской/ }).click()
  await page.getByRole('radio', { name: 'обычная' }).click()
  await page.waitForTimeout(700) // saved with a short debounce
  await page.reload()
  await expect(page.getByRole('radio', { name: /Мужской/ })).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByRole('radio', { name: 'обычная' })).toHaveAttribute('aria-checked', 'true')

  // The site voice: the server file for this voice and speed.
  const openDictionary = async () => {
    const settingsLoaded = page.waitForResponse(/\/api\/me\/settings$/)
    await page.goto(`/dictionaries/${dict}`)
    await settingsLoaded
  }
  await openDictionary()
  await page.getByRole('button', { name: 'Произнести το νερό' }).click()
  await expect.poll(() => audio.at(-1) ?? '').toMatch(/\/audio\?v=\w+&voice=male&rate=0$/)

  // The device voice: no server audio, the phone/computer speaks at the chosen speed.
  await page.goto('/profile')
  await voice.getByRole('radio', { name: /Голос устройства/ }).click()
  await expect(page.getByRole('radio', { name: /Мужской/ })).toHaveCount(0)
  await page.getByRole('radio', { name: '−20 %' }).click()
  await page.getByRole('button', { name: '▶ Прослушать' }).click()
  await page.waitForTimeout(700)
  const before = audio.length
  await openDictionary()
  await page.getByRole('button', { name: 'Произнести το νερό' }).click()
  await expect.poll(spoken).toEqual([{ text: 'το νερό', rate: 0.8 }])
  expect(audio.length).toBe(before)

  await ctx.close()
})
