import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import Icon from './Icon'
import { useT } from '../i18n'

/**
 * ИИ-ассистент в углу экрана.
 *
 * Отвечает OpenAI (или Gemini как резерв). Если ключей нет или провайдеры
 * недоступны, сервер отвечает по правилам — интерфейс тот же, здесь ничего
 * менять не нужно. В шапке честно пишем, кто отвечает.
 */

const SUGGESTION_KEYS = ['ai_sugg_1', 'ai_sugg_2', 'ai_sugg_3', 'ai_sugg_4']

export default function AiChat() {
  const { t, lang } = useT()
  const [open, setOpen] = useState(false)
  /* Приветствие кладём при первом рендере на текущем языке. Уже начатую
     переписку при смене языка не переписываем — реплики пользователя и ИИ
     пришли на том языке, на котором их писали. */
  const [messages, setMessages] = useState(() => [{ role: 'assistant', text: t('ai_greeting') }])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [engine, setEngine] = useState(null)
  const bodyRef = useRef(null)
  const inputRef = useRef(null)

  // Узнаём, подключён ли ИИ, — показываем это честно, а не притворяемся.
  useEffect(() => {
    api.ai
      .status()
      .then((s) => setEngine(s.engine))
      .catch(() => setEngine(null))
  }, [])

  // Прокручиваем к последней реплике.
  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight
  }, [messages, busy, open])

  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  // Esc закрывает панель.
  useEffect(() => {
    if (!open) return
    const onKey = (e) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  async function send(text) {
    const msg = (text ?? input).trim()
    if (!msg || busy) return

    // История без приветствия — оно не несёт смысла для модели.
    const history = messages.slice(1).map((m) => ({ role: m.role, text: m.text }))

    setMessages((p) => [...p, { role: 'user', text: msg }])
    setInput('')
    setBusy(true)
    try {
      const res = await api.ai.chat(msg, history, lang)
      setEngine(res.engine)
      setMessages((p) => [...p, { role: 'assistant', text: res.reply }])
    } catch (e) {
      setMessages((p) => [
        ...p,
        { role: 'assistant', text: t('ai_err') },
      ])
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button
        type="button"
        className={`ai-fab${open ? ' is-open' : ''}`}
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? t('ai_close_chat') : t('ai_open')}
        aria-expanded={open}
      >
        {open ? '✕' : <Icon name="chat" size={22} />}
        {!open && <span className="ai-fab-label">{t('ai_ask')}</span>}
      </button>

      {open && (
        <div className="ai-panel" role="dialog" aria-label={t('ai_dialog_aria')}>
          <header className="ai-head">
            <span className="ai-dot" />
            <div>
              <div className="ai-title">{t('ai_title')}</div>
              <div className="ai-sub">
                {/* 'rules' — это ответы по ключевым словам без ИИ.
                    Любой другой движок (gemini, openai) — настоящий ИИ. */}
                {engine && engine !== 'rules' ? t('ai_online_ai') : t('ai_online_kb')}
              </div>
            </div>
            <button type="button" className="ai-close" onClick={() => setOpen(false)} aria-label={t('close')}>
              ✕
            </button>
          </header>

          <div className="ai-body" ref={bodyRef}>
            {messages.map((m, i) => (
              <div key={i} className={`ai-msg ai-msg--${m.role}`}>
                {m.text}
              </div>
            ))}

            {busy && (
              <div className="ai-msg ai-msg--assistant ai-typing">
                <i />
                <i />
                <i />
              </div>
            )}

            {messages.length === 1 && !busy && (
              <div className="ai-chips">
                {SUGGESTION_KEYS.map((k) => (
                  <button type="button" key={k} className="ai-chip" onClick={() => send(t(k))}>
                    {t(k)}
                  </button>
                ))}
              </div>
            )}
          </div>

          <form
            className="ai-form"
            onSubmit={(e) => {
              e.preventDefault()
              send()
            }}
          >
            <input
              ref={inputRef}
              className="ai-input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={t('ai_ph')}
              maxLength={2000}
              aria-label={t('ai_msg_aria')}
            />
            <button
              type="submit"
              className="ai-send"
              disabled={busy || !input.trim()}
              aria-label={t('ai_send_aria')}
            >
              →
            </button>
          </form>

          {/* Переписку обрабатывает сторонний ИИ-сервис — человек должен знать
              об этом до того, как что-то напишет, а не из политики постфактум. */}
          <div className="ai-note">
            {t('ai_note')}
            <Link to="/privacy" target="_blank" rel="noopener noreferrer">
              {t('ai_more')}
            </Link>
          </div>
        </div>
      )}
    </>
  )
}
