import { useState } from 'react'
import { api } from '../api'
import { useSite } from '../store'
import Reveal from '../components/Reveal'
import { ConsentCheck, Honeypot } from '../components/ui'
import Icon from '../components/Icon'
import usePageMeta from '../hooks/usePageMeta'
import { useT } from '../i18n'

const SOCIAL = [
  { key: 'instagram_url', name: 'Instagram' },
  { key: 'telegram_url', name: 'Telegram' },
  { key: 'whatsapp_url', name: 'WhatsApp' },
]

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

            <div className="map-stub">
              <div className="media-stub">
                <span>{t('map_stub')}</span>
              </div>
            </div>
          </Reveal>

          <Reveal className="form-panel frame" variant="right" delay={120}>
            <h2 style={{ fontSize: 26 }}>{t('fb_title')}</h2>
            <p style={{ color: 'var(--text-2)', margin: '10px 0 22px', fontSize: 15 }}>
              {t('fb_lead')}
            </p>

            <form onSubmit={submit}>
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
    </main>
  )
}
