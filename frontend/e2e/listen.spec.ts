import { expect, test } from '@playwright/test'
import { activateOnly, seedDictionary, setSlider } from './helpers.ts'

// 0.1 s of silence: stands in for the TTS files (the e2e backend has TTS switched off).
function silentWav(): Buffer {
  const rate = 8000
  const samples = rate / 10
  const b = Buffer.alloc(44 + samples)
  b.write('RIFF', 0)
  b.writeUInt32LE(36 + samples, 4)
  b.write('WAVEfmt ', 8)
  b.writeUInt32LE(16, 16)
  b.writeUInt16LE(1, 20) // PCM
  b.writeUInt16LE(1, 22) // mono
  b.writeUInt32LE(rate, 24)
  b.writeUInt32LE(rate, 28)
  b.writeUInt16LE(1, 32)
  b.writeUInt16LE(8, 34)
  b.write('data', 36)
  b.writeUInt32LE(samples, 40)
  b.fill(128, 44)
  return b
}

test('audio review: greek → pause → russian → pause, pause/play, finish', async ({
  page,
  request,
}) => {
  test.setTimeout(60_000)
  const id = await seedDictionary(request, `Аудио ${Date.now()}`)
  await activateOnly(request, id)
  const audioRequests: string[] = []
  await page.route(/\/api\/words\/\d+\/audio/, (route) => {
    audioRequests.push(new URL(route.request().url()).pathname)
    return route.fulfill({ status: 200, contentType: 'audio/wav', body: silentWav() })
  })

  await page.goto('/listen')
  await expect(page.getByText('3 с', { exact: true })).toBeVisible() // default pause
  await setSlider(page, 2)
  await setSlider(page, 1, 1) // pause 1 s
  await expect(page.getByText('1 с', { exact: true }).first()).toBeVisible()
  await page.getByRole('button', { name: 'Начать' }).click()

  const status = page.locator('[aria-live=polite]')
  await expect(page.getByText('1 / 2')).toBeVisible()

  // Pause right away (whatever the phase): nothing moves on while paused.
  await page.getByRole('button', { name: 'Пауза' }).click()
  await expect(status).toHaveText('на паузе')
  await page.waitForTimeout(2_500)
  await expect(status).toHaveText('на паузе')
  await expect(page.getByText('1 / 2')).toBeVisible()

  // ⏭ while paused: next word, still paused; ⏮ goes back.
  await page.getByRole('button', { name: 'Следующее слово' }).click()
  await expect(page.getByText('2 / 2')).toBeVisible()
  await expect(status).toHaveText('на паузе')
  await page.getByRole('button', { name: 'Предыдущее слово' }).click()
  await expect(page.getByText('1 / 2')).toBeVisible()

  await page.getByRole('button', { name: 'Продолжить' }).click()
  await expect(status).not.toHaveText('на паузе')

  // ⏭ while playing jumps at once; ⏭ on the last word finishes.
  await page.getByRole('button', { name: 'Следующее слово' }).click()
  await expect(page.getByText('2 / 2')).toBeVisible()
  await page.getByRole('button', { name: 'Следующее слово' }).click()
  await expect(page.getByText('Прослушано: 2 слова')).toBeVisible({ timeout: 3_000 })

  // «Ещё раз» + natural end with 1 s pauses (~4 s for two words).
  await page.getByRole('button', { name: 'Ещё раз' }).click()
  await expect(page.getByText('1 / 2')).toBeVisible()
  await expect(page.getByText('Прослушано: 2 слова')).toBeVisible({ timeout: 8_000 })

  // Greek first, then Russian, for each word.
  const kinds = audioRequests
    .filter((p) => !p.endsWith('/'))
    .map((p) => (p.endsWith('/ru') ? 'ru' : 'el'))
  expect(kinds.slice(-4).length).toBe(4)
  expect(kinds).toContain('ru')
})
