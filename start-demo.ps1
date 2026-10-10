$ErrorActionPreference = "Stop"
$projectDir = $PSScriptRoot
if (-not (Get-Command go -ErrorAction SilentlyContinue)) { throw "Install Go 1.26+ and a GCC-compatible C compiler before running the SQLite demo." }
if (-not (Test-Path "$projectDir/frontend/dist/index.html")) {
    Push-Location "$projectDir/frontend"
    try { npm ci; if ($LASTEXITCODE -ne 0) { throw "npm ci failed" }; npm run build; if ($LASTEXITCODE -ne 0) { throw "Frontend build failed" } } finally { Pop-Location }
}
New-Item -ItemType Directory -Path "$projectDir/data" -Force | Out-Null
Write-Host "Open http://127.0.0.1:8080 — founder@schach.demo / SchachDemo!2026"
Write-Host "All sample data is fictional. Press Ctrl+C to stop."
Push-Location "$projectDir/backend"
try { go run ./cmd/server --demo --addr 127.0.0.1:8080 --db "$projectDir/data/schach-demo.db" --frontend "$projectDir/frontend/dist" } finally { Pop-Location }
