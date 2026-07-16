import Icon from './Icon'
import Reveal from './Reveal'

/** Раздел «Услуги» — данные приходят из /api/home, редактируются в админке. */
export default function Services({ items = [] }) {
  if (items.length === 0) return null

  return (
    <section className="section" id="services">
      <div className="wrap">
        <Reveal as="span" className="kicker">
          Услуги
        </Reveal>
        <div className="section-head">
          <div>
            <Reveal as="h2" delay={60}>
              Не только продаём — ведём хозяйство дальше
            </Reveal>
            <Reveal as="p" className="lead" delay={120} style={{ marginTop: 12 }}>
              Техника — это половина дела. Вторая половина начинается после отгрузки:
              запчасти, сервис в поле и помощь с документами.
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
                <h3>{s.title}</h3>
                <p>{s.text}</p>
                {s.note && (
                  <span className="svc-note">
                    <Icon name="check" size={14} />
                    {s.note}
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
