import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useSite } from '../store'
import { useTilt } from '../hooks/useMotion'
import { Media } from '../components/ui'
import Reveal, { CountUp } from '../components/Reveal'
import SunField from '../components/SunField'
import Ticker from '../components/Ticker'
import Services from '../components/Services'
import Steps from '../components/Steps'
import Icon from '../components/Icon'
import WhatWeDo from '../components/WhatWeDo'
import Production from '../components/Production'
import { api } from '../api'
import { useFetch } from '../store'
import usePageMeta from '../hooks/usePageMeta'
import { useT } from '../i18n'

// t — ключи словаря (src/locales): плашки доверия переводятся с языком сайта.
const TRUST = [
  { icon: 'shield', t: 'trust_warranty' },
  { icon: 'wrench', t: 'trust_service' },
  { icon: 'percent', t: 'trust_leasing' },
]

/** Часть заголовка после запятой — латунью, второй строкой. */
function HeroTitle({ text }) {
  const i = text.indexOf(',')
  if (i === -1) return text
  return (
    <>
      {text.slice(0, i + 1)}
      <br />
      <em>{text.slice(i + 1).trim()}</em>
    </>
  )
}

/** Лайтбокс сертификата. */
function CertLightbox({ cert, onClose }) {
  const { t, td } = useT()
  return (
    <div className="backdrop" onClick={onClose}>
      <div className="lightbox" onClick={(e) => e.stopPropagation()}>
        <div className="lightbox-sheet">
          <div className="cert-seal" style={{ width: 54, height: 54, fontSize: 16 }}>
            СХМ
          </div>
          <div className="cert-title" style={{ fontSize: 24 }}>
            {td(cert.title)}
          </div>
          <div className="cert-org">{td(cert.org)}</div>
        </div>
        <div className="lightbox-cap">
          <span style={{ fontSize: 14, color: 'var(--text-2)' }}>{td(cert.title)}</span>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            {t('close_x')}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function Home() {
  usePageMeta({
    // Совпадает с серверной версией (server/seo.js): робот без JS и браузер
    // после гидратации должны видеть один и тот же title.
    fullTitle: 'СХМ Агро — сельхозтехника от производителя в Казахстане',
    description:
      'СХМ Агро — казахстанский завод сельхозтехники. Купить трактор, комбайн, сеялку или посевной комплекс напрямую у производителя: цены без посредников, гарантия 2 года, 34 сервисных центра, лизинг и субсидии.',
  })
  // Все данные главной приходят одним запросом /api/home из провайдера.
  const { settings, home, openKP } = useSite()
  const { t, td, fdate, lang } = useT()
  const navigate = useNavigate()
  const [cert, setCert] = useState(null)
  const tiltRef = useTilt(9)

  const stats = home?.stats ?? []
  const certs = home?.certs ?? []
  const news = home?.news ?? []

  // Каталог для блока «что выпускаем» — числа моделей берём из него.
  const models = useFetch(() => api.models(), [])
  const cats = useFetch(() => api.categories(), [])

  return (
    <main className="route-fade">
      {/* ------------------------------- герой ------------------------------ */}
      <section className="hero">
        {/* Canvas 2D: золотые частицы, реагируют на курсор */}
        <SunField />
        <div className="hero-glow" />

        <div className="hero-inner">
          <div>
            <Reveal as="span" variant="fade" className="kicker kicker--light">
              {t('hero_kicker')}
            </Reveal>
            {/* Русский герой правится в админке (settings). Для казахского и
                английского берём перевод из словаря: полей на трёх языках в
                админке пока нет, а русский текст в казахском интерфейсе
                выглядел бы хуже, чем выверенный перевод текущего героя. */}
            <Reveal as="h1" delay={80}>
              <HeroTitle text={lang === 'ru' ? settings.hero_title : t('hero_title')} />
            </Reveal>
            <Reveal as="p" delay={160}>
              {lang === 'ru' ? settings.hero_subtitle : t('hero_subtitle')}
            </Reveal>
            <Reveal className="hero-actions" delay={240}>
              <button
                type="button"
                className="btn btn-brass btn-lg"
                onClick={() => navigate('/catalog')}
              >
                {t('hero_catalog')}
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-secondary--light btn-lg"
                onClick={() => openKP()}
              >
                {t('hero_price')}
              </button>
            </Reveal>

            <Reveal className="hero-trust" delay={320}>
              {TRUST.map((item) => (
                <span className="hero-trust-item" key={item.t}>
                  <Icon name={item.icon} size={17} />
                  {t(item.t)}
                </span>
              ))}
            </Reveal>
          </div>

          <Reveal variant="clip" delay={200}>
            <figure className="hero-figure tilt" ref={tiltRef}>
              <i className="tl" />
              <i className="tr" />
              <i className="bl" />
              <i className="br" />
              {/* Фото редактируется в админке («Главная» → «Фото сайта»);
                  пустое значение — снимок из комплекта сайта. LCP-картинка:
                  грузим сразу, приоритетом, без lazy — через Media, чтобы
                  srcset не собирался для загруженных фото без -sm.webp
                  (см. комментарий в Media про уже случавшийся 404). */}
              <Media
                src={settings.hero_photo || '/assets/hero-field.webp'}
                alt={t('hero_img_alt')}
                sizes="(max-width: 1000px) 100vw, 560px"
                priority
              />
            </figure>
          </Reveal>
        </div>

        {/* показатели прямо под героем, на тёмном — цифры набегают счётчиком */}
        <div className="stat-strip">
          <div className="stat-strip-inner">
            {stats.map((s) => (
              <div className="stat" key={s.id}>
                <div className="stat-v">
                  <CountUp value={s.v} />
                </div>
                <div className="stat-k">{td(s.k)}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* бегущая строка регионов — CSS keyframes */}
      <Ticker />

      {/* Первый содержательный экран: чем занимаемся и что выпускаем */}
      <WhatWeDo models={models.data ?? []} categories={cats.data ?? []} />

      {/* ----------------------------- о компании --------------------------- */}
      <section className="section" id="about">
        <div className="wrap">
          <Reveal as="span" className="kicker">
            {t('about_kicker')}
          </Reveal>
          <div className="about-grid">
            <Reveal as="h2" variant="left">
              {t('home_about_title')}
            </Reveal>
            <Reveal className="about-text" variant="right" delay={120}>
              <p>{t('home_about_p1')}</p>
              <p>{t('home_about_p2')}</p>
              <Link to="/about" className="btn btn-ghost" style={{ marginTop: 14 }}>
                {t('home_about_more')}
              </Link>
            </Reveal>
          </div>
        </div>
      </section>


      {/* услуги — из базы, редактируются в админке */}
      <Services items={home?.services ?? []} />

      {/* как работаем */}
      <Steps />

      {/* производство — тёмная глава, цитата директора закрывает её */}
      <Production quote />

      {/* ---------------------------- сертификаты --------------------------- */}
      <section className="section">
        <div className="wrap">
          <Reveal as="span" className="kicker">
            {t('certs_kicker')}
          </Reveal>
          <div className="section-head">
            <div>
              <Reveal as="h2" delay={60}>
                {t('certs_title')}
              </Reveal>
              <Reveal as="p" className="lead" delay={120} style={{ marginTop: 10, fontSize: 16 }}>
                {t('certs_hint')}
              </Reveal>
            </div>
          </div>
          <div className="cert-grid">
            {certs.map((c, i) => (
              <Reveal key={c.id} delay={(i % 3) * 90}>
                <button
                  type="button"
                  className="cert"
                  style={{ width: '100%', height: '100%' }}
                  onClick={() => setCert(c)}
                >
                  <div className="cert-seal">СХМ</div>
                  <div>
                    <div className="cert-title">{td(c.title)}</div>
                    <div className="cert-org">{td(c.org)}</div>
                  </div>
                </button>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* -------------------------- лизинг и субсидии ----------------------- */}
      <section className="section section--alt">
        <div className="wrap">
          <div className="grid-2">
            <Reveal className="banner frame" variant="left">
              <span className="tag tag-brass">{t('tag_leasing')}</span>
              <h3>{t('leasing_title')}</h3>
              <p>{t('leasing_text')}</p>
              <a
                className="btn btn-secondary"
                href={settings.leasing_url}
                target="_blank"
                rel="noopener noreferrer"
              >
                {t('leasing_cta')}
              </a>
            </Reveal>

            <Reveal className="banner frame" variant="right" delay={120}>
              <span className="tag tag-brass">{t('tag_subsidy')}</span>
              <h3>{t('subsidy_title')}</h3>
              <p>{t('subsidy_text')}</p>
              <a
                className="btn btn-secondary"
                href={settings.subsidy_url}
                target="_blank"
                rel="noopener noreferrer"
              >
                {t('subsidy_cta')}
              </a>
            </Reveal>
          </div>
        </div>
      </section>

      {/* ------------------------------- новости ---------------------------- */}
      <section className="section">
        <div className="wrap">
          <div className="section-head">
            <div>
              <Reveal as="span" className="kicker">
                {t('news_kicker')}
              </Reveal>
              <Reveal as="h2" delay={60}>
                {t('news_home_title')}
              </Reveal>
            </div>
            <Reveal delay={120}>
              <Link to="/news" className="btn btn-secondary">
                {t('news_all')}
              </Link>
            </Reveal>
          </div>

          <div className="grid-3">
            {news.map((n, i) => (
              <Reveal key={n.id} delay={i * 110}>
                <Link to={`/news/${n.id}`} className="card card--link" style={{ height: '100%' }}>
                  <div className="card-media">
                    <Media src={n.cover} alt={n.title} stub={t('cover_stub')} />
                  </div>
                  <div className="card-body">
                    <span className="card-meta">{fdate(n.date)}</span>
                    <h3 className="card-title">{n.title}</h3>
                    <p className="card-text">{n.excerpt}</p>
                    <span className="btn btn-ghost" style={{ alignSelf: 'flex-start' }}>
                      {t('read')}
                    </span>
                  </div>
                </Link>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {cert && <CertLightbox cert={cert} onClose={() => setCert(null)} />}
    </main>
  )
}
