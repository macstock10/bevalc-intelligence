@echo off
echo Starting scraper for 2014-08 (August)
cd /d "%~dp0"
python cola_worker.py --name 2014_08 --months 2014-08
pause
