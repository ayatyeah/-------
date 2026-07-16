/**
 * Иконки — инлайновый SVG, без внешних библиотек.
 * Единая сетка 24×24, штрих 1.6, цвет наследуется от currentColor.
 */
const PATHS = {
  // завод / производство
  factory: (
    <>
      <path d="M3 21h18" />
      <path d="M4 21V10l6 4V10l6 4V6l4-2v17" />
      <path d="M7 17h2M13 17h2" />
    </>
  ),
  // подбор / направление
  compass: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M15.5 8.5l-2 5-5 2 2-5 5-2z" />
    </>
  ),
  // сервис / ключ
  wrench: (
    <>
      <path d="M15.5 3.5a5 5 0 0 0-6.1 6.9L3.7 16.1a2 2 0 1 0 2.8 2.8l5.7-5.7a5 5 0 0 0 6.9-6.1l-2.9 2.9-2.6-.7-.7-2.6 2.6-2.2z" />
    </>
  ),
  // запчасти / шестерня
  gear: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" />
    </>
  ),
  // лизинг / процент
  percent: (
    <>
      <path d="M19 5L5 19" />
      <circle cx="7.5" cy="7.5" r="2.5" />
      <circle cx="16.5" cy="16.5" r="2.5" />
    </>
  ),
  // гарантия / щит
  shield: (
    <>
      <path d="M12 3l7 3v5c0 4.5-3 8.5-7 10-4-1.5-7-5.5-7-10V6l7-3z" />
      <path d="M9 12l2 2 4-4" />
    </>
  ),
  // документ
  doc: (
    <>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5z" />
      <path d="M14 3v5h5M9 13h6M9 17h6" />
    </>
  ),
  // телефон
  phone: (
    <>
      <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2 4.2 2 2 0 0 1 4 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.2-1.2a2 2 0 0 1 2.1-.5c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z" />
    </>
  ),
  // грузовик / поставка
  truck: (
    <>
      <path d="M1 3h13v13H1zM14 8h4l3 3v5h-7" />
      <circle cx="5.5" cy="18.5" r="2" />
      <circle cx="17.5" cy="18.5" r="2" />
    </>
  ),
  // галочка
  check: (
    <>
      <path d="M20 6L9 17l-5-5" />
    </>
  ),
}

export default function Icon({ name, size = 24, className = '', ...rest }) {
  const d = PATHS[name] ?? PATHS.gear
  return (
    <svg
      className={`icon ${className}`.trim()}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {d}
    </svg>
  )
}
