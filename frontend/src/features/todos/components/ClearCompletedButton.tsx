import { ListX } from 'lucide-react'
import { Button } from '../../../design-system'

export function ClearCompletedButton({
  count,
  disabled,
  onClear,
}: {
  count: number
  disabled: boolean
  onClear: () => void
}) {
  if (count === 0) return null
  return (
    <div className="row">
      <Button variant="secondary" disabled={disabled} onClick={onClear}>
        <ListX size={16} aria-hidden="true" />
        Clear completed ({count})
      </Button>
    </div>
  )
}
