import type { ReactNode } from 'react'
import type { DialogueLine } from '../api/types.ts'

// Shared by the dialogue modes (SPEC «Диалоги», Д4).

// --- the chat ---

const BUBBLE = [
  'bg-white dark:bg-slate-900',
  'bg-blue-50 dark:bg-blue-950/60',
  'bg-emerald-50 dark:bg-emerald-950/60',
]

export function Bubble({
  line,
  speakers,
  show,
  active = false,
  onTap,
  children,
  bubbleRef,
}: {
  line: DialogueLine
  speakers: string[]
  show: { greek: boolean; transcription: boolean; translation: boolean }
  active?: boolean
  onTap?: () => void
  children?: ReactNode
  bubbleRef?: (el: HTMLLIElement | null) => void
}) {
  const left = line.speaker === 0
  const body = (
    <>
      <span className="block text-xs font-medium text-slate-500 dark:text-slate-400" lang="el">
        {speakers[line.speaker]}
      </span>
      {show.greek && (
        <span lang="el" className="block text-lg break-words">
          {line.greek}
        </span>
      )}
      {show.transcription && line.transcription && (
        <span className="block text-slate-500 italic break-words dark:text-slate-400">
          {line.transcription}
        </span>
      )}
      {show.translation && <span className="block break-words">{line.translation_ru}</span>}
      {show.translation && line.note && (
        <span className="mt-1 block text-xs text-amber-700 dark:text-amber-400">{line.note}</span>
      )}
    </>
  )
  const cls = `max-w-[85%] min-w-0 rounded-2xl px-4 py-2.5 text-left shadow-sm ${BUBBLE[line.speaker % 3]} ${
    left ? 'rounded-bl-md' : 'rounded-br-md'
  } ${active ? 'ring-2 ring-blue-500' : ''}`
  return (
    <li ref={bubbleRef} className={`flex ${left ? 'justify-start' : 'justify-end'}`}>
      <div className={cls}>
        {onTap ? (
          <button type="button" onClick={onTap} className="block w-full text-left">
            {body}
          </button>
        ) : (
          body
        )}
        {children}
      </div>
    </li>
  )
}
