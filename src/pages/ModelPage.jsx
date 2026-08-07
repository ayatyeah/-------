import { useEffect, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { api } from '../api'
import { useFetch, useSite } from '../store'
import { useTilt } from '../hooks/useMotion'
import { Media, ErrorState } from '../components/ui'
import PhotoLightbox from '../components/PhotoLightbox'
import ModelCard, { BADGE_TAGS } from '../components/ModelCard'
import SeasonBanner from '../components/SeasonBanner'
import Reveal from '../components/Reveal'
import usePageMeta from '../hooks/usePageMeta'
import { useT } from '../i18n'

export default function ModelPage() {
  const { id } = useParams()
  const navigate = useNavigate()

  /* Куда возвращает «Назад в каталог».

     Категорию приносит адрес карточки (см. toModel в src/pages/Catalog.jsx),
     и мы возвращаем посетителя ровно к тому списку, из которого он пришёл,
     а не ко всему каталогу заново.

     navigate(-1) здесь не годится: на карточку часто попадают прямо из
     поиска или по присланной ссылке, и «назад» уводил бы с сайта вовсе. */
  const [params] = useSearchParams()
  const catBack = params.get('cat')
  const { settings, openKP, openCall } = useSite()
  const { t, td, tField, withLang } = useT()
  const backToCatalog = () => navigate(withLang(catBack ? `/catalog?cat=${catBack}` : '/catalog'))
  const tiltRef = useTilt(7)
  const { data: m, loading, error, reload } = useFetch(() => api.model(id), [id])
  const mName = m ? tField(m, 'name') : ''
  const mShort = m ? tField(m, 'short') : ''
  const mDescr = m ? tField(m, 'descr') : ''

  // Похожие модели — та же категория, без текущей (задача 10). Ждём, пока
  // подгрузится сама модель: до этого категория не известна.
  const { data: sameCat } = useFetch(() => (m ? api.models(m.cat) : Promise.resolve([])), [m?.cat, m?.id])
  const related = (sameCat || []).filter((x) => x.id !== id).slice(0, 3)
  const toModel = (relId) => `/catalog/${relId}${m ? `?cat=${m.cat}` : ''}`

  // Какое фото сейчас крупно: по умолчанию главное, миниатюра меняет его
  // без перехода на другую страницу. Сбрасываем на главное при смене
  // модели — иначе после перехода «назад → другая модель» могло остаться
  // выбранным фото из предыдущей карточки.
  const photos = m ? [m.photo, ...(m.gallery || [])].filter(Boolean) : []
  const [shown, setShown] = useState(null)
  useEffect(() => setShown(null), [id])
  const active = shown && photos.includes(shown) ? shown : photos[0]

  // Лайтбокс открывается на том фото, что сейчас показано крупно.
  const [lightbox, setLightbox] = useState(false)

  // Пока модель грузится — общий заголовок; загрузилась — её имя и краткое
  // описание. Ошибка/не найдено закрываем от индексации.
  usePageMeta({
    title: m ? `${mName} — купить у производителя` : 'Каталог техники',
    description: m
      ? `${mShort} Купить ${mName} напрямую у завода СХМ Агро: характеристики, гарантия 2 года, лизинг и субсидии, доставка по Казахстану.`.trim()
      : undefined,
    noindex: !!error,
  })

  useEffect(() => {
    window.scrollTo(0, 0)
  }, [id])

  // Приватный счётчик просмотров карточки — раз за вкладку на модель, как и
  // общий счётчик визитов (см. App.jsx). Без cookie и идентификаторов,
  // только +1 к дневному счётчику этой модели для сводки в админке.
  useEffect(() => {
    if (!m) return
    const key = `shm_viewed_${m.id}`
    if (sessionStorage.getItem(key)) return
    sessionStorage.setItem(key, '1')
    api.metric('model_view', m.id).catch(() => {})
  }, [m])

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
          <button type="button" className="btn btn-secondary" onClick={backToCatalog}>
            {t('back_catalog')}
          </button>
        </div>
      </main>
    )
  }

  const badge = BADGE_TAGS[m.badge]

  return (
    <main className="wrap route-fade" style={{ paddingBlock: '36px 72px' }}>
      <SeasonBanner />

      <button type="button" className="back-link" onClick={backToCatalog}>
        {t('back_catalog')}
      </button>

      <div className="model-layout">
        <div>
          <Reveal variant="clip">
            <button
              type="button"
              className="model-hero-btn"
              onClick={() => active && setLightbox(true)}
              aria-label={t('photo_zoom_hint')}
              disabled={!active}
            >
              <figure className="model-hero tilt" ref={tiltRef}>
                {(m.flagship || badge) && (
                  <span className="model-hero-tags">
                    {m.flagship && <span className="tag tag-flagship">{t('flagship')}</span>}
                    {badge && <span className={`tag ${badge.cls}`}>{t(badge.key)}</span>}
                  </span>
                )}
                <Media src={active} alt={mName} stub={`${mName} · ${t('photo')}`} priority />
                {active && (
                  <span className="model-hero-zoom-hint" aria-hidden="true">
                    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="11" cy="11" r="7" />
                      <path d="M21 21l-4.35-4.35M11 8v6M8 11h6" strokeLinecap="round" />
                    </svg>
                  </span>
                )}
              </figure>
            </button>
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

          {/* То же краткое описание, что и на карточке в каталоге. Колонка с
              фото короче колонки с характеристиками (grid align-items: start
              не тянет её по высоте) — без этого под миниатюрами оставалась
              пустая плашка. */}
          {mShort && (
            <Reveal delay={120}>
              <p className="model-left-desc">{mShort}</p>
            </Reveal>
          )}
        </div>

        <Reveal variant="right" delay={100}>
          <span className="card-kicker">{td(m.catName)}</span>
          <h1 className="model-title">{mName}</h1>

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

          <p className="model-desc">{mDescr}</p>

          <div className="model-actions">
            <button type="button" className="btn btn-primary" onClick={() => openKP(m)}>
              {t('model_kp')}
            </button>
            <button type="button" className="btn btn-secondary" onClick={openCall}>
              {t('call_order')}
            </button>
            {m.specs.length > 0 && (
              <a
                href={`/api/models/${m.id}/sheet.pdf`}
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-ghost"
              >
                {t('model_pdf')}
              </a>
            )}
          </div>

          {m.specs.length > 0 && (
            <>
              <h3 className="specs-title">{t('specs_title')}</h3>
              <table className="table specs">
                <tbody>
                  {m.specs.map((row, i) => (
                    <tr key={i}>
                      <td>{td(row.k)}</td>
                      <td>
                        {row.v}
                        {/* Характеристика «через выгоду» (задача 10) — только
                            если админ реально вписал пояснение, ничего не
                            считаем и не досочиняем сами. */}
                        {row.benefit && <div className="spec-benefit-note">{row.benefit}</div>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          {/* Отзыв хозяйства — блок появляется только когда реально
              заполнен в админке. */}
          {m.testimonial?.quote && (
            <blockquote className="testimonial">
              <p>&laquo;{m.testimonial.quote}&raquo;</p>
              {m.testimonial.author && <cite>{m.testimonial.author}</cite>}
            </blockquote>
          )}

          {/* Консультативные CTA с персональным менеджером — блок целиком
              скрыт, пока у модели не назначен менеджер с именем и телефоном:
              ничего выдуманного вместо реального сотрудника показывать нельзя.
              Менеджер выбирается для каждой модели отдельно в её форме в
              админке (задача 10, расширена — раньше был один на весь сайт). */}
          {m.manager?.name && m.manager?.phone && (
            <div className="manager-card">
              {m.manager.photo && <img src={m.manager.photo} alt="" className="manager-photo" />}
              <div>
                <div className="manager-title">{t('manager_title')}</div>
                <div className="manager-name">{m.manager.name}</div>
                {m.manager.position && <div className="manager-position">{m.manager.position}</div>}
                <a className="manager-phone" href={`tel:${m.manager.phone.replace(/[^\d+]/g, '')}`}>
                  {m.manager.phone}
                </a>
              </div>
              <div className="manager-actions">
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => openKP(m, `Запрос: выезд в хозяйство (${m.name})`)}
                >
                  {t('manager_visit')}
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => openKP(m, `Запрос: демо-показ (${m.name})`)}
                >
                  {t('manager_demo')}
                </button>
              </div>
            </div>
          )}
        </Reveal>
      </div>

      {related.length > 0 && (
        <div className="model-related">
          <h3 className="specs-title">{t('related_title')}</h3>
          <div className="grid-2">
            {related.map((rm, i) => (
              <ModelCard key={rm.id} model={rm} href={toModel(rm.id)} delay={i * 90} />
            ))}
          </div>
        </div>
      )}

      {lightbox && (
        <PhotoLightbox
          photos={photos}
          startIndex={photos.indexOf(active)}
          alt={mName}
          onClose={() => setLightbox(false)}
        />
      )}
    </main>
  )
}
