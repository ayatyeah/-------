import { Link } from 'react-router-dom'
import { Media } from './ui'
import Reveal from './Reveal'
import { useSite } from '../store'
import { useT } from '../i18n'

/** Бейдж → класс тега и переводимый ключ подписи (задача 10). */
export const BADGE_TAGS = {
  new: { cls: 'tag-green', key: 'badge_new' },
  hit: { cls: 'tag-brass', key: 'badge_hit' },
  in_stock: { cls: 'tag-outline', key: 'badge_in_stock' },
  on_order: { cls: 'tag-muted', key: 'badge_on_order' },
}

/**
 * Карточка модели — вынесена из Catalog.jsx, чтобы тем же самым пользовались
 * связанные модели на странице модели (задача 10): дублировать разметку
 * карточки в двух местах означало бы чинить баг в одном и забывать про
 * второе.
 */
export default function ModelCard({ model: m, href, delay = 0 }) {
  const { openKP } = useSite()
  const { t, td, tField } = useT()
  const badge = BADGE_TAGS[m.badge]
  const name = tField(m, 'name')

  return (
    <Reveal delay={delay}>
      <article className="card card--link" style={{ height: '100%' }}>
        <Link to={href} className="card-media" aria-label={name}>
          <div className="card-media-tags">
            {m.flagship && <span className="tag tag-flagship">{t('flagship')}</span>}
            {m.subsidized && <span className="tag tag-brass">{t('subsidized')}</span>}
            {badge && <span className={`tag ${badge.cls}`}>{t(badge.key)}</span>}
          </div>
          <Media src={m.photo} alt={name} stub={td(m.catName)} />
        </Link>
        <div className="card-body">
          <span className="card-kicker">{td(m.catName)}</span>
          <h3 className="card-title">
            <Link to={href} className="card-title-link">
              {name}
            </Link>
          </h3>
          <p className="card-text">{tField(m, 'short')}</p>
          {/* 2-3 ключевые характеристики прямо на карточке (задача 9) —
              чтобы сравнивать модели, не открывая каждую по очереди. */}
          {m.specs?.length > 0 && (
            <ul className="card-specs">
              {m.specs.slice(0, 3).map((s, i) => (
                <li key={i}>
                  <span>{td(s.k)}</span>
                  <b>{s.v}</b>
                </li>
              ))}
            </ul>
          )}
          <div className="card-actions">
            <Link to={href} className="btn btn-primary btn-sm">
              {t('more')}
            </Link>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => openKP(m)}>
              {t('get_kp')}
            </button>
          </div>
        </div>
      </article>
    </Reveal>
  )
}
