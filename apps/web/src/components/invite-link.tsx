import { useState } from 'react'
import { paths } from '../routes'
import { Button } from './ui'

export function InviteLink({ code }: { code: string }) {
  const [message, setMessage] = useState('')
  const href = new URL(paths.invite(code), window.location.origin).href
  return <div className="space-y-2">
    <label className="field text-xs">Ссылка-приглашение<input readOnly value={href} onFocus={event => event.currentTarget.select()} /></label>
    <Button variant="outline" onClick={async () => {
      try {
        await navigator.clipboard.writeText(href)
        setMessage('Ссылка скопирована')
      } catch {
        setMessage('Выделите ссылку и скопируйте её вручную')
      }
    }}>Копировать ссылку</Button>
    {message && <p role="status" className="text-xs muted">{message}</p>}
  </div>
}
