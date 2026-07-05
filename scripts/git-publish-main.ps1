<#
.SYNOPSIS
Stages all changes, creates an auto-numbered daily commit, rebases from origin/main, and pushes.

.DESCRIPTION
Commit message format:
INIT Data Editing System - yyyy.MM.dd-N

The sequence number is calculated as the largest existing commit number for today plus one.

.EXAMPLE
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\git-publish-main.ps1
#>

param(
    [string]$Remote = "origin",
    [string]$Branch = "main",
    [string]$MessagePrefix = "INIT Data Editing System"
)

$ErrorActionPreference = "Stop"

$utf8NoBom = [System.Text.UTF8Encoding]::new($false)
[Console]::InputEncoding = $utf8NoBom
[Console]::OutputEncoding = $utf8NoBom
$OutputEncoding = $utf8NoBom
chcp.com 65001 | Out-Null

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Resolve-Path (Join-Path $scriptDir "..")
Set-Location $repoRoot

function Invoke-Git {
    param([Parameter(ValueFromRemainingArguments = $true)][string[]]$GitArgs)

    Write-Host ""
    Write-Host "git $($GitArgs -join ' ')" -ForegroundColor Cyan
    & git @GitArgs
    if ($LASTEXITCODE -ne 0) {
        throw "Git command failed: git $($GitArgs -join ' ')"
    }
}

function Get-NextCommitMessage {
    param(
        [string]$Prefix,
        [string]$DateText
    )

    $escapedPrefix = [regex]::Escape($Prefix)
    $escapedDate = [regex]::Escape($DateText)
    $pattern = "^$escapedPrefix - $escapedDate-(\d+)$"
    $subjects = & git log --all --format=%s --grep="$Prefix - $DateText-"
    if ($LASTEXITCODE -ne 0) {
        throw "Unable to read git log for commit sequence."
    }

    $maxSeq = 0
    foreach ($subject in $subjects) {
        $match = [regex]::Match($subject, $pattern)
        if ($match.Success) {
            $seq = [int]$match.Groups[1].Value
            if ($seq -gt $maxSeq) {
                $maxSeq = $seq
            }
        }
    }

    return "$Prefix - $DateText-$($maxSeq + 1)"
}

Invoke-Git status --short
Invoke-Git fetch $Remote $Branch

if (Test-Path "requirements.txt") {
    Invoke-Git add requirements.txt
}

Invoke-Git add -A

$staged = & git diff --cached --name-only
if ($LASTEXITCODE -ne 0) {
    throw "Unable to inspect staged changes."
}

if (-not $staged) {
    Write-Host ""
    Write-Host "No staged changes. Nothing to commit or push." -ForegroundColor Yellow
    exit 0
}

$dateText = Get-Date -Format "yyyy.MM.dd"
$commitMessage = Get-NextCommitMessage -Prefix $MessagePrefix -DateText $dateText

Write-Host ""
Write-Host "Commit message: $commitMessage" -ForegroundColor Green
Invoke-Git commit -m $commitMessage
Invoke-Git pull --rebase $Remote $Branch
Invoke-Git push $Remote $Branch

Write-Host ""
Write-Host "Publish complete." -ForegroundColor Green
