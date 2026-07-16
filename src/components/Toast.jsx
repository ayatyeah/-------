import { useSite } from '../store'

export default function Toast() {
  const { toast } = useSite()
  if (!toast) return null

  return (
    <div className="toast" role="status" aria-live="polite">
      <span className="toast-check">✓</span>
      {toast}
    </div>
  )
}
