@echo off
echo Starting scraper for 2014-07 (July)
cd /d "%~dp0"
python cola_worker.py --name 2014_07 --months 2014-07
pause
