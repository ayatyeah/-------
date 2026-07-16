import { useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { api } from '../api'
import { useFetch, useSite } from '../store'
import { useTilt } from '../hooks/useMotion'
import { Media, ErrorState } from '../components/ui'
import Reveal from '../components/Reveal'

const VIEWS = ['Вид 1', 'Вид 2', 'Кабина', 'В работе']

export default function ModelPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { settings, openKP, openCall } = useSite()
  const tiltRef = useTilt(7)
  const { data: m, loading, error, reload } = useFetch(() => api.model(id), [id])

  useEffect(() => {
    window.scrollTo(0, 0)
  }, [id])

  if (loading) {
    return (
      <main className="wrap" style={{ paddingBlock: 56 }}>
        <div className="skeleton" style={{ height: 420 }} />
      </main>
    )
  }

  if (error) {
    return (
      <main className="wrap">
        <ErrorState message={error} onRetry={reload} />
        <div style={{ textAlign: 'center', paddingBottom: 60 }}>
          <button type="button" className="btn btn-secondary" onClick={() => navigate('/catalog')}>
            ← Назад в каталог
          </button>
        </div>
      </main>
    )
  }

  return (
    <main className="wrap route-fade" style={{ paddingBlock: '36px 72px' }}>
      <button type="button" className="back-link" onClick={() => navigate('/catalog')}>
        ← Назад в каталог
      </button>

      <div className="model-layout">
        <div>
          <Reveal variant="clip">
            <figure className="model-hero tilt" ref={tiltRef}>
              <Media src={m.photo} alt={m.name} stub={`${m.name} · фото`} />
            </figure>
          </Reveal>
          <div className="model-thumbs">
            {VIEWS.map((v, i) => (
              <Reveal className="model-thumb" key={v} delay={i * 80}>
                <div className="media-stub">
                  <span>{v}</span>
                </div>
              </Reveal>
            ))}
          </div>
        </div>

        <Reveal variant="right" delay={100}>
          <span className="card-kicker">{m.catName}</span>
          <h1 className="model-title">{m.name}</h1>

          {m.subsidized && (
            <div className="subsidy-note">
              <span className="tag tag-brass">Субсидируется</span>
              <span>
                Входит в перечень господдержки —{' '}
                <a href={settings.subsidy_url} target="_blank" rel="noopener noreferrer">
                  проверить на ГосАгро →
                </a>
              </span>
            </div>
          )}

          <p className="model-desc">{m.descr}</p>

          <div className="model-actions">
            <button type="button" className="btn btn-primary" onClick={() => openKP(m)}>
              Получить коммерческое предложение
            </button>
            <button type="button" className="btn btn-secondary" onClick={openCall}>
              Заказать звонок
            </button>
          </div>

          {m.specs.length > 0 && (
            <>
              <h3 className="specs-title">Технические характеристики</h3>
              <table className="table specs">
                <tbody>
                  {m.specs.map((row, i) => (
                    <tr key={i}>
                      <td>{row.k}</td>
                      <td>{row.v}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </Reveal>
      </div>
    </main>
  )
}
