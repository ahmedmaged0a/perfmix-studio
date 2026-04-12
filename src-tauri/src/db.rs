use rusqlite::{params, Connection, OptionalExtension};
use std::fs;
use std::path::PathBuf;
use tauri::Manager;

pub fn db_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
  let dir = app
    .path()
    .app_data_dir()
    .map_err(|e| format!("Failed to resolve app data dir: {e}"))?;
  fs::create_dir_all(&dir).map_err(|e| format!("Failed to create app data dir: {e}"))?;
  Ok(dir.join("perfmix.sqlite3"))
}

fn migrate(conn: &Connection) -> Result<(), String> {
  conn
    .execute_batch(
      r#"
      PRAGMA foreign_keys = ON;

      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT NOT NULL UNIQUE,
        password TEXT NOT NULL,
        created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
      );

      CREATE TABLE IF NOT EXISTS app_state (
        user_email TEXT PRIMARY KEY,
        payload TEXT NOT NULL,
        updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
      );

      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY,
        user_email TEXT NOT NULL,
        status TEXT NOT NULL,
        summary_path TEXT,
        html_path TEXT,
        created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
      );
    "#,
    )
    .map_err(|e| format!("Failed to migrate sqlite: {e}"))?;

  // Add username column for MVP auth (keep email for backwards compatibility)
  let _ = conn.execute("ALTER TABLE users ADD COLUMN username TEXT", []);

  // Seed default user for local MVP: username test / password test
  let test_exists: i64 = conn
    .query_row(
      "SELECT COUNT(1) FROM users WHERE IFNULL(username, email) = 'test'",
      [],
      |row| row.get(0),
    )
    .unwrap_or(0);
  if test_exists == 0 {
    conn
      .execute(
        "INSERT INTO users (email, username, password) VALUES (?1, ?2, ?3)",
        params!["test", "test", "test"],
      )
      .map_err(|e| format!("Failed to seed default user: {e}"))?;
  }

  Ok(())
}

pub fn open_conn_at(path: &PathBuf) -> Result<Connection, String> {
  if let Some(parent) = path.parent() {
    fs::create_dir_all(parent).map_err(|e| format!("Failed to create db parent dir: {e}"))?;
  }
  let conn = Connection::open(path).map_err(|e| format!("Failed to open sqlite: {e}"))?;
  migrate(&conn)?;
  Ok(conn)
}

pub fn open_conn(app: &tauri::AppHandle) -> Result<Connection, String> {
  let path = db_path(app)?;
  open_conn_at(&path)
}

pub fn verify_user(conn: &Connection, username: &str, password: &str) -> Result<(), String> {
  let stored: Option<String> = conn
    .query_row(
      "SELECT password FROM users WHERE IFNULL(username, email) = ?1",
      params![username],
      |row| row.get(0),
    )
    .optional()
    .map_err(|e| format!("Failed to query user: {e}"))?;

  let Some(stored) = stored else {
    return Err("Invalid credentials".to_string());
  };

  if stored != password {
    return Err("Invalid credentials".to_string());
  }

  Ok(())
}

pub fn load_app_state(conn: &Connection, user_email: &str) -> Result<Option<String>, String> {
  let payload: Option<String> = conn
    .query_row(
      "SELECT payload FROM app_state WHERE user_email = ?1",
      params![user_email],
      |row| row.get(0),
    )
    .optional()
    .map_err(|e| format!("Failed to load app state: {e}"))?;
  Ok(payload)
}

pub fn save_app_state(conn: &Connection, user_email: &str, payload: &str) -> Result<(), String> {
  conn
    .execute(
      r#"
      INSERT INTO app_state (user_email, payload, updated_at)
      VALUES (?1, ?2, strftime('%s','now'))
      ON CONFLICT(user_email) DO UPDATE SET
        payload = excluded.payload,
        updated_at = excluded.updated_at
    "#,
      params![user_email, payload],
    )
    .map_err(|e| format!("Failed to save app state: {e}"))?;
  Ok(())
}

pub fn insert_run(
  conn: &Connection,
  run_id: &str,
  user_email: &str,
  status: &str,
  summary_path: Option<&str>,
  html_path: Option<&str>,
) -> Result<(), String> {
  conn
    .execute(
      r#"
      INSERT INTO runs (id, user_email, status, summary_path, html_path, created_at)
      VALUES (?1, ?2, ?3, ?4, ?5, strftime('%s','now'))
    "#,
      params![run_id, user_email, status, summary_path, html_path],
    )
    .map_err(|e| format!("Failed to insert run record: {e}"))?;
  Ok(())
}
