@echo off
echo Starting scraper for 2014-02 (February)
cd /d "%~dp0"
python cola_worker.py --name 2014_02 --months 2014-02
pause
