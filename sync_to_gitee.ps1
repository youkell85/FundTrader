# FundTrader 自动同步到 Gitee 脚本
# 用法: .\sync_to_gitee.ps1
# 功能: 自动提交更改并推送到 Gitee 远程仓库

$ErrorActionPreference = "Stop"
$projectDir = Split-Path -Parent $MyInvocation.MyCommand.Path

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  FundTrader 自动同步到 Gitee" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

Set-Location $projectDir

# 检查 git 状态
$status = git status --porcelain
if (-not $status) {
    Write-Host "[INFO] 工作区干净，无需提交" -ForegroundColor Green
} else {
    Write-Host "[INFO] 检测到更改，正在提交..." -ForegroundColor Yellow
    git add -A
    $commitMsg = "auto: 自动同步 $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
    git commit -m $commitMsg
    Write-Host "[OK] 提交完成" -ForegroundColor Green
}

# 推送到远程
Write-Host "[INFO] 推送到 Gitee..." -ForegroundColor Yellow
git push gitee master
if ($LASTEXITCODE -eq 0) {
    Write-Host "[OK] 推送成功" -ForegroundColor Green
} else {
    Write-Host "[ERR] 推送失败" -ForegroundColor Red
    Write-Host "[INFO] 尝试推送到 origin (GitHub)..." -ForegroundColor Yellow
    git push origin master
    if ($LASTEXITCODE -eq 0) {
        Write-Host "[OK] GitHub 推送成功" -ForegroundColor Green
    } else {
        Write-Host "[ERR] 推送全部失败" -ForegroundColor Red
        exit 1
    }
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  同步完成" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
