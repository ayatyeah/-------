import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import Icon from './Icon'

/**
 * ИИ-ассистент в углу экрана.
 *
 * Отвечает OpenAI (или Gemini как резерв). Если ключей нет или провайдеры
 * недоступны, сервер отвечает по правилам — интерфейс тот же, здесь ничего
 * менять не нужно. В шапке честно пишем, кто отвечает.
 */

const GREETING =
  'Здравствуйте! Я помощник СХМ Агро. Спрошу пару вопросов и подскажу по технике, лизингу, субсидиям и сервису.'

const SUGGESTIONS = [
  'Какие есть тракторы?',
  'Что попадает под субсидию?',
  'Как оформить лизинг?',
  'Какая гарантия?',
]

export default function AiChat() {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState([{ role: 'assistant', text: GREETING }])
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
      const res = await api.ai.chat(msg, history)
      setEngine(res.engine)
      setMessages((p) => [...p, { role: 'assistant', text: res.reply }])
    } catch (e) {
      setMessages((p) => [
        ...p,
        { role: 'assistant', text: 'Связь с сервером пропала. Попробуйте ещё раз или позвоните нам.' },
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
        aria-label={open ? 'Закрыть чат' : 'Открыть чат с помощником'}
        aria-expanded={open}
      >
        {open ? '✕' : <Icon name="chat" size={22} />}
        {!open && <span className="ai-fab-label">Спросить</span>}
      </button>

      {open && (
        <div className="ai-panel" role="dialog" aria-label="ИИ-помощник СХМ Агро">
          <header className="ai-head">
            <span className="ai-dot" />
            <div>
              <div className="ai-title">Помощник СХМ Агро</div>
              <div className="ai-sub">
                {/* 'rules' — это ответы по ключевым словам без ИИ.
                    Любой другой движок (gemini, openai) — настоящий ИИ. */}
                {engine && engine !== 'rules'
                  ? 'На связи · отвечает ИИ'
                  : 'На связи · отвечает по базе знаний'}
              </div>
            </div>
            <button type="button" className="ai-close" onClick={() => setOpen(false)} aria-label="Закрыть">
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
                {SUGGESTIONS.map((s) => (
                  <button type="button" key={s} className="ai-chip" onClick={() => send(s)}>
                    {s}
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
              placeholder="Спросите о технике…"
              maxLength={2000}
              aria-label="Сообщение"
            />
            <button
              type="submit"
              className="ai-send"
              disabled={busy || !input.trim()}
              aria-label="Отправить"
            >
              →
            </button>
          </form>

          {/* Переписку обрабатывает сторонний ИИ-сервис — человек должен знать
              об этом до того, как что-то напишет, а не из политики постфактум. */}
          <div className="ai-note">
            Отвечает ИИ — не вводите личные данные.{' '}
            <Link to="/privacy" target="_blank" rel="noopener noreferrer">
              Подробнее
            </Link>
          </div>
        </div>
      )}
    </>
  )
}
