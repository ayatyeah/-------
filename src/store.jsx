import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { api } from './api'

const SiteContext = createContext(null)

/** Значения до загрузки настроек — чтобы шапка/подвал не «прыгали». */
const FALLBACK = {
  phone: '+7 7172 55-00-00',
  email: 'info@shmagro.kz',
  address: 'г. Астана, Индустриальная зона, ул. Заводская 7',
  hours: 'Пн–Пт 8:00–18:00, Сб 9:00–14:00',
  leasing_url: 'https://kazagro.kz',
  subsidy_url: 'https://qoldau.kz',
  hero_title: 'Сельхозтехника, сделанная для степи',
  hero_subtitle:
    'Собственное производство тракторов, комбайнов и посевных комплексов в Казахстане.',
}

export function SiteProvider({ children }) {
  const [settings, setSettings] = useState(FALLBACK)
  // Данные главной: настройки, показатели, услуги, сертификаты, новости.
  const [home, setHome] = useState(null)
  const [toast, setToast] = useState(null)
  // { kind: 'kp' | 'call', modelId?, modelName? }
  const [modal, setModal] = useState(null)
  const timer = useRef(null)

  useEffect(() => {
    // Один запрос на весь сайт: настройки нужны в шапке и подвале везде,
    // остальное — на главной и «О компании».
    api
      .home()
      .then((d) => {
        setSettings({ ...FALLBACK, ...d.settings })
        setHome(d)
      })
      .catch(() => {
        /* сервер недоступен — остаёмся на значениях по умолчанию */
      })
  }, [])

  const showToast = useCallback((msg) => {
    setToast(msg)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setToast(null), 2800)
  }, [])

  useEffect(() => () => clearTimeout(timer.current), [])

  const openKP = useCallback((model) => {
    setModal({ kind: 'kp', modelId: model?.id ?? null, modelName: model?.name ?? '' })
  }, [])

  const openCall = useCallback(() => setModal({ kind: 'call' }), [])
  const closeModal = useCallback(() => setModal(null), [])

  const value = {
    settings,
    setSettings,
    home,
    toast,
    showToast,
    modal,
    openKP,
    openCall,
    closeModal,
  }

  return <SiteContext.Provider value={value}>{children}</SiteContext.Provider>
}

export function useSite() {
  const ctx = useContext(SiteContext)
  if (!ctx) throw new Error('useSite должен вызываться внутри <SiteProvider>')
  return ctx
}

/** Загрузка данных с состояниями loading/error и повтором. */
export function useFetch(fn, deps = []) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    let alive = true
    setLoading(true)
    setError(null)
    fn()
      .then((d) => alive && setData(d))
      .catch((e) => alive && setError(e.message))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce])

  return { data, loading, error, reload: () => setNonce((n) => n + 1) }
}
