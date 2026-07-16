import { useState } from 'react'
import { api } from '../api'
import { useSite } from '../store'
import Reveal from '../components/Reveal'

export default function Contacts() {
  const { settings, showToast, openCall } = useSite()
  const [sending, setSending] = useState(false)
  const [error, setError] = useState(null)
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
      })
      f.reset()
      showToast('Сообщение отправлено. Спасибо!')
    } catch (err) {
      setError(err.message)
    } finally {
      setSending(false)
    }
  }

  const rows = [
    { k: 'Адрес', v: settings.address },
    { k: 'Телефон', v: <a href={telHref}>{settings.phone}</a> },
    { k: 'E-mail', v: <a href={`mailto:${settings.email}`}>{settings.email}</a> },
    { k: 'Часы работы', v: settings.hours },
  ]

  return (
    <main className="route-fade">
      <div className="wrap page-head">
        <span className="kicker">Связаться</span>
        <h1>Контакты</h1>
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
                Заказать звонок
              </button>
            </div>

            <div className="map-stub">
              <div className="media-stub">
                <span>Карта проезда</span>
              </div>
            </div>
          </Reveal>

          <Reveal className="form-panel frame" variant="right" delay={120}>
            <h2 style={{ fontSize: 26 }}>Обратная связь</h2>
            <p style={{ color: 'var(--text-2)', margin: '10px 0 22px', fontSize: 15 }}>
              Оставьте сообщение — перезвоним в рабочее время.
            </p>

            <form onSubmit={submit}>
              {error && <div className="form-error">{error}</div>}
              <div className="field">
                <label htmlFor="c_name">Ваше имя</label>
                <input
                  id="c_name"
                  className="input"
                  name="c_name"
                  required
                  placeholder="Как к вам обращаться"
                />
              </div>
              <div className="field">
                <label htmlFor="c_phone">Телефон</label>
                <input
                  id="c_phone"
                  className="input"
                  name="c_phone"
                  required
                  placeholder="+7 ___ ___ __ __"
                />
              </div>
              <div className="field">
                <label htmlFor="c_msg">Сообщение</label>
                <textarea
                  id="c_msg"
                  className="input"
                  name="c_msg"
                  placeholder="Что вас интересует"
                />
              </div>
              <button type="submit" className="btn btn-primary btn-block" disabled={sending}>
                {sending ? 'Отправляем…' : 'Отправить'}
              </button>
            </form>
          </Reveal>
        </div>
      </div>
    </main>
  )
}
