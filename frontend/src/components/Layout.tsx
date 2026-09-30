import { useEffect } from 'react'
import { Outlet } from 'react-router'
import { DEFAULT_VOICE, setVoicePrefs, type VoicePrefs } from '../lib/speaker.ts'
import { useTrainerSettings } from '../trainers/common.tsx'
import NavBar from './NavBar.tsx'

// Phone: header with ☰ on top. Laptop: a row of links on top. Content centered below.
export default function Layout() {
  // The user's «Озвучка» choice, for every speak() in the app; back to default on logout.
  const [voice] = useTrainerSettings<VoicePrefs>('voice', DEFAULT_VOICE)
  useEffect(() => {
    if (voice) setVoicePrefs(voice)
    return () => setVoicePrefs(DEFAULT_VOICE)
  }, [voice])

  return (
    <div className="flex min-h-full flex-col">
      <NavBar />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 pt-4 pb-8">
        <Outlet />
      </main>
    </div>
  )
}
