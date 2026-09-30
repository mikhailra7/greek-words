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
