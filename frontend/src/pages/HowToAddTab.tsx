import { useEffect, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router'
import { api } from '../api/client.ts'
import type { Dictionary } from '../api/types.ts'
import { Button, Card, ErrorText } from '../components/ui.tsx'

// «Как добавить словари» (admins): every way to get words onto the site, step by step,
// with the Claude prompts to copy and a box to paste a word-list answer into.
export default function HowToAddTab() {
  return (
    <div className="space-y-3">
      <Card className="space-y-2 text-sm">
        <p className="font-medium">Какой способ выбрать</p>
        <ul className="space-y-1.5 text-slate-600 dark:text-slate-400">
          <li>
            <b className="text-slate-900 dark:text-slate-100">Страницы учебника</b> (до ~10 за раз)
            — через claude.ai, можно с телефона. Слова, транскрипция, переводы и картинки из
            учебника.
          </li>
          <li>
            <b className="text-slate-900 dark:text-slate-100">Большой учебник</b> (20+ страниц) —
            через Claude Code на компьютере с проектом.
          </li>
          <li>
            <b className="text-slate-900 dark:text-slate-100">Список слов</b> без картинок (текст,
            таблица, фото списка) — через claude.ai, вставка прямо на этой странице.
          </li>
          <li>
            <b className="text-slate-900 dark:text-slate-100">Пара слов или исправление</b> —
            вручную.
          </li>
        </ul>
        <p className="text-slate-500">
          Платный Claude API не нужен: Claude работает через обычный чат claude.ai или Claude Code.
        </p>
      </Card>

      <Section title="1. Страницы учебника через claude.ai" open>
        <Steps>
          <li>
            <Link to="/import" className={link}>
              «Импорт из учебника»
            </Link>{' '}
            → «Загрузить PDF или фото». До 50 МБ и 30 страниц. DOC/DOCX сначала сохраните как PDF.
            Сканируйте лучше в 300 dpi — картинки будут чётче.
          </li>
          <li>
            Отметьте нужные страницы — <b>не больше 5–10 за раз</b>, иначе ответ Claude может
            оборваться — и нажмите «Дальше».
          </li>
          <li>
            «Скачать PDF» — это выбранные страницы с координатной сеткой: по ней Claude указывает,
            где на странице картинка к слову.
          </li>
          <li>«Скопировать промпт». Он же — ниже, в нём уже есть текущий список категорий.</li>
          <li>
            Откройте{' '}
            <a href="https://claude.ai/new" target="_blank" rel="noreferrer" className={link}>
              новый чат claude.ai
            </a>
            , приложите PDF, вставьте промпт и отправьте. Ответ может занять пару минут.
          </li>
          <li>
            Нажмите «Copy» на блоке с JSON в ответе Claude, на сайте — «Вставить из буфера» →
            «Проверить». Сайт проверит ответ и вырежет картинки.
          </li>
          <li>Проверьте черновик (список ниже), введите название словаря → «Опубликовать».</li>
        </Steps>
        <PromptBox kind="import" label="Промпт для страниц учебника" />
        <Checklist />
        <Trouble />
      </Section>

      <Section title="2. Большой учебник через Claude Code">
        <p>
          Для 20+ страниц: Claude Code сам разбирает страницы по частям, вырезает картинки и
          проверяет, что в них не попала подпись. Нужен компьютер с папкой проекта и Claude Code.
        </p>
        <Steps>
          <li>
            Положите PDF в папку <Code>import_inbox/</Code> проекта.
          </li>
          <li>
            Откройте Claude Code в папке проекта и напишите:
            <Pre>разбери учебник import_inbox/имя-файла.pdf</Pre>
            Claude Code возьмёт инструкцию из скилла <Code>import-textbook</Code> и тот же промпт с
            актуальными категориями.
          </li>
          <li>
            В конце он отчитается: сколько слов, сколько с картинками, что было неоднозначно. Архив
            появится в <Code>import_outbox/имя-файла.zip</Code>.
          </li>
          <li>
            На сайте:{' '}
            <Link to="/import" className={link}>
              «Импорт из учебника»
            </Link>{' '}
            → «Загрузить архив (zip)» → тот же черновик, что и в способе 1 → «Опубликовать».
          </li>
        </Steps>
      </Section>

      <Section title="3. Список слов без учебника">
        <p>
          Подходит для списка из чата, таблицы, фото или скриншота списка. Картинок из учебника не
          будет — у слов эмодзи, фото можно подобрать потом.
        </p>
        <Steps>
          <li>Скопируйте промпт для списка (ниже).</li>
          <li>
            В{' '}
            <a href="https://claude.ai/new" target="_blank" rel="noreferrer" className={link}>
              новом чате claude.ai
            </a>{' '}
            вставьте промпт, а сразу под ним — ваш список (или приложите фото / файл со списком).
          </li>
          <li>Нажмите «Copy» на блоке с JSON и вставьте ответ в поле ниже → «Создать словарь».</li>
          <li>
            Словарь создаётся сразу, без черновика — откройте его и просмотрите слова (нажмите на
            слово, чтобы исправить). Категории — кнопкой «Без категории: N», фото — в карточке
            слова: «Найти на стоке» или «Загрузить картинку».
          </li>
        </Steps>
        <PromptBox kind="wordlist" label="Промпт для списка слов" />
        <PasteDictionary />
      </Section>

      <Section title="4. Вручную">
        <Steps>
          <li>На вкладке «Словари» — «+ Новый словарь» (или откройте существующий).</li>
          <li>
            «+ Слово»: артикль, слово по-гречески с ударением, транскрипция латиницей («to neró»),
            1–3 перевода, часть речи, категория.
          </li>
          <li>
            После сохранения форма остаётся открытой — можно сразу «Загрузить картинку» или «Найти
            на стоке». Озвучка появится сама.
          </li>
        </Steps>
      </Section>

      <Section title="5. Резервная копия и перенос">
        <p>
          У словаря — «Скачать архив»: zip со словами, категориями и картинками. Загрузить его
          обратно (на этот же или другой сайт) — на вкладке «Словари» кнопкой «Загрузить JSON /
          архив»: архив откроется черновиком, как после импорта. Там же можно загрузить .json в
          формате промпта для списка — словарь создастся сразу.
        </p>
      </Section>

      <Section title="6. После публикации">
        <ul className="list-disc space-y-1.5 pl-5">
          <li>
            Словарь сразу виден всей группе. Каждый сам отмечает его галочкой, чтобы слова попали в
            тренировки.
          </li>
          <li>
            Озвучка создаётся в фоне. Если слово звучит плохо — в карточке слова «Перегенерировать
            звук».
          </li>
          <li>
            Ошибку в слове можно исправить в любой момент: откройте словарь и нажмите на слово.
          </li>
          <li>Новые слова без категории видны по кнопке «Без категории: N» в словаре.</li>
        </ul>
      </Section>
    </div>
  )
}

const link = 'text-blue-600 underline dark:text-blue-400'

function Section({
  title,
  open,
  children,
}: {
  title: string
  open?: boolean
  children: ReactNode
}) {
  return (
    <details
      open={open}
      className="group rounded-2xl bg-white shadow-sm dark:bg-slate-900 [&_summary::-webkit-details-marker]:hidden"
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-3.5 font-medium">
        {title}
        <span className="text-slate-400 transition-transform group-open:rotate-90">›</span>
      </summary>
      <div className="space-y-4 px-4 pb-4 text-sm leading-relaxed">{children}</div>
    </details>
  )
}

function Steps({ children }: { children: ReactNode }) {
  return <ol className="list-decimal space-y-2 pl-5 marker:text-slate-400">{children}</ol>
}

function Code({ children }: { children: ReactNode }) {
  return (
    <code className="rounded bg-slate-100 px-1 py-0.5 text-[0.85em] dark:bg-slate-800">
      {children}
    </code>
  )
}

function Pre({ children }: { children: ReactNode }) {
  return (
    <pre className="my-2 overflow-x-auto rounded-xl bg-slate-100 p-3 text-xs whitespace-pre-wrap dark:bg-slate-800">
      {children}
    </pre>
  )
}

function Checklist() {
  return (
    <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-800/60">
      <p className="mb-2 font-medium">Что проверить в черновике</p>
      <ul className="list-disc space-y-1 pl-5">
        <li>ударения в словах и в транскрипции;</li>
        <li>артикль у каждого существительного (ο, η, το, οι, τα);</li>
        <li>множественное число осталось множественным («τα μήλα» — «яблоки»);</li>
        <li>переводы — самый частый первым, не больше трёх;</li>
        <li>
          картинка: рисунок целиком и <b>без подписи со словом</b> (иначе она подскажет ответ).
          Нажмите на слово → рамку можно поправить пальцем или мышкой;
        </li>
        <li>«уже есть в «…»» — такое слово уже есть в другом словаре; лишнее снимите галочкой;</li>
        <li>новые категории от Claude — «Создать» или выберите слову существующую категорию.</li>
      </ul>
    </div>
  )
}

function Trouble() {
  return (
    <div className="rounded-xl bg-amber-50 p-3 text-amber-950 dark:bg-amber-950/60 dark:text-amber-100">
      <p className="mb-2 font-medium">Если что-то пошло не так</p>
      <ul className="list-disc space-y-1 pl-5">
        <li>
          «Не нашёл JSON» или «JSON повреждён» — ответ скопирован не целиком. Нажмите «Copy» именно
          на блоке с кодом. Если ответ Claude оборвался — у страниц нажмите «Изменить», выберите
          меньше и повторите.
        </li>
        <li>
          «JSON не подходит: слово N, поле …» — напишите Claude в том же чате, что исправить, и
          попросите прислать JSON целиком заново.
        </li>
        <li>
          Результат не понравился — в черновике «Вставить ответ Claude заново» (например, после
          повторной попытки в новом чате).
        </li>
      </ul>
    </div>
  )
}

function PromptBox({ kind, label }: { kind: 'import' | 'wordlist'; label: string }) {
  const [prompt, setPrompt] = useState('')
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState('')

  // Loaded up front: on iOS the clipboard write must happen right inside the tap.
  useEffect(() => {
    fetch(`/api/imports/prompt?kind=${kind}`)
      .then((r) => (r.ok ? r.text() : Promise.reject()))
      .then(setPrompt)
      .catch(() => setError('Не удалось загрузить промпт'))
  }, [kind])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(prompt)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setError('Браузер не дал скопировать — выделите текст промпта и скопируйте вручную')
    }
  }

  return (
    <div className="space-y-2 rounded-xl border border-slate-200 p-3 dark:border-slate-700">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium">{label}</span>
        <Button variant="secondary" onClick={copy} disabled={!prompt}>
          {copied ? 'Скопировано ✓' : 'Скопировать промпт'}
        </Button>
      </div>
      <ErrorText>{error}</ErrorText>
      {prompt && (
        <details>
          <summary className="cursor-pointer text-slate-500">Показать текст промпта</summary>
          <pre className="mt-2 max-h-80 overflow-auto rounded-lg bg-slate-100 p-3 text-xs whitespace-pre-wrap dark:bg-slate-800">
            {prompt}
          </pre>
        </details>
      )}
    </div>
  )
}

function PasteDictionary() {
  const navigate = useNavigate()
  const [text, setText] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const pasteFromClipboard = async () => {
    try {
      setText(await navigator.clipboard.readText())
    } catch {
      setError('Браузер не дал прочитать буфер — вставьте вручную в поле')
    }
  }

  const submit = async () => {
    setBusy(true)
    setError('')
    try {
      const d = await api<Dictionary>('/dictionaries/import/text', {
        method: 'POST',
        body: JSON.stringify({ text }),
      })
      navigate(`/dictionaries/${d.id}`)
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }

  return (
    <div className="space-y-2">
      <label className="block font-medium" htmlFor="wordlist-json">
        JSON от Claude
      </label>
      <textarea
        id="wordlist-json"
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={6}
        placeholder='{"schema_version": 1, "title": "…", "words": [ … ] }'
        className="w-full rounded-xl border border-slate-300 bg-white p-3 font-mono text-xs dark:border-slate-700 dark:bg-slate-900"
      />
      <ErrorText>{error}</ErrorText>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={pasteFromClipboard}>
          Вставить из буфера
        </Button>
        <Button onClick={submit} disabled={busy || !text.trim()}>
          {busy ? 'Создаю…' : 'Создать словарь'}
        </Button>
      </div>
    </div>
  )
}
