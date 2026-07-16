import { lazy, Suspense, useEffect } from 'react'
import { Link, Route, Routes, useLocation } from 'react-router-dom'
import { SiteProvider, useSite } from './store'
import Navbar from './components/Navbar'
import Footer from './components/Footer'
import Modals from './components/Modals'
import Toast from './components/Toast'
import AiChat from './components/AiChat'
import Home from './pages/Home'
import About from './pages/About'
import Catalog from './pages/Catalog'
import ModelPage from './pages/ModelPage'
import News from './pages/News'
import Article from './pages/Article'
import Contacts from './pages/Contacts'

// Админку грузим отдельным чанком: посетителям сайта она не нужна,
// а весит она больше любой публичной страницы.
const Admin = lazy(() => import('./pages/Admin'))

function NotFound() {
  return (
    <main className="wrap" style={{ paddingBlock: 100, textAlign: 'center' }}>
      <span className="kicker" style={{ justifyContent: 'center' }}>
        Ошибка 404
      </span>
      <h1 style={{ fontSize: 48, margin: '16px 0 12px' }}>Страница не найдена</h1>
      <p className="lead" style={{ marginInline: 'auto', marginBottom: 28 }}>
        Возможно, ссылка устарела или страница была перенесена.
      </p>
      <Link to="/" className="btn btn-primary">
        На главную
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
  const { openCall } = useSite()
  const isAdmin = pathname.startsWith('/admin')

  return (
    <div className="app">
      <ScrollTop />
      {!isAdmin && <Navbar />}

      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/about" element={<About />} />
        <Route path="/catalog" element={<Catalog />} />
        <Route path="/catalog/:id" element={<ModelPage />} />
        <Route path="/news" element={<News />} />
        <Route path="/news/:id" element={<Article />} />
        <Route path="/contacts" element={<Contacts />} />
        <Route
          path="/admin"
          element={
            <Suspense
              fallback={
                <div className="state">
                  <div className="state-title">Загружаем админку…</div>
                </div>
              }
            >
              <Admin />
            </Suspense>
          }
        />
        <Route path="*" element={<NotFound />} />
      </Routes>

      {!isAdmin && <Footer />}

      {/* Плавающие кнопки одной стопкой: сверху чат, снизу звонок.
          Позиционирует их сама стопка — у кнопок position не трогаем,
          иначе .btn { position: relative } (блик при наведении) снова
          перебьёт фиксацию и кнопка растянется во всю ширину. */}
      {!isAdmin && (
        <div className="float-stack">
          <AiChat />
          <button
            type="button"
            className="btn btn-brass float-call"
            onClick={openCall}
            aria-label="Заказать звонок"
          >
            📞<span>Заказать звонок</span>
          </button>
        </div>
      )}

      <Modals />
      <Toast />
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
