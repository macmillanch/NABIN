param(
    [Parameter(Mandatory=$true)]
    [string]$Url,
    [Parameter(Mandatory=$true)]
    [string]$OutputFile,
    [int]$Width = 1280,
    [int]$Height = 900
)

$msedge = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
if (-not (Test-Path $msedge)) {
    Write-Error "Edge not found at $msedge"
    exit 1
}

$fullOutputDir = Split-Path -Parent $OutputFile
if ($fullOutputDir -and -not (Test-Path $fullOutputDir)) {
    New-Item -ItemType Directory -Path $fullOutputDir -Force | Out-Null
}

$resolvedOutput = [System.IO.Path]::GetFullPath($OutputFile)
$tempProfile = Join-Path $env:TEMP ("edge_qa_" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $tempProfile -Force | Out-Null

try {
    # Warm up URL first
    try {
        Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 10 | Out-Null
    } catch {
        # continue even if warm-up fails
    }

    $argsList = @(
        "--headless=new",
        "--screenshot=$resolvedOutput",
        "--window-size=$Width,$Height",
        "--force-device-scale-factor=1",
        "--hide-scrollbars",
        "--disable-gpu",
        "--user-data-dir=$tempProfile"
    )

    if ($Width -lt 768) {
        $argsList += "--use-mobile-user-agent"
        $argsList += '--user-agent="Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)"'
        $argsList += "--enable-viewport"
    }

    $argsList += $Url

    $proc = Start-Process -FilePath $msedge -ArgumentList $argsList -PassThru -NoNewWindow

    # Wait for process to finish screenshot capture (max 10 seconds)
    $finished = $proc.WaitForExit(10000)
    if (-not $finished) {
        Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
    }
    
    # Brief pause to ensure disk write flush
    Start-Sleep -Milliseconds 800

    if (Test-Path $resolvedOutput) {
        $item = Get-Item $resolvedOutput
        Write-Output "CAPTURED: $($item.FullName) ($($item.Length) bytes)"
    } else {
        Write-Error "Failed to capture screenshot to $resolvedOutput"
    }
} finally {
    Remove-Item -Recurse -Force $tempProfile -ErrorAction SilentlyContinue
}
