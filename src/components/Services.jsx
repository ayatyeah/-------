import Icon from './Icon'
import Reveal from './Reveal'
import { useT } from '../i18n'

/** Раздел «Услуги» — данные приходят из /api/home, редактируются в админке. */
export default function Services({ items = [] }) {
  const { t, td } = useT()
  if (items.length === 0) return null

  return (
    <section className="section section--alt" id="services">
      <div className="wrap">
        <Reveal as="span" className="kicker">
          {t('svc_kicker')}
        </Reveal>
        <div className="section-head">
          <div>
            <Reveal as="h2" delay={60}>
              {t('svc_title')}
            </Reveal>
            <Reveal as="p" className="lead" delay={120} style={{ marginTop: 12 }}>
              {t('svc_lead')}
            </Reveal>
          </div>
        </div>

        <div className="svc-grid">
          {items.map((s, i) => (
            <Reveal key={s.id} delay={(i % 3) * 90}>
              <article className="svc">
                <div className="svc-ico">
                  <Icon name={s.icon} size={24} />
                </div>
                <h3>{td(s.title)}</h3>
                <p>{td(s.text)}</p>
                {s.note && (
                  <span className="svc-note">
                    <Icon name="check" size={14} />
                    {td(s.note)}
                  </span>
                )}
              </article>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  )
}
