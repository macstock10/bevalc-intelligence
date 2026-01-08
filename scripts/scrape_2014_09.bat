@echo off
echo Starting scraper for 2014-09 (September)
cd /d "%~dp0"
python cola_worker.py --name 2014_09 --months 2014-09
pause
