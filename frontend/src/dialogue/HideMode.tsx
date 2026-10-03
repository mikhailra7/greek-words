import { useState } from 'react'
import type { DialogueDetail, DialogueLine } from '../api/types.ts'
import SpeakButton from '../components/SpeakButton.tsx'
import { Button } from '../components/ui.tsx'
import { hiddenWords, tokenize } from '../lib/greekText.ts'
import { speak } from '../lib/speaker.ts'
import type { Voice } from './voice.ts'

// Д4.3 «Постепенное скрытие»: level 0 — all the text, 1 — ~30% of the words hidden, 2 — ~60%,
// 3 — only the translation. A hidden word is a blank as wide as the word; a tap opens it and
// counts as a peek. «Готово» without peeks moves on to the next level.

const LEVEL_HINTS = ['весь текст', '~30% слов скрыто', '~60% слов скрыто', 'только перевод']

export default function HideMode({
  dialogue,
  voiceOf,
  level,
  setLevel,
}: {
  dialogue: DialogueDetail
  voiceOf: Voice
  level: number
  setLevel: (level: number) => void
}) {
  const { lines, speakers } = dialogue
  // «lineId:wordIndex» of the words opened in this pass.
  const [opened, setOpened] = useState<Set<string>>(new Set())
  const [message, setMessage] = useState('')

  const changeLevel = (next: number) => {
    setOpened(new Set())
    setMessage('')
    setLevel(next)
  }

  const done = () => {
    if (opened.size > 0) {
      setMessage(`Подсмотрено слов: ${opened.size}. Слова снова скрыты — ещё раз!`)
      setOpened(new Set())
    } else if (level < 3) {
      setOpened(new Set())
      setMessage(`Без подсказок! Уровень ${level + 1}: ${LEVEL_HINTS[level + 1]}.`)
      setLevel(level + 1)
    } else {
      setMessage('Весь диалог по памяти, без подсказок! 🎉')
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <p className="mb-2 font-medium">Уровень</p>
        <div className="grid grid-cols-4 gap-2" role="radiogroup" aria-label="Уровень">
          {LEVEL_HINTS.map((hint, i) => (
            <button
              key={i}
              role="radio"
              aria-checked={level === i}
              aria-label={`Уровень ${i}: ${hint}`}
              onClick={() => changeLevel(i)}
              className={`rounded-xl border-2 py-2 text-lg font-medium ${
                level === i
                  ? 'border-blue-600 bg-blue-50 text-blue-900 dark:bg-blue-950 dark:text-blue-100'
                  : 'border-slate-200 dark:border-slate-700'
              }`}
            >
              {i}
            </button>
          ))}
        </div>
        <p className="mt-1 text-sm text-slate-500">
          {LEVEL_HINTS[level]}. Вспоминайте вслух; нажмите на пропуск, чтобы подсмотреть слово.
        </p>
      </div>

      <ul className="space-y-3 pb-16">
        {lines.map((line) => (
          <HiddenLine
            key={line.id}
            line={line}
            speaker={speakers[line.speaker]}
            level={level}
            opened={opened}
            onOpen={(key) => setOpened((s) => new Set(s).add(key))}
            onPlay={() => speak(line.audio_url, line.greek, voiceOf(line.speaker))}
          />
        ))}
      </ul>

      <div className="sticky bottom-3 space-y-2">
        {message && (
          <p
            role="status"
            className="rounded-xl bg-white p-3 text-center shadow-lg dark:bg-slate-900"
          >
            {message}
          </p>
        )}
        <div className="flex justify-center">
          <Button onClick={done} className="shadow-lg">
            Готово{opened.size > 0 ? ` (подсмотрено: ${opened.size})` : ''}
          </Button>
        </div>
      </div>
    </div>
  )
}

const BUBBLE = [
  'bg-white dark:bg-slate-900',
  'bg-blue-50 dark:bg-blue-950/60',
  'bg-emerald-50 dark:bg-emerald-950/60',
]

function HiddenLine({
  line,
  speaker,
  level,
  opened,
  onOpen,
  onPlay,
}: {
  line: DialogueLine
  speaker: string
  level: number
  opened: Set<string>
  onOpen: (key: string) => void
  onPlay: () => void
}) {
  const tokens = tokenize(line.greek)
  const wordCount = tokens.filter((t) => t.word).length
  const hidden = hiddenWords(line.id, wordCount, level)
  let w = -1
  const left = line.speaker === 0
  return (
    <li className={`flex ${left ? 'justify-start' : 'justify-end'}`}>
      <div
        className={`relative max-w-[85%] min-w-0 rounded-2xl px-4 py-2.5 pr-12 shadow-sm ${BUBBLE[line.speaker % 3]} ${
          left ? 'rounded-bl-md' : 'rounded-br-md'
        }`}
      >
        <span className="block text-xs font-medium text-slate-500 dark:text-slate-400" lang="el">
          {speaker}
        </span>
        <span lang="el" className="block text-lg leading-relaxed break-words">
          {tokens.map((t, i) => {
            if (!t.word) return <span key={i}>{t.text}</span>
            w++
            const key = `${line.id}:${w}`
            if (!hidden.has(w)) return <span key={i}>{t.text}</span>
            if (opened.has(key))
              return (
                <span key={i} className="rounded bg-amber-100 px-0.5 dark:bg-amber-900/60">
                  {t.text}
                </span>
              )
            return (
              <button
                key={i}
                type="button"
                onClick={() => onOpen(key)}
                aria-label="Скрытое слово — открыть"
                // As wide as the word: the word itself, invisible, over an underline.
                className="rounded-sm border-b-2 border-slate-400 text-transparent select-none hover:bg-slate-200/60 dark:border-slate-500 dark:hover:bg-slate-700/60"
              >
                {t.text}
              </button>
            )
          })}
        </span>
        {level === 0 && line.transcription && (
          <span className="block text-slate-500 italic break-words dark:text-slate-400">
            {line.transcription}
          </span>
        )}
        <span className="block break-words">{line.translation_ru}</span>
        <SpeakButton
          url={line.audio_url}
          text={line.greek}
          className="absolute top-1 right-1 [&_svg]:size-6"
          onPlay={onPlay}
        />
      </div>
    </li>
  )
}
