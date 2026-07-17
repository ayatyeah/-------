import { Link } from 'react-router-dom'
import { useSite } from '../store'
import { useTilt } from '../hooks/useMotion'
import Reveal, { CountUp } from '../components/Reveal'
import Production from '../components/Production'

export default function About() {
  // Показатели и сертификаты уже загружены провайдером — второй запрос не нужен.
  const { settings, home, openCall } = useSite()
  const tiltRef = useTilt(8)
  const stats = home?.stats ?? []
  const certs = home?.certs ?? []

  return (
    <main className="route-fade">
      <div className="wrap page-head">
        <span className="kicker">О компании</span>
        <h1>18 лет строим технику для казахстанских хозяйств</h1>
      </div>

      <section className="section--tight">
        <div className="wrap">
          <div className="about-grid">
            <Reveal variant="clip">
              <figure
                className="hero-figure tilt"
                ref={tiltRef}
                style={{ borderColor: 'var(--rule)' }}
              >
                <i className="tl" />
                <i className="tr" />
                <i className="bl" />
                <i className="br" />
                <img
                  src="/assets/tractor-green.webp"
                  srcSet="/assets/tractor-green-sm.webp 760w, /assets/tractor-green.webp 1200w"
                  sizes="(max-width: 1000px) 100vw, 560px"
                  alt="Трактор СХМ на площадке предпродажной подготовки"
                  width="1200"
                  height="655"
                  loading="lazy"
                  decoding="async"
                />
              </figure>
            </Reveal>
            <Reveal className="about-text" variant="right" delay={120}>
              <p>
                ТОО «СХМ Агро» — производитель и поставщик сельскохозяйственной техники с полным
                циклом: от литья узлов до сборки и сервисного обслуживания. Мы работаем с фермерами
                и крупными агрохозяйствами по всей стране.
              </p>
              <p>
                Техника проектируется под реальные условия степи и резко-континентального климата:
                запас прочности, доступность запчастей и сервис в каждом регионе.
              </p>
              <p>
                Мы не перепродаём — мы производим. Собственный сборочный цех, линия покраски и
                испытательный полигон позволяют держать качество под контролем на каждом этапе.
              </p>
            </Reveal>
          </div>
        </div>
      </section>

      {/* показатели — цифры набегают счётчиком */}
      <section className="section--tight">
        <div className="wrap">
          <div className="grid-2" style={{ gridTemplateColumns: 'repeat(4, 1fr)', gap: 0 }}>
            {stats.map((s, i) => (
              <Reveal
                key={s.id}
                className="frame"
                delay={i * 90}
                style={{
                  padding: '26px 22px',
                  borderRight: i === 3 ? undefined : 0,
                }}
              >
                <div className="stat-v" style={{ color: 'var(--green-600)' }}>
                  <CountUp value={s.v} />
                </div>
                <div className="stat-k" style={{ color: 'var(--text-3)' }}>
                  {s.k}
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>


      {/* производство — без цитаты: ниже своя линия повествования */}
      <Production />

      {/* сертификаты списком */}
      <section className="section">
        <div className="wrap">
          <span className="kicker">Сертификаты</span>
          <div className="section-head">
            <h2>Соответствие и качество</h2>
          </div>
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Документ</th>
                  <th>Область</th>
                </tr>
              </thead>
              <tbody>
                {certs.map((c) => (
                  <tr key={c.id}>
                    <td style={{ fontFamily: 'var(--font-head)', fontWeight: 600, fontSize: 17 }}>
                      {c.title}
                    </td>
                    <td style={{ color: 'var(--text-2)' }}>{c.org}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* призыв */}
      <section className="section">
        <div className="wrap">
          <div className="grid-2">
            <div className="banner frame">
              <span className="tag tag-green">Каталог</span>
              <h3>Подберём технику под ваше хозяйство</h3>
              <p>Тракторы, комбайны, посевные комплексы и почвообрабатывающая техника.</p>
              <Link to="/catalog" className="btn btn-primary">
                Смотреть каталог →
              </Link>
            </div>
            <div className="banner frame">
              <span className="tag tag-green">Связь</span>
              <h3>Нужна консультация?</h3>
              <p>
                Позвоните {settings.phone} или оставьте номер — перезвоним в рабочее время.
              </p>
              <button type="button" className="btn btn-secondary" onClick={openCall}>
                Заказать звонок
              </button>
            </div>
          </div>
        </div>
      </section>
    </main>
  )
}
