import { useSite } from '../store'
import Icon from './Icon'

export default function Toast() {
  const { toast } = useSite()
  if (!toast) return null

  return (
    <div className="toast" role="status" aria-live="polite">
      <Icon name="check" size={17} className="toast-check" />
      {toast}
    </div>
  )
}
