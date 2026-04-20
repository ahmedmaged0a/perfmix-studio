mod db;

use once_cell::sync::Lazy;
use serde::Deserialize;
use serde::Serialize;
use std::collections::HashMap;
use std::sync::Arc;
use std::str::FromStr;
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::Mutex;
use std::time::{Instant, SystemTime, UNIX_EPOCH};
use tauri::path::BaseDirectory;
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;
use reqwest::cookie::Jar;
use reqwest::header::{HeaderMap, HeaderName, HeaderValue};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

/// Suppress an extra console window when spawning CLI subprocesses from the Tauri GUI (Windows).
#[cfg(target_os = "windows")]
fn hide_console(cmd: &mut Command) {
  const CREATE_NO_WINDOW: u32 = 0x0800_0000;
  cmd.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(target_os = "windows"))]
fn hide_console(_cmd: &mut Command) {}

#[derive(Clone, Serialize)]
struct BootstrapResult {
  k6_path: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "snake_case")]
struct RuntimeDiagnostics {
  tauri_available: bool,
  k6_path: String,
  mode: String,
  can_execute: bool,
  runs_dir_writable: bool,
  k6_version: String,
  issues: Vec<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "lowercase")]
enum RunState {
  Queued,
  Running,
  Passed,
  Failed,
}

#[derive(Clone, Serialize)]
struct RunStatusPayload {
  run_id: String,
  status: RunState,
  logs: Vec<String>,
  #[serde(skip_serializing_if = "Option::is_none")]
  summary_path: Option<String>,
  #[serde(skip_serializing_if = "Option::is_none")]
  report_html_path: Option<String>,
  #[serde(skip_serializing_if = "Option::is_none")]
  summary_json: Option<String>,
}

#[derive(Clone)]
struct RunRecord {
  status: RunState,
  logs: Vec<String>,
  /// Wall clock anchor for elapsed prefixes on streamed k6 lines.
  log_start: Instant,
  summary_path: Option<PathBuf>,
  report_html_path: Option<PathBuf>,
  report_html: Option<String>,
  pid: Option<u32>,
}

static RUNS: Lazy<Mutex<HashMap<String, RunRecord>>> = Lazy::new(|| Mutex::new(HashMap::new()));
const MAX_LOG_LINES: usize = 2000;

/// Shared cookie jar for legacy `http_execute` calls without `cookieSessionId` (backward compatible).
static HTTP_COOKIES: Lazy<Arc<Jar>> = Lazy::new(|| Arc::new(Jar::default()));

fn build_blocking_http_client(jar: Arc<Jar>, redirect: reqwest::redirect::Policy) -> reqwest::blocking::Client {
  reqwest::blocking::Client::builder()
    .cookie_provider(jar)
    .timeout(std::time::Duration::from_secs(120))
    .redirect(redirect)
    .build()
    .expect("reqwest blocking HTTP client")
}

/// Default client: follow redirects (e.g. `openid-connect/auth` → login HTML).
static HTTP_CLIENT_FOLLOW: Lazy<reqwest::blocking::Client> = Lazy::new(|| {
  build_blocking_http_client(HTTP_COOKIES.clone(), reqwest::redirect::Policy::limited(10))
});

/// Keycloak `login-actions/authenticate`: do **not** follow redirects so `Location` with `?code=` stays
/// visible for header correlation (`tokenCode`) before the EUUM token exchange.
static HTTP_CLIENT_NO_REDIRECT: Lazy<reqwest::blocking::Client> =
  Lazy::new(|| build_blocking_http_client(HTTP_COOKIES.clone(), reqwest::redirect::Policy::none()));

/// Per Send-batch cookie jars (UI passes a UUID) so Keycloak replays do not reuse a stale global session.
#[derive(Clone)]
struct SessionHttpClients {
  follow: reqwest::blocking::Client,
  no_redirect: reqwest::blocking::Client,
}

static HTTP_SESSION_CLIENTS: Lazy<Mutex<HashMap<String, Arc<SessionHttpClients>>>> =
  Lazy::new(|| Mutex::new(HashMap::new()));

fn make_session_http_clients() -> Arc<SessionHttpClients> {
  let jar = Arc::new(Jar::default());
  let follow = build_blocking_http_client(jar.clone(), reqwest::redirect::Policy::limited(10));
  let no_redirect = build_blocking_http_client(jar, reqwest::redirect::Policy::none());
  Arc::new(SessionHttpClients {
    follow,
    no_redirect,
  })
}

fn session_http_clients(session_id: &str) -> Arc<SessionHttpClients> {
  let mut m = HTTP_SESSION_CLIENTS.lock().expect("cookie session mutex");
  m.entry(session_id.to_string())
    .or_insert_with(make_session_http_clients)
    .clone()
}

fn sanitize_run_label(raw: &str) -> String {
  let mut out = String::new();
  let mut prev_underscore = false;
  for ch in raw.chars() {
    let mapped = if ch.is_ascii_alphanumeric() {
      Some(ch.to_ascii_lowercase())
    } else if ch == '_' || ch == '-' {
      Some(ch)
    } else if ch.is_whitespace() || ch == '.' || ch == '/' || ch == '\\' || ch == ':' {
      Some('_')
    } else {
      None
    };
    if let Some(c) = mapped {
      if c == '_' {
        if !out.is_empty() && !prev_underscore {
          out.push(c);
          prev_underscore = true;
        }
      } else {
        out.push(c);
        prev_underscore = false;
      }
    }
  }
  while out.ends_with('_') {
    out.pop();
  }
  let max = 60usize;
  if out.len() > max {
    out.truncate(max);
    while out.ends_with('_') {
      out.pop();
    }
  }
  out
}

fn build_run_id(run_label: Option<String>) -> String {
  let nanos = SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .map(|d| d.as_nanos())
    .unwrap_or(0);
  let suffix = format!("{:x}", (nanos & 0xffff_ffff) as u32);
  let Some(label) = run_label.filter(|s| !s.trim().is_empty()) else {
    return format!("run_{nanos}");
  };
  let safe = sanitize_run_label(label.trim());
  if safe.is_empty() {
    return format!("run_{nanos}");
  }
  format!("{safe}_{suffix}")
}

fn resource_binary_name() -> &'static str {
  if cfg!(target_os = "windows") {
    "k6-windows-amd64.exe"
  } else if cfg!(target_os = "macos") && cfg!(target_arch = "aarch64") {
    "k6-darwin-arm64"
  } else if cfg!(target_os = "macos") {
    "k6-darwin-amd64"
  } else {
    "k6-linux-amd64"
  }
}

fn installed_binary_name() -> &'static str {
  if cfg!(target_os = "windows") {
    "k6.exe"
  } else {
    "k6"
  }
}

fn ensure_runtime(app: &tauri::AppHandle) -> Result<PathBuf, String> {
  let app_data = app
    .path()
    .app_data_dir()
    .map_err(|e| format!("Failed to resolve app data dir: {e}"))?;
  let bin_dir = app_data.join("runtime").join("bin");
  let runs_dir = app_data.join("runs");
  fs::create_dir_all(&bin_dir).map_err(|e| format!("Failed to create runtime dir: {e}"))?;
  fs::create_dir_all(&runs_dir).map_err(|e| format!("Failed to create runs dir: {e}"))?;

  let installed = bin_dir.join(installed_binary_name());
  if installed.exists() {
    return Ok(installed);
  }

  let bundled_source = app
    .path()
    .resolve(
      format!("k6/{}", resource_binary_name()),
      BaseDirectory::Resource,
    )
    .map_err(|e| format!("Failed to resolve bundled k6 path: {e}"))?;

  if !bundled_source.exists() {
    // Dev fallback: if k6 is already available in PATH, use it.
    let mut probe = Command::new("k6");
    hide_console(&mut probe);
    if probe
      .arg("version")
      .stdout(Stdio::null())
      .stderr(Stdio::null())
      .status()
      .map(|s| s.success())
      .unwrap_or(false)
    {
      return Ok(PathBuf::from("k6"));
    }
    return Err(format!(
      "Bundled k6 binary missing at {} and no system k6 found in PATH.",
      bundled_source.display()
    ));
  }

  fs::copy(&bundled_source, &installed).map_err(|e| format!("Failed to copy k6 runtime: {e}"))?;

  #[cfg(unix)]
  {
    use std::os::unix::fs::PermissionsExt;
    let mut perms = fs::metadata(&installed)
      .map_err(|e| format!("Failed to read runtime metadata: {e}"))?
      .permissions();
    perms.set_mode(0o755);
    fs::set_permissions(&installed, perms)
      .map_err(|e| format!("Failed to set runtime executable permission: {e}"))?;
  }

  Ok(installed)
}

fn detect_mode(path: &PathBuf) -> String {
  if path.to_string_lossy() == "k6" {
    "path".to_string()
  } else if path.exists() {
    "bundled".to_string()
  } else {
    "unavailable".to_string()
  }
}

fn append_log(run_id: &str, line: String) {
  if let Ok(mut runs) = RUNS.lock() {
    if let Some(run) = runs.get_mut(run_id) {
      let sec = run.log_start.elapsed().as_secs_f32();
      let stamped = format!("[{sec:>7.1}s] {line}");
      run.logs.push(stamped);
      if run.logs.len() > MAX_LOG_LINES {
        let overflow = run.logs.len() - MAX_LOG_LINES;
        run.logs.drain(0..overflow);
      }
    }
  }
}

fn set_status(run_id: &str, status: RunState) {
  if let Ok(mut runs) = RUNS.lock() {
    if let Some(run) = runs.get_mut(run_id) {
      run.status = status;
    }
  }
}

fn set_run_artifacts(run_id: &str, summary_path: PathBuf, report_html_path: PathBuf, report_html: String) {
  if let Ok(mut runs) = RUNS.lock() {
    if let Some(run) = runs.get_mut(run_id) {
      run.summary_path = Some(summary_path);
      run.report_html_path = Some(report_html_path);
      run.report_html = Some(report_html);
    }
  }
}

fn metric_f64(summary: &serde_json::Value, metric: &str, field: &str) -> Option<f64> {
  let m = summary.get("metrics")?.get(metric)?;
  m.get("values")
    .and_then(|v| v.get(field))
    .and_then(|v| v.as_f64())
    .or_else(|| m.get(field)?.as_f64())
}

fn build_html_report(summary: &serde_json::Value, run_id: &str, exit_code: i32) -> String {
  let avg_ms = metric_f64(summary, "http_req_duration", "avg");
  let p50_ms = metric_f64(summary, "http_req_duration", "med");
  let p90_ms = metric_f64(summary, "http_req_duration", "p(90)");
  let p95_ms = metric_f64(summary, "http_req_duration", "p(95)");
  let p99_ms = metric_f64(summary, "http_req_duration", "p(99)");
  let min_ms = metric_f64(summary, "http_req_duration", "min");
  let max_ms = metric_f64(summary, "http_req_duration", "max");
  let err_rate = metric_f64(summary, "http_req_failed", "rate");
  let err_count = metric_f64(summary, "http_req_failed", "passes");
  let reqs = metric_f64(summary, "http_reqs", "count");
  let rps = metric_f64(summary, "http_reqs", "rate");
  let sending = metric_f64(summary, "http_req_sending", "avg");
  let waiting = metric_f64(summary, "http_req_waiting", "avg");
  let receiving = metric_f64(summary, "http_req_receiving", "avg");
  let connecting = metric_f64(summary, "http_req_connecting", "avg");
  let tls_hs = metric_f64(summary, "http_req_tls_handshaking", "avg");
  let blocked = metric_f64(summary, "http_req_blocked", "avg");
  let iterations = metric_f64(summary, "iterations", "count");
  let iter_dur = metric_f64(summary, "iteration_duration", "avg");
  let vus_val = metric_f64(summary, "vus", "value");
  let vus_max = metric_f64(summary, "vus_max", "value");
  let data_recv = metric_f64(summary, "data_received", "count");
  let data_sent = metric_f64(summary, "data_sent", "count");

  let fm = |v: Option<f64>| -> String { v.map(|x| format!("{x:.2}")).unwrap_or_else(|| "n/a".to_string()) };
  let fi = |v: Option<f64>| -> String { v.map(|x| format!("{x:.0}")).unwrap_or_else(|| "n/a".to_string()) };
  let fp = |v: Option<f64>| -> String { v.map(|x| format!("{:.3}%", x * 100.0)).unwrap_or_else(|| "n/a".to_string()) };
  let fb = |v: Option<f64>| -> String {
    v.map(|x| {
      if x > 1_048_576.0 { format!("{:.1} MB", x / 1_048_576.0) }
      else if x > 1024.0 { format!("{:.1} KB", x / 1024.0) }
      else { format!("{x:.0} B") }
    }).unwrap_or_else(|| "n/a".to_string())
  };

  let status_class = if exit_code == 0 { "pass" } else { "fail" };
  let status_label = if exit_code == 0 { "PASSED" } else { "FAILED" };

  let latency_score = avg_ms.map(|a| { let c = (a / 20.0).min(100.0); 100.0 - c }).unwrap_or(0.0);
  let reliability_score = err_rate.map(|e| ((1.0 - e) * 100.0).max(0.0)).unwrap_or(0.0);
  let throughput_score = rps.map(|r| (r / 1.0).min(100.0).max(5.0)).unwrap_or(0.0);

  format!(
    r#"<!doctype html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>PerfMix Studio - Run Report ({run_id})</title>
<style>
:root{{ color-scheme:dark; --bg:#0b1220; --text:#e8eefc; --muted:#a7b4d6; --border:rgba(255,255,255,0.10); --accent:#3b82f6; --green:#22c55e; --red:#ef4444; }}
*{{ box-sizing:border-box; }}
body{{ margin:0; font-family:system-ui,Segoe UI,Roboto,Arial; background:radial-gradient(1200px 800px at 20% 0%,rgba(59,130,246,0.18),transparent 55%),var(--bg); color:var(--text); }}
.wrap{{ max-width:1200px; margin:0 auto; padding:28px 18px 60px; }}
.header{{ display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px; margin-bottom:20px; }}
h1{{ margin:0; font-size:22px; }}
.pill{{ display:inline-flex; align-items:center; gap:8px; padding:6px 12px; border-radius:999px; border:1px solid var(--border); font-size:12px; font-weight:600; }}
.pill.pass{{ background:rgba(34,197,94,0.15); color:var(--green); }}
.pill.fail{{ background:rgba(239,68,68,0.15); color:var(--red); }}
.pill.info{{ background:rgba(59,130,246,0.10); }}
.kpi-row{{ display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:12px; margin-bottom:20px; }}
.kpi{{ border:1px solid var(--border); background:rgba(18,26,43,0.72); border-radius:14px; padding:14px; }}
.kpi-label{{ font-size:11px; color:var(--muted); text-transform:uppercase; font-weight:600; }}
.kpi-val{{ font-size:1.5rem; margin-top:6px; font-weight:700; }}
.kpi-sub{{ font-size:11px; color:var(--muted); margin-top:4px; }}
.section{{ margin-bottom:20px; }}
.card{{ border:1px solid var(--border); background:rgba(18,26,43,0.72); border-radius:14px; padding:16px; }}
h2{{ margin:0 0 12px; font-size:13px; color:var(--muted); font-weight:600; text-transform:uppercase; }}
table{{ width:100%; border-collapse:collapse; }}
th{{ text-align:left; font-size:11px; color:var(--muted); text-transform:uppercase; padding:10px 8px; border-bottom:2px solid var(--border); }}
td{{ border-top:1px solid var(--border); padding:10px 8px; font-size:13px; }}
.grid2{{ display:grid; grid-template-columns:1fr 1fr; gap:14px; }}
@media(max-width:900px){{ .grid2{{ grid-template-columns:1fr; }} }}
.meter{{ margin-bottom:10px; }}
.meter-label{{ font-size:12px; color:var(--muted); margin-bottom:6px; display:flex; justify-content:space-between; }}
.meter-bar{{ height:12px; border-radius:999px; border:1px solid var(--border); background:rgba(0,0,0,0.25); overflow:hidden; }}
.meter-fill{{ display:block; height:100%; border-radius:999px; }}
.meter-fill.blue{{ background:linear-gradient(90deg,rgba(59,130,246,0.3),rgba(59,130,246,0.9)); }}
.meter-fill.green{{ background:linear-gradient(90deg,rgba(34,197,94,0.3),rgba(34,197,94,0.9)); }}
.meter-fill.amber{{ background:linear-gradient(90deg,rgba(245,158,11,0.3),rgba(245,158,11,0.9)); }}
pre{{ margin:0; padding:12px; border-radius:12px; border:1px solid var(--border); background:rgba(0,0,0,0.25); overflow:auto; max-height:520px; font-size:12px; color:#dbe7ff; }}
.footer{{ margin-top:32px; padding-top:16px; border-top:1px solid var(--border); font-size:11px; color:var(--muted); text-align:center; }}
</style></head><body><div class="wrap">
<div class="header"><div><div class="pill info" style="margin-bottom:8px"><span style="color:var(--accent)">PerfMix Studio</span><span>Performance Report</span></div><h1>Run Summary</h1><p style="margin:4px 0 0;color:var(--muted);font-size:13px">Run ID: <code>{run_id}</code></p></div><div class="pill {status_class}">{status_label} (exit {exit_code})</div></div>
<div class="kpi-row">
<div class="kpi"><div class="kpi-label">Total Requests</div><div class="kpi-val">{total_reqs}</div><div class="kpi-sub">{rps_val} req/s</div></div>
<div class="kpi"><div class="kpi-label">Avg Response</div><div class="kpi-val">{avg_val} ms</div><div class="kpi-sub">min {min_val} / max {max_val}</div></div>
<div class="kpi"><div class="kpi-label">P95 Latency</div><div class="kpi-val">{p95_val} ms</div><div class="kpi-sub">p50 {p50_val} / p99 {p99_val}</div></div>
<div class="kpi"><div class="kpi-label">Error Rate</div><div class="kpi-val">{err_pct}</div><div class="kpi-sub">{err_cnt} failed</div></div>
<div class="kpi"><div class="kpi-label">Throughput</div><div class="kpi-val">{rps_val} rps</div><div class="kpi-sub">{iter_val} iters</div></div>
<div class="kpi"><div class="kpi-label">VUs</div><div class="kpi-val">{vus_v}</div><div class="kpi-sub">max {vus_m}</div></div>
</div>
<div class="section"><div class="card"><h2>Health Gauges</h2>
<div class="meter"><div class="meter-label"><span>Latency</span><span>{latency_score:.0}%</span></div><div class="meter-bar"><span class="meter-fill blue" style="width:{latency_score:.0}%"></span></div></div>
<div class="meter"><div class="meter-label"><span>Reliability</span><span>{reliability_score:.0}%</span></div><div class="meter-bar"><span class="meter-fill green" style="width:{reliability_score:.0}%"></span></div></div>
<div class="meter"><div class="meter-label"><span>Throughput</span><span>{throughput_score:.0}%</span></div><div class="meter-bar"><span class="meter-fill amber" style="width:{throughput_score:.0}%"></span></div></div>
</div></div>
<div class="section grid2"><div class="card"><h2>Response Time Distribution</h2><table><thead><tr><th>Percentile</th><th>Latency (ms)</th></tr></thead><tbody><tr><td>Min</td><td>{min_val}</td></tr><tr><td>p50</td><td>{p50_val}</td></tr><tr><td>p90</td><td>{p90_val}</td></tr><tr><td>p95</td><td>{p95_val}</td></tr><tr><td>p99</td><td>{p99_val}</td></tr><tr><td>Max</td><td>{max_val}</td></tr><tr><td>Avg</td><td>{avg_val}</td></tr></tbody></table></div>
<div class="card"><h2>Request Phases (avg ms)</h2><table><thead><tr><th>Phase</th><th>ms</th></tr></thead><tbody><tr><td>Blocked</td><td>{blocked_val}</td></tr><tr><td>Connecting</td><td>{connecting_val}</td></tr><tr><td>TLS</td><td>{tls_val}</td></tr><tr><td>Sending</td><td>{sending_val}</td></tr><tr><td>Waiting</td><td>{waiting_val}</td></tr><tr><td>Receiving</td><td>{receiving_val}</td></tr></tbody></table></div></div>
<div class="section grid2"><div class="card"><h2>Data Transfer</h2><table><thead><tr><th>Metric</th><th>Value</th></tr></thead><tbody><tr><td>Received</td><td>{data_recv_val}</td></tr><tr><td>Sent</td><td>{data_sent_val}</td></tr><tr><td>Iter dur (avg)</td><td>{iter_dur_val} ms</td></tr></tbody></table></div>
<div class="card"><h2>Run Info</h2><table><thead><tr><th>Field</th><th>Value</th></tr></thead><tbody><tr><td>Run ID</td><td style="font-family:monospace">{run_id}</td></tr><tr><td>Exit Code</td><td>{exit_code}</td></tr><tr><td>Status</td><td><span class="pill {status_class}">{status_label}</span></td></tr></tbody></table></div></div>
<div class="section"><div class="card"><h2>Raw JSON</h2><details><summary style="cursor:pointer;color:var(--muted)">Expand</summary><pre>{raw}</pre></details></div></div>
<div class="footer">Generated by PerfMix Studio</div>
</div></body></html>"#,
    run_id = run_id,
    exit_code = exit_code,
    status_class = status_class,
    status_label = status_label,
    total_reqs = fi(reqs),
    avg_val = fm(avg_ms),
    min_val = fm(min_ms),
    max_val = fm(max_ms),
    p50_val = fm(p50_ms),
    p90_val = fm(p90_ms),
    p95_val = fm(p95_ms),
    p99_val = fm(p99_ms),
    err_pct = fp(err_rate),
    err_cnt = fi(err_count),
    rps_val = fm(rps),
    iter_val = fi(iterations),
    iter_dur_val = fm(iter_dur),
    vus_v = fi(vus_val),
    vus_m = fi(vus_max),
    blocked_val = fm(blocked),
    connecting_val = fm(connecting),
    tls_val = fm(tls_hs),
    sending_val = fm(sending),
    waiting_val = fm(waiting),
    receiving_val = fm(receiving),
    data_recv_val = fb(data_recv),
    data_sent_val = fb(data_sent),
    latency_score = latency_score,
    reliability_score = reliability_score,
    throughput_score = throughput_score,
    raw = serde_json::to_string_pretty(summary).unwrap_or_else(|_| "{}".to_string()),
  )
}

#[derive(Debug, Deserialize)]
struct AuthLoginInput {
  username: String,
  password: String,
}

#[derive(Debug, Serialize)]
struct AuthLoginResult {
  ok: bool,
  username: String,
}

#[tauri::command]
fn auth_login(app: tauri::AppHandle, input: AuthLoginInput) -> Result<AuthLoginResult, String> {
  let username = input.username.trim().to_string();
  if username.is_empty() {
    return Err("Username is required.".to_string());
  }
  if input.password.trim().is_empty() {
    return Err("Password is required.".to_string());
  }

  let conn = db::open_conn(&app)?;
  db::verify_user(&conn, &username, input.password.trim())?;
  Ok(AuthLoginResult {
    ok: true,
    username,
  })
}

#[tauri::command]
fn app_data_get(app: tauri::AppHandle, username: String) -> Result<Option<String>, String> {
  let email = username.trim().to_string();
  if email.is_empty() {
    return Err("Username is required.".to_string());
  }
  let conn = db::open_conn(&app)?;
  db::load_app_state(&conn, &email)
}

#[tauri::command]
fn app_data_save(app: tauri::AppHandle, username: String, payload_json: String) -> Result<(), String> {
  let email = username.trim().to_string();
  if email.is_empty() {
    return Err("Username is required.".to_string());
  }
  // Validate JSON early to avoid persisting garbage.
  let _: serde_json::Value =
    serde_json::from_str(&payload_json).map_err(|e| format!("payload_json is not valid JSON: {e}"))?;
  let conn = db::open_conn(&app)?;
  db::save_app_state(&conn, &email, &payload_json)
}

#[tauri::command]
fn read_run_report_html(run_id: String) -> Result<String, String> {
  let runs = RUNS.lock().map_err(|_| "Failed to lock run store".to_string())?;
  let record = runs
    .get(&run_id)
    .ok_or_else(|| "Run not found".to_string())?;

  if let Some(html) = &record.report_html {
    return Ok(html.clone());
  }

  if let Some(path) = &record.report_html_path {
    return fs::read_to_string(path).map_err(|e| format!("Failed to read report html: {e}"));
  }

  Err("Report not available yet.".to_string())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct HttpExecuteInput {
  method: String,
  url: String,
  #[serde(default)]
  headers: HashMap<String, String>,
  #[serde(default)]
  body: Option<String>,
  #[serde(default, rename = "cookieSessionId")]
  cookie_session_id: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct HttpExecuteOutput {
  ok: bool,
  status: u16,
  status_text: String,
  response_headers: Vec<(String, String)>,
  body: String,
  #[serde(skip_serializing_if = "Option::is_none")]
  error: Option<String>,
}

/** Strip browser-recording headers that trigger CORS/WAF issues for Keycloak login or EUUM token POST. */
fn strip_recorded_browser_headers(url: &str, headers: &mut HeaderMap) {
  let u = url.to_ascii_lowercase();
  let strip = u.contains("login-actions/authenticate")
    || (u.contains("/euum/") && u.contains("/authorize/v1/token"));
  if !strip {
    return;
  }
  const REMOVE: &[&str] = &[
    "origin",
    "referer",
    "sec-fetch-mode",
    "sec-fetch-site",
    "sec-fetch-dest",
    "sec-fetch-user",
    "sec-ch-ua",
    "sec-ch-ua-mobile",
    "sec-ch-ua-platform",
    "priority",
    "postman-token",
  ];
  for name in REMOVE {
    if let Ok(hn) = HeaderName::from_str(name) {
      headers.remove(hn);
    }
  }
}

#[tauri::command]
fn http_cookie_session_drop(session_id: String) -> Result<(), String> {
  let key = session_id.trim();
  if key.is_empty() {
    return Ok(());
  }
  HTTP_SESSION_CLIENTS
    .lock()
    .expect("cookie session mutex")
    .remove(key);
  Ok(())
}

#[tauri::command]
fn http_execute(input: HttpExecuteInput) -> Result<HttpExecuteOutput, String> {
  let url = input.url.trim();
  if url.is_empty() {
    return Err("URL is required.".to_string());
  }

  let method = reqwest::Method::from_bytes(input.method.trim().as_bytes())
    .map_err(|_| format!("Unsupported HTTP method: {}", input.method.trim()))?;

  let url_lower = url.to_ascii_lowercase();
  let keycloak_authenticate = url_lower.contains("login-actions/authenticate");
  let use_session = input
    .cookie_session_id
    .as_deref()
    .map(|s| !s.trim().is_empty())
    .unwrap_or(false);

  let mut header_map = HeaderMap::new();
  for (k, v) in input.headers {
    let name = k.trim();
    if name.is_empty() {
      continue;
    }
    if let (Ok(hn), Ok(hv)) = (HeaderName::from_str(name), HeaderValue::from_str(&v)) {
      let _ = header_map.append(hn, hv);
    }
  }
  strip_recorded_browser_headers(url, &mut header_map);

  let session_pair: Option<Arc<SessionHttpClients>> = if use_session {
    let sid = input.cookie_session_id.as_deref().unwrap().trim();
    Some(session_http_clients(sid))
  } else {
    None
  };

  let client: &reqwest::blocking::Client = if let Some(pair) = session_pair.as_ref() {
    if keycloak_authenticate {
      &pair.no_redirect
    } else {
      &pair.follow
    }
  } else if keycloak_authenticate {
    &HTTP_CLIENT_NO_REDIRECT
  } else {
    &HTTP_CLIENT_FOLLOW
  };

  let rb = client.request(method.clone(), url).headers(header_map);

  let has_body = matches!(
    method,
    reqwest::Method::POST | reqwest::Method::PUT | reqwest::Method::PATCH
  );

  let resp_result = if has_body {
    rb.body(input.body.unwrap_or_default()).send()
  } else {
    rb.send()
  };

  let resp = match resp_result {
    Ok(r) => r,
    Err(e) => {
      return Ok(HttpExecuteOutput {
        ok: false,
        status: 0,
        status_text: String::new(),
        response_headers: vec![],
        body: String::new(),
        error: Some(format!("{e}")),
      });
    }
  };

  let status = resp.status();
  let status_u16 = status.as_u16();
  let status_text = status
    .canonical_reason()
    .unwrap_or("")
    .to_string();
  let ok = status.is_success()
    || (keycloak_authenticate && status.is_redirection());

  let mut response_headers = Vec::new();
  for (k, v) in resp.headers().iter() {
    response_headers.push((k.to_string(), v.to_str().unwrap_or("").to_string()));
  }

  let body = resp.text().unwrap_or_default();

  Ok(HttpExecuteOutput {
    ok,
    status: status_u16,
    status_text,
    response_headers,
    body,
    error: None,
  })
}

#[tauri::command]
fn bootstrap_runtime(app: tauri::AppHandle) -> Result<BootstrapResult, String> {
  let runtime = ensure_runtime(&app)?;
  Ok(BootstrapResult {
    k6_path: runtime.to_string_lossy().to_string(),
  })
}

#[tauri::command]
fn runtime_diagnostics(app: tauri::AppHandle) -> Result<RuntimeDiagnostics, String> {
  let mut issues = Vec::new();
  let runtime = ensure_runtime(&app)?;
  let mode = detect_mode(&runtime);
  let app_data = app
    .path()
    .app_data_dir()
    .map_err(|e| format!("Failed to resolve app data dir: {e}"))?;
  let runs_dir = app_data.join("runs");
  if let Err(e) = fs::create_dir_all(&runs_dir) {
    issues.push(format!("Failed to ensure runs dir: {e}"));
  }
  let test_file = runs_dir.join(".healthcheck");
  let runs_dir_writable = fs::write(&test_file, "ok")
    .and_then(|_| fs::remove_file(&test_file))
    .is_ok();
  if !runs_dir_writable {
    issues.push("Runs directory is not writable.".to_string());
  }

  let mut version_cmd = Command::new(&runtime);
  hide_console(&mut version_cmd);
  let version_output = version_cmd.arg("version").output();
  let (can_execute, k6_version) = match version_output {
    Ok(out) if out.status.success() => (
      true,
      String::from_utf8_lossy(&out.stdout).trim().to_string(),
    ),
    Ok(out) => {
      issues.push(format!(
        "k6 version command failed with code {:?}.",
        out.status.code()
      ));
      (
        false,
        String::from_utf8_lossy(&out.stderr).trim().to_string(),
      )
    }
    Err(e) => {
      issues.push(format!("Failed to execute k6 binary: {e}"));
      (false, "unknown".to_string())
    }
  };

  Ok(RuntimeDiagnostics {
    tauri_available: true,
    k6_path: runtime.to_string_lossy().to_string(),
    mode,
    can_execute,
    runs_dir_writable,
    k6_version,
    issues,
  })
}

#[tauri::command]
fn run_k6(
  app: tauri::AppHandle,
  script: String,
  username: String,
  quiet: bool,
  run_label: Option<String>,
) -> Result<String, String> {
  let runtime = ensure_runtime(&app)?;
  let app_data = app
    .path()
    .app_data_dir()
    .map_err(|e| format!("Failed to resolve app data dir: {e}"))?;
  let runs_dir = app_data.join("runs");
  fs::create_dir_all(&runs_dir).map_err(|e| format!("Failed to create runs dir: {e}"))?;

  let run_id = build_run_id(run_label);
  let script_path = runs_dir.join(format!("{run_id}.k6.js"));
  fs::write(&script_path, script).map_err(|e| format!("Failed to write run script: {e}"))?;
  let summary_path = runs_dir.join(format!("{run_id}.summary.json"));
  let report_path = runs_dir.join(format!("{run_id}.report.html"));
  let db_file = db::db_path(&app)?;

  {
    let log_start = Instant::now();
    let mut runs = RUNS.lock().map_err(|_| "Failed to lock run store".to_string())?;
    runs.insert(
      run_id.clone(),
      RunRecord {
        status: RunState::Queued,
        logs: vec![format!("[{:>7.1}s] Queued...", 0.0)],
        log_start,
        summary_path: None,
        report_html_path: None,
        report_html: None,
        pid: None,
      },
    );
  }

  let run_id_for_thread = run_id.clone();
  let summary_path_for_thread = summary_path.clone();
  let report_path_for_thread = report_path.clone();
  let user_email_for_thread = username.trim().to_string();
  let quiet_for_thread = quiet;
  std::thread::spawn(move || {
    set_status(&run_id_for_thread, RunState::Running);
    append_log(
      &run_id_for_thread,
      if quiet_for_thread {
        "Starting k6 (quiet mode: live console output is hidden)...".to_string()
      } else {
        "Starting k6 (verbose mode: streaming console output)...".to_string()
      },
    );

    let mut cmd = Command::new(runtime);
    hide_console(&mut cmd);
    cmd.arg("run")
      .arg("--summary-export")
      .arg(&summary_path_for_thread)
      .arg(&script_path);

    if quiet_for_thread {
      cmd.stdout(Stdio::null()).stderr(Stdio::piped());
    } else {
      cmd.stdout(Stdio::piped()).stderr(Stdio::piped());
    }

    let mut child = match cmd.spawn()
    {
      Ok(c) => c,
      Err(err) => {
        set_status(&run_id_for_thread, RunState::Failed);
        append_log(
          &run_id_for_thread,
          format!("Failed to start k6 process: {err}"),
        );
        return;
      }
    };

    if let Ok(mut runs) = RUNS.lock() {
      if let Some(record) = runs.get_mut(&run_id_for_thread) {
        record.pid = Some(child.id());
      }
    }

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();

    let run_stdout = run_id_for_thread.clone();
    let out_handle = if quiet_for_thread {
      None
    } else {
      stdout.map(|stream| {
        std::thread::spawn(move || {
          for line in BufReader::new(stream).lines().map_while(Result::ok) {
            append_log(&run_stdout, line);
          }
        })
      })
    };

    let run_stderr = run_id_for_thread.clone();
    let err_capture: std::sync::Arc<std::sync::Mutex<Vec<String>>> =
      std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
    let err_capture_for_thread = std::sync::Arc::clone(&err_capture);
    let err_handle = stderr.map(|stream| {
      std::thread::spawn(move || {
        for line in BufReader::new(stream).lines().map_while(Result::ok) {
          if quiet_for_thread {
            if let Ok(mut buf) = err_capture_for_thread.lock() {
              buf.push(line);
              const MAX_ERR_LINES: usize = 200;
              if buf.len() > MAX_ERR_LINES {
                let overflow = buf.len() - MAX_ERR_LINES;
                buf.drain(0..overflow);
              }
            }
          } else {
            append_log(&run_stderr, line);
          }
        }
      })
    });

    let exit_code = child.wait().ok().and_then(|s| s.code()).unwrap_or(1);
    if let Some(handle) = out_handle {
      let _ = handle.join();
    }
    if let Some(handle) = err_handle {
      let _ = handle.join();
    }

    if quiet_for_thread && exit_code != 0 {
      if let Ok(buf) = err_capture.lock() {
        if !buf.is_empty() {
          append_log(&run_id_for_thread, "---- k6 stderr (last lines) ----".to_string());
          for line in buf.iter().take(80) {
            append_log(&run_id_for_thread, line.clone());
          }
        }
      }
    }

    append_log(
      &run_id_for_thread,
      format!(
        "k6 finished with exit code {exit_code}. Summary export: {}",
        summary_path_for_thread.display()
      ),
    );

    let summary_text = fs::read_to_string(&summary_path_for_thread).unwrap_or_else(|_| "{}".to_string());
    let summary_value: serde_json::Value =
      serde_json::from_str(&summary_text).unwrap_or_else(|_| serde_json::json!({}));

    let html = build_html_report(&summary_value, &run_id_for_thread, exit_code);
    let html_result = fs::write(&report_path_for_thread, &html);
    if let Err(err) = html_result {
      append_log(
        &run_id_for_thread,
        format!("Failed to write HTML report: {err}"),
      );
    } else {
      append_log(
        &run_id_for_thread,
        format!("HTML report written to {}", report_path_for_thread.display()),
      );
    }

    set_run_artifacts(
      &run_id_for_thread,
      summary_path_for_thread.clone(),
      report_path_for_thread.clone(),
      html.clone(),
    );

    let final_status = if exit_code == 0 {
      RunState::Passed
    } else {
      RunState::Failed
    };
    set_status(&run_id_for_thread, final_status.clone());
    if exit_code == 0 {
      append_log(&run_id_for_thread, "Run completed (process exit code 0).".to_string());
    } else {
      append_log(
        &run_id_for_thread,
        format!("Run failed (process exit code {exit_code})."),
      );
    }

    // Persist a lightweight index row for future reporting/history screens.
    if let Ok(conn) = db::open_conn_at(&db_file) {
      let status_label = match final_status {
        RunState::Passed => "passed",
        RunState::Failed => "failed",
        RunState::Running => "running",
        RunState::Queued => "queued",
      };
      let _ = db::insert_run(
        &conn,
        &run_id_for_thread,
        &user_email_for_thread,
        status_label,
        Some(summary_path_for_thread.to_string_lossy().as_ref()),
        Some(report_path_for_thread.to_string_lossy().as_ref()),
      );
    }
  });

  Ok(run_id)
}

#[tauri::command]
fn stop_k6(run_id: String) -> Result<(), String> {
  let pid = {
    let runs = RUNS.lock().map_err(|_| "Failed to lock run store".to_string())?;
    let record = runs.get(&run_id).ok_or_else(|| "Run not found".to_string())?;
    record.pid
  };

  if let Some(pid) = pid {
    #[cfg(target_os = "windows")]
    {
      let mut tk = Command::new("taskkill");
      hide_console(&mut tk);
      let _ = tk
        .args(["/PID", &pid.to_string(), "/T", "/F"])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
    }
    #[cfg(not(target_os = "windows"))]
    {
      let _ = Command::new("kill")
        .args(["-TERM", &pid.to_string()])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
    }
    set_status(&run_id, RunState::Failed);
    append_log(&run_id, "Run stopped by user.".to_string());
    Ok(())
  } else {
    Err("No active process found for this run.".to_string())
  }
}

#[tauri::command]
fn get_k6_status(run_id: String) -> Result<RunStatusPayload, String> {
  let runs = RUNS.lock().map_err(|_| "Failed to lock run store".to_string())?;
  let record = runs
    .get(&run_id)
    .ok_or_else(|| "Run not found".to_string())?
    .clone();

  let mut summary_json: Option<String> = None;
  if matches!(record.status, RunState::Passed | RunState::Failed) {
    if let Some(path) = &record.summary_path {
      if path.exists() {
        if let Ok(meta) = fs::metadata(path) {
          if meta.len() <= 2_000_000 {
            summary_json = fs::read_to_string(path).ok();
          }
        }
      }
    }
  }

  Ok(RunStatusPayload {
    run_id,
    status: record.status,
    logs: record.logs,
    summary_path: record
      .summary_path
      .as_ref()
      .map(|p| p.to_string_lossy().to_string()),
    report_html_path: record
      .report_html_path
      .as_ref()
      .map(|p| p.to_string_lossy().to_string()),
    summary_json,
  })
}

/// Opens a native save dialog and writes UTF-8 HTML. Returns `Ok(None)` if the user cancels.
#[tauri::command]
async fn export_html_file(app: tauri::AppHandle, default_file_name: String, html: String) -> Result<Option<String>, String> {
  let mut name = default_file_name.trim().to_string();
  if name.is_empty() {
    name = "report.html".to_string();
  }
  let lower = name.to_ascii_lowercase();
  if !lower.ends_with(".html") && !lower.ends_with(".htm") {
    name.push_str(".html");
  }

  let chosen = tokio::task::spawn_blocking({
    let app = app.clone();
    let name = name.clone();
    move || {
      app
        .dialog()
        .file()
        .set_title("Save HTML report")
        .set_file_name(&name)
        .add_filter("HTML", &["html", "htm"])
        .blocking_save_file()
    }
  })
  .await
  .map_err(|e| format!("Save dialog task failed: {e}"))?;

  let Some(file_path) = chosen else {
    return Ok(None);
  };

  let path = file_path
    .as_path()
    .ok_or_else(|| "Could not resolve a filesystem path for the selected file.".to_string())?;
  fs::write(path, html.as_bytes()).map_err(|e| format!("Failed to write HTML file: {e}"))?;
  Ok(Some(path.to_string_lossy().to_string()))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
    .setup(|app| {
      let _ = db::open_conn(&app.handle());
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      bootstrap_runtime,
      runtime_diagnostics,
      auth_login,
      app_data_get,
      app_data_save,
      read_run_report_html,
      http_execute,
      http_cookie_session_drop,
      run_k6,
      stop_k6,
      get_k6_status,
      export_html_file
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
