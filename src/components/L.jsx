import { Link as RouterLink, NavLink as RouterNavLink } from 'react-router-dom'
import { useT } from '../i18n'

/**
 * Замена <Link> из react-router-dom, которая сама подставляет текущий
 * языковой префикс (задача 17): написали `<Link to="/catalog">` на
 * казахской странице — получили ссылку на «/kk/catalog», без правки на
 * каждом месте использования. Внешние адреса, якоря (#hash), mailto:/tel: —
 * не трогаем, withLang() их не меняет (см. src/i18n.jsx).
 */
export default function Link({ to, ...rest }) {
  const { withLang } = useT()
  return <RouterLink to={typeof to === 'string' ? withLang(to) : to} {...rest} />
}

/** То же для NavLink (подсветка активного пункта меню). */
export function NavLink({ to, ...rest }) {
  const { withLang } = useT()
  return <RouterNavLink to={typeof to === 'string' ? withLang(to) : to} {...rest} />
}
