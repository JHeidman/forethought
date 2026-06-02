# ForeThought Test Runner
# Automatically starts/stops the dev server when testing locally.
#
# Usage:
#   .\scripts\test.ps1                          # run against localhost (auto-starts server)
#   .\scripts\test.ps1 -prod                    # run against live Vercel URL
#   .\scripts\test.ps1 -api                     # API tests only (faster)
#   .\scripts\test.ps1 -browser                 # browser smoke tests only

param(
    [switch]$prod,
    [switch]$api,
    [switch]$browser
)

# ── Config ────────────────────────────────────────────────────────────────────

$PROD_URL    = "https://forethought-7s4a.vercel.app"
$LOCAL_URL   = "http://localhost:3000"
$PROJECT_DIR = "C:\Users\jhber\dev\forethought"

# Load credentials and keys from .env.local
$envFile = Join-Path $PROJECT_DIR ".env.local"
$TEST_EMAIL    = "test@forethought.app"
$TEST_PASSWORD = ""
$ANTHROPIC_KEY = ""
$ELEVENLABS_KEY = ""
if (Test-Path $envFile) {
    Get-Content $envFile | ForEach-Object {
        if ($_ -match "^TEST_EMAIL=(.+)$")        { $TEST_EMAIL     = $Matches[1] }
        if ($_ -match "^TEST_PASSWORD=(.+)$")     { $TEST_PASSWORD  = $Matches[1] }
        if ($_ -match "^ANTHROPIC_API_KEY=(.+)$") { $ANTHROPIC_KEY  = $Matches[1] }
        if ($_ -match "^ELEVENLABS_API_KEY=(.+)$"){ $ELEVENLABS_KEY = $Matches[1] }
    }
}

# ── Setup ─────────────────────────────────────────────────────────────────────

$targetUrl    = if ($prod) { $PROD_URL } else { $LOCAL_URL }
$runApi       = -not $browser
$runBrowser   = -not $api
$startServer  = (-not $prod)
$serverJob    = $null

$env:TEST_URL      = $targetUrl
$env:TEST_EMAIL    = $TEST_EMAIL
$env:TEST_PASSWORD = $TEST_PASSWORD

Write-Host "`n=== ForeThought Test Suite ===" -ForegroundColor Cyan
Write-Host "Target: $targetUrl" -ForegroundColor Gray
if ($prod) { Write-Host "Mode:   Production`n" -ForegroundColor Gray }
else       { Write-Host "Mode:   Local (auto-managed server)`n" -ForegroundColor Gray }

# ── Start local dev server ────────────────────────────────────────────────────

if ($startServer) {
    # Check if already running
    $alreadyRunning = $false
    try {
        $null = Invoke-WebRequest -Uri "$LOCAL_URL/login" -TimeoutSec 2 -ErrorAction Stop
        $alreadyRunning = $true
        Write-Host "✓ Dev server already running on $LOCAL_URL" -ForegroundColor Green
    } catch {}

    if (-not $alreadyRunning) {
        Write-Host "▶ Starting dev server…" -ForegroundColor Yellow

        $serverJob = Start-Job -ScriptBlock {
            param($dir, $ak, $ek)
            Set-Location $dir
            $env:ANTHROPIC_API_KEY  = $ak
            $env:ELEVENLABS_API_KEY = $ek
            npm run dev 2>&1
        } -ArgumentList $PROJECT_DIR, $ANTHROPIC_KEY, $ELEVENLABS_KEY

        # Wait for server to be ready (up to 30 seconds)
        $ready = $false
        $attempts = 0
        Write-Host "  Waiting for server" -NoNewline -ForegroundColor Gray
        while (-not $ready -and $attempts -lt 30) {
            Start-Sleep -Seconds 1
            $attempts++
            Write-Host "." -NoNewline -ForegroundColor Gray
            try {
                $null = Invoke-WebRequest -Uri "$LOCAL_URL/login" -TimeoutSec 1 -ErrorAction Stop
                $ready = $true
            } catch {}
        }
        Write-Host ""

        if (-not $ready) {
            Write-Host "✗ Server failed to start in 30 seconds" -ForegroundColor Red
            if ($serverJob) { Stop-Job $serverJob; Remove-Job $serverJob }
            exit 1
        }
        Write-Host "✓ Dev server ready`n" -ForegroundColor Green
    }
}

# ── Run tests ─────────────────────────────────────────────────────────────────

$apiExit     = 0
$browserExit = 0

if ($runApi) {
    Write-Host "--- API Tests ---" -ForegroundColor Yellow
    Set-Location $PROJECT_DIR
    node tests/api.test.js
    $apiExit = $LASTEXITCODE
}

if ($runBrowser) {
    Write-Host "`n--- Browser Smoke Tests ---" -ForegroundColor Yellow
    Set-Location $PROJECT_DIR
    npx playwright test tests/smoke.spec.ts --reporter=line
    $browserExit = $LASTEXITCODE
}

# ── Stop server if we started it ──────────────────────────────────────────────

if ($serverJob) {
    Write-Host "`n▶ Stopping dev server…" -ForegroundColor Gray
    Stop-Job $serverJob
    Remove-Job $serverJob
    # Kill any leftover node processes on port 3000
    $proc = Get-NetTCPConnection -LocalPort 3000 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -First 1
    if ($proc) { Stop-Process -Id $proc -Force -ErrorAction SilentlyContinue }
    Write-Host "✓ Server stopped" -ForegroundColor Gray
}

# ── Summary ───────────────────────────────────────────────────────────────────

Write-Host "`n=== Results ===" -ForegroundColor Cyan
if ($apiExit -eq 0 -and $browserExit -eq 0) {
    Write-Host "All tests passed ✓" -ForegroundColor Green
} else {
    Write-Host "Some tests failed ✗" -ForegroundColor Red
    exit 1
}
