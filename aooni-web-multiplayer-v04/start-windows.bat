@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js가 설치되어 있지 않습니다.
  echo Node.js LTS를 설치한 뒤 다시 실행하세요.
  pause
  exit /b 1
)
if not exist node_modules (
  echo 필요한 패키지를 설치합니다...
  call npm install
  if errorlevel 1 (
    echo npm install에 실패했습니다.
    pause
    exit /b 1
  )
)
echo 서버를 시작합니다: http://localhost:8080
call npm start
pause
