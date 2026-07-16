import { useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { api, formatDate } from '../api'
import { useFetch } from '../store'
import { Media, ErrorState } from '../components/ui'
import Reveal from '../components/Reveal'

export default function Article() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { data: a, loading, error, reload } = useFetch(() => api.article(id), [id])

  useEffect(() => {
    window.scrollTo(0, 0)
  }, [id])

  if (loading) {
    return (
      <main className="wrap" style={{ paddingBlock: 56 }}>
        <div className="skeleton" style={{ height: 380, maxWidth: 760, margin: '0 auto' }} />
      </main>
    )
  }

  if (error) {
    return (
      <main className="wrap">
        <ErrorState message={error} onRetry={reload} />
        <div style={{ textAlign: 'center', paddingBottom: 60 }}>
          <button type="button" className="btn btn-secondary" onClick={() => navigate('/news')}>
            ← Все новости
          </button>
        </div>
      </main>
    )
  }

  return (
    <main className="wrap route-fade" style={{ paddingBlock: '36px 72px' }}>
      <div className="article-head">
        <button type="button" className="back-link" onClick={() => navigate('/news')}>
          ← Все новости
        </button>
        <span className="card-meta">{formatDate(a.date)}</span>
        <h1 className="article-title">{a.title}</h1>
      </div>

      <Reveal variant="clip" style={{ maxWidth: 900, marginInline: 'auto' }}>
        <figure className="article-cover" style={{ marginBlock: 0 }}>
          <Media src={a.cover} alt={a.title} stub="Обложка статьи" />
        </figure>
      </Reveal>

      <div className="article-body" style={{ marginTop: 32 }}>
        {a.body.map((p, i) => (
          <Reveal as="p" key={i} delay={i * 70}>
            {p}
          </Reveal>
        ))}
      </div>

      <div style={{ textAlign: 'center', marginTop: 48 }}>
        <button type="button" className="btn btn-secondary" onClick={() => navigate('/news')}>
          ← Все новости
        </button>
      </div>
    </main>
  )
}
