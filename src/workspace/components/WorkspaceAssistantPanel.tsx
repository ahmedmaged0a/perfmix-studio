import { useState, type FormEvent } from 'react'

type ChatMessage = { role: 'user' | 'assistant'; text: string; at: string }

const API = import.meta.env.VITE_AI_API_URL as string | undefined

const OFFLINE_KNOWLEDGE: Record<string, string> = {
  'test case': 'A test case (TC) maps to a k6 scenario. Each TC defines VUs, duration, ramp-up, and performance criteria (avg response time, p95, error rate, throughput). Add TCs in the Request tab, under the test cases table. Each row becomes a separate k6 scenario with its own thresholds.',
  threshold: 'Thresholds are pass/fail criteria for your k6 test. Set them per test case: max avg response (ms), max p95 (ms), max error rate (0-1), and min throughput (req/s). k6 will mark the run as failed if any threshold is breached.',
  variable: 'Variables can be environment-specific (DEV/TEST/STAGING) or shared. Use the right panel to define key-value pairs. Reference them in URLs, headers, or body using {{variableName}} syntax. The k6 generator replaces them at script generation time.',
  environment: 'Environments (DEV, TEST, STAGING) let you maintain different variable sets. Select the active environment from the top bar. Each environment has its own key-value map, plus shared variables that apply everywhere.',
  collection: 'A collection groups related API requests. Use the left sidebar to create collections and add requests to them. You can export an entire collection as a single k6 script or run all requests together.',
  correlation: 'Correlation lets you extract values from one response and use them in subsequent requests. Define rules in the right panel under "Extract": pick a source request, specify a JSONPath (e.g. $.token), and name the variable. The extracted value is available as {{variableName}}.',
  csv: 'CSV data-driven testing: Upload a CSV file in the right panel. Each row becomes a data iteration. Reference CSV fields using {{data}} in your URL, headers, or body. For multi-column CSVs, field names are mapped to variables.',
  report: 'The Reporting tab shows run history for each request. You can compare runs side-by-side (avg, p95, errors, RPS), see delta changes, and download HTML reports. Charts show response time distribution and RPS over time.',
  export: 'Export your k6 script from the top bar. Choose "Active request" for a single request or "Whole collection" for all requests. The downloaded .js file is ready for CI/CD pipelines (k6 run script.js).',
  run: 'Click "Run" in the top bar to execute the generated k6 script locally. Choose Performance or Smoke mode. Results appear in the Request Output tab (quick metrics) and the Reporting tab (full history). Make sure k6 is installed or bundled.',
  k6: 'k6 is an open-source load testing tool. PerfMix Studio generates k6 scripts from your request definitions and test cases, then executes them locally using the k6 CLI. Results are parsed from k6\'s --summary-export JSON output.',
  scenario: 'Each test case becomes a k6 scenario. Scenarios run in parallel with independent VU counts, durations, and ramp-up periods. This lets you simulate different load patterns (e.g., 5 VUs for 10 min AND 3 VUs for 5 min) in a single test run.',
  performance: 'Performance criteria define expected behavior: max average response time (ms), max p95 latency (ms), max error rate (0.0-1.0), and minimum throughput (req/s). These translate directly to k6 thresholds that determine pass/fail.',
  ramp: 'Ramp-up defines how quickly VUs scale up to the target count. For example, a 30s ramp-up with 10 VUs means k6 gradually adds VUs over 30 seconds. This simulates realistic load patterns instead of sudden traffic spikes.',
}

function offlineAnswer(question: string): string {
  const lower = question.toLowerCase()

  for (const [keyword, answer] of Object.entries(OFFLINE_KNOWLEDGE)) {
    if (lower.includes(keyword)) {
      return answer
    }
  }

  if (lower.includes('how') && (lower.includes('start') || lower.includes('begin') || lower.includes('use'))) {
    return 'Getting started: 1) Create or select a project from the top bar. 2) Add a collection in the left sidebar. 3) Add a request with method, URL, headers, and body. 4) Optionally add test cases with performance criteria. 5) Click Run to execute, or Download .js to export for CI/CD. Check the Reporting tab after runs for history and comparisons.'
  }

  if (lower.includes('help') || lower.includes('what can')) {
    return 'I can help with: creating test cases, setting thresholds, configuring variables/environments, understanding k6 scripts, correlation/extraction, CSV data-driven tests, reporting features, and exporting for CI/CD. Ask me anything specific!'
  }

  return `I'm running in offline mode with built-in knowledge about PerfMix Studio features. I can answer questions about: test cases, thresholds, variables, environments, collections, correlation, CSV data, reporting, exports, k6 scenarios, and performance criteria.\n\nFor AI-powered answers, set the VITE_AI_API_URL environment variable to an OpenAI-compatible endpoint (e.g., https://api.openai.com/v1/chat/completions). Your question: "${question}" — try rephrasing with one of the topics above.`
}

export function WorkspaceAssistantPanel() {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: 'assistant',
      at: new Date().toISOString(),
      text: 'Welcome! Ask me about test cases, thresholds, variables, environments, k6 scripts, reporting, or any PerfMix Studio feature. I work offline with built-in knowledge, or connect to an AI API via VITE_AI_API_URL.',
    },
  ])
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const text = draft.trim()
    if (!text) return
    const userMsg: ChatMessage = { role: 'user', text, at: new Date().toISOString() }
    const thread = [...messages, userMsg]
    setMessages(thread)
    setDraft('')
    setBusy(true)
    try {
      if (API) {
        const res = await fetch(API, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages: thread.map((x) => ({ role: x.role, content: x.text })),
          }),
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = (await res.json()) as { choices?: { message?: { content?: string } }[] }
        const content = data.choices?.[0]?.message?.content?.trim() || 'No content returned.'
        setMessages((m) => [...m, { role: 'assistant', text: content, at: new Date().toISOString() }])
      } else {
        await new Promise((r) => setTimeout(r, 300))
        const reply = offlineAnswer(text)
        setMessages((m) => [...m, { role: 'assistant', text: reply, at: new Date().toISOString() }])
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Request failed'
      const fallback = offlineAnswer(text)
      setMessages((m) => [
        ...m,
        { role: 'assistant', text: `API error: ${msg}\n\nFalling back to offline answer:\n${fallback}`, at: new Date().toISOString() },
      ])
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="ws-assistant">
      <div className="ws-assistant-head">
        <div className="ws-title">AI assistant</div>
        <p className="muted" style={{ margin: '6px 0 0' }}>
          {API ? <span className="mono tiny">{API}</span> : <span>Offline mode — built-in knowledge base active.</span>}
        </p>
      </div>
      <div className="ws-assistant-thread">
        {messages.map((m, idx) => (
          <div key={`${m.at}-${idx}`} className={`ws-chat-bubble ${m.role}`}>
            <div className="ws-chat-meta">{m.role === 'user' ? 'You' : 'Assistant'}</div>
            <div className="ws-chat-text">{m.text}</div>
          </div>
        ))}
      </div>
      <form className="ws-assistant-form" onSubmit={(e) => void submit(e)}>
        <textarea
          className="ws-textarea"
          rows={3}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              void submit(e as unknown as FormEvent)
            }
          }}
          placeholder="Ask anything about PerfMix Studio…"
        />
        <button type="submit" className="ws-btn primary" disabled={busy}>
          {busy ? 'Thinking…' : 'Send'}
        </button>
      </form>
    </div>
  )
}
