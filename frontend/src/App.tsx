import { Route, Routes } from 'react-router'
import { GuestOnly, RequireAdmin, RequireAuth } from './auth/guards.tsx'
import Layout from './components/Layout.tsx'
import AdminPage from './pages/AdminPage.tsx'
import CategoryPage from './pages/CategoryPage.tsx'
import DialoguePage from './pages/DialoguePage.tsx'
import DialoguesPage from './pages/DialoguesPage.tsx'
import DictionariesPage from './pages/DictionariesPage.tsx'
import DictionaryPage from './pages/DictionaryPage.tsx'
import HomePage from './pages/HomePage.tsx'
import ImportJobPage from './pages/ImportJobPage.tsx'
import ImportListPage from './pages/ImportListPage.tsx'
import ListenPage from './pages/ListenPage.tsx'
import LoginPage from './pages/LoginPage.tsx'
import MixPage from './pages/MixPage.tsx'
import NotFoundPage from './pages/NotFoundPage.tsx'
import ProfilePage from './pages/ProfilePage.tsx'
import RegisterPage from './pages/RegisterPage.tsx'
import StudyPage from './pages/StudyPage.tsx'
import TranslatePage from './pages/TranslatePage.tsx'
import WritePage from './pages/WritePage.tsx'

export default function App() {
  return (
    <Routes>
      <Route element={<GuestOnly />}>
        <Route path="login" element={<LoginPage />} />
        <Route path="register" element={<RegisterPage />} />
      </Route>
      <Route element={<RequireAuth />}>
        <Route element={<Layout />}>
          <Route index element={<HomePage />} />
          <Route path="dictionaries" element={<DictionariesPage />} />
          <Route path="dictionaries/:id" element={<DictionaryPage />} />
          <Route path="categories/:id" element={<CategoryPage />} />
          <Route path="study" element={<StudyPage />} />
          <Route path="translate" element={<TranslatePage />} />
          <Route path="write" element={<WritePage />} />
          <Route path="mix" element={<MixPage />} />
          <Route path="listen" element={<ListenPage />} />
          <Route path="dialogues" element={<DialoguesPage />} />
          <Route path="dialogues/:id" element={<DialoguePage />} />
          <Route path="profile" element={<ProfilePage />} />
          <Route element={<RequireAdmin />}>
            <Route path="admin" element={<AdminPage />} />
            <Route path="import" element={<ImportListPage />} />
            <Route path="import/:id" element={<ImportJobPage />} />
          </Route>
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Route>
    </Routes>
  )
}
