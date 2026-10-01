import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api/client.ts'
import type { Word } from '../api/types.ts'
import SpeakButton from '../components/SpeakButton.tsx'
import { Button } from '../components/ui.tsx'
import { speak } from '../lib/speaker.ts'
import { WordPicture, type Mistake } from './common.tsx'

export type Direction = 'ru_gr' | 'gr_ru'
export type Option = { word_id: number; text: string }

// One «Переведи» question: card + 4 options. Used by «Переведи» and «Микс заданий».
// Mount it with a key per question so its state starts fresh.
export default function ChoiceTask({
  word,
  options,
  direction,
  showAnswer,
  speakAnswer = false,
  onAnswered,
  onNext,
}: {
  word: Word
  options: Option[]
  direction: Direction
  showAnswer: boolean
  /** «Воспроизвести ответ»: say the Greek word when the right answer is shown. */
  speakAnswer?: boolean
  onAnswered: (mistake: Mistake | null) => void
  onNext: () => void
}) {
  const [chosen, setChosen] = useState<Option | null>(null)
  // Enter on the focused «Далее» fires both the key handler and the click: advance once.
  const advanced = useRef(false)
  const next = useCallback(() => {
    if (advanced.current) return
    advanced.current = true
    onNext()
  }, [onNext])

  const answer = useCallback(
    (opt: Option) => {
      if (chosen) return
      const correct = opt.word_id === word.id
      const right = options.find((o) => o.word_id === word.id)!
      onAnswered(
        correct
          ? null
          : {
              word,
              prompt: direction === 'ru_gr' ? word.translations_ru.join(', ') : word.full_greek,
              correct: right.text,
              given: opt.text,
              greek: direction === 'ru_gr',
            },
      )
      api('/training/answers', {
        method: 'POST',
        body: JSON.stringify({
          word_id: word.id,
          mode: 'translate',
          direction,
          is_correct: correct,
          given_answer: opt.text,
        }),
      }).catch(() => {})
      if (showAnswer) {
        setChosen(opt)
        // Inside the tap, so iOS lets it play.
        if (speakAnswer) speak(word.audio_url, word.full_greek)
      } else next()
    },
    [chosen, word, options, direction, showAnswer, speakAnswer, onAnswered, next],
  )

  // Laptop: 1–4 choose, Enter — «Далее».
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const n = Number(e.key)
      if (!chosen && n >= 1 && n <= options.length) answer(options[n - 1])
      else if (chosen && e.key === 'Enter') next()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [answer, next, chosen, options])

  const optionClass = (opt: Option) => {
    if (!chosen) {
      return 'border-slate-200 bg-white hover:border-blue-400 active:bg-blue-50 dark:border-slate-700 dark:bg-slate-900 dark:active:bg-slate-800'
    }
    if (opt.word_id === word.id)
      return 'border-green-600 bg-green-50 text-green-900 dark:bg-green-950 dark:text-green-100'
    if (opt === chosen)
      return 'border-red-600 bg-red-50 text-red-900 dark:bg-red-950 dark:text-red-100'
    return 'border-slate-200 bg-white opacity-50 dark:border-slate-700 dark:bg-slate-900'
  }

  return (
    <>
      <article className="relative rounded-3xl bg-white p-4 text-center shadow-lg dark:bg-slate-900">
        {direction === 'ru_gr' ? (
          <>
            <WordPicture
              word={word}
              className="mx-auto aspect-square max-h-[34dvh] w-full [@media(max-height:700px)]:max-h-[24dvh]"
            />
            <p className="pt-4 pb-1 text-2xl font-semibold">{word.translations_ru.join(', ')}</p>
          </>
        ) : (
          <>
            <SpeakButton
              url={word.audio_url}
              text={word.full_greek}
              className="absolute top-2 right-2"
            />
            <p lang="el" className="px-8 py-10 text-4xl font-semibold break-words">
              {word.full_greek}
            </p>
          </>
        )}
      </article>

      <ul className="grid gap-2">
        {options.map((opt, i) => (
          <li key={opt.word_id}>
            <button
              onClick={() => answer(opt)}
              disabled={!!chosen}
              lang={direction === 'ru_gr' ? 'el' : undefined}
              className={`flex w-full items-center gap-3 rounded-2xl border-2 px-4 py-3.5 text-left text-lg transition-colors ${optionClass(opt)}`}
            >
              <span className="hidden text-sm text-slate-400 md:inline">{i + 1}</span>
              {opt.text}
            </button>
          </li>
        ))}
      </ul>

      <div className="h-12">
        {chosen && (
          <Button onClick={next} className="w-full py-3 text-base" autoFocus>
            {chosen.word_id === word.id ? 'Верно! Далее' : 'Далее'}
          </Button>
        )}
      </div>
    </>
  )
}
