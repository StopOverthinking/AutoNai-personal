[CmdletBinding()]
param([switch]$IncludeLiveSite)

$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
$version = (Get-Content -Raw -LiteralPath (Join-Path $taskRoot 'manifest.json') | ConvertFrom-Json).version
$artifactDir = Join-Path $taskRoot 'output/playwright'
$browserSession = 'autonai-personal-regression'
$checks = @('history-resilience', 'current-ui', 'status-recovery', 'completion', 'notification-popup')
if ($IncludeLiveSite) { $checks += 'live-ui' }
$tempScript = Join-Path $artifactDir 'browser-check-current.js'
$failures = @()
New-Item -ItemType Directory -Path $artifactDir -Force | Out-Null
Push-Location $taskRoot
try {
    & npx.cmd --package @playwright/cli playwright-cli "-s=$browserSession" open about:blank --raw
    if ($LASTEXITCODE -ne 0) { throw 'Could not start the verification browser.' }
    foreach ($name in $checks) {
        $source = Get-Content -Raw -LiteralPath (Join-Path $PSScriptRoot "browser/$name-verify.js")
        $source = $source.Replace('__PROJECT_ROOT__', $taskRoot.Replace('\', '/')).Replace('__VERSION__', $version)
        [System.IO.File]::WriteAllText($tempScript, $source, [System.Text.UTF8Encoding]::new($false))
        $result = & npx.cmd --package @playwright/cli playwright-cli "-s=$browserSession" run-code --filename $tempScript --raw 2>&1
        $failed = $LASTEXITCODE -ne 0 -or ($result -join "`n") -match '(?m)^### Error'
        $result | Set-Content -LiteralPath (Join-Path $artifactDir "$name-verify-v$version.log") -Encoding utf8
        Write-Output "$name : $($result -join [Environment]::NewLine)"
        if ($failed) { $failures += $name }
    }
    if ($failures.Count) { throw "Browser checks failed: $($failures -join ', ')" }
}
finally {
    & npx.cmd --package @playwright/cli playwright-cli "-s=$browserSession" close --raw
    if (Test-Path -LiteralPath $tempScript) { Remove-Item -LiteralPath $tempScript }
    Pop-Location
}
