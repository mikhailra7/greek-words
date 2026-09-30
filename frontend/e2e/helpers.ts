import type { APIRequestContext, Page } from '@playwright/test'

export type SeedWord = {
  article?: string
  greek: string
  translations_ru: string[]
  part_of_speech?: string
  transcription?: string
}

export const WORDS: SeedWord[] = [
  { article: 'το', greek: 'νερό', translations_ru: ['вода'], part_of_speech: 'noun' },
  { article: 'το', greek: 'ψωμί', translations_ru: ['хлеб'], part_of_speech: 'noun' },
  { article: 'το', greek: 'γάλα', translations_ru: ['молоко'], part_of_speech: 'noun' },
  { article: 'το', greek: 'τυρί', translations_ru: ['сыр'], part_of_speech: 'noun' },
]

/** Dictionary + words through the API (as the logged-in admin of `request`). */
export async function seedDictionary(
  request: APIRequestContext,
  title: string,
  words: SeedWord[] = WORDS,
): Promise<number> {
  const d = await (await request.post('/api/dictionaries', { data: { title } })).json()
  for (const w of words) await request.post(`/api/dictionaries/${d.id}/words`, { data: w })
  return d.id
}

/** Only this dictionary is active for the current user. */
export async function activateOnly(request: APIRequestContext, dictionaryId: number) {
  const { dictionaries } = await (await request.get('/api/dictionaries')).json()
  for (const d of dictionaries as { id: number }[]) {
    await request.put(`/api/dictionaries/${d.id}/active`, {
      data: { active: d.id === dictionaryId },
    })
  }
}

/** Set a range input from the test (drag precision isn't the point here). */
export async function setSlider(page: Page, value: number, nth = 0) {
  await page
    .locator('input[type=range]')
    .nth(nth)
    .evaluate((el, v) => {
      const input = el as HTMLInputElement
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      setter.call(input, String(v))
      input.dispatchEvent(new Event('input', { bubbles: true }))
    }, value)
}

export function findWord(text: string): SeedWord {
  const w = WORDS.find((x) => x.translations_ru.join(', ') === text)
  if (!w) throw new Error(`unknown prompt ${text}`)
  return w
}

export const fullGreek = (w: SeedWord) => (w.article ? `${w.article} ${w.greek}` : w.greek)

export type Spoken = { text: string; rate: number }

/** Stands in for the browser's speech engine, with one Greek voice. `works`: phrases start and
 * end like on a real device; `stuck`: phrases are accepted but never start — what Safari (iOS)
 * and Chrome (macOS) sometimes do. `window.spoken` lists the phrases (the empty «unlock» phrase
 * aside), `window.speechCalls` counts speak/cancel. */
export async function fakeSpeech(page: Page, mode: 'works' | 'stuck' = 'works') {
  await page.addInitScript((mode) => {
    const w = window as unknown as {
      spoken: { text: string; rate: number }[]
      speechCalls: { speak: number; cancel: number }
    }
    w.spoken = []
    w.speechCalls = { speak: 0, cancel: 0 }
    let current: SpeechSynthesisUtterance | null = null
    const fire = (u: SpeechSynthesisUtterance, type: string, error?: string) =>
      u.dispatchEvent(
        error
          ? new SpeechSynthesisErrorEvent(type, { utterance: u, error: error as never })
          : new SpeechSynthesisEvent(type, { utterance: u }),
      )
    const s = speechSynthesis
    Object.defineProperty(s, 'speaking', { get: () => current !== null })
    Object.defineProperty(s, 'pending', { get: () => false })
    // Not a real SpeechSynthesisVoice: the page must cope (u.voice = … throws on it).
    s.getVoices = () =>
      [{ lang: 'el-GR', name: 'Melina', default: false, localService: true }] as never
    s.speak = (u: SpeechSynthesisUtterance) => {
      w.speechCalls.speak++
      if (u.text) w.spoken.push({ text: u.text, rate: Math.round(u.rate * 100) / 100 })
      current = u
      if (mode === 'stuck' && u.text) return
      setTimeout(() => current === u && fire(u, 'start'), 10)
      setTimeout(() => {
        if (current !== u) return
        current = null
        fire(u, 'end')
      }, 150)
    }
    s.cancel = () => {
      w.speechCalls.cancel++
      const u = current
      current = null
      if (u) fire(u, 'error', 'interrupted')
    }
  }, mode)
  return {
    spoken: () => page.evaluate(() => (window as unknown as { spoken: Spoken[] }).spoken),
    calls: () =>
      page.evaluate(
        () => (window as unknown as { speechCalls: { speak: number; cancel: number } }).speechCalls,
      ),
  }
}
