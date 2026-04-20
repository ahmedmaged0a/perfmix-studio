import { defineConfig } from 'vite'

/**
 * Exclude Tauri Rust output from Vite's watcher. Watching `target/` while Cargo compiles
 * races on Windows (ENOENT/lstat UNKNOWN) and can contribute to broken rustc metadata.
 */
export default defineConfig({
  server: {
    watch: {
      ignored: ['**/src-tauri/target/**', '**/src-tauri/gen/**'],
    },
  },
  build: {
    /** Monaco ships multi‑MB workers (esp. ts.worker); large bundles are normal for this app. */
    chunkSizeWarningLimit: 7000,
  },
})
