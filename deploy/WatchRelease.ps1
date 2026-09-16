# ==========================================================================
# WatchRelease.ps1 - follow one "Desktop release" run until it finishes.
#
# Called by PushVersion.cmd straight after it pushes a tag, and usable on its
# own for a tag that is already building:
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File deploy\WatchRelease.ps1 -Tag v0.98.0
#
# -RunId follows one run by its id instead of looking the tag's run up.
#
# It finds the run the tag started, then every few seconds rewrites ONE line
# with that run's status and its jobs, and stops when the run completes.
# Exit code: 0 when the run succeeded, 1 when it failed or was cancelled, 2
# when the run could not be found or followed. Ctrl+C stops watching only - the
# run carries on in GitHub.
#
# The run is matched on the TAG and on the commit the tag points at, never on
# "the newest run": two tags pushed close together, or a rerun of an older
# release, would otherwise have this watch somebody else's build.
# ==========================================================================

param(
  [Parameter(Mandatory = $true)][string]$Tag,
  [string]$Workflow = "Desktop release",
  [int]$IntervalSeconds = 5,
  # How long to wait for GitHub to create the run after the push. Usually a few seconds.
  [int]$FindTimeoutSeconds = 180,
  # Follow this run rather than finding the one the tag started.
  [long]$RunId = 0
)

# Not "Stop": in Windows PowerShell 5.1 that turns anything a native command writes to stderr into a
# terminating error, even with 2>$null - so git naming an unknown tag, or gh failing once on a
# dropped connection, would end the watch instead of being handled below.
$ErrorActionPreference = "Continue"

# From the repository root, whatever directory this was started in: gh finds the repository, and git
# the tag, from the current directory - and PushVersion.cmd can be run from anywhere.
Set-Location (Join-Path $PSScriptRoot "..")

if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
  Write-Host "The GitHub CLI (gh) is not installed, so the run cannot be followed."
  Write-Host "Watch it on GitHub, under Actions > $Workflow."
  exit 2
}

# The commit the tag names, so a run for a different commit under the same tag name is not taken.
$sha = (git rev-parse "$Tag^{commit}" 2>$null)
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($sha)) { $sha = $null } else { $sha = $sha.Trim() }

# --- One line, rewritten in place ------------------------------------------
$script:lastLength = 0

function Get-LineWidth {
  try { return [Math]::Max(40, $Host.UI.RawUI.BufferSize.Width - 1) } catch { return 119 }
}

# Rewrites the current console line. Cut to the window width, because a line that wraps can no
# longer be returned to with a carriage return, and every update would then start a new line.
function Write-StatusLine([string]$text) {
  $width = Get-LineWidth
  if ($text.Length -gt $width) { $text = $text.Substring(0, $width - 3) + "..." }
  $padded = $text.PadRight([Math]::Max($script:lastLength, $text.Length))
  Write-Host ("`r" + $padded) -NoNewline
  $script:lastLength = $text.Length
}

function Format-Elapsed([TimeSpan]$span) {
  if ($span.TotalSeconds -lt 0) { $span = [TimeSpan]::Zero }
  return "{0:00}:{1:00}" -f [Math]::Floor($span.TotalMinutes), $span.Seconds
}

# gh answers dates as ISO strings; PowerShell 7 turns them into DateTime while 5.1 leaves them as text.
function ConvertTo-Utc($value) {
  if ($null -eq $value -or "$value" -eq "") { return $null }
  if ($value -is [DateTime]) { return $value.ToUniversalTime() }
  return [DateTimeOffset]::Parse("$value").UtcDateTime
}

function Invoke-GhJson([string[]]$arguments) {
  $output = & gh @arguments 2>$null
  if ($LASTEXITCODE -ne 0 -or $null -eq $output) { return $null }
  try { return ($output -join "`n") | ConvertFrom-Json } catch { return $null }
}

# --- Find the run the tag started ------------------------------------------
Write-Host ""
$found = if ($RunId -gt 0) { Invoke-GhJson @("run", "view", "$RunId", "--json", "databaseId,url") } else { $null }
if ($RunId -gt 0 -and $null -eq $found) {
  Write-Host "Run $RunId could not be read from GitHub."
  exit 2
}
$searchStart = Get-Date
while ($null -eq $found) {
  # Filtered by the tag on GitHub's side - a tag's runs are listed under it as their branch - so a
  # busy workflow cannot push the run out of the page this looks at.
  $runs = Invoke-GhJson @("run", "list", "--workflow", $Workflow, "--branch", $Tag, "--limit", "20",
    "--json", "databaseId,headBranch,headSha,status,url")
  if ($null -ne $runs) {
    $found = @($runs | Where-Object {
        $_.headBranch -eq $Tag -and ($null -eq $sha -or $_.headSha -eq $sha)
      }) | Select-Object -First 1
  }
  if ($null -ne $found) { break }

  $waited = (Get-Date) - $searchStart
  if ($waited.TotalSeconds -ge $FindTimeoutSeconds) {
    Write-StatusLine "No `"$Workflow`" run for $Tag appeared within $FindTimeoutSeconds seconds."
    Write-Host ""
    Write-Host "Check it on GitHub: gh run list --workflow `"$Workflow`""
    exit 2
  }
  Write-StatusLine ("Waiting for GitHub to start the `"$Workflow`" run for $Tag... " + (Format-Elapsed $waited))
  Start-Sleep -Seconds $IntervalSeconds
}

$followId = $found.databaseId
Write-StatusLine "Following run $followId for $Tag"
Write-Host ""
Write-Host $found.url

# --- Follow it --------------------------------------------------------------
$last = $null
while ($true) {
  $run = Invoke-GhJson @("run", "view", "$followId", "--json", "status,conclusion,createdAt,updatedAt,jobs")
  $clock = (Get-Date).ToString("HH:mm:ss")

  if ($null -eq $run) {
    # A dropped connection is not the end of the run. Keep the last good status and say so.
    $previous = if ($null -eq $last) { "" } else { "$last  " }
    Write-StatusLine "$previous(could not reach GitHub at $clock, retrying)"
    Start-Sleep -Seconds $IntervalSeconds
    continue
  }

  # To now while it runs; to when it last changed once it has finished, so a watch started on a run
  # that finished an hour ago does not report it as taking an hour.
  $until = if ($run.status -eq "completed") { ConvertTo-Utc $run.updatedAt } else { (Get-Date).ToUniversalTime() }
  $elapsed = Format-Elapsed ($until - (ConvertTo-Utc $run.createdAt))
  $jobs = @($run.jobs)
  $done = @($jobs | Where-Object { $_.status -eq "completed" }).Count
  # Each job by the last word of its name - "Package windows-latest" reads as "windows-latest".
  $jobText = ($jobs | ForEach-Object {
      $short = ($_.name -split " ")[-1]
      $state = if ($_.status -eq "completed") { $_.conclusion } else { $_.status }
      "${short}: $state"
    }) -join ", "

  $state = if ($run.status -eq "completed") { $run.conclusion } else { $run.status }
  $last = "$Tag  $state  $elapsed  jobs $done/$($jobs.Count)  [$jobText]"
  Write-StatusLine "$last  (at $clock)"

  if ($run.status -eq "completed") {
    Write-Host ""
    Write-Host ""
    if ($run.conclusion -eq "success") {
      Write-Host "$Workflow for $Tag succeeded in $elapsed."
      exit 0
    }
    Write-Host "$Workflow for $Tag finished as `"$($run.conclusion)`"."
    Write-Host "See why: gh run view $followId --log-failed"
    exit 1
  }

  Start-Sleep -Seconds $IntervalSeconds
}
