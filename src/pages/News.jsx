import { Link } from 'react-router-dom'
import { api } from '../api'
import { useFetch } from '../store'
import { Media, Loading, ErrorState, EmptyState } from '../components/ui'
import Reveal from '../components/Reveal'
import usePageMeta from '../hooks/usePageMeta'
import { useT } from '../i18n'

export default function News() {
  usePageMeta({
    title: 'Новости и статьи о сельхозтехнике',
    description:
      'Новости завода СХМ Агро, обновления модельного ряда сельхозтехники, разборы по субсидиям и лизингу для аграриев Казахстана.',
  })
  const { t, fdate } = useT()
  const { data, loading, error, reload } = useFetch(() => api.news(), [])
  const items = data ?? []

  return (
    <main className="route-fade">
      <div className="wrap page-head">
        <span className="kicker">{t('press_kicker')}</span>
        <h1>{t('news_page_title')}</h1>
        <p className="lead" style={{ marginTop: 14 }}>
          {t('news_lead')}
        </p>
      </div>

      <div className="wrap" style={{ paddingBottom: 72 }}>
        {loading && <Loading count={3} />}
        {error && <ErrorState message={error} onRetry={reload} />}

        {!loading && !error && items.length === 0 && (
          <EmptyState title={t('news_empty_t')} text={t('news_empty_p')} />
        )}

        {items.length > 0 && (
          <div className="grid-3">
            {items.map((n, i) => (
              <Reveal key={n.id} delay={(i % 3) * 110}>
                {/* Карточка — настоящая ссылка: доступна с клавиатуры и видна
                    поисковику. Раньше открывалась только onClick. */}
                <Link to={`/news/${n.id}`} className="card card--link" style={{ height: '100%' }}>
                  <div className="card-media">
                    <Media src={n.cover} alt={n.title} stub={t('cover_stub')} />
                  </div>
                  <div className="card-body">
                    <span className="card-meta">{fdate(n.date)}</span>
                    <h3 className="card-title">{n.title}</h3>
                    <p className="card-text">{n.excerpt}</p>
                    <span className="btn btn-ghost" style={{ alignSelf: 'flex-start' }}>
                      {t('read')}
                    </span>
                  </div>
                </Link>
              </Reveal>
            ))}
          </div>
        )}
      </div>
    </main>
  )
}
