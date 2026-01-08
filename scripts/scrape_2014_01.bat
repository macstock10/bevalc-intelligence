@echo off
echo Starting scraper for 2014-01 (January)
cd /d "%~dp0"
python cola_worker.py --name 2014_01 --months 2014-01
pause
