import { useState } from 'react'
import { speak } from '../lib/speaker.ts'

export function IconSpeaker({ className = '' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <path d="M11 5 6 9H3v6h3l5 4z" />
      <path d="M15.5 8.5a5 5 0 0 1 0 7" />
      <path d="M18.5 5.5a9 9 0 0 1 0 13" />
    </svg>
  )
}

export default function SpeakButton({
  url,
  text,
  className = '',
  onPlay,
}: {
  url: string
  text: string
  className?: string
  /** Plays it differently (e.g. a dialogue role's own voice) instead of speak(url, text). */
  onPlay?: () => void
}) {
  const [active, setActive] = useState(false)
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        setActive(true)
        setTimeout(() => setActive(false), 900)
        if (onPlay) onPlay()
        else speak(url, text)
      }}
      className={`flex shrink-0 items-center justify-center rounded-full p-2 text-slate-500 hover:bg-slate-100 hover:text-blue-600 dark:text-slate-400 dark:hover:bg-slate-800 ${
        active ? 'text-blue-600 dark:text-blue-400' : ''
      } ${className}`}
      aria-label={`Произнести ${text}`}
    >
      <IconSpeaker className={`size-9 ${active ? 'animate-pulse' : ''}`} />
    </button>
  )
}
