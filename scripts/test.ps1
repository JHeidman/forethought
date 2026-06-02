# ForeThought Test Runner
# Usage: .\scripts\test.ps1 [--url https://forethought-7s4a.vercel.app] [--password yourpassword]

param(
    [string]$url = "http://localhost:3000",
    [string]$password = ""
)

$env:TEST_URL = $url
$env:TEST_EMAIL = "jheidman@northteq.com"
$env:TEST_PASSWORD = $password

Write-Host "`n=== ForeThought Test Suite ===" -ForegroundColor Cyan
Write-Host "Target: $url`n" -ForegroundColor Gray

# API Tests
Write-Host "--- API Tests ---" -ForegroundColor Yellow
node scripts/db.js profiles 2>$null | Out-Null  # warm up DB connection
node tests/api.test.js
$apiExit = $LASTEXITCODE

# Browser Smoke Tests
Write-Host "`n--- Browser Smoke Tests ---" -ForegroundColor Yellow
npx playwright test tests/smoke.spec.ts --reporter=line
$browserExit = $LASTEXITCODE

# Summary
Write-Host "`n=== Results ===" -ForegroundColor Cyan
if ($apiExit -eq 0 -and $browserExit -eq 0) {
    Write-Host "All tests passed ✓" -ForegroundColor Green
} else {
    Write-Host "Some tests failed ✗" -ForegroundColor Red
    exit 1
}
