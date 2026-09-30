// One shared <audio> for the whole app.
//
// iOS Safari only lets a page play sound after a user gesture has started playback once;
// `unlockAudio()` is called from such a gesture (e.g. the «Начать» button) and later
// `speak()` calls — including the delayed auto-play on a card — are then allowed.
// If the server audio fails (TTS down), fall back to the browser's own Greek voice.
//
// Each user picks their voice in the profile («Озвучка»): the site's voice (female or male,
// speed of Greek speech) or the voice of their own phone/computer. `setVoicePrefs` is fed
// from the saved settings; every speak/preload/playUntilEnd call follows it.

export type VoicePrefs = { device: boolean; male: boolean; speed: number }
export const DEFAULT_VOICE: VoicePrefs = { device: false, male: false, speed: -10 }
export const SPEEDS = [-30, -20, -10, 0, 10] as const

let prefs: VoicePrefs = DEFAULT_VOICE

export function setVoicePrefs(p: VoicePrefs): void {
  prefs = p
}

/** Server URL for the chosen voice. The default voice keeps the plain URL (same file). */
export function voiceUrl(url: string): string {
  const params = []
  if (prefs.male) params.push('voice=male')
  if (!url.includes('/audio/ru') && prefs.speed !== DEFAULT_VOICE.speed)
    params.push(`rate=${prefs.speed}`) // Russian is always read at normal speed
  if (!params.length) return url
  return url + (url.includes('?') ? '&' : '?') + params.join('&')
}

type Lang = 'el-GR' | 'ru-RU'

/** Does this device have a voice for `lang`? (Unknown yet — the list loads late in Chrome —
 * counts as yes.) Without one, «голос устройства» falls back to the site's voice. */
export function hasDeviceVoice(lang: Lang): boolean {
  if (!('speechSynthesis' in window)) return false
  const voices = speechSynthesis.getVoices()
  const code = lang.slice(0, 2)
  return voices.length === 0 || voices.some((v) => v.lang.toLowerCase().startsWith(code))
}
if ('speechSynthesis' in window) speechSynthesis.getVoices() // starts loading the list

const onDevice = (lang: Lang) => prefs.device && hasDeviceVoice(lang)
const deviceRate = (lang: Lang) => (lang === 'el-GR' ? 1 + prefs.speed / 100 : 1)

const SILENT_WAV =
  'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA='

let audio: HTMLAudioElement | null = null
let unlocked = false

function player(): HTMLAudioElement {
  if (!audio) {
    audio = new Audio()
    audio.preload = 'auto'
  }
  return audio
}

export function unlockAudio(): void {
  // iOS: the speech engine also wants its first utterance inside a tap.
  if (prefs.device && 'speechSynthesis' in window)
    speechSynthesis.speak(new SpeechSynthesisUtterance(''))
  if (unlocked) return
  const a = player()
  a.src = SILENT_WAV
  a.play()
    .then(() => (unlocked = true))
    .catch(() => {})
}

function browserVoice(text: string): void {
  if (!('speechSynthesis' in window)) return
  const u = new SpeechSynthesisUtterance(text)
  u.lang = 'el-GR'
  u.rate = deviceRate('el-GR')
  speechSynthesis.cancel()
  speechSynthesis.speak(u)
}

export async function speak(url: string, text: string): Promise<void> {
  const a = player()
  a.pause()
  if (onDevice('el-GR')) return browserVoice(text)
  a.src = voiceUrl(url)
  try {
    await a.play()
    unlocked = true
  } catch (e) {
    // NotAllowedError = no gesture yet; anything else = the file didn't load.
    if ((e as DOMException).name !== 'NotAllowedError') browserVoice(text)
  }
}

// Warm the browser cache for the next card.
export function preload(url: string): void {
  if (prefs.device) return
  const link = document.createElement('link')
  link.rel = 'prefetch'
  link.href = voiceUrl(url)
  document.head.appendChild(link)
  setTimeout(() => link.remove(), 30_000)
}

// --- sequential playback for «Аудио повторение» ---

let fallbackActive = false
// Settles the clip that is playing right now (so a jump to another word doesn't hang).
let settleCurrent: (() => void) | null = null

function browserVoiceUntilEnd(text: string, lang: Lang): Promise<void> {
  return new Promise((resolve) => {
    if (!('speechSynthesis' in window)) return resolve()
    const u = new SpeechSynthesisUtterance(text)
    u.lang = lang
    u.rate = deviceRate(lang)
    fallbackActive = true
    u.onend = u.onerror = () => {
      fallbackActive = false
      settleCurrent = null
      resolve()
    }
    settleCurrent = () => {
      fallbackActive = false
      settleCurrent = null
      resolve()
    }
    speechSynthesis.cancel()
    speechSynthesis.speak(u)
  })
}

/** Plays `url` and resolves when it has finished (or fell back to the browser voice). */
export function playUntilEnd(url: string, text: string, lang: Lang): Promise<void> {
  const a = player()
  a.pause()
  if (onDevice(lang)) return browserVoiceUntilEnd(text, lang)
  return new Promise((resolve) => {
    let settled = false
    const done = () => {
      if (settled) return
      settled = true
      settleCurrent = null
      a.removeEventListener('ended', done)
      a.removeEventListener('error', failed)
      resolve()
    }
    const failed = () => {
      if (settled) return
      a.removeEventListener('ended', done)
      a.removeEventListener('error', failed)
      settled = true
      browserVoiceUntilEnd(text, lang).then(resolve)
    }
    settleCurrent = done
    a.addEventListener('ended', done)
    a.addEventListener('error', failed)
    a.src = voiceUrl(url)
    a.play()
      .then(() => (unlocked = true))
      .catch((e: DOMException) => (e.name === 'AbortError' ? undefined : failed()))
  })
}

export function pausePlayback(): void {
  if (fallbackActive) speechSynthesis.pause()
  else player().pause()
}

export function resumePlayback(): void {
  if (fallbackActive) speechSynthesis.resume()
  else if (player().getAttribute('src') && !player().ended)
    player()
      .play()
      .catch(() => {})
}

/** Stops the current clip; a pending playUntilEnd() resolves right away. */
export function stopPlayback(): void {
  const a = player()
  a.pause()
  a.removeAttribute('src') // so a later resumePlayback() can't restart the old clip
  if ('speechSynthesis' in window) speechSynthesis.cancel()
  fallbackActive = false
  settleCurrent?.()
}
