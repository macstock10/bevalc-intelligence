@echo off
echo Starting scraper for 2014-04 (April)
cd /d "%~dp0"
python cola_worker.py --name 2014_04 --months 2014-04
pause
