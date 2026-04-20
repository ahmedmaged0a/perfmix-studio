import { useEffect, useRef } from 'react'

type Props = {
  script: string
  uiTheme: 'dark' | 'light'
}

function monacoEditorTheme(ui: 'dark' | 'light'): 'vs-dark' | 'vs' {
  return ui === 'light' ? 'vs' : 'vs-dark'
}

export function WorkspaceScriptViewer(props: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const editorRef = useRef<import('monaco-editor').editor.IStandaloneCodeEditor | null>(null)

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      const { setupMonacoWorkers } = await import('../../monaco/setupMonaco')
      setupMonacoWorkers()
      const monaco = await import('monaco-editor')
      if (cancelled || !hostRef.current) return
      const domTheme = document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark'
      const editor = monaco.editor.create(hostRef.current, {
        value: props.script,
        language: 'javascript',
        theme: monacoEditorTheme(domTheme),
        minimap: { enabled: false },
        automaticLayout: true,
        readOnly: true,
        wordWrap: 'on',
      })
      editorRef.current = editor
    }
    void run()
    return () => {
      cancelled = true
      editorRef.current?.dispose()
      editorRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
    if (model.getValue() !== props.script) {
      editor.setValue(props.script)
    }
  }, [props.script])

  return (
    <div className="ws-panel ws-monaco">
      <div ref={hostRef} className="ws-monaco-host" />
    </div>
  )
}
