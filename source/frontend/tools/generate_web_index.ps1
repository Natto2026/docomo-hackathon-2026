param(
  [string]$EnvFile = (Join-Path $PSScriptRoot '..\.env'),
  [string]$TemplateFile = (Join-Path $PSScriptRoot '..\web\index.html.template'),
  [string]$OutputFile = (Join-Path $PSScriptRoot '..\web\index.html')
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath $EnvFile)) {
  throw "Environment file not found: $EnvFile. Copy .env.example to .env and set GOOGLE_MAPS_WEB_API_KEY."
}

$keyLine = Get-Content -LiteralPath $EnvFile | Where-Object { $_ -match '^\s*GOOGLE_MAPS_WEB_API_KEY\s*=' } | Select-Object -First 1
$key = if ($keyLine) { ($keyLine -replace '^\s*GOOGLE_MAPS_WEB_API_KEY\s*=\s*', '').Trim().Trim('"').Trim("'") } else { '' }

if ([string]::IsNullOrWhiteSpace($key) -or $key -eq 'YOUR_GOOGLE_MAPS_WEB_API_KEY') {
  throw 'GOOGLE_MAPS_WEB_API_KEY is missing or still uses the placeholder value.'
}

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$template = [IO.File]::ReadAllText((Resolve-Path -LiteralPath $TemplateFile), $utf8NoBom)
$output = $template.Replace('__GOOGLE_MAPS_WEB_API_KEY__', $key)
[IO.File]::WriteAllText($OutputFile, $output, $utf8NoBom)
Write-Host "Generated $OutputFile from $EnvFile"
