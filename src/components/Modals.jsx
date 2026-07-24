import { useEffect, useState } from 'react'
import { api } from '../api'
import { useSite } from '../store'
import { ConsentCheck, Dialog } from './ui'

/** Заявка на КП: имя, телефон, регион, комментарий. */
function KPDialog() {
  const { modal, closeModal, showToast } = useSite()
  const [regions, setRegions] = useState([])
  const [sending, setSending] = useState(false)
  const [error, setError] = useState(null)
  const [consent, setConsent] = useState(false)

  useEffect(() => {
    api.regions().then(setRegions).catch(() => setRegions([]))
  }, [])

  async function submit(e) {
    e.preventDefault()
    const f = e.target
    setSending(true)
    setError(null)
    try {
      await api.createRequest({
        type: 'КП',
        fio: f.k_name.value.trim(),
        phone: f.k_phone.value.trim(),
        region: f.k_region.value,
        comment: f.k_comment.value.trim(),
        modelId: modal.modelId,
        consent: true,
      })
      closeModal()
      showToast('Заявка на КП отправлена. Мы свяжемся с вами.')
    } catch (err) {
      setError(err.message)
    } finally {
      setSending(false)
    }
  }

  return (
    <Dialog title="Получить коммерческое предложение" onClose={closeModal}>
      {modal.modelName && (
        <div className="dialog-note">
          Модель: <b style={{ color: 'var(--text)' }}>{modal.modelName}</b>
        </div>
      )}
      <form onSubmit={submit}>
        {error && <div className="form-error">{error}</div>}
        <div className="field">
          <label htmlFor="k_name">Ваше имя *</label>
          <input id="k_name" className="input" name="k_name" required placeholder="Как к вам обращаться" />
        </div>
        <div className="field">
          <label htmlFor="k_phone">Телефон *</label>
          <input id="k_phone" className="input" name="k_phone" required placeholder="+7 ___ ___ __ __" />
        </div>
        <div className="field">
          <label htmlFor="k_region">Регион</label>
          <select id="k_region" className="input" name="k_region">
            {regions.map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="k_comment">Комментарий</label>
          <textarea
            id="k_comment"
            className="input"
            name="k_comment"
            placeholder="Комплектация, количество, сроки"
          />
        </div>
        <ConsentCheck id="k_consent" checked={consent} onChange={setConsent} />
        <div className="dialog-actions">
          <button type="button" className="btn btn-secondary" onClick={closeModal}>
            Отмена
          </button>
          <button type="submit" className="btn btn-primary" disabled={sending || !consent}>
            {sending ? 'Отправляем…' : 'Отправить заявку'}
          </button>
        </div>
      </form>
    </Dialog>
  )
}

/** Заказ обратного звонка. */
function CallDialog() {
  const { closeModal, showToast } = useSite()
  const [sending, setSending] = useState(false)
  const [error, setError] = useState(null)
  const [consent, setConsent] = useState(false)

  async function submit(e) {
    e.preventDefault()
    const f = e.target
    setSending(true)
    setError(null)
    try {
      await api.createRequest({
        type: 'Звонок',
        fio: f.cb_name.value.trim(),
        phone: f.cb_phone.value.trim(),
        consent: true,
      })
      closeModal()
      showToast('Заявка на звонок принята. Скоро перезвоним.')
    } catch (err) {
      setError(err.message)
    } finally {
      setSending(false)
    }
  }

  return (
    <Dialog title="Заказать звонок" onClose={closeModal}>
      <div className="dialog-note">
        Оставьте имя и телефон — перезвоним в течение рабочего дня.
      </div>
      <form onSubmit={submit}>
        {error && <div className="form-error">{error}</div>}
        <div className="field">
          <label htmlFor="cb_name">Ваше имя *</label>
          <input id="cb_name" className="input" name="cb_name" required placeholder="Как к вам обращаться" />
        </div>
        <div className="field">
          <label htmlFor="cb_phone">Телефон *</label>
          <input id="cb_phone" className="input" name="cb_phone" required placeholder="+7 ___ ___ __ __" />
        </div>
        <ConsentCheck id="cb_consent" checked={consent} onChange={setConsent} />
        <div className="dialog-actions">
          <button type="button" className="btn btn-secondary" onClick={closeModal}>
            Отмена
          </button>
          <button type="submit" className="btn btn-primary" disabled={sending || !consent}>
            {sending ? 'Отправляем…' : 'Жду звонка'}
          </button>
        </div>
      </form>
    </Dialog>
  )
}

export default function Modals() {
  const { modal } = useSite()
  if (!modal) return null
  if (modal.kind === 'kp') return <KPDialog />
  if (modal.kind === 'call') return <CallDialog />
  return null
}
