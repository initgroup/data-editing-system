param(
    [ValidateSet("Git", "Working")]
    [string]$Mode = "Git",

    [string]$BackupRoot = "D:\work\backup"
)

$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backupDir = Join-Path $BackupRoot "data-editing-system-$($Mode.ToLower())-$stamp"

New-Item -ItemType Directory -Force -Path $backupDir | Out-Null

if ($Mode -eq "Git") {
    $zipPath = Join-Path $env:TEMP "data-editing-system-$stamp.zip"
    if (Test-Path $zipPath) {
        Remove-Item -LiteralPath $zipPath -Force
    }

    Push-Location $repoRoot
    try {
        git archive --format=zip --output="$zipPath" HEAD
        Expand-Archive -LiteralPath $zipPath -DestinationPath $backupDir -Force
    }
    finally {
        Pop-Location
        if (Test-Path $zipPath) {
            Remove-Item -LiteralPath $zipPath -Force
        }
    }
}
else {
    $excludeDirs = @(
        ".git",
        "venv",
        ".venv",
        "node_modules",
        ".node_modules",
        "secreats",
        ".secreats",
        "etc\secrets",
        "instantclient",
        ".instantclient",
        "__pycache__"
    )
    $excludeFiles = @(
        ".env",
        "*.pyc"
    )

    $args = @(
        $repoRoot,
        $backupDir,
        "/MIR",
        "/R:2",
        "/W:1",
        "/XD"
    ) + $excludeDirs + @("/XF") + $excludeFiles

    robocopy @args
    $exitCode = $LASTEXITCODE
    if ($exitCode -gt 7) {
        throw "robocopy failed with exit code $exitCode"
    }
}

Write-Host ""
Write-Host "Backup completed." -ForegroundColor Green
Write-Host "Mode: $Mode"
Write-Host "Path: $backupDir"
