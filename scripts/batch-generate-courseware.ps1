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
Add-Type -AssemblyName System.Net.Http

function Get-ObjectValue {
  param(
    [object]$Object,
    [string]$Name
  )

  if ($null -ne $Object -and $Object.PSObject.Properties.Name -contains $Name) {
    return $Object.$Name
  }
  return $null
}

function Get-ConfiguredValue {
  param(
    [object]$Course,
    [object]$Defaults,
    [string]$Name
  )

  $courseValue = Get-ObjectValue $Course $Name
  if ($null -ne $courseValue) {
    return $courseValue
  }
  return Get-ObjectValue $Defaults $Name
}

function Resolve-ProjectPath {
  param(
    [string]$ProjectRoot,
    [string]$Value
  )

  if ([System.IO.Path]::IsPathRooted($Value)) {
    return [System.IO.Path]::GetFullPath($Value)
  }
  return [System.IO.Path]::GetFullPath((Join-Path $ProjectRoot $Value))
}

function Resolve-ChildPath {
  param(
    [string]$Directory,
    [string]$Value
  )

  if ([System.IO.Path]::IsPathRooted($Value)) {
    return [System.IO.Path]::GetFullPath($Value)
  }
  return [System.IO.Path]::GetFullPath((Join-Path $Directory $Value))
}

function Assert-PageRange {
  param(
    [string]$Value,
    [string]$Context
  )

  if ([string]::IsNullOrWhiteSpace($Value)) {
    return
  }
  foreach ($rawPart in $Value.Split(',')) {
    $part = $rawPart.Trim()
    if ($part -match '^(\d+)$') {
      if ([int64]$Matches[1] -lt 1) {
        throw "$Context has an invalid page number '$part'. Pages start at 1."
      }
      continue
    }
    if ($part -match '^(\d+)\s*-\s*(\d+)$') {
      $start = [int64]$Matches[1]
      $end = [int64]$Matches[2]
      if ($start -lt 1 -or $end -lt $start) {
        throw "$Context has an invalid page range '$part'."
      }
      continue
    }
    throw "$Context has invalid pages '$Value'. Use 3, 1-10, or 1-3,7,10-12."
  }
}

function Get-EnvironmentSecret {
  param(
    [object]$Object,
    [object]$Defaults,
    [string]$PropertyName,
    [string]$Context
  )

  $variableName = Get-ObjectValue $Object $PropertyName
  if ([string]::IsNullOrWhiteSpace([string]$variableName)) {
    $variableName = Get-ObjectValue $Defaults $PropertyName
  }
  if ([string]::IsNullOrWhiteSpace([string]$variableName)) {
    return $null
  }
  $value = [Environment]::GetEnvironmentVariable([string]$variableName)
  if ([string]::IsNullOrWhiteSpace($value)) {
    throw "$Context requires environment variable '$variableName'."
  }
  return $value
}

function Read-JsonResponse {
  param(
    [object]$Response,
    [string]$Context
  )

  try {
    $text = $Response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
    if (-not $Response.IsSuccessStatusCode) {
      throw "$Context failed with HTTP $([int]$Response.StatusCode): $text"
    }
    if ([string]::IsNullOrWhiteSpace($text)) {
      return [pscustomobject]@{}
    }
    return $text | ConvertFrom-Json
  } finally {
    $Response.Dispose()
  }
}

function Invoke-OpenMaicJson {
  param(
    [ValidateSet('GET', 'POST')]
    [string]$Method,
    [string]$Uri,
    [object]$Client,
    [object]$Body
  )

  if ($Method -eq 'GET') {
    $response = $Client.GetAsync($Uri).GetAwaiter().GetResult()
    return Read-JsonResponse $response "GET $Uri"
  }

  $json = $Body | ConvertTo-Json -Depth 30 -Compress
  $content = [System.Net.Http.StringContent]::new(
    $json,
    [System.Text.Encoding]::UTF8,
    'application/json'
  )
  try {
    $response = $Client.PostAsync($Uri, $content).GetAwaiter().GetResult()
    return Read-JsonResponse $response "POST $Uri"
  } finally {
    $content.Dispose()
  }
}

function Add-MultipartText {
  param(
    [object]$Multipart,
    [string]$Name,
    [string]$Value
  )

  if ([string]::IsNullOrWhiteSpace($Value)) {
    return
  }
  $content = [System.Net.Http.StringContent]::new($Value, [System.Text.Encoding]::UTF8)
  $Multipart.Add($content, $Name)
}

function Invoke-DocumentExtraction {
  param(
    [string]$Uri,
    [object]$Client,
    [object]$Pdf
  )

  $multipart = [System.Net.Http.MultipartFormDataContent]::new()
  $stream = [System.IO.File]::Open(
    $Pdf.Path,
    [System.IO.FileMode]::Open,
    [System.IO.FileAccess]::Read,
    [System.IO.FileShare]::Read
  )
  try {
    $fileContent = [System.Net.Http.StreamContent]::new($stream)
    $fileContent.Headers.ContentType =
      [System.Net.Http.Headers.MediaTypeHeaderValue]::new('application/pdf')
    $multipart.Add($fileContent, 'file', [System.IO.Path]::GetFileName($Pdf.Path))
    Add-MultipartText $multipart 'providerId' $Pdf.ProviderId
    Add-MultipartText $multipart 'pageRange' $Pdf.Pages
    Add-MultipartText $multipart 'apiKey' $Pdf.ApiKey
    Add-MultipartText $multipart 'baseUrl' $Pdf.BaseUrl
    Add-MultipartText $multipart 'accessKeyId' $Pdf.AccessKeyId
    Add-MultipartText $multipart 'accessKeySecret' $Pdf.AccessKeySecret

    $response = $Client.PostAsync($Uri, $multipart).GetAwaiter().GetResult()
    $result = Read-JsonResponse $response "Extracting $($Pdf.Path)"
    if (-not $result.success -or $null -eq $result.data) {
      throw "Document extraction returned no data for $($Pdf.Path)."
    }
    return $result.data
  } finally {
    $multipart.Dispose()
    $stream.Dispose()
  }
}

$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$resolvedConfigPath = (Resolve-Path -LiteralPath $ConfigPath).Path
$config = Get-Content -Raw -Encoding UTF8 -LiteralPath $resolvedConfigPath | ConvertFrom-Json
$defaults = Get-ObjectValue $config 'defaults'
$paths = Get-ObjectValue $config 'paths'
$promptDirectoryValue = [string](Get-ObjectValue $paths 'promptsDir')
$pdfDirectoryValue = [string](Get-ObjectValue $paths 'pdfDir')
if ([string]::IsNullOrWhiteSpace($promptDirectoryValue)) {
  $promptDirectoryValue = 'batch/prompts'
}
if ([string]::IsNullOrWhiteSpace($pdfDirectoryValue)) {
  $pdfDirectoryValue = 'batch/pdfs'
}
$promptsDir = Resolve-ProjectPath $projectRoot $promptDirectoryValue
$pdfDir = Resolve-ProjectPath $projectRoot $pdfDirectoryValue
$courses = @($config.courses)
if ($courses.Count -eq 0) {
  throw 'The batch config must contain at least one course.'
}

$jobs = @()
for ($index = 0; $index -lt $courses.Count; $index += 1) {
  $course = $courses[$index]
  $context = "Course $($index + 1)"
  $title = [string](Get-ConfiguredValue $course $defaults 'title')
  if ([string]::IsNullOrWhiteSpace($title)) {
    $title = $context
  }
  $model = [string](Get-ConfiguredValue $course $defaults 'model')
  if ([string]::IsNullOrWhiteSpace($model) -or $model -notmatch '^[^:\s]+:.+$') {
    throw "$context has invalid model '$model' (expected provider:model)."
  }

  $requirementParts = [System.Collections.Generic.List[string]]::new()
  $inlineRequirement = [string](Get-ConfiguredValue $course $defaults 'requirement')
  if (-not [string]::IsNullOrWhiteSpace($inlineRequirement)) {
    $requirementParts.Add($inlineRequirement.Trim())
  }
  $promptFile = [string](Get-ConfiguredValue $course $defaults 'promptFile')
  $promptPath = $null
  if (-not [string]::IsNullOrWhiteSpace($promptFile)) {
    $promptPath = Resolve-ChildPath $promptsDir $promptFile
    if (-not (Test-Path -LiteralPath $promptPath -PathType Leaf)) {
      throw "$context prompt file not found: $promptPath"
    }
    $requirementParts.Add((Get-Content -Raw -Encoding UTF8 -LiteralPath $promptPath).Trim())
  }
  if ($requirementParts.Count -eq 0) {
    throw "$context must define requirement or promptFile."
  }

  $pdfInputs = @()
  $coursePdfs = Get-ObjectValue $course 'pdfs'
  foreach ($pdfEntry in @($coursePdfs)) {
    if ($null -eq $pdfEntry) {
      continue
    }
    $pdfObject = if ($pdfEntry -is [string]) {
      [pscustomobject]@{ file = [string]$pdfEntry }
    } else {
      $pdfEntry
    }
    $pdfFile = [string](Get-ObjectValue $pdfObject 'file')
    if ([string]::IsNullOrWhiteSpace($pdfFile)) {
      throw "$context contains a PDF entry without file."
    }
    $pdfPath = Resolve-ChildPath $pdfDir $pdfFile
    if (-not (Test-Path -LiteralPath $pdfPath -PathType Leaf)) {
      throw "$context PDF file not found: $pdfPath"
    }
    if ([System.IO.Path]::GetExtension($pdfPath) -ne '.pdf') {
      throw "$context course material must be a PDF: $pdfPath"
    }
    $pages = [string](Get-ObjectValue $pdfObject 'pages')
    Assert-PageRange $pages "$context PDF '$pdfFile'"
    $providerId = [string](Get-ObjectValue $pdfObject 'providerId')
    if ([string]::IsNullOrWhiteSpace($providerId)) {
      $providerId = [string](Get-ConfiguredValue $course $defaults 'pdfProviderId')
    }
    if ([string]::IsNullOrWhiteSpace($providerId)) {
      $providerId = 'unpdf'
    }
    $baseUrlValue = [string](Get-ObjectValue $pdfObject 'baseUrl')
    if ([string]::IsNullOrWhiteSpace($baseUrlValue)) {
      $baseUrlValue = [string](Get-ConfiguredValue $course $defaults 'pdfBaseUrl')
    }
    $pdfInputs += [pscustomobject]@{
      Path = $pdfPath
      Pages = $pages
      ProviderId = $providerId
      BaseUrl = $baseUrlValue
      ApiKey = Get-EnvironmentSecret $pdfObject $defaults 'apiKeyEnv' "$context PDF '$pdfFile'"
      AccessKeyId = Get-EnvironmentSecret $pdfObject $defaults 'accessKeyIdEnv' "$context PDF '$pdfFile'"
      AccessKeySecret = Get-EnvironmentSecret $pdfObject $defaults 'accessKeySecretEnv' "$context PDF '$pdfFile'"
    }
  }

  $body = [ordered]@{
    title = $title
    requirement = $requirementParts -join "`n`n"
    model = $model
  }
  foreach ($option in @(
      'enableWebSearch',
      'webSearchProviderId',
      'enableImageGeneration',
      'enableVideoGeneration',
      'enableTTS',
      'enableVisionAudit',
      'agentMode'
    )) {
    $value = Get-ConfiguredValue $course $defaults $option
    if ($null -ne $value) {
      $body[$option] = $value
    }
  }
  $jobs += [pscustomobject]@{
    Title = $title
    Model = $model
    Prompt = $promptPath
    PdfInputs = $pdfInputs
    Body = $body
  }
}

Write-Host "Validated $($jobs.Count) course(s) from $resolvedConfigPath"
$jobs | Select-Object Title, Model, @{ Name = 'PDFs'; Expression = { $_.PdfInputs.Count } } |
  Format-Table -AutoSize
if ($ValidateOnly) {
  return
}

if ([string]::IsNullOrWhiteSpace($BaseUrl)) {
  $configuredBaseUrl = [string](Get-ObjectValue $config 'baseUrl')
  $BaseUrl = if ([string]::IsNullOrWhiteSpace($configuredBaseUrl)) {
    'http://127.0.0.1:3000'
  } else {
    $configuredBaseUrl
  }
}
$BaseUrl = $BaseUrl.TrimEnd('/')
$handler = [System.Net.Http.HttpClientHandler]::new()
$handler.CookieContainer = [System.Net.CookieContainer]::new()
$client = [System.Net.Http.HttpClient]::new($handler)
$client.Timeout = [TimeSpan]::FromMinutes([Math]::Max(5, $TimeoutMinutes))

try {
  $accessStatus = Invoke-OpenMaicJson 'GET' "$BaseUrl/api/access-code/status" $client $null
  if ($accessStatus.enabled -and -not $accessStatus.authenticated) {
    if ([string]::IsNullOrWhiteSpace($AccessCode)) {
      throw 'Access control is enabled. Set OPENMAIC_ACCESS_CODE or pass -AccessCode.'
    }
    $verification = Invoke-OpenMaicJson 'POST' "$BaseUrl/api/access-code/verify" $client @{ code = $AccessCode }
    if (-not $verification.success -or -not $verification.valid) {
      throw 'Access code verification failed.'
    }
  }

  $results = @()
  $failures = @()
  foreach ($job in $jobs) {
    Write-Host "[$($job.Model)] Preparing: $($job.Title)"
    try {
      if ($job.PdfInputs.Count -gt 0) {
        $textParts = [System.Collections.Generic.List[string]]::new()
        $images = [System.Collections.Generic.List[string]]::new()
        foreach ($pdf in $job.PdfInputs) {
          $pageLabel = if ([string]::IsNullOrWhiteSpace($pdf.Pages)) { 'all' } else { $pdf.Pages }
          Write-Host "  Extracting $([System.IO.Path]::GetFileName($pdf.Path)) (pages: $pageLabel; provider: $($pdf.ProviderId))"
          $data = Invoke-DocumentExtraction "$BaseUrl/api/extract-document" $client $pdf
          $sourceHeading = "# Source: $([System.IO.Path]::GetFileName($pdf.Path)) (pages: $pageLabel)"
          $textParts.Add("$sourceHeading`n`n$($data.text)")
          foreach ($image in @($data.images)) {
            if (-not [string]::IsNullOrWhiteSpace([string]$image)) {
              $images.Add([string]$image)
            }
          }
        }
        $job.Body['pdfContent'] = [ordered]@{
          text = $textParts -join "`n`n"
          images = @($images)
        }
      }

      Write-Host "[$($job.Model)] Submitting: $($job.Title)"
      $submission = Invoke-OpenMaicJson 'POST' "$BaseUrl/api/generate-classroom" $client $job.Body
      if (-not $submission.success -or [string]::IsNullOrWhiteSpace([string]$submission.jobId)) {
        throw "Job submission failed: $($submission.error)"
      }

      $deadline = [DateTime]::UtcNow.AddMinutes($TimeoutMinutes)
      $lastProgress = -1
      do {
        Start-Sleep -Seconds $PollIntervalSeconds
        $status = Invoke-OpenMaicJson 'GET' "$BaseUrl/api/generate-classroom/$($submission.jobId)" $client $null
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
      $failure = [pscustomobject]@{
        Title = $job.Title
        Model = $job.Model
        Error = $_.Exception.Message
      }
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
} finally {
  $client.Dispose()
  $handler.Dispose()
}
