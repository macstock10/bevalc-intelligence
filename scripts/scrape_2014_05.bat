@echo off
echo Starting scraper for 2014-05 (May)
cd /d "%~dp0"
python cola_worker.py --name 2014_05 --months 2014-05
pause
