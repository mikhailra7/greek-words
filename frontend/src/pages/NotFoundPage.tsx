import { Link } from 'react-router'
import PageStub from '../components/PageStub.tsx'

export default function NotFoundPage() {
  return (
    <PageStub title="Страница не найдена">
      <Link to="/" className="text-blue-600 underline dark:text-blue-400">
        На главную
      </Link>
    </PageStub>
  )
}
