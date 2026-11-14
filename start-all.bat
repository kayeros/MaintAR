@echo off
rem Запуск всей связки MaintAR на этом ПК: сервис ИИ (8000), бэкенд (5176), Expo (8081).
rem Бэкенд лежит в этом же репозитории: backend\MaintARBackend. Секреты — в appsettings.Local.json (образец appsettings.Local.example.json).
cd /d "%~dp0"
start "MaintAR AI" cmd /k "ai\service\run.bat"
start "MaintAR Backend" cmd /k "cd /d backend\MaintARBackend && set ASPNETCORE_ENVIRONMENT=Development && dotnet run --launch-profile http --urls http://0.0.0.0:5176"
start "MaintAR Expo" cmd /k "cd /d frontend && npx expo start --lan --clear"
echo Запущено три окна. В Expo Go откройте адрес exp://, который покажет окно Expo.
