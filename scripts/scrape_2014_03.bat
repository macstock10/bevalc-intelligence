@echo off
echo Starting scraper for 2014-03 (March)
cd /d "%~dp0"
python cola_worker.py --name 2014_03 --months 2014-03
pause
