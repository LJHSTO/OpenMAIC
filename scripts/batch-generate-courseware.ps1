[CmdletBinding()]
param(
  [string]$ConfigPath = (Join-Path $PSScriptRoot 'courseware-batch.example.json'),
  [string]$BaseUrl = '',
  [string]$AccessCode = $env:OPENMAIC_ACCESS_CODE,
  [ValidateRange(1, 300)]
  [int]$PollIntervalSeconds = 5,
  [ValidateRange(1, 1440)]
  [int]$TimeoutMinutes = 90,
  [switch]$ContinueOnError,
  [switch]$ValidateOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-ConfiguredValue {
  param(
    [object]$Course,
    [object]$Defaults,
    [string]$Name
  )

  if ($Course.PSObject.Properties.Name -contains $Name) {
    return $Course.$Name
  }
  if ($null -ne $Defaults -and $Defaults.PSObject.Properties.Name -contains $Name) {
    return $Defaults.$Name
  }
  return $null
}

function Invoke-OpenMaicJson {
  param(
    [ValidateSet('GET', 'POST')]
    [string]$Method,
    [string]$Uri,
    [Microsoft.PowerShell.Commands.WebRequestSession]$Session,
    [object]$Body
  )

  $parameters = @{
    Method = $Method
    Uri = $Uri
    WebSession = $Session
  }
  if ($null -ne $Body) {
    $parameters.ContentType = 'application/json; charset=utf-8'
    $parameters.Body = $Body | ConvertTo-Json -Depth 20 -Compress
  }
  return Invoke-RestMethod @parameters
}

$resolvedConfigPath = (Resolve-Path -LiteralPath $ConfigPath).Path
$config = Get-Content -Raw -Encoding UTF8 -LiteralPath $resolvedConfigPath | ConvertFrom-Json
$defaults = if ($config.PSObject.Properties.Name -contains 'defaults') { $config.defaults } else { $null }
$courses = @($config.courses)
if ($courses.Count -eq 0) {
  throw 'The batch config must contain at least one course.'
}

$jobs = @()
for ($index = 0; $index -lt $courses.Count; $index += 1) {
  $course = $courses[$index]
  $title = [string](Get-ConfiguredValue $course $defaults 'title')
  $requirement = [string](Get-ConfiguredValue $course $defaults 'requirement')
  $model = [string](Get-ConfiguredValue $course $defaults 'model')
  if ([string]::IsNullOrWhiteSpace($requirement)) {
    throw "Course $($index + 1) is missing requirement."
  }
  if ([string]::IsNullOrWhiteSpace($model)) {
    throw "Course $($index + 1) is missing model (expected provider:model)."
  }
  if ($model -notmatch '^[^:\s]+:.+$') {
    throw "Course $($index + 1) has invalid model '$model' (expected provider:model)."
  }
  if ([string]::IsNullOrWhiteSpace($title)) {
    $title = "Course $($index + 1)"
  }

  $body = [ordered]@{
    requirement = $requirement
    model = $model
  }
  foreach ($option in @(
      'enableWebSearch',
      'webSearchProviderId',
      'enableImageGeneration',
      'enableVideoGeneration',
      'enableTTS',
      'agentMode'
    )) {
    $value = Get-ConfiguredValue $course $defaults $option
    if ($null -ne $value) {
      $body[$option] = $value
    }
  }
  $jobs += [pscustomobject]@{ Title = $title; Model = $model; Body = $body }
}

Write-Host "Validated $($jobs.Count) course(s) from $resolvedConfigPath"
$jobs | Select-Object Title, Model | Format-Table -AutoSize
if ($ValidateOnly) {
  return
}

if ([string]::IsNullOrWhiteSpace($BaseUrl)) {
  $BaseUrl = if ($config.PSObject.Properties.Name -contains 'baseUrl') {
    [string]$config.baseUrl
  } else {
    'http://127.0.0.1:3000'
  }
}
$BaseUrl = $BaseUrl.TrimEnd('/')
$session = [Microsoft.PowerShell.Commands.WebRequestSession]::new()
$accessStatus = Invoke-OpenMaicJson -Method GET -Uri "$BaseUrl/api/access-code/status" -Session $session -Body $null
if ($accessStatus.enabled -and -not $accessStatus.authenticated) {
  if ([string]::IsNullOrWhiteSpace($AccessCode)) {
    throw 'Access control is enabled. Set OPENMAIC_ACCESS_CODE or pass -AccessCode.'
  }
  $verification = Invoke-OpenMaicJson -Method POST -Uri "$BaseUrl/api/access-code/verify" -Session $session -Body @{ code = $AccessCode }
  if (-not $verification.success) {
    throw 'Access code verification failed.'
  }
}

$results = @()
$failures = @()
foreach ($job in $jobs) {
  Write-Host "[$($job.Model)] Submitting: $($job.Title)"
  try {
    $submission = Invoke-OpenMaicJson -Method POST -Uri "$BaseUrl/api/generate-classroom" -Session $session -Body $job.Body
    if (-not $submission.success -or [string]::IsNullOrWhiteSpace([string]$submission.jobId)) {
      throw "Job submission failed: $($submission.error)"
    }

    $deadline = [DateTime]::UtcNow.AddMinutes($TimeoutMinutes)
    $lastProgress = -1
    do {
      Start-Sleep -Seconds $PollIntervalSeconds
      $status = Invoke-OpenMaicJson -Method GET -Uri "$BaseUrl/api/generate-classroom/$($submission.jobId)" -Session $session -Body $null
      if ([int]$status.progress -ne $lastProgress) {
        $lastProgress = [int]$status.progress
        Write-Host "  $($status.progress)% [$($status.step)] $($status.message)"
      }
      if ([DateTime]::UtcNow -gt $deadline) {
        throw "Job timed out after $TimeoutMinutes minute(s): $($submission.jobId)"
      }
    } until ($status.done)

    if ($status.status -ne 'succeeded') {
      throw "Generation failed: $($status.error)"
    }
    $archive = $status.result.archive
    $results += [pscustomobject]@{
      Title = $job.Title
      Model = $job.Model
      ClassroomId = $status.result.classroomId
      Archive = $archive.path
      VisualCritical = $status.result.visualAudit.critical
    }
    Write-Host "  Archive: $($archive.path)"
  } catch {
    $failure = [pscustomobject]@{ Title = $job.Title; Model = $job.Model; Error = $_.Exception.Message }
    $failures += $failure
    Write-Error -ErrorAction Continue "[$($job.Title)] $($failure.Error)"
    if (-not $ContinueOnError) {
      throw
    }
  }
}

Write-Host ''
Write-Host "Completed: $($results.Count); Failed: $($failures.Count)"
if ($results.Count -gt 0) {
  $results | Format-Table -AutoSize
}
if ($failures.Count -gt 0) {
  $failures | Format-Table -AutoSize
  exit 1
}
