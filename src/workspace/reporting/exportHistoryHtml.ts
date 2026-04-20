import type { K6RunHistoryEntry } from '../../models/types'

function esc(s: string) {
  return s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

export function buildRunHistoryHtml(requestName: string, entries: K6RunHistoryEntry[]) {
  const rows = [...entries].reverse()

  const bestAvg = rows.reduce((best, e) => {
    if (e.metrics.avgMs == null) return best
    return best == null || e.metrics.avgMs < best ? e.metrics.avgMs : best
  }, null as number | null)

  const body = rows
    .map((e, idx) => {
      const prev = rows[idx + 1]
      const dAvg =
        prev && e.metrics.avgMs != null && prev.metrics.avgMs != null
          ? (e.metrics.avgMs - prev.metrics.avgMs).toFixed(1)
          : null
      const dClass = dAvg == null ? '' : Number(dAvg) > 0 ? 'worse' : Number(dAvg) < 0 ? 'better' : ''
      const statusCls = e.status === 'passed' ? 'pass' : 'fail'
      const isBest = bestAvg != null && e.metrics.avgMs != null && e.metrics.avgMs === bestAvg
      return `<tr>
        <td>${esc(new Date(e.at).toLocaleString())}</td>
        <td>${esc(e.scope)}</td>
        <td><span class="pill ${statusCls}">${esc(e.status)}</span></td>
        <td${isBest ? ' class="best"' : ''}>${e.metrics.avgMs == null ? '—' : `${e.metrics.avgMs.toFixed(1)} ms`}</td>
        <td>${e.metrics.p95Ms == null ? '—' : `${e.metrics.p95Ms.toFixed(1)} ms`}</td>
        <td>${e.metrics.errorRate == null ? '—' : `${(e.metrics.errorRate * 100).toFixed(3)}%`}</td>
        <td>${e.metrics.rps == null ? '—' : `${e.metrics.rps.toFixed(2)}`}</td>
        <td class="${dClass}">${dAvg == null ? '—' : `${Number(dAvg) > 0 ? '+' : ''}${dAvg} ms`}</td>
      </tr>`
    })
    .join('\n')

  const avgValues = rows.map((e) => e.metrics.avgMs).filter((v): v is number => v != null)
  const p95Values = rows.map((e) => e.metrics.p95Ms).filter((v): v is number => v != null)
  const totalRuns = rows.length
  const passedRuns = rows.filter((e) => e.status === 'passed').length
  const passRate = totalRuns > 0 ? ((passedRuns / totalRuns) * 100).toFixed(1) : '0'
  const overallAvg = avgValues.length > 0 ? (avgValues.reduce((a, b) => a + b, 0) / avgValues.length).toFixed(1) : 'n/a'
  const overallP95 = p95Values.length > 0 ? (p95Values.reduce((a, b) => a + b, 0) / p95Values.length).toFixed(1) : 'n/a'

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Run History — ${esc(requestName)}</title>
<style>
:root{ color-scheme:dark; --bg:#0b1220; --text:#e5e7eb; --muted:#94a3b8; --border:rgba(255,255,255,0.10); --accent:#3b82f6; --green:#22c55e; --red:#ef4444; }
*{ box-sizing:border-box; }
body{ font-family:system-ui,Segoe UI,Roboto,Arial; margin:0; background:radial-gradient(1200px 800px at 20% 0%,rgba(59,130,246,0.18),transparent 55%),var(--bg); color:var(--text); }
.wrap{ max-width:1200px; margin:0 auto; padding:24px 18px 60px; }
h1{ font-size:22px; margin:0 0 4px; }
.subtitle{ color:var(--muted); margin:0 0 20px; font-size:13px; }
.kpi-row{ display:grid; grid-template-columns:repeat(auto-fit,minmax(140px,1fr)); gap:12px; margin-bottom:20px; }
.kpi{ border:1px solid var(--border); background:rgba(18,26,43,0.72); border-radius:14px; padding:14px; }
.kpi-label{ font-size:11px; color:var(--muted); text-transform:uppercase; font-weight:600; }
.kpi-val{ font-size:1.4rem; margin-top:6px; font-weight:700; }
.pill{ display:inline-block; padding:3px 8px; border-radius:999px; font-size:11px; font-weight:600; }
.pill.pass{ background:rgba(34,197,94,0.15); color:var(--green); }
.pill.fail{ background:rgba(239,68,68,0.15); color:var(--red); }
table{ width:100%; border-collapse:collapse; font-size:13px; }
th{ text-align:left; font-size:11px; color:var(--muted); text-transform:uppercase; font-weight:600; padding:10px 8px; border-bottom:2px solid var(--border); }
td{ border-bottom:1px solid var(--border); padding:10px 8px; }
tr:hover td{ background:rgba(59,130,246,0.04); }
.better{ color:var(--green); }
.worse{ color:var(--red); }
.best{ font-weight:700; color:var(--green); }
.card{ border:1px solid var(--border); background:rgba(18,26,43,0.72); border-radius:14px; padding:16px; }
.footer{ margin-top:32px; padding-top:16px; border-top:1px solid var(--border); font-size:11px; color:var(--muted); text-align:center; }
</style></head><body><div class="wrap">
<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;margin-bottom:20px">
  <div><div class="pill" style="background:rgba(59,130,246,0.10);color:var(--accent);margin-bottom:8px">PerfMix Studio</div><h1>Run History</h1><p class="subtitle">${esc(requestName)} · ${totalRuns} runs · newest first</p></div>
</div>
<div class="kpi-row">
  <div class="kpi"><div class="kpi-label">Total Runs</div><div class="kpi-val">${totalRuns}</div></div>
  <div class="kpi"><div class="kpi-label">Pass Rate</div><div class="kpi-val">${passRate}%</div></div>
  <div class="kpi"><div class="kpi-label">Overall Avg</div><div class="kpi-val">${overallAvg} ms</div></div>
  <div class="kpi"><div class="kpi-label">Overall p95</div><div class="kpi-val">${overallP95} ms</div></div>
</div>
<div class="card"><h2 style="margin:0 0 12px;font-size:13px;color:var(--muted);font-weight:600;text-transform:uppercase">Run Details</h2>
<div style="overflow:auto"><table><thead><tr><th>When</th><th>Scope</th><th>Status</th><th>Avg</th><th>p95</th><th>Errors</th><th>RPS</th><th>Δ avg</th></tr></thead>
<tbody>${body}</tbody></table></div></div>
<div class="footer">Generated by PerfMix Studio</div>
</div></body></html>`
}
