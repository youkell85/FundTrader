@echo off
REM FundTrader Windows 本地快速部署脚本
REM 用法: scripts\deploy-local.bat [--backend-only|--frontend-only|--full|--quick]
REM
REM 流程: 本地 commit+push → Gitee → 服务器 git pull → 重启服务
REM 服务器: 新加坡 (43.160.226.62, SSH端口 22222)

setlocal enabledelayedexpansion

set SG_HOST=43.160.226.62
set SSH_PORT=22222
set GIT_REMOTE=gitee
set BRANCH=master
set PROJECT_DIR=/opt/fundtrader
set BACKEND_DIR=/opt/fundtrader/backend
set FRONTEND_DIR=/opt/fundtrader/frontend

set DEPLOY_BACKEND=1
set DEPLOY_FRONTEND=1
set DEPLOY_NGINX=0
set DEPLOY_ENV=0
set SKIP_COMMIT=0

REM 参数解析
:parse_args
if "%~1"=="" goto end_parse
if "%~1"=="--backend-only" (
    set DEPLOY_FRONTEND=0
    set DEPLOY_NGINX=0
    shift
    goto parse_args
)
if "%~1"=="--frontend-only" (
    set DEPLOY_BACKEND=0
    set DEPLOY_NGINX=0
    shift
    goto parse_args
)
if "%~1"=="--full" (
    set DEPLOY_NGINX=1
    set DEPLOY_ENV=1
    shift
    goto parse_args
)
if "%~1"=="--env" (
    set DEPLOY_ENV=1
    shift
    goto parse_args
)
if "%~1"=="--skip-commit" (
    set SKIP_COMMIT=1
    shift
    goto parse_args
)
if "%~1"=="--quick" (
    set DEPLOY_NGINX=0
    set DEPLOY_ENV=0
    shift
    goto parse_args
)
echo 未知参数: %~1
shift
goto parse_args
:end_parse

echo ========================================
echo   FundTrader 自动同步部署
echo   服务器: 新加坡 (43.160.226.62)
echo ========================================

REM 1. 本地 git commit & push
if %SKIP_COMMIT%==0 (
    echo.
    echo [1/6] 提交代码到 Git...
    git add -A
    git diff --cached --quiet >nul 2>&1
    if !errorlevel! equ 0 (
        echo   没有新的变更需要提交
    ) else (
        for /f "tokens=*" %%i in ('powershell -command "Get-Date -Format 'yyyy-MM-dd HH:mm'"') do set COMMIT_MSG=deploy: %%i
        git commit -m "!COMMIT_MSG!"
        echo   已提交: !COMMIT_MSG!
    )
    git push %GIT_REMOTE% %BRANCH%
    echo   代码已推送到 %GIT_REMOTE%/%BRANCH%
) else (
    echo.
    echo [1/6] 跳过本地提交 (--skip-commit)
)

REM 2. 服务器拉取最新代码
echo.
echo [2/6] 服务器拉取最新代码...
ssh -p %SSH_PORT% root@%SG_HOST% "cd %PROJECT_DIR% && git pull %GIT_REMOTE% %BRANCH%"
echo   代码已更新

REM 3. 同步 .env 文件
if %DEPLOY_ENV%==1 (
    echo.
    echo [3/6] 同步环境配置...
    scp -P %SSH_PORT% backend\.env root@%SG_HOST%:%BACKEND_DIR%/.env
    echo   .env 已同步
) else (
    echo.
    echo [3/6] 跳过环境配置同步
)

REM 4. 部署后端
if %DEPLOY_BACKEND%==1 (
    echo.
    echo [4/6] 部署后端 (FastAPI)...
    ssh -p %SSH_PORT% root@%SG_HOST% "cd %BACKEND_DIR% && python3 -m venv .venv && .venv/bin/pip install -U pip -q && .venv/bin/pip install -r requirements.txt -q && systemctl restart fundtrader"
    echo   后端已重启
) else (
    echo.
    echo [4/6] 跳过后端部署
)

REM 5. 部署前端
if %DEPLOY_FRONTEND%==1 (
    echo.
    echo [5/6] 部署前端 (Hono BFF)...
    ssh -p %SSH_PORT% root@%SG_HOST% "cd %FRONTEND_DIR% && npm ci && npm run build && systemctl restart fundtrader-frontend"
    echo   前端已重启
) else (
    echo.
    echo [5/6] 跳过前端部署
)

REM 6. 更新 Nginx
if %DEPLOY_NGINX%==1 (
    echo.
    echo [6/6] 更新 Nginx 配置...
    scp -P %SSH_PORT% deploy\nginx_fund.conf root@%SG_HOST%:/etc/nginx/conf.d/fundtrader.conf
    scp -P %SSH_PORT% deploy\fundtrader.service root@%SG_HOST%:/etc/systemd/system/fundtrader.service
    scp -P %SSH_PORT% deploy\fundtrader-frontend.service root@%SG_HOST%:/etc/systemd/system/fundtrader-frontend.service
    ssh -p %SSH_PORT% root@%SG_HOST% "systemctl daemon-reload && nginx -t && systemctl reload nginx && systemctl restart fundtrader fundtrader-frontend"
    echo   Nginx & Systemd 配置已更新
) else (
    echo.
    echo [6/6] 跳过 Nginx 配置更新
)

REM 验证
echo.
echo ========================================
echo   验证服务
echo ========================================
timeout /t 3 /nobreak >nul

echo   检查后端...
for /f "tokens=*" %%i in ('ssh -p %SSH_PORT% root@%SG_HOST% "curl -s -o /dev/null -w '%%{http_code}' http://localhost:8766/health"') do set BACKEND_OK=%%i
echo   后端 (8766):     %BACKEND_OK%

for /f "tokens=*" %%i in ('ssh -p %SSH_PORT% root@%SG_HOST% "curl -s -o /dev/null -w '%%{http_code}' http://localhost:3000/fund/"') do set FRONTEND_OK=%%i
echo   前端 (3000):     %FRONTEND_OK%

for /f "tokens=*" %%i in ('ssh -p %SSH_PORT% root@%SG_HOST% "curl -s -o /dev/null -w '%%{http_code}' http://localhost/fund/"') do set NGINX_OK=%%i
echo   Nginx 代理 (80): %NGINX_OK%

if "%NGINX_OK%"=="200" (
    echo.
    echo ========================================
    echo   部署成功!
    echo   访问: http://%SG_HOST%/fund/
    echo   API:  http://%SG_HOST%/fund/api/docs
    echo ========================================
) else (
    echo.
    echo WARNING: 部署可能存在问题，请检查服务状态
)

endlocal