# PerfMix Studio

**PerfMix Studio** is a desktop-first workspace for designing API requests, organizing them into collections and projects, running **in-app HTTP** checks, generating **k6** load-test scripts, and reviewing run history—with optional **Tauri** packaging for a native Windows experience.

**Suggested GitHub About description:**  
*PerfMix Studio — API collections, k6 load tests, variables, cURL import/export, Postman-style scripts (Monaco), and reporting.*

---

## Features (high level)

- Multi-**project** / **collection** / **request** tree with methods, URL, query params, headers, and body  
- **Environments** and **variables** (`{{name}}`) resolved for HTTP Send and k6 generation  
- **Send** single requests or **send all** in a collection; assertions and response viewer  
- **Export / import** k6 scripts, **cURL**, and **PerfMix JSON** collections  
- **Pre-request** and **post-request** JavaScript (Monaco, Postman-style **`pm`** API) for in-app Send only  
- **Reporting** and k6 run history; **ECharts** where used in the app  

More detail: [docs/WORKSPACE.md](docs/WORKSPACE.md) · First run & troubleshooting: [docs/GETTING_STARTED.md](docs/GETTING_STARTED.md)

---

## Tech stack

| Area | Choice |
|------|--------|
| UI | React 19, TypeScript, Vite 8 |
| State | Zustand |
| Editor | Monaco Editor |
| Charts | ECharts |
| Desktop shell | Tauri 2 (Rust) |
| Load testing | k6 (see `src-tauri/resources/k6/README.md` for bundled binary layout) |

---

## Prerequisites

- **Node.js** 20+ (LTS recommended) and **npm**  
- **Rust** toolchain + **Microsoft C++ Build Tools** (Windows) if you run `npm run tauri:dev` or `npm run tauri:build`  
- **k6** on your PATH for full in-app HTTP execution in desktop mode; the UI can fall back to browser `fetch` with CORS limits (see in-app diagnostics)  

---

## Clone and install

```bash
git clone https://github.com/ahmedmaged0a/perfmix-studio.git
cd perfmix-studio
npm install
```

---

## Run locally

### Web UI (fastest)

```bash
npm run dev
```

Open the URL printed in the terminal (default Vite port).

### Production web build (smoke test)

```bash
npm run build
npm run preview
```

### Desktop (Tauri)

```bash
npm run tauri:dev
```

### Desktop installer / bundle

```bash
npm run tauri:build
```

Artifacts appear under `src-tauri/target/release/bundle/` (do **not** commit `target/`; it is gitignored).

---

## Environment variables (optional)

| Variable | Purpose |
|----------|---------|
| `VITE_API_BASE_URL` | Backend for remote app data (default `http://localhost:3000`) — see `src/api/client.ts` |
| `VITE_AI_API_URL` | OpenAI-compatible chat endpoint for the in-app assistant — see `src/workspace/components/WorkspaceAssistantPanel.tsx` |

Create a `.env.local` (gitignored) in the project root, e.g.:

```env
VITE_API_BASE_URL=http://localhost:3000
# VITE_AI_API_URL=https://api.openai.com/v1/chat/completions
```

---

## Repository size vs. folder size on disk

`node_modules/`, `dist/`, and `src-tauri/target/` can grow to **many gigabytes** locally. They are **ignored by Git** and must **not** be pushed. After `npm install` / Tauri builds, clones stay small on GitHub; developers regenerate these folders locally.

How to free space before zipping or auditing: [docs/GETTING_STARTED.md#freeing-disk-space-before-push](docs/GETTING_STARTED.md#freeing-disk-space-before-push)

---

## Push this repo to GitHub

If this directory is already a Git repository:

```bash
git remote add origin https://github.com/ahmedmaged0a/perfmix-studio.git
# If origin exists: git remote set-url origin https://github.com/ahmedmaged0a/perfmix-studio.git

git branch -M main
git add .
git commit -m "Describe your changes"
git push -u origin main
```

If the remote already has commits (e.g. a license file), run `git pull origin main --rebase` before the first push, or follow GitHub’s **“push an existing repository”** wizard.

---

## License

Specify a license in the repository (e.g. MIT) and add a `LICENSE` file when you are ready.

---

## Contributing

Issues and pull requests are welcome. Keep changes focused; run `npm run build` before submitting.
