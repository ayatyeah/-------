import { useRef, useState } from 'react'
import { api } from '../api'
import { useSite, useFetch } from '../store'
import Reveal from '../components/Reveal'
import { ConsentCheck, Honeypot } from '../components/ui'
import Icon from '../components/Icon'
import usePageMeta from '../hooks/usePageMeta'
import { useT } from '../i18n'
import { getAttribution } from '../lib/attribution'

const SOCIAL = [
  { key: 'instagram_url', name: 'Instagram' },
  { key: 'telegram_url', name: 'Telegram' },
  { key: 'whatsapp_url', name: 'WhatsApp' },
]

/**
 * Карта проезда — по нажатию.
 *
 * Почему не сразу: встроенная карта — это чужой iframe, и он отправляет
 * адрес посетителя в 2ГИС или Яндекс ещё до того, как человек что-либо
 * нажал. Сайт при этом честно спрашивает согласие на аналитику и обещает,
 * что данные остаются в Казахстане, — молча загруженная карта делала бы
 * это обещание неправдой, а кнопку «Только необходимые» — декоративной.
 *
 * Поэтому до нажатия не уходит ни одного запроса: показываем адрес и
 * обычную ссылку «Открыть в 2ГИС», которая работает всегда и никого ни о
 * чём не спрашивает. Нажал «Показать карту» — значит согласился, тогда и
 * грузим.
 *
 * Ссылка на карту задаётся в админке (настройка map_embed_url). Пустая —
 * блок показывает адрес и ссылку, без встраивания: заглушка «здесь будет
 * карта», которая стояла раньше, доверия не прибавляла.
 */
function MapBlock() {
  const { settings } = useSite()
  const { t } = useT()
  const [shown, setShown] = useState(false)

  const embed = settings.map_embed_url || ''
  const address = settings.address || ''
  const searchUrl = `https://2gis.kz/search/${encodeURIComponent(address)}`

  if (!embed || !shown) {
    return (
      <div className="map-stub">
        <div className="media-stub" style={{ flexDirection: 'column', gap: 12, padding: 20 }}>
          <span style={{ textAlign: 'center' }}>{address || t('map_stub')}</span>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
            {embed && (
              <button type="button" className="btn btn-primary btn-sm" onClick={() => setShown(true)}>
                {t('map_show')}
              </button>
            )}
            {address && (
              <a
                className="btn btn-secondary btn-sm"
                href={searchUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                {t('map_open_2gis')}
              </a>
            )}
          </div>
          {embed && (
            <small style={{ opacity: 0.7, textAlign: 'center', maxWidth: 320 }}>
              {t('map_privacy_note')}
            </small>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="map-stub">
      <iframe
        src={embed}
        title={t('map_iframe_title')}
        loading="lazy"
        // Чужому фрейму не нужны ни камера, ни микрофон, ни геолокация:
        // забираем их явно, чтобы карта не могла даже спросить.
        allow=""
        referrerPolicy="no-referrer"
        style={{ width: '100%', height: '100%', border: 0, display: 'block' }}
      />
    </div>
  )
}

/**
 * Список сервисных центров (п.12 дорожной карты) — отдельно от адреса
 * завода в блоке выше. Показывается, только когда админ реально добавил
 * хотя бы один центр (см. server/store.js): выдуманных адресов на сайте
 * быть не должно, а пустой раздел — не повод его рисовать.
 */
function ServiceCenters() {
  const { t } = useT()
  const { data: centers } = useFetch(() => api.serviceCenters(), [])

  if (!centers?.length) return null

  return (
    <Reveal className="wrap service-centers" delay={80}>
      <h2>{t('svc_title')}</h2>
      <div className="service-centers-grid">
        {centers.map((c) => (
          <div className="service-center-card" key={c.id}>
            <h3>{c.name}</h3>
            {c.region && <div className="service-center-region">{c.region}</div>}
            {c.address && <div className="service-center-address">{c.address}</div>}
            <div className="service-center-actions">
              {c.phone && (
                <a href={`tel:${c.phone.replace(/[^\d+]/g, '')}`}>{c.phone}</a>
              )}
              {c.mapUrl && (
                <a href={c.mapUrl} target="_blank" rel="noopener noreferrer">
                  {t('svc_open_map')}
                </a>
              )}
            </div>
          </div>
        ))}
      </div>
    </Reveal>
  )
}

export default function Contacts() {
  usePageMeta({
    title: 'Контакты завода сельхозтехники',
    description:
      'Адрес, телефон и почта ТОО «СХМ Агро» — купить сельхозтехнику в Казахстане. Оставьте заявку — перезвоним в рабочее время.',
  })
  const { settings, showToast, openCall } = useSite()
  const { t } = useT()
  const [sending, setSending] = useState(false)
  const [error, setError] = useState(null)
  const [consent, setConsent] = useState(false)
  const telHref = `tel:${settings.phone.replace(/[^\d+]/g, '')}`

  // Приватный счётчик «начали заполнять форму» — по первому фокусу в любом
  // поле, один раз за визит на страницу (см. server/store.js metrics).
  const startedRef = useRef(false)
  const markStarted = () => {
    if (startedRef.current) return
    startedRef.current = true
    api.metric('form_start').catch(() => {})
  }

  async function submit(e) {
    e.preventDefault()
    const f = e.target
    setSending(true)
    setError(null)
    try {
      await api.createRequest({
        type: 'Звонок',
        fio: f.c_name.value.trim(),
        phone: f.c_phone.value.trim(),
        comment: f.c_msg.value.trim(),
        meta: 'Обратная связь',
        website: f.c_website.value,
        consent: true,
        ...getAttribution(),
      })
      f.reset()
      setConsent(false) // форма очищена — согласие тоже сбрасываем
      showToast(t('contacts_toast'))
    } catch (err) {
      setError(err.message)
    } finally {
      setSending(false)
    }
  }

  const rows = [
    // Реквизиты — первыми и только когда заполнены: по закону о защите прав
    // потребителей продавец должен быть назван.
    settings.legal_name && { k: t('r_name'), v: settings.legal_name },
    settings.bin && { k: t('r_bin'), v: settings.bin },
    { k: t('r_address'), v: settings.address },
    { k: t('r_phone'), v: <a href={telHref}>{settings.phone}</a> },
    { k: t('r_email'), v: <a href={`mailto:${settings.email}`}>{settings.email}</a> },
    { k: t('r_hours'), v: settings.hours },
    // Строка появляется, только когда в настройках указана хотя бы одна ссылка.
    SOCIAL.some(({ key }) => settings[key]) && {
      k: t('r_social'),
      v: (
        <div className="contact-social">
          {SOCIAL.map(({ key, name }) =>
            settings[key] ? (
              <a key={key} href={settings[key]} aria-label={name} target="_blank" rel="noopener noreferrer">
                <Icon name={name.toLowerCase()} size={19} />
              </a>
            ) : null
          )}
        </div>
      ),
    },
  ].filter(Boolean)

  return (
    <main className="route-fade">
      <div className="wrap page-head">
        <span className="kicker">{t('contacts_kicker')}</span>
        <h1>{t('contacts_title')}</h1>
      </div>

      <div className="wrap" style={{ paddingBottom: 72 }}>
        <div className="contacts-layout">
          <Reveal variant="left">
            <div className="contact-rows">
              {rows.map((r) => (
                <div className="contact-row" key={r.k}>
                  <div className="contact-row-k">{r.k}</div>
                  <div className="contact-row-v">{r.v}</div>
                </div>
              ))}
              <button
                type="button"
                className="btn btn-primary btn-block"
                style={{ marginTop: 20 }}
                onClick={openCall}
              >
                {t('call_order')}
              </button>
            </div>

            <MapBlock />
          </Reveal>

          <Reveal className="form-panel frame" variant="right" delay={120}>
            <h2 style={{ fontSize: 26 }}>{t('fb_title')}</h2>
            <p style={{ color: 'var(--text-2)', margin: '10px 0 22px', fontSize: 15 }}>
              {t('fb_lead')}
            </p>

            <form onSubmit={submit} onFocus={markStarted}>
              {error && <div className="form-error">{error}</div>}
              <div className="field">
                <label htmlFor="c_name">{t('f_name')}</label>
                <input id="c_name" className="input" name="c_name" required placeholder={t('f_name_ph')} />
              </div>
              <div className="field">
                <label htmlFor="c_phone">{t('f_phone')}</label>
                <input
                  id="c_phone"
                  className="input"
                  name="c_phone"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  required
                  placeholder="+7 ___ ___ __ __"
                />
              </div>
              <div className="field">
                <label htmlFor="c_msg">{t('f_msg')}</label>
                <textarea id="c_msg" className="input" name="c_msg" placeholder={t('f_msg_ph')} />
              </div>
              <Honeypot name="c_website" />
              <ConsentCheck id="c_consent" checked={consent} onChange={setConsent} />
              <button
                type="submit"
                className="btn btn-primary btn-block"
                disabled={sending || !consent}
              >
                {sending ? t('sending') : t('send')}
              </button>
            </form>
          </Reveal>
        </div>
      </div>

      <ServiceCenters />
    </main>
  )
}
