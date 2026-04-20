Place bundled k6 binaries in this folder for installer builds.

From the repository root you can download the official Grafana k6 release into this folder:

```bash
npm run k6:bundle-download
```

Use `npm run k6:bundle-download -- --all` if you want every platform binary (larger download). Override the tag with `K6_VERSION=v0.55.0`.

Required file names:
- k6-windows-amd64.exe
- k6-darwin-amd64
- k6-darwin-arm64
- k6-linux-amd64

At runtime, the app copies the matching binary into the user app-data runtime folder
and executes it for in-app performance test runs.
