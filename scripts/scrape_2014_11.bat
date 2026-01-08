@echo off
echo Starting scraper for 2014-11 (November)
cd /d "%~dp0"
python cola_worker.py --name 2014_11 --months 2014-11
pause
