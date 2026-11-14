@echo off
rem Сервис ИИ MaintAR (YOLO) на порту 8000. Веса лежат в папке weights,
rem другой путь задаётся переменными BASIC_WEIGHTS и EXPANDED_WEIGHTS.
cd /d "%~dp0"
if not exist .venv\Scripts\python.exe (
  python -m venv .venv || goto :error
  .venv\Scripts\python -m pip install --disable-pip-version-check -r requirements.txt || goto :error
)
.venv\Scripts\python -m uvicorn app:app --host 0.0.0.0 --port 8000
goto :eof
:error
echo Не удалось подготовить окружение. Нужен Python 3.10 или новее.
pause
