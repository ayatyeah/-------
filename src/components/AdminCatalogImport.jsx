import { useRef, useState } from 'react'
import { api } from '../api'
import { Dialog } from './ui'

/** Балл увереннности ИИ → цвет метки и подпись. */
function confidenceTag(score) {
  if (score >= 80) return { cls: 'tag-green', label: `${score}` }
  if (score >= 50) return { cls: 'tag-brass', label: `${score}` }
  return { cls: 'tag-muted', label: `${score}` }
}

/**
 * AI-импорт каталога из файла (задача 7 дорожной карты): загрузка
 * прайс-листа/спецификации → ИИ раскладывает текст на черновики моделей →
 * экран проверки с флагами уверенности → массовое создание.
 *
 * Осознанно не даёт редактировать характеристики построчно прямо здесь:
 * все созданные модели остаются черновиками (published: false), и тонкая
 * доводка — дело уже существующей формы модели, а не этого разового экрана.
 * Здесь только решить, что вообще стоит того, чтобы стать черновиком.
 */
export default function CatalogImportPanel({ cats, onClose, onImported }) {
  const [step, setStep] = useState('upload') // upload | review
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [overview, setOverview] = useState('')
  const [rows, setRows] = useState([])
  const [result, setResult] = useState(null)
  const fileRef = useRef(null)

  async function pickFile(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setBusy(true)
    setError(null)
    try {
      const res = await api.admin.catalogImportAnalyze(file, file.name)
      setOverview(res.overview || '')
      setRows(
        res.items.map((it, i) => ({
          key: i,
          include: it.confidence >= 50,
          name: it.name,
          cat: cats.some((c) => c.id === it.catId) ? it.catId : cats[0]?.id || '',
          short: it.short,
          specs: it.specs,
          subsidized: it.subsidized,
          confidence: it.confidence,
          note: it.note,
        }))
      )
      setStep('review')
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  const setRow = (key, patch) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)))

  async function commit() {
    const chosen = rows.filter((r) => r.include)
    if (!chosen.length) {
      setError('Отметьте хотя бы одну модель')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const res = await api.admin.catalogImportCommit(
        chosen.map((r) => ({
          name: r.name,
          cat: r.cat,
          short: r.short,
          specs: r.specs,
          subsidized: r.subsidized,
        }))
      )
      // Каталог обновляем только когда экран результата закроют (кнопка
      // «Готово»), а не сразу: reload() наверху показывает скелет вкладки
      // и на секунду убрал бы с экрана только что открывшийся результат.
      setResult(res)
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog title="AI-импорт каталога из файла" onClose={onClose} wide>
      {step === 'upload' && (
        <div style={{ padding: '8px 0' }}>
          <p style={{ color: 'var(--text-2)', marginBottom: 16 }}>
            Загрузите прайс-лист или спецификацию — XLSX, DOCX или PDF. ИИ найдёт в тексте модели
            техники и предложит характеристики; ничего не попадёт в каталог без вашего
            подтверждения на следующем экране.
          </p>
          {error && <div className="form-error" style={{ marginBottom: 14 }}>{error}</div>}
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.docx,.pdf"
            onChange={pickFile}
            disabled={busy}
            style={{ display: 'none' }}
          />
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy}
            onClick={() => fileRef.current?.click()}
          >
            {busy ? 'Разбираю файл…' : 'Выбрать файл'}
          </button>
        </div>
      )}

      {step === 'review' && !result && (
        <div style={{ padding: '8px 0' }}>
          {overview && <div className="ai-overview" style={{ marginBottom: 16 }}>{overview}</div>}
          {error && <div className="form-error" style={{ marginBottom: 14 }}>{error}</div>}

          {rows.length === 0 ? (
            <p style={{ color: 'var(--text-2)' }}>ИИ не нашёл в документе ни одной модели техники.</p>
          ) : (
            <div className="table-scroll">
              <table className="table">
                <thead>
                  <tr>
                    <th />
                    <th>Название</th>
                    <th>Категория</th>
                    <th>Субсидия</th>
                    <th>Уверенность</th>
                    <th>Характеристики</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const conf = confidenceTag(r.confidence)
                    return (
                      <tr key={r.key} style={{ opacity: r.include ? 1 : 0.5 }}>
                        <td>
                          <input
                            type="checkbox"
                            checked={r.include}
                            onChange={(e) => setRow(r.key, { include: e.target.checked })}
                          />
                        </td>
                        <td style={{ minWidth: 180 }}>
                          <input
                            className="input"
                            style={{ padding: '6px 8px' }}
                            value={r.name}
                            onChange={(e) => setRow(r.key, { name: e.target.value })}
                          />
                        </td>
                        <td>
                          <select
                            className="input"
                            style={{ padding: '6px 8px' }}
                            value={r.cat}
                            onChange={(e) => setRow(r.key, { cat: e.target.value })}
                          >
                            {cats.map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.name}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <input
                            type="checkbox"
                            checked={r.subsidized}
                            onChange={(e) => setRow(r.key, { subsidized: e.target.checked })}
                          />
                        </td>
                        <td>
                          <span className={`tag ${conf.cls}`} title={r.note || 'Уверенность ИИ, 0-100'}>
                            {conf.label}
                          </span>
                          {r.note && (
                            <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 4, maxWidth: 200 }}>
                              {r.note}
                            </div>
                          )}
                        </td>
                        <td style={{ fontSize: 13, color: 'var(--text-2)', maxWidth: 260 }}>
                          {r.specs.length
                            ? r.specs.map((s) => `${s.k}: ${s.v}`).join(' · ')
                            : '—'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div className="dialog-actions" style={{ marginTop: 20 }}>
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Отмена
            </button>
            {rows.length > 0 && (
              <button type="button" className="btn btn-primary" disabled={busy} onClick={commit}>
                {busy ? 'Создаю…' : `Создать черновиков: ${rows.filter((r) => r.include).length}`}
              </button>
            )}
          </div>
        </div>
      )}

      {result && (
        <div style={{ padding: '8px 0' }}>
          <p>
            Создано черновиков: <b>{result.created.length}</b>
            {result.failed.length > 0 && <> · не удалось: {result.failed.length}</>}
          </p>
          {result.failed.length > 0 && (
            <ul style={{ color: 'var(--text-2)', fontSize: 14, marginTop: 8 }}>
              {result.failed.map((f, i) => (
                <li key={i}>
                  «{f.name}» — {f.error}
                </li>
              ))}
            </ul>
          )}
          <p style={{ color: 'var(--text-2)', marginTop: 12 }}>
            Черновики не опубликованы и не видны на сайте — проверьте и опубликуйте каждый в
            каталоге.
          </p>
          <div className="dialog-actions" style={{ marginTop: 20 }}>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                if (result.created.length) onImported()
                onClose()
              }}
            >
              Готово
            </button>
          </div>
        </div>
      )}
    </Dialog>
  )
}
