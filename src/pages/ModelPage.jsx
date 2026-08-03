import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { api } from '../api'
import { useFetch, useSite } from '../store'
import { useTilt } from '../hooks/useMotion'
import { Media, ErrorState } from '../components/ui'
import Reveal from '../components/Reveal'
import usePageMeta from '../hooks/usePageMeta'
import { useT } from '../i18n'

export default function ModelPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { settings, openKP, openCall } = useSite()
  const { t, td } = useT()
  const tiltRef = useTilt(7)
  const { data: m, loading, error, reload } = useFetch(() => api.model(id), [id])

  // Какое фото сейчас крупно: по умолчанию главное, миниатюра меняет его
  // без перехода на другую страницу. Сбрасываем на главное при смене
  // модели — иначе после перехода «назад → другая модель» могло остаться
  // выбранным фото из предыдущей карточки.
  const photos = m ? [m.photo, ...(m.gallery || [])].filter(Boolean) : []
  const [shown, setShown] = useState(null)
  useEffect(() => setShown(null), [id])
  const active = shown && photos.includes(shown) ? shown : photos[0]

  // Пока модель грузится — общий заголовок; загрузилась — её имя и краткое
  // описание. Ошибка/не найдено закрываем от индексации.
  usePageMeta({
    title: m ? `${m.name} — купить у производителя` : 'Каталог техники',
    description: m
      ? `${m.short || ''} Купить ${m.name} напрямую у завода СХМ Агро: характеристики, гарантия 2 года, лизинг и субсидии, доставка по Казахстану.`.trim()
      : undefined,
    noindex: !!error,
  })

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
            {t('back_catalog')}
          </button>
        </div>
      </main>
    )
  }

  return (
    <main className="wrap route-fade" style={{ paddingBlock: '36px 72px' }}>
      <button type="button" className="back-link" onClick={() => navigate('/catalog')}>
        {t('back_catalog')}
      </button>

      <div className="model-layout">
        <div>
          <Reveal variant="clip">
            <figure className="model-hero tilt" ref={tiltRef}>
              <Media src={active} alt={m.name} stub={`${m.name} · ${t('photo')}`} priority />
            </figure>
          </Reveal>
          {/* Строка миниатюр — только когда есть что переключать: одно
              единственное фото под тем же фото ничего не добавляет. */}
          {photos.length > 1 && (
            <div className="model-thumbs">
              {photos.map((p, i) => (
                <Reveal key={p} delay={i * 80}>
                  <button
                    type="button"
                    className={`model-thumb${p === active ? ' is-active' : ''}`}
                    onClick={() => setShown(p)}
                    aria-label={`${t('photo')} ${i + 1}`}
                    aria-current={p === active}
                  >
                    <img src={p} alt="" loading="lazy" />
                  </button>
                </Reveal>
              ))}
            </div>
          )}
        </div>

        <Reveal variant="right" delay={100}>
          <span className="card-kicker">{td(m.catName)}</span>
          <h1 className="model-title">{m.name}</h1>

          {m.subsidized && (
            <div className="subsidy-note">
              <span className="tag tag-brass">{t('subsidized')}</span>
              <span>
                {t('model_subsidy')}{' '}
                <a href={settings.subsidy_url} target="_blank" rel="noopener noreferrer">
                  {t('subsidy_check')}
                </a>
              </span>
            </div>
          )}

          <p className="model-desc">{m.descr}</p>

          <div className="model-actions">
            <button type="button" className="btn btn-primary" onClick={() => openKP(m)}>
              {t('model_kp')}
            </button>
            <button type="button" className="btn btn-secondary" onClick={openCall}>
              {t('call_order')}
            </button>
          </div>

          {m.specs.length > 0 && (
            <>
              <h3 className="specs-title">{t('specs_title')}</h3>
              <table className="table specs">
                <tbody>
                  {m.specs.map((row, i) => (
                    <tr key={i}>
                      <td>{td(row.k)}</td>
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
