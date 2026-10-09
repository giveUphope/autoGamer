@echo off
rem S10 spike shim: forwards to dsh.cmd with safe quoting (msys positional quirk).
call "D:\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd" --profile headless --patch "D:\DEV\autoGamer\plugins\autogamer-device\spike\headless-spike.patch.yml" --json %*
