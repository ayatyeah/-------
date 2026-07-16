import { useNavigate } from 'react-router-dom'
import { api, formatDate } from '../api'
import { useFetch } from '../store'
import { Media, Loading, ErrorState, EmptyState } from '../components/ui'
import Reveal from '../components/Reveal'

export default function News() {
  const navigate = useNavigate()
  const { data, loading, error, reload } = useFetch(() => api.news(), [])
  const items = data ?? []

  return (
    <main className="route-fade">
      <div className="wrap page-head">
        <span className="kicker">Пресс-центр</span>
        <h1>Новости и статьи</h1>
        <p className="lead" style={{ marginTop: 14 }}>
          Что происходит на производстве, как меняется техника и как получить господдержку.
        </p>
      </div>

      <div className="wrap" style={{ paddingBottom: 72 }}>
        {loading && <Loading count={3} />}
        {error && <ErrorState message={error} onRetry={reload} />}

        {!loading && !error && items.length === 0 && (
          <EmptyState title="Новостей пока нет" text="Загляните позже." />
        )}

        {items.length > 0 && (
          <div className="grid-3">
            {items.map((n, i) => (
              <Reveal key={n.id} delay={(i % 3) * 110}>
                <article
                  className="card card--link"
                  style={{ height: '100%' }}
                  onClick={() => navigate(`/news/${n.id}`)}
                >
                  <div className="card-media">
                    <Media src={n.cover} alt={n.title} stub="Обложка" />
                  </div>
                  <div className="card-body">
                    <span className="card-meta">{formatDate(n.date)}</span>
                    <h3 className="card-title">{n.title}</h3>
                    <p className="card-text">{n.excerpt}</p>
                    <span className="btn btn-ghost" style={{ alignSelf: 'flex-start' }}>
                      Читать →
                    </span>
                  </div>
                </article>
              </Reveal>
            ))}
          </div>
        )}
      </div>
    </main>
  )
}
