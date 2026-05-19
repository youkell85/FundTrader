# FundTrader 自动同步 - 创建 Windows 计划任务
# 用法: 以管理员身份运行 .\setup_auto_sync.ps1
# 功能: 创建每 30 分钟自动同步到 Gitee 的计划任务

$ErrorActionPreference = "Stop"
$projectDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$syncScript = Join-Path $projectDir "sync_to_gitee.ps1"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  配置 FundTrader 自动同步任务" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# 检查是否以管理员身份运行
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Host "[WARN] 请以管理员身份运行此脚本" -ForegroundColor Yellow
    Write-Host "       或手动创建计划任务" -ForegroundColor Yellow
    exit 1
}

# 删除旧任务（如果存在）
$taskName = "FundTrader-SyncToGitee"
$existingTask = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($existingTask) {
    Write-Host "[INFO] 删除旧任务: $taskName" -ForegroundColor Yellow
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
}

# 创建触发器：每 30 分钟执行一次
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 30) -RepetitionDuration ([TimeSpan]::MaxValue)

# 创建动作
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-ExecutionPolicy Bypass -File `"$syncScript`"" -WorkingDirectory $projectDir

# 创建设置
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 5)

# 注册任务
Register-ScheduledTask -TaskName $taskName -Trigger $trigger -Action $action -Settings $settings -Description "FundTrader 项目自动同步到 Gitee，每 30 分钟执行一次" -User $env:USERNAME

Write-Host ""
Write-Host "[OK] 计划任务创建成功: $taskName" -ForegroundColor Green
Write-Host "     执行频率: 每 30 分钟" -ForegroundColor Green
Write-Host "     同步脚本: $syncScript" -ForegroundColor Green
Write-Host ""
Write-Host "查看任务状态: Get-ScheduledTask -TaskName '$taskName'" -ForegroundColor Cyan
Write-Host "手动触发: Start-ScheduledTask -TaskName '$taskName'" -ForegroundColor Cyan
Write-Host "删除任务: Unregister-ScheduledTask -TaskName '$taskName' -Confirm:`$false" -ForegroundColor Cyan
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  配置完成" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
