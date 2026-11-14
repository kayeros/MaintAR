@echo off
rem Запуск сервиса анализа фото MaintAR на порту 8000 (доступен в локальной сети).
cd /d "%~dp0"
if not exist .venv\Scripts\python.exe (
  echo Создаю окружение и ставлю зависимости...
  python -m venv .venv || goto :error
  .venv\Scripts\python -m pip install --disable-pip-version-check -q -r requirements.txt || goto :error
)
.venv\Scripts\python -m uvicorn app:app --host 0.0.0.0 --port 8000
goto :eof
:error
echo Не удалось подготовить окружение. Нужен Python 3.10 или новее.
pause
