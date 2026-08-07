import { lazy, Suspense, useEffect } from 'react'
import { Route, Routes, useLocation } from 'react-router-dom'
import Link from './components/L'
import { SiteProvider, useSite } from './store'
import { api } from './api'
import { captureAttribution } from './lib/attribution'
import { useHiddenOnScrollDown } from './hooks/useMotion'
import Navbar from './components/Navbar'
import Footer from './components/Footer'
import Modals from './components/Modals'
import Toast from './components/Toast'
import AiChat from './components/AiChat'
import Icon from './components/Icon'
import Home from './pages/Home'
import About from './pages/About'
import Catalog from './pages/Catalog'
import ModelPage from './pages/ModelPage'
import News from './pages/News'
import Article from './pages/Article'
import Contacts from './pages/Contacts'
import Privacy from './pages/Privacy'
import Terms from './pages/Terms'
import CookieConsent from './components/CookieConsent'
import usePageMeta from './hooks/usePageMeta'
import { useT } from './i18n'

// Админку грузим отдельным чанком: посетителям сайта она не нужна,
// а весит она больше любой публичной страницы.
const Admin = lazy(() => import('./pages/Admin'))

/* Публичные страницы (задача 17). Русский — без префикса (язык по
   умолчанию), казахский и английский — с /kk и /en: тот же набор адресов
   регистрируется трижды, чтобы у каждого языка были свои, отдельно
   индексируемые URL (см. src/i18n.jsx, server/seo.js). Админка сюда не
   входит — у неё нет и не будет языковых версий. */
const PAGE_ROUTES = [
  { path: '/', element: <Home /> },
  { path: '/about', element: <About /> },
  { path: '/catalog', element: <Catalog /> },
  { path: '/catalog/:id', element: <ModelPage /> },
  { path: '/news', element: <News /> },
  { path: '/news/:id', element: <Article /> },
  { path: '/contacts', element: <Contacts /> },
  { path: '/privacy', element: <Privacy /> },
  { path: '/terms', element: <Terms /> },
]
const LANG_PREFIXES = ['kk', 'en']

function NotFound() {
  const { t } = useT()
  usePageMeta({ title: 'Страница не найдена', noindex: true })
  return (
    <main className="wrap" style={{ paddingBlock: 100, textAlign: 'center' }}>
      <span className="kicker" style={{ justifyContent: 'center' }}>
        {t('nf_kicker')}
      </span>
      <h1 style={{ fontSize: 48, margin: '16px 0 12px' }}>{t('nf_title')}</h1>
      <p className="lead" style={{ marginInline: 'auto', marginBottom: 28 }}>
        {t('nf_text')}
      </p>
      <Link to="/" className="btn btn-primary">
        {t('nf_home')}
      </Link>
    </main>
  )
}

/** Прокрутка вверх при смене маршрута. */
function ScrollTop() {
  const { pathname } = useLocation()
  // Тело в скобках: стрелка без них вернула бы результат scrollTo,
  // а React принял бы его за функцию очистки.
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [pathname])
  return null
}

function Shell() {
  const { pathname } = useLocation()
  const { settings, openCall } = useSite()
  const { t } = useT()
  const isAdmin = pathname.startsWith('/admin')
  // Пока листают вниз — прячем стопку, чтобы не закрывала текст.
  const stackHidden = useHiddenOnScrollDown()

  /* Счётчик визитов для сводки в админке: один раз за вкладку браузера. Флаг
     в sessionStorage ставим сразу при первой отрисовке, независимо от того,
     какая страница открылась первой, — а сам маячок шлём, только если это
     не админка. Так сотрудник, зашедший сразу в /admin, а потом заглянувший
     на публичные страницы в той же вкладке, не досчитывается как визит. */
  useEffect(() => {
    if (sessionStorage.getItem('shm_visited')) return
    sessionStorage.setItem('shm_visited', '1')
    if (!isAdmin) api.visit().catch(() => {})
  }, [isAdmin])

  // Метки перехода (utm/referrer) — читаем адресную строку один раз на
  // вкладку, до того как посетитель, возможно, уйдёт на страницу без них.
  useEffect(() => {
    captureAttribution()
  }, [])

  return (
    <div className="app">
      <ScrollTop />
      {/* Ссылка «к содержанию» — первый элемент в табуляции, видна только при
          фокусе с клавиатуры. Позволяет пропустить навигацию и уйти сразу к
          контенту (требование доступности). */}
      {!isAdmin && (
        <a href="#main" className="skip-link">
          {t('skip_link')}
        </a>
      )}
      {!isAdmin && <Navbar />}

      <div id="main">
        <Routes>
        {PAGE_ROUTES.map(({ path, element }) => (
          <Route key={path} path={path} element={element} />
        ))}
        {LANG_PREFIXES.flatMap((lang) =>
          PAGE_ROUTES.map(({ path, element }) => (
            <Route
              key={`${lang}${path}`}
              path={path === '/' ? `/${lang}` : `/${lang}${path}`}
              element={element}
            />
          ))
        )}
        <Route
          path="/admin"
          element={
            <Suspense
              fallback={
                <div className="state">
                  <div className="state-title">{t('admin_loading')}</div>
                </div>
              }
            >
              <Admin />
            </Suspense>
          }
        />
        <Route path="*" element={<NotFound />} />
        </Routes>
      </div>

      {!isAdmin && <Footer />}

      {/* Плавающие кнопки одной стопкой: сверху чат, снизу звонок.
          Позиционирует их сама стопка — у кнопок position не трогаем,
          иначе .btn { position: relative } (блик при наведении) снова
          перебьёт фиксацию и кнопка растянется во всю ширину. */}
      {!isAdmin && (
        <div className={`float-stack${stackHidden ? ' is-hidden' : ''}`}>
          <AiChat />
          {/* Значок появляется только когда ссылка задана в админке — та же
              логика, что и у соцсетей в подвале (см. Footer.jsx). */}
          {settings.whatsapp_url && (
            <a
              href={settings.whatsapp_url}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-primary float-whatsapp"
              aria-label={t('whatsapp_chat')}
            >
              <Icon name="whatsapp" size={18} />
              <span>{t('whatsapp_chat')}</span>
            </a>
          )}
          <button
            type="button"
            className="btn btn-brass float-call"
            onClick={openCall}
            aria-label={t('call_order')}
          >
            <Icon name="phone" size={18} />
            <span>{t('call_order')}</span>
          </button>
        </div>
      )}

      <Modals />
      <Toast />
      {/* В админке баннер не нужен: это рабочий инструмент сотрудника,
          а не публичная страница. */}
      {!isAdmin && <CookieConsent />}
    </div>
  )
}

export default function App() {
  return (
    <SiteProvider>
      <Shell />
    </SiteProvider>
  )
}
