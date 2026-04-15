import { useEffect, useRef } from 'react'
import type { BodyType } from '../../models/types'

type Props = {
  value: string
  onChange: (next: string) => void
  /** Used as remount key when switching requests */
  requestKey: string
  /** Explicit body type — takes precedence over content-type sniffing */
  bodyType?: BodyType
  /** Content-Type header value from the request, used as fallback language detection */
  contentType?: string
}

function bodyTypeToLanguage(bodyType?: BodyType): string | null {
  switch (bodyType) {
    case 'json': return 'json'
    case 'xml': return 'xml'
    case 'graphql': return 'graphql'
    case 'text': return 'plaintext'
    case 'msgpack': return 'plaintext'
    default: return null
  }
}

function detectLanguage(bodyType?: BodyType, contentType?: string, body?: string): string {
  const fromType = bodyTypeToLanguage(bodyType)
  if (fromType) return fromType

  const ct = (contentType ?? '').toLowerCase()
  if (ct.includes('application/json') || ct.includes('text/json')) return 'json'
  if (ct.includes('application/xml') || ct.includes('text/xml') || ct.includes('application/soap')) return 'xml'
  if (ct.includes('text/html')) return 'html'
  if (ct.includes('application/graphql') || ct.includes('multipart/graphql')) return 'graphql'

  // Fallback: sniff the body content
  const trimmed = (body ?? '').trimStart()
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return 'json'
  if (trimmed.startsWith('<')) return 'xml'

  return 'plaintext'
}

function tryPrettyPrintJson(value: string): string {
  try {
    return JSON.stringify(JSON.parse(value), null, 2)
  } catch {
    return value
  }
}

export function BodyMonacoEditor(props: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const editorRef = useRef<import('monaco-editor').editor.IStandaloneCodeEditor | null>(null)
  const debounceRef = useRef<number | null>(null)
  const propsRef = useRef(props)
  propsRef.current = props

  const language = detectLanguage(props.bodyType, props.contentType, props.value)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const { setupMonacoWorkers } = await import('../../monaco/setupMonaco')
      setupMonacoWorkers()
      const monaco = await import('monaco-editor')
      await import('monaco-editor/min/vs/editor/editor.main.css')
      if (cancelled || !hostRef.current) return

      const lang = detectLanguage(propsRef.current.bodyType, propsRef.current.contentType, propsRef.current.value)
      const initialValue =
        lang === 'json' ? tryPrettyPrintJson(propsRef.current.value) : propsRef.current.value

      const editor = monaco.editor.create(hostRef.current, {
        value: initialValue,
        language: lang,
        theme: 'vs-dark',
        minimap: { enabled: false },
        automaticLayout: true,
        wordWrap: 'on',
        scrollBeyondLastLine: false,
        fontSize: 13,
        tabSize: 2,
        padding: { top: 8, bottom: 8 },
        formatOnPaste: true,
        formatOnType: false,
        // Show line numbers but keep them compact
        lineNumbers: 'on',
        lineNumbersMinChars: 3,
        glyphMargin: false,
        folding: true,
      })
      editorRef.current = editor

      editor.onDidChangeModelContent(() => {
        if (debounceRef.current) window.clearTimeout(debounceRef.current)
        debounceRef.current = window.setTimeout(() => {
          debounceRef.current = null
          const v = editor.getValue()
          if (v !== propsRef.current.value) propsRef.current.onChange(v)
        }, 200)
      })

      // Add format action via keyboard shortcut Shift+Alt+F
      editor.addAction({
        id: 'format-body',
        label: 'Format Body',
        keybindings: [
          // Shift+Alt+F
          monaco.KeyMod.Shift | monaco.KeyMod.Alt | monaco.KeyCode.KeyF,
        ],
        run: (ed) => {
          void ed.getAction('editor.action.formatDocument')?.run()
        },
      })
    })()

    return () => {
      cancelled = true
      if (debounceRef.current) window.clearTimeout(debounceRef.current)
      debounceRef.current = null
      const ed = editorRef.current
      if (ed) {
        const v = ed.getValue()
        if (v !== propsRef.current.value) propsRef.current.onChange(v)
        ed.dispose()
      }
      editorRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- remount when request changes
  }, [props.requestKey])

  // Sync external value changes (e.g. import/reset)
  useEffect(() => {
    const editor = editorRef.current
    if (!editor) return
    const cur = editor.getValue()
    if (cur !== props.value) {
      editor.setValue(props.value)
    }
  }, [props.value])

  return (
    <div className="ws-body-editor-wrap">
      <div className="ws-body-editor-header">
        <span className="ws-body-lang-badge">{language}</span>
        <span className="muted" style={{ fontSize: '0.72rem' }}>
          Shift+Alt+F to format
        </span>
      </div>
      <div className="ws-monaco-host ws-body-monaco-host" ref={hostRef} />
    </div>
  )
}
