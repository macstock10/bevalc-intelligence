@echo off
echo Starting scraper for 2014-06 (June)
cd /d "%~dp0"
python cola_worker.py --name 2014_06 --months 2014-06
pause
