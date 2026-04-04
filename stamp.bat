@echo off
:: ─────────────────────────────────────────────────────
:: stamp.bat — injects a build hash into index.html
::
:: Usage (from the folder containing index.html):
::   stamp.bat
:: ─────────────────────────────────────────────────────

setlocal enabledelayedexpansion

set "FILE=%~dp0index.html"

if not exist "%FILE%" (
    echo ERROR: index.html not found in %~dp0
    exit /b 1
)

:: Use PowerShell under the hood for the MD5 — available on all modern Windows
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$file = '%FILE:\=\\%';" ^
  "$html = [System.IO.File]::ReadAllText($file, [System.Text.Encoding]::UTF8);" ^
  "$stripped = $html -replace 'v[0-9a-f]{8}(?=</span>)', 'vXXXXXXXX';" ^
  "$bytes = [System.Text.Encoding]::UTF8.GetBytes($stripped);" ^
  "$md5 = [System.Security.Cryptography.MD5]::Create();" ^
  "$hashBytes = $md5.ComputeHash($bytes);" ^
  "$hash = (($hashBytes | ForEach-Object { $_.ToString('x2') }) -join '').Substring(0,8);" ^
  "$updated = $stripped -replace 'vXXXXXXXX', \"v$hash\";" ^
  "$utf8NoBom = New-Object System.Text.UTF8Encoding $false;" ^
  "[System.IO.File]::WriteAllText($file, $updated, $utf8NoBom);" ^
  "Write-Host \"Stamped index.html with hash v$hash\""

endlocal
