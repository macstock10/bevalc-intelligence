@echo off
echo Starting scraper for 2014-10 (October)
cd /d "%~dp0"
python cola_worker.py --name 2014_10 --months 2014-10
pause
