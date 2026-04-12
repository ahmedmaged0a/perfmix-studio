Place bundled k6 binaries in this folder for installer builds.

Required file names:
- k6-windows-amd64.exe
- k6-darwin-amd64
- k6-darwin-arm64
- k6-linux-amd64

At runtime, the app copies the matching binary into the user app-data runtime folder
and executes it for in-app performance test runs.
