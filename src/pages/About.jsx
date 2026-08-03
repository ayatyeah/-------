import { Link } from 'react-router-dom'
import { useSite } from '../store'
import { useTilt } from '../hooks/useMotion'
import { Media } from '../components/ui'
import Reveal, { CountUp } from '../components/Reveal'
import Production from '../components/Production'
import usePageMeta from '../hooks/usePageMeta'
import { useT } from '../i18n'

export default function About() {
  usePageMeta({
    title: 'О заводе — производство сельхозтехники в Казахстане',
    description:
      'Собственное производство сельхозтехники в Казахстане: льём узлы, собираем, красим и обкатываем машины на своём полигоне. Завод СХМ Агро — техника, рассчитанная на степь.',
  })
  // Показатели и сертификаты уже загружены провайдером — второй запрос не нужен.
  const { settings, home, openCall } = useSite()
  const { t, td } = useT()
  const tiltRef = useTilt(8)
  const stats = home?.stats ?? []
  const certs = home?.certs ?? []

  return (
    <main className="route-fade">
      <div className="wrap page-head">
        <span className="kicker">{t('about_kicker')}</span>
        <h1>{t('about_title')}</h1>
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
                {/* Фото редактируется в админке («Главная» → «Фото сайта»);
                    пустое значение — снимок из комплекта сайта. */}
                <Media
                  src={settings.about_photo || '/assets/tractor-green.webp'}
                  alt={t('about_img_alt')}
                  sizes="(max-width: 1000px) 100vw, 560px"
                />
              </figure>
            </Reveal>
            <Reveal className="about-text" variant="right" delay={120}>
              <p>{t('about_p1')}</p>
              <p>{t('about_p2')}</p>
              <p>{t('about_p3')}</p>
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
                  {td(s.k)}
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
          <span className="kicker">{t('certs_kicker')}</span>
          <div className="section-head">
            <h2>{t('certs_title')}</h2>
          </div>
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>{t('certs_doc')}</th>
                  <th>{t('certs_org')}</th>
                </tr>
              </thead>
              <tbody>
                {certs.map((c) => (
                  <tr key={c.id}>
                    <td style={{ fontFamily: 'var(--font-head)', fontWeight: 600, fontSize: 17 }}>
                      {td(c.title)}
                    </td>
                    <td style={{ color: 'var(--text-2)' }}>{td(c.org)}</td>
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
              <span className="tag tag-green">{t('tag_catalog')}</span>
              <h3>{t('about_cta_title')}</h3>
              <p>{t('about_cta_text')}</p>
              <Link to="/catalog" className="btn btn-primary">
                {t('about_cta_btn')}
              </Link>
            </div>
            <div className="banner frame">
              <span className="tag tag-green">{t('tag_contact')}</span>
              <h3>{t('about_call_title')}</h3>
              <p>
                {t('about_call_pre')}
                {settings.phone}
                {t('about_call_post')}
              </p>
              <button type="button" className="btn btn-secondary" onClick={openCall}>
                {t('call_order')}
              </button>
            </div>
          </div>
        </div>
      </section>
    </main>
  )
}
