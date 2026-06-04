@echo off
chcp 65001 >nul
echo ============================================================
echo         股市 APP - GitHub Pages 一鍵部署工具
echo ============================================================
echo.

git init
git add .
git commit -m "deploy to github pages"

echo.
echo 請複製你在 GitHub 建立的倉庫網址 (以 .git 結尾)。
echo 例如: https://github.com/m45801ch/stock-app.git
echo.
set /p REPO_URL=請貼上你的倉庫網址並按 Enter: 

if "%REPO_URL%"=="" (
    echo 網址不能為空！
    pause
    exit
)

echo.
echo 正在設定遠端倉庫...
git remote remove origin >nul 2>&1
git remote add origin %REPO_URL%

echo 正在更名分支為 main...
git branch -M main

echo.
echo 正在上傳至 GitHub (這可能需要一點時間，若跳出登入視窗請進行驗證)...
git push -u origin main

echo.
echo ============================================================
echo 執行完畢！請檢查上方是否有錯誤訊息。
echo ============================================================
pause
