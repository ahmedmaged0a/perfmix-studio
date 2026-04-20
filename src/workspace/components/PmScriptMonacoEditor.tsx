import { useEffect, useRef } from 'react'
import { disposePmScriptLib, ensurePmScriptLib } from '../pmMonacoTypes'

type Props = {
  value: string
  onChange: (next: string) => void
  /** `jsr223` uses Java-like highlighting for Groovy-ish JMeter scripts (no `pm` typings). */
  phase: 'pre' | 'post' | 'jsr223'
  /** Stable key when switching requests so the editor remounts with fresh state */
  requestKey: string
  uiTheme: 'dark' | 'light'
  placeholder?: string
}

function monacoEditorTheme(ui: 'dark' | 'light'): 'vs-dark' | 'vs' {
  return ui === 'light' ? 'vs' : 'vs-dark'
}

export function PmScriptMonacoEditor(props: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const editorRef = useRef<import('monaco-editor').editor.IStandaloneCodeEditor | null>(null)
  const debounceRef = useRef<number | null>(null)
  const propsRef = useRef(props)
  propsRef.current = props

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const { setupMonacoWorkers } = await import('../../monaco/setupMonaco')
      setupMonacoWorkers()
      const monaco = await import('monaco-editor')
      if (cancelled || !hostRef.current) return

      const lang = props.phase === 'jsr223' ? 'java' : 'javascript'
      if (props.phase !== 'jsr223') {
        ensurePmScriptLib(monaco, props.phase)
      }

      const editor = monaco.editor.create(hostRef.current, {
        value: props.value,
        language: lang,
        theme: monacoEditorTheme(propsRef.current.uiTheme),
        minimap: { enabled: false },
        automaticLayout: true,
        readOnly: false,
        wordWrap: 'on',
        scrollBeyondLastLine: false,
        fontSize: 13,
        tabSize: 2,
        padding: { top: 8, bottom: 8 },
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
    })()

    return () => {
      cancelled = true
      if (debounceRef.current) window.clearTimeout(debounceRef.current)
      debounceRef.current = null
      const ed = editorRef.current
      if (ed) {
        const v = ed.getValue()
        if (v !== propsRef.current.value) propsRef.current.onChange(v)
      }
      ed?.dispose()
      editorRef.current = null
      disposePmScriptLib()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- remount when request or phase identity changes
  }, [props.requestKey, props.phase])

  useEffect(() => {
    const ed = editorRef.current
    if (!ed) return
    void import('monaco-editor').then((monaco) => {
      monaco.editor.setTheme(monacoEditorTheme(props.uiTheme))
    })
  }, [props.uiTheme])

  useEffect(() => {
    const editor = editorRef.current
    if (!editor) return
    const model = editor.getModel()
    if (!model) return
    const cur = model.getValue()
    if (cur !== props.value) {
      editor.setValue(props.value)
    }
  }, [props.value])

  return <div className="ws-monaco-host ws-pm-script-host" ref={hostRef} title={props.placeholder} />
}
