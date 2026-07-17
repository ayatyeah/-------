import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { formatDate } from '../api'
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

const TRUST = [
  { icon: 'shield', t: 'Гарантия 2 года' },
  { icon: 'wrench', t: '34 сервисных центра' },
  { icon: 'percent', t: 'Лизинг и субсидии' },
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
  return (
    <div className="backdrop" onClick={onClose}>
      <div className="lightbox" onClick={(e) => e.stopPropagation()}>
        <div className="lightbox-sheet">
          <div className="cert-seal" style={{ width: 54, height: 54, fontSize: 16 }}>
            СХМ
          </div>
          <div className="cert-title" style={{ fontSize: 24 }}>
            {cert.title}
          </div>
          <div className="cert-org">{cert.org}</div>
        </div>
        <div className="lightbox-cap">
          <span style={{ fontSize: 14, color: 'var(--text-2)' }}>{cert.title}</span>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Закрыть ✕
          </button>
        </div>
      </div>
    </div>
  )
}

export default function Home() {
  // Все данные главной приходят одним запросом /api/home из провайдера.
  const { settings, home, openKP } = useSite()
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
              Производство · Продажа · Сервис
            </Reveal>
            <Reveal as="h1" delay={80}>
              <HeroTitle text={settings.hero_title} />
            </Reveal>
            <Reveal as="p" delay={160}>
              {settings.hero_subtitle}
            </Reveal>
            <Reveal className="hero-actions" delay={240}>
              <button
                type="button"
                className="btn btn-brass btn-lg"
                onClick={() => navigate('/catalog')}
              >
                Смотреть каталог
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-secondary--light btn-lg"
                onClick={() => openKP()}
              >
                Рассчитать цену
              </button>
            </Reveal>

            <Reveal className="hero-trust" delay={320}>
              {TRUST.map((t) => (
                <span className="hero-trust-item" key={t.t}>
                  <Icon name={t.icon} size={17} />
                  {t.t}
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
              {/* LCP-картинка: грузим сразу, приоритетом, без lazy */}
              <img
                src="/assets/hero-field.webp"
                srcSet="/assets/hero-field-sm.webp 760w, /assets/hero-field.webp 1200w"
                sizes="(max-width: 1000px) 100vw, 560px"
                alt="Посевной комплекс СХМ в поле"
                width="1200"
                height="655"
                fetchpriority="high"
                decoding="sync"
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
                <div className="stat-k">{s.k}</div>
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
            О компании
          </Reveal>
          <div className="about-grid">
            <Reveal as="h2" variant="left">
              18 лет строим технику для казахстанских хозяйств
            </Reveal>
            <Reveal className="about-text" variant="right" delay={120}>
              <p>
                СХМ Агро — не перекупщики. Мы делаем технику сами: льём узлы, собираем, красим и
                обкатываем на своём полигоне. Поэтому знаем каждую машину до болта и отвечаем за неё
                после продажи.
              </p>
              <p>
                Конструкцию считаем под степь: перепады от −40 до +40, пыль, длинные гоны и работа
                по 16 часов в смену. Отсюда запас прочности, простое обслуживание и запчасти,
                которые есть на складе, а не «под заказ из Европы».
              </p>
              <Link to="/about" className="btn btn-ghost" style={{ marginTop: 14 }}>
                Подробнее о производстве →
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
            Сертификаты
          </Reveal>
          <div className="section-head">
            <div>
              <Reveal as="h2" delay={60}>
                Соответствие и качество
              </Reveal>
              <Reveal as="p" className="lead" delay={120} style={{ marginTop: 10, fontSize: 16 }}>
                Нажмите на карточку, чтобы увеличить.
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
                    <div className="cert-title">{c.title}</div>
                    <div className="cert-org">{c.org}</div>
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
              <span className="tag tag-brass">Лизинг</span>
              <h3>Работаем через КазАгроФинанс</h3>
              <p>
                Оформите технику в лизинг с государственной поддержкой. Первоначальный взнос,
                льготная ставка и понятный график платежей — подайте заявку напрямую.
              </p>
              <a
                className="btn btn-secondary"
                href={settings.leasing_url}
                target="_blank"
                rel="noopener noreferrer"
              >
                Подать заявку на лизинг →
              </a>
            </Reveal>

            <Reveal className="banner frame" variant="right" delay={120}>
              <span className="tag tag-brass">Субсидии</span>
              <h3>Субсидируемая техника</h3>
              <p>
                Часть нашей техники включена в перечень государственных субсидий. Проверьте
                актуальный список моделей и условия на портале ГосАгро.
              </p>
              <a
                className="btn btn-secondary"
                href={settings.subsidy_url}
                target="_blank"
                rel="noopener noreferrer"
              >
                Перечень на ГосАгро →
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
                Новости
              </Reveal>
              <Reveal as="h2" delay={60}>
                Последнее из хозяйства
              </Reveal>
            </div>
            <Reveal delay={120}>
              <Link to="/news" className="btn btn-secondary">
                Все новости →
              </Link>
            </Reveal>
          </div>

          <div className="grid-3">
            {news.map((n, i) => (
              <Reveal key={n.id} delay={i * 110}>
                <article
                  className="card card--link"
                  style={{ height: '100%' }}
                  onClick={() => navigate(`/news/${n.id}`)}
                >
                  <div className="card-media">
                    <Media src={n.cover} alt={n.title} stub="Обложка" />
                  </div>
                  <div className="card-body">
                    <span className="card-meta">{formatDate(n.date)}</span>
                    <h3 className="card-title">{n.title}</h3>
                    <p className="card-text">{n.excerpt}</p>
                    <span className="btn btn-ghost" style={{ alignSelf: 'flex-start' }}>
                      Читать →
                    </span>
                  </div>
                </article>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {cert && <CertLightbox cert={cert} onClose={() => setCert(null)} />}
    </main>
  )
}
