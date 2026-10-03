import type { SpeakOptions } from '../lib/speaker.ts'

/** The site voice of a role (or {} — the profile's voice, «Один голос»). */
export type Voice = (speaker: number) => SpeakOptions

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
