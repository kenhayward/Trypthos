@echo off
setlocal enabledelayedexpansion

rem ==========================================================================
rem PushVersion.cmd - cut a desktop release by pushing a v<version> tag.
rem
rem The "Desktop release" workflow triggers on any pushed tag matching v*, then
rem builds and publishes the Windows installer and the macOS .dmg to GitHub
rem Releases. By convention the tag matches the app version in version.json.
rem
rem Usage:   PushVersion.cmd <version>|--current [--force]
rem   e.g.   PushVersion.cmd 0.98.0     push tag v0.98.0
rem          PushVersion.cmd v0.98.0    (a leading v is accepted and stripped)
rem          PushVersion.cmd --current  push the tag matching version.json
rem          PushVersion.cmd --current --force   skip the safety checks
rem
rem Before tagging it checks that HEAD is somewhere a release may be cut from:
rem on main, clean, level with origin/main, and green in CI. The release
rem workflow itself runs NO tests - it installs, builds, packages and publishes
rem - so a tag on a red commit would publish a broken app without complaint.
rem
rem Note: the tag message does not appear anywhere a user sees. The GitHub
rem Release body comes from the workflow, so do not put release notes here.
rem ==========================================================================

set "ARG=%~1"
set "FORCE="
if /i "%~2"=="--force" set "FORCE=1"
if /i "%~1"=="--force" (
  echo --force is a modifier, not a version. Usage: %~nx0 ^<version^>^|--current [--force]
  exit /b 1
)

if "%ARG%"=="" (
  echo Usage: %~nx0 ^<version^>^|--current [--force]
  echo   e.g. %~nx0 0.98.0        push tag v0.98.0
  echo        %~nx0 --current      push the tag matching version.json
  exit /b 1
)

rem Repo root is the parent of this script's folder (deploy\).
set "ROOT=%~dp0.."

rem Read the canonical app version from version.json (used by --current and the match check).
set "REPOVER="
for /f "usebackq delims=" %%v in (`powershell -NoProfile -Command "try { (ConvertFrom-Json (Get-Content -Raw '%ROOT%\version.json')).version } catch {}"`) do set "REPOVER=%%v"

if /i "%ARG%"=="--current" (
  if "!REPOVER!"=="" (
    echo Could not read the version from "%ROOT%\version.json".
    exit /b 1
  )
  set "VER=!REPOVER!"
) else (
  rem Accept "v0.98.0" as well as "0.98.0".
  if /i "!ARG:~0,1!"=="v" set "ARG=!ARG:~1!"
  set "VER=!ARG!"
  if not "!REPOVER!"=="" if /i not "!REPOVER!"=="!ARG!" (
    echo WARNING: version.json is !REPOVER! but you asked to tag !ARG!.
    echo The desktop-release convention is that the tag matches the app version.
    set /p "CONT=Continue anyway? [y/N] "
    if /i not "!CONT!"=="y" (
      echo Aborted.
      exit /b 1
    )
  )
)
set "TAG=v!VER!"

if defined FORCE (
  echo.
  echo --force: SKIPPING the branch, clean, up-to-date and CI checks.
  echo A tag pushed from here may build code you have not seen, or code that does not pass CI.
  goto :confirm
)

rem --- Is this a commit a release may be cut from? ---------------------------
rem Each of these is a note in the header comment made enforceable. The one that
rem actually bites: merge a PR on GitHub, run this without pulling, and the tag
rem lands on a stale HEAD - so the release builds the previous commit while the
rem tag claims the new version. Nothing downstream notices, because the version
rem in the built app comes from this same stale checkout.

echo.
echo Checking this is a commit a release may be cut from...

set "BRANCH="
for /f "usebackq delims=" %%b in (`git -C "%ROOT%" rev-parse --abbrev-ref HEAD 2^>nul`) do set "BRANCH=%%b"
if /i not "!BRANCH!"=="main" (
  echo   FAILED: on branch "!BRANCH!", not main.
  goto :notreleasable
)
echo   on main

set "DIRTY="
for /f "usebackq delims=" %%s in (`git -C "%ROOT%" status --porcelain 2^>nul`) do set "DIRTY=1"
if defined DIRTY (
  echo   FAILED: the working tree has uncommitted changes.
  echo           Whatever is uncommitted will NOT be in the release.
  goto :notreleasable
)
echo   working tree clean

git -C "%ROOT%" fetch --quiet origin
if errorlevel 1 (
  echo   FAILED: could not fetch from origin.
  goto :notreleasable
)

set "LOCAL="
set "REMOTE="
for /f "usebackq delims=" %%h in (`git -C "%ROOT%" rev-parse HEAD 2^>nul`) do set "LOCAL=%%h"
for /f "usebackq delims=" %%h in (`git -C "%ROOT%" rev-parse origin/main 2^>nul`) do set "REMOTE=%%h"
if not "!LOCAL!"=="!REMOTE!" (
  echo   FAILED: HEAD is not the same commit as origin/main.
  echo           local  !LOCAL!
  echo           origin !REMOTE!
  echo           Pull first, or you will tag a commit that is not what was merged.
  goto :notreleasable
)
echo   level with origin/main

rem --- Is CI green for this exact commit? ------------------------------------
rem By SHA, not by branch: "the latest run on main" can belong to a different
rem commit entirely, which would let a red commit through on a green neighbour.

where gh >nul 2>&1
if errorlevel 1 (
  echo   SKIPPED: the GitHub CLI is not installed, so CI status cannot be checked.
  goto :ciunknown
)

set "SLUG="
for /f "usebackq delims=" %%r in (`gh repo view --json nameWithOwner -q .nameWithOwner 2^>nul`) do set "SLUG=%%r"
if "!SLUG!"=="" (
  echo   SKIPPED: could not identify the repository ^(is gh signed in?^).
  goto :ciunknown
)

set "CI="
for /f "usebackq delims=" %%c in (`gh api "repos/!SLUG!/actions/runs?head_sha=!LOCAL!" --jq "[.workflow_runs[] | select(.name==\"CI\")] | first | .conclusion // \"none\"" 2^>nul`) do set "CI=%%c"

if /i "!CI!"=="success" (
  echo   CI is green for this commit
  goto :confirm
)
if /i "!CI!"=="none" (
  echo   FAILED: no CI run found for this commit yet.
  echo           It may still be queued - wait for it rather than releasing blind.
  goto :notreleasable
)
if "!CI!"=="" (
  echo   SKIPPED: could not read the CI status.
  goto :ciunknown
)
echo   FAILED: the CI run for this commit concluded "!CI!".
goto :notreleasable

:ciunknown
echo.
echo The CI status could not be confirmed. The release workflow runs no tests of
echo its own, so nothing else will check this commit before it is published.
set /p "CIOK=Continue without knowing? [y/N] "
if /i not "!CIOK!"=="y" (
  echo Aborted.
  exit /b 1
)

:confirm
echo.
echo About to create and push tag %TAG% to origin ^(cuts a desktop release^).
set /p "OK=Proceed? [y/N] "
if /i not "%OK%"=="y" (
  echo Aborted.
  exit /b 1
)

git -C "%ROOT%" tag -a "%TAG%" -m "Desktop release %VER%"
if errorlevel 1 (
  echo Failed to create tag %TAG% ^(does it already exist?^).
  exit /b 1
)

git -C "%ROOT%" push origin "%TAG%"
if errorlevel 1 (
  echo Failed to push tag %TAG%. Removing the local tag so you can retry.
  git -C "%ROOT%" tag -d "%TAG%" >nul 2>&1
  exit /b 1
)

echo.
echo Pushed %TAG%. The "Desktop release" workflow will build + publish the installers.
echo Watch it: gh run list --workflow "Desktop release"
echo.
echo When it finishes, check the release actually contains both installers and that
echo the app starts - a published release is not the same as a working one.
endlocal
exit /b 0

:notreleasable
echo.
echo Not tagging. Fix the above, or pass --force if you are certain.
exit /b 1
