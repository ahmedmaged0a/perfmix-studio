import { useEffect, useMemo, useState } from 'react'
import { Plus, X } from 'lucide-react'

type Row = { id: string; key: string; value: string }

function recordToRows(value: Record<string, string>): Row[] {
  return Object.entries(value).map(([key, v], idx) => ({
    id: `kv-${idx}-${key}`,
    key,
    value: v,
  }))
}

function rowsToRecord(rows: Row[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const r of rows) {
    const k = r.key.trim()
    if (!k) continue
    out[k] = r.value
  }
  return out
}

type Props = {
  value: Record<string, string>
  onChange: (next: Record<string, string>) => void
  keyLabel?: string
  valueLabel?: string
  keyPlaceholder?: string
  valuePlaceholder?: string
  addLabel?: string
}

export function KeyValueTable(props: Props) {
  const serialized = useMemo(() => JSON.stringify(props.value), [props.value])
  const [rows, setRows] = useState<Row[]>(() => recordToRows(props.value))

  // Only re-sync from parent when the serialized record changes. Do not depend on
  // `props.value` reference alone — parent often passes a new object for the same keys,
  // which would wipe in-progress empty rows after "+ Add" (rowsToRecord drops blank keys).
  useEffect(() => {
    setRows(recordToRows(props.value))
  }, [serialized])

  const addRow = () => {
    setRows((prev) => [...prev, { id: `kv-new-${Date.now()}`, key: '', value: '' }])
  }

  const removeRow = (id: string) => {
    setRows((prev) => {
      const next = prev.filter((r) => r.id !== id)
      props.onChange(rowsToRecord(next))
      return next
    })
  }

  const patchRow = (id: string, patch: Partial<Pick<Row, 'key' | 'value'>>) => {
    setRows((prev) => {
      const next = prev.map((r) => (r.id === id ? { ...r, ...patch } : r))
      props.onChange(rowsToRecord(next))
      return next
    })
  }

  return (
    <div className="kv-table">
      <div className="kv-head">
        <span>{props.keyLabel ?? 'Key'}</span>
        <span>{props.valueLabel ?? 'Value'}</span>
        <span />
      </div>
      {rows.map((r) => (
        <div key={r.id} className="kv-row">
          <input
            className="ws-input kv-cell"
            value={r.key}
            onChange={(e) => patchRow(r.id, { key: e.target.value })}
            placeholder={props.keyPlaceholder ?? 'Key'}
          />
          <input
            className="ws-input kv-cell"
            value={r.value}
            onChange={(e) => patchRow(r.id, { value: e.target.value })}
            placeholder={props.valuePlaceholder ?? 'Value or {{variable}}'}
          />
          <button type="button" className="ws-btn ghost kv-del" title="Remove row" onClick={() => removeRow(r.id)}>
            <X size={12} strokeWidth={2.5} />
          </button>
        </div>
      ))}
      <button type="button" className="ws-btn ghost kv-add" onClick={addRow}>
        <Plus size={13} strokeWidth={2.5} />
        {props.addLabel ?? 'Add Key'}
      </button>
    </div>
  )
}
