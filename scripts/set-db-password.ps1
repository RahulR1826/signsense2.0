# Prompts for the PostgreSQL password and writes it into backend/.env.
# The password is typed hidden and never printed.
$envFile = Join-Path $PSScriptRoot "..\backend\.env"
if (-not (Test-Path $envFile)) {
    Copy-Item (Join-Path $PSScriptRoot "..\backend\.env.example") $envFile
}

$secure = Read-Host "PostgreSQL password for user 'postgres'" -AsSecureString
$plain = [System.Net.NetworkCredential]::new("", $secure).Password
if ([string]::IsNullOrEmpty($plain)) { Write-Host "No password entered; nothing changed."; exit 1 }

# URL-encode so characters like @ : / # don't break the connection string.
$encoded = [uri]::EscapeDataString($plain)
$url = "DATABASE_URL=postgresql+asyncpg://postgres:$encoded@localhost:5432/signsense"

$lines = Get-Content $envFile | ForEach-Object { if ($_ -match '^DATABASE_URL=') { $url } else { $_ } }
Set-Content -Path $envFile -Value $lines -Encoding utf8
Write-Host "Saved to backend/.env"
