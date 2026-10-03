// Words of a line, for the dialogue modes that hide or shuffle them (SPEC «Диалоги», Д4.3–Д4.5).

export type Token = { text: string; word: boolean }

// A word: letters and digits (accented Greek included), with an inner apostrophe (σ’ αγαπώ).
const WORD = /[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu

/** The line split into words and what's between them (spaces, punctuation), in order. */
export function tokenize(text: string): Token[] {
  const tokens: Token[] = []
  let last = 0
  for (const m of text.matchAll(WORD)) {
    if (m.index > last) tokens.push({ text: text.slice(last, m.index), word: false })
    tokens.push({ text: m[0], word: true })
    last = m.index + m[0].length
  }
  if (last < text.length) tokens.push({ text: text.slice(last), word: false })
  return tokens
}

export const words = (text: string): string[] =>
  tokenize(text)
    .filter((t) => t.word)
    .map((t) => t.text)

// «Постепенное скрытие»: level → share of words hidden. Level 3 hides them all.
export const HIDE_LEVELS = [0, 0.3, 0.6, 1] as const

/** Indexes (among the line's words) hidden at `level`. Not random: every word has a fixed
 * place in the queue (from the line id), so a higher level hides the same words plus more. */
export function hiddenWords(lineId: number, wordCount: number, level: number): Set<number> {
  if (level <= 0 || wordCount === 0) return new Set()
  const share = HIDE_LEVELS[Math.min(level, 3)]
  const count = level >= 3 ? wordCount : Math.max(1, Math.round(wordCount * share))
  const queue = Array.from({ length: wordCount }, (_, i) => i).sort(
    (a, b) => rank(lineId, a) - rank(lineId, b) || a - b,
  )
  return new Set(queue.slice(0, count))
}

// A fixed pseudo-random number per (line, word).
function rank(lineId: number, i: number): number {
  let h = (lineId * 2654435761 + (i + 1) * 40503) >>> 0
  h ^= h >>> 15
  h = Math.imul(h, 2246822507) >>> 0
  h ^= h >>> 13
  return h >>> 0
}

// --- «Ввод по памяти» (Д4.5): a lenient comparison ---

/** A word as compared in «Ввод по памяти»: no accents or diaeresis, lower case, σ for ς. */
export function looseWord(word: string): string {
  return word.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/ς/g, 'σ')
}

export type LooseCheck = {
  correct: boolean
  /** Per typed word / per word of the line: true = it matches. */
  given: { text: string; ok: boolean }[]
  expected: { text: string; ok: boolean }[]
  latin: boolean
}

/** Case, punctuation, accents and ς/σ don't matter; the words and their order do. Matching
 * words are found by the longest common subsequence, so one missed word marks only itself. */
export function compareLoose(typed: string, line: string): LooseCheck {
  const given = words(typed)
  const expected = words(line)
  const a = given.map(looseWord)
  const b = expected.map(looseWord)
  const lcs = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0))
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1])
  const okA = new Array<boolean>(a.length).fill(false)
  const okB = new Array<boolean>(b.length).fill(false)
  for (let i = 0, j = 0; i < a.length && j < b.length;) {
    if (a[i] === b[j]) {
      okA[i++] = true
      okB[j++] = true
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) i++
    else j++
  }
  return {
    correct: a.length === b.length && okA.every(Boolean),
    given: given.map((text, i) => ({ text, ok: okA[i] })),
    expected: expected.map((text, i) => ({ text, ok: okB[i] })),
    latin: /[a-z]/i.test(typed),
  }
}
