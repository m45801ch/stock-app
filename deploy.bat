@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul
echo ============================================================
echo         股市 APP - GitHub Pages 一鍵部署工具
echo ============================================================
echo.

:: 檢查 Git 是否安裝
git --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [錯誤] 系統未偵測到 Git，請先安裝 Git 再執行此腳本！
    pause
    exit /b
)

:: 檢查是否有設定遠端倉庫
git remote get-url origin >nul 2>&1
if %errorlevel% neq 0 (
    echo [提示] 尚未設定 GitHub 遠端倉庫。
    echo 請先在 GitHub (https://github.com/new) 建立一個新的 Public 倉庫（例如命名為 stock-app）。
    echo 注意：請「不要」勾選 Add a README, Add .gitignore 或 Choose a license。
    echo 建立完成後，在下方貼入你的倉庫 URL：
    echo.
    set /p repo_url="請輸入倉庫 URL (例如 https://github.com/m45801ch/stock-app.git): "
    if "!repo_url!"=="" (
        echo [錯誤] 未輸入 URL，部署終止。
        pause
        exit /b
    )
    git remote add origin !repo_url!
    echo [成功] 已設定遠端倉庫：!repo_url!
)

echo.
echo [1/3] 正在加入新變更與提交...
git add .
git commit -m "deploy to github pages"

echo.
echo [2/3] 正在推送到 GitHub...
git branch -M main
git push -u origin main --force

if %errorlevel% neq 0 (
    echo.
    echo [錯誤] 推送失敗！請確認：
    echo 1. 你的 GitHub 帳號是否有該倉庫的寫入權限。
    echo 2. 倉庫 URL 是否正確。
    echo 3. 是否有進行 GitHub 登入驗證 (Credential Manager)。
    pause
    exit /b
)

echo.
echo [3/3] 部署成功！
echo.
echo 請到你的 GitHub 倉庫網頁完成 Pages 設定：
echo 1. 進入 Settings -^> Pages (在左側選單中)
echo 2. 在 Build and deployment -^> Source 選擇 "Deploy from a branch"
echo 3. Branch 選擇 "main"，目錄選擇 "/ (root)"，然後點擊 "Save" 按鈕。
echo 4. 等待 1~2 分鐘，你的自選股 APP 就會上線！
echo.
pause
