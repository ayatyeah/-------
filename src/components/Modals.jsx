import { useEffect, useState } from 'react'
import { api } from '../api'
import { useSite } from '../store'
import { ConsentCheck, Dialog, Honeypot } from './ui'
import { useT } from '../i18n'

/** Заявка на КП: имя, телефон, регион, комментарий. */
function KPDialog() {
  const { modal, closeModal, showToast } = useSite()
  const { t, td } = useT()
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
        website: f.k_website.value, // honeypot — у людей пуст
        consent: true,
      })
      closeModal()
      showToast(t('kp_toast'))
    } catch (err) {
      setError(err.message)
    } finally {
      setSending(false)
    }
  }

  return (
    <Dialog title={t('kp_title')} onClose={closeModal}>
      {modal.modelName && (
        <div className="dialog-note">
          {t('kp_model')} <b style={{ color: 'var(--text)' }}>{modal.modelName}</b>
        </div>
      )}
      <form onSubmit={submit}>
        {error && <div className="form-error">{error}</div>}
        <div className="field">
          <label htmlFor="k_name">{t('f_name_req')}</label>
          <input id="k_name" className="input" name="k_name" required placeholder={t('f_name_ph')} />
        </div>
        <div className="field">
          <label htmlFor="k_phone">{t('f_phone_req')}</label>
          <input
            id="k_phone"
            className="input"
            name="k_phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            required
            placeholder="+7 ___ ___ __ __"
          />
        </div>
        <Honeypot name="k_website" />
        <div className="field">
          <label htmlFor="k_region">{t('f_region')}</label>
          {/* value — русская строка (так заявка хранится и читается в админке),
              а видимая подпись переводится через td. */}
          <select id="k_region" className="input" name="k_region">
            {regions.map((r) => (
              <option key={r} value={r}>
                {td(r)}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="k_comment">{t('f_comment')}</label>
          <textarea id="k_comment" className="input" name="k_comment" placeholder={t('f_comment_ph')} />
        </div>
        <ConsentCheck id="k_consent" checked={consent} onChange={setConsent} />
        <div className="dialog-actions">
          <button type="button" className="btn btn-secondary" onClick={closeModal}>
            {t('cancel')}
          </button>
          <button type="submit" className="btn btn-primary" disabled={sending || !consent}>
            {sending ? t('sending') : t('kp_submit')}
          </button>
        </div>
      </form>
    </Dialog>
  )
}

/** Заказ обратного звонка. */
function CallDialog() {
  const { closeModal, showToast } = useSite()
  const { t } = useT()
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
        website: f.cb_website.value,
        consent: true,
      })
      closeModal()
      showToast(t('call_toast'))
    } catch (err) {
      setError(err.message)
    } finally {
      setSending(false)
    }
  }

  return (
    <Dialog title={t('call_title')} onClose={closeModal}>
      <div className="dialog-note">{t('call_note')}</div>
      <form onSubmit={submit}>
        {error && <div className="form-error">{error}</div>}
        <div className="field">
          <label htmlFor="cb_name">{t('f_name_req')}</label>
          <input id="cb_name" className="input" name="cb_name" required placeholder={t('f_name_ph')} />
        </div>
        <div className="field">
          <label htmlFor="cb_phone">{t('f_phone_req')}</label>
          <input
            id="cb_phone"
            className="input"
            name="cb_phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            required
            placeholder="+7 ___ ___ __ __"
          />
        </div>
        <Honeypot name="cb_website" />
        <ConsentCheck id="cb_consent" checked={consent} onChange={setConsent} />
        <div className="dialog-actions">
          <button type="button" className="btn btn-secondary" onClick={closeModal}>
            {t('cancel')}
          </button>
          <button type="submit" className="btn btn-primary" disabled={sending || !consent}>
            {sending ? t('sending') : t('call_submit')}
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
