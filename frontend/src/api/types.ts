export type Word = {
  id: number
  dictionary_id: number
  article: string | null
  greek: string
  full_greek: string
  transcription: string
  translations_ru: string[]
  part_of_speech: PartOfSpeech | null
  example_gr: string | null
  example_ru: string | null
  image_emoji: string | null
  image_query: string | null
  category_id: number | null
  image_url: string | null
  image_credit: string | null
  audio_url: string
  audio_ru_url: string
  position: number
  known: boolean // per user: «Я знаю это слово»
}

export type WordInput = {
  article: string | null
  greek: string
  transcription: string
  translations_ru: string[]
  part_of_speech: PartOfSpeech | null
  example_gr: string | null
  example_ru: string | null
  image_emoji: string | null
  image_query: string | null
  category_id?: number | null
}

export type Dictionary = {
  id: number
  title: string
  description: string | null
  source: string
  is_published: boolean
  word_count: number
  is_active: boolean
  can_edit: boolean
}

export type DictionaryDetail = Dictionary & { words: Word[] }

export type ActiveSummary = {
  dictionaries: number
  categories: number
  words: number
  known: number // of `words`, marked as known by this user
}

export type Category = {
  id: number
  name: string
  emoji: string | null
  position: number
  word_count: number
  is_active: boolean
  can_edit: boolean
}

export type CategoryDetail = Category & { words: (Word & { dictionary_title: string })[] }

export function activeSummaryText(a: ActiveSummary): string {
  if (a.words === 0) return 'Отметьте словари или категории — их слова попадут в тренировки.'
  const parts = []
  if (a.dictionaries) parts.push(`словарей: ${a.dictionaries}`)
  if (a.categories) parts.push(`категорий: ${a.categories}`)
  return `В тренировке: ${a.words} ${pluralWords(a.words)} (${parts.join(', ')})`
}

export const ARTICLES = ['ο', 'η', 'το', 'οι', 'τα'] as const

export const PARTS_OF_SPEECH = {
  noun: 'существительное',
  verb: 'глагол',
  adjective: 'прилагательное',
  adverb: 'наречие',
  pronoun: 'местоимение',
  preposition: 'предлог',
  conjunction: 'союз',
  numeral: 'числительное',
  phrase: 'фраза',
  other: 'другое',
} as const

export type PartOfSpeech = keyof typeof PARTS_OF_SPEECH

export function pluralWords(n: number): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return 'слово'
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'слова'
  return 'слов'
}

export function pluralDictionaries(n: number): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return 'словаре'
  return 'словарях'
}

export type ImportStatus = 'uploaded' | 'awaiting_json' | 'review' | 'done'

export const IMPORT_STATUS_LABELS: Record<ImportStatus, string> = {
  uploaded: 'выбор страниц',
  awaiting_json: 'ждёт ответ Claude',
  review: 'черновик',
  done: 'опубликован',
}

export type DraftWord = Omit<
  Word,
  'dictionary_id' | 'audio_url' | 'audio_ru_url' | 'image_credit' | 'known'
> & {
  category_suggestion: string | null
  category_source: 'claude' | 'match' | 'manual' | null
  include: boolean
  note: string | null
  page: number | null
  bbox: [number, number, number, number] | null
  duplicates: string[]
}

export type ImportJob = {
  id: number
  mode: 'paste' | 'package'
  status: ImportStatus
  title: string
  source_filename: string
  has_source_pdf: boolean
  page_count: number
  selected_pages: number[]
  dictionary_id: number | null
  created_at: string
  word_count: number
}

export type ImportJobDetail = ImportJob & { words: DraftWord[]; claude_pages: number }
