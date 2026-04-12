# Getting started with PerfMix Studio

This guide helps you run the app for the first time, avoid common setup issues, and keep your local folder from growing into multi-gigabyte **disk** usage (which is normal for development, but unrelated to **GitHub** repository size).

---

## First-time flow

1. **Install dependencies** (from repo root): `npm install`  
2. **Start the UI**: `npm run dev` — open the URL Vite prints.  
3. In the app: select or create a **project** → **collection** → **request** (method, URL, headers/body as needed).  
4. Click **Send** to run an HTTP request and inspect the bottom **Request output** panel.  
5. Configure **variables** on the right (environment, collection, project) and use `{{variableName}}` in URL, headers, or body.  
6. Use **Run** in the top bar to generate and execute **k6** (requires k6 and a healthy runtime as shown in the bottom panel).  

---

## Freeing disk space before push

Your project **folder** can be **several GB** because of:

| Path | What it is | Safe to delete? |
|------|------------|-----------------|
| `node_modules/` | npm packages | Yes — run `npm install` again |
| `dist/` | Vite production output | Yes — run `npm run build` again |
| `src-tauri/target/` | Rust compile cache and bundles | Yes — recreated on `tauri dev` / `tauri build` |

These paths are listed in `.gitignore` / `src-tauri/.gitignore` and should **not** appear in `git status` as tracked files.

### Windows (PowerShell), from repo root

```powershell
Remove-Item -Recurse -Force node_modules, dist -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force src-tauri\target -ErrorAction SilentlyContinue
```

Then reinstall when you want to develop again:

```powershell
npm install
```

### Verify Git is ignoring the big folders

From repo root (requires Git on your PATH):

```bash
git check-ignore -v node_modules
git check-ignore -v dist
git check-ignore -v src-tauri/target
git status
```

You should see `node_modules` and `dist` ignored from the root ignore file, and `src-tauri/target` ignored via `src-tauri/.gitignore`. `git status` should **not** list thousands of files under those directories.

### If `target/` was ever committed by mistake

If `git ls-files | findstr target` (Windows) or `git ls-files | grep target` shows paths under `src-tauri/target/`, history rewrite tools (e.g. `git filter-repo`) are needed; ask for help or open an issue—normal `git rm` is not enough once pushed.

---

## Troubleshooting

### `npm run tauri:dev` fails (Rust / linker)

Install [Rust](https://rustup.rs/) and on Windows the **Visual Studio Build Tools** with the **Desktop development with C++** workload. Restart the terminal, then `npm run tauri:dev` again.

### k6 not found / runtime unhealthy

Install [k6](https://k6.io/docs/get-started/installation/) and ensure `k6` is on your `PATH`. The app’s bottom panel shows runtime diagnostics; follow any hints shown there.

### Port already in use (`npm run dev`)

Stop the other process or run Vite on another port, e.g. `npx vite --port 5174`.

### Browser vs desktop HTTP

In pure browser mode, `fetch` may hit **CORS** limits. The **Tauri** build uses native HTTP for fuller behavior—use `npm run tauri:dev` when testing real APIs.

### Assistant “offline”

Set `VITE_AI_API_URL` in `.env.local` to an OpenAI-compatible endpoint if you want live AI answers; otherwise the assistant uses built-in offline snippets.

---

## Next steps

- Feature overview: [WORKSPACE.md](WORKSPACE.md)  
- Main readme: [../README.md](../README.md)
