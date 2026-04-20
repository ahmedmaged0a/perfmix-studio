# Workspace reference

This document describes the **PerfMix Studio** workspace as implemented in this repository. It is accurate for the current codebase; if something is missing here, check the UI or source.

---

## Projects, collections, requests

- **Projects** hold multiple **collections**.  
- Each **collection** has a name and a list of **requests**.  
- Each **request** has: name, HTTP method, URL, query parameters (key/value table), headers, body text, optional **assertions**, optional **test cases** (for k6 thresholds and scenarios), optional **docs**, and optional **pre-request** / **post-request** scripts.  

Use the left sidebar to switch collections and requests; use the top bar to switch **projects** and **environment** (dev, testing, production, etc.).

---

## Variables and templates

- **Shared** variables, **per-project** variables, **per-collection** variables, and **per-environment** key/value maps are edited in the **right** panel.  
- Reference them in URL, headers, or body with `{{variableName}}` syntax.  
- Resolution order for HTTP Send and script templating matches the k6 generator: environment overrides collection overrides project overrides shared (see workspace template resolution in code).  

---

## HTTP: Send and Send all

- **Send** runs the active request through the in-app pipeline: template resolution → optional **pre-request** script → HTTP → optional **post-request** script → **assertions**.  
- **Send all** (play control on a collection) runs each request in order with shared variable maps where applicable.  
- Output appears in the bottom **Request output** tab; script `console` output appears under **Logs** with HTTP client lines prepended when present.  

---

## k6: generate and run

- **Export** from the top bar: choose **Active request** or **Whole collection**, then **Download .js** for the generated k6 script.  
- **Run** executes the generated script via the bundled/runtime k6 integration (see runtime diagnostics in the app).  
- **Reporting** tab stores run history per request where implemented.  

Pre/post **JavaScript is not emitted into k6** in the current design; those scripts apply to **in-app Send** only.

---

## cURL and collection import/export

- **Export cURL** (top bar): same scope toggle as k6 export; downloads a `.sh`-style text file of `curl` commands.  
- **Import cURL** (sidebar): paste a command; optional “ignore generic headers”; appends a new request to the chosen collection.  
- **Import JSON** / **Export JSON** (sidebar): **PerfMix** collection format (`perfMixCollectionExport` version `1`) for round-trip with new IDs on import.  

---

## Pre-request and post-request scripts

- Tabs on the request builder open **Monaco** editors with JavaScript highlighting and typed **`pm`** completions (phase-specific: `pm.response` is typed only in post-request).  
- Supported **`pm`** surface (align with runtime): `pm.request` (url, method, body, headers add/upsert/remove), `pm.collectionVariables`, `pm.environment`, `pm.variables`, `pm.sendRequest`, `pm.test`, and in post only `pm.response` (`code`, `headers.get`, `text()`, `json()`).  
- Scripts run in a restricted `new Function` context with injected `pm` and `console`.  

---

## Assertions

- Configured per request; evaluated on Send and reflected in k6 **checks** when you export and run load tests.  

---

## Optional backend and AI

- `VITE_API_BASE_URL` — remote persistence / API client base URL.  
- `VITE_AI_API_URL` — optional OpenAI-compatible URL for the assistant panel.  

See root [README.md](../README.md#environment-variables-optional).
