[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
Set-Location -LiteralPath $PSScriptRoot

function Refresh-ProcessPath {
    $machinePath = [Environment]::GetEnvironmentVariable("Path", "Machine")
    $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
    $env:Path = "$machinePath;$userPath"
}

function Get-NodeMajorVersion {
    $nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
    if (-not $nodeCommand) {
        return $null
    }

    $versionText = (& $nodeCommand.Source --version).Trim().TrimStart("v")
    return ([version]$versionText).Major
}

$nodeMajor = Get-NodeMajorVersion
if ($null -eq $nodeMajor) {
    $wingetCommand = Get-Command winget.exe -ErrorAction SilentlyContinue
    if (-not $wingetCommand) {
        throw "Node.js 20 or newer is required. Install Node.js LTS from https://nodejs.org and run this script again."
    }

    Write-Host "Installing Node.js LTS..." -ForegroundColor Cyan
    & $wingetCommand.Source install --id OpenJS.NodeJS.LTS --exact --accept-package-agreements --accept-source-agreements
    if ($LASTEXITCODE -ne 0) {
        throw "Node.js installation failed with exit code $LASTEXITCODE."
    }
    Refresh-ProcessPath
    $nodeMajor = Get-NodeMajorVersion
}

if ($null -eq $nodeMajor -or $nodeMajor -lt 20) {
    throw "Node.js 20 or newer is required. Update Node.js at https://nodejs.org and run this script again."
}

$npmCommand = Get-Command npm.cmd -ErrorAction SilentlyContinue
if (-not $npmCommand) {
    throw "npm was not found after checking Node.js. Restart Windows and run this script again."
}

$envPath = Join-Path $PSScriptRoot ".env"
if (-not (Test-Path -LiteralPath $envPath)) {
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot ".env.example") -Destination $envPath
}

$envText = [IO.File]::ReadAllText($envPath)
$keyMatch = [regex]::Match($envText, '(?m)^\s*GEMINI_API_KEY\s*=\s*["'']?(?<key>[^"''\r\n]*)')
$hasApiKey = $keyMatch.Success -and
    -not [string]::IsNullOrWhiteSpace($keyMatch.Groups["key"].Value) -and
    $keyMatch.Groups["key"].Value -notmatch "replace-with|your-key"

if (-not $hasApiKey) {
    Write-Host "A Gemini API key is needed only for AI Helper." -ForegroundColor Yellow
    $secureKey = Read-Host "Paste the Gemini API key (input is hidden)" -AsSecureString
    $keyPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureKey)
    try {
        $plainKey = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($keyPointer)
    }
    finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($keyPointer)
    }

    if ([string]::IsNullOrWhiteSpace($plainKey)) {
        throw "No Gemini API key was provided."
    }

    $replacement = 'GEMINI_API_KEY="' + $plainKey.Trim() + '"'
    if ($keyMatch.Success) {
        $envText = [regex]::Replace($envText, '(?m)^\s*GEMINI_API_KEY\s*=.*$', $replacement)
    }
    else {
        $envText = $replacement + [Environment]::NewLine + $envText
    }
    [IO.File]::WriteAllText($envPath, $envText, [Text.UTF8Encoding]::new($false))
    Remove-Variable plainKey -ErrorAction SilentlyContinue
}
else {
    Write-Host "Using the Gemini key already configured in .env." -ForegroundColor Green
}

Write-Host "Installing project dependencies..." -ForegroundColor Cyan
& $npmCommand.Source ci
if ($LASTEXITCODE -ne 0) {
    throw "npm ci failed with exit code $LASTEXITCODE."
}

$appUrl = "http://127.0.0.1:4000/"
$env:HOST = "127.0.0.1"
$env:PORT = "4000"
$env:PUBLIC_APP_URL = $appUrl.TrimEnd("/")
$env:DATABASE_PATH = Join-Path $PSScriptRoot "data\family-companion.sqlite"
$env:UPLOAD_PATH = Join-Path $PSScriptRoot "data\uploads"

$browserJob = Start-Job -ScriptBlock {
    param($targetUrl)
    for ($attempt = 0; $attempt -lt 90; $attempt++) {
        try {
            $response = Invoke-WebRequest -Uri $targetUrl -UseBasicParsing -TimeoutSec 2
            if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) {
                Start-Process $targetUrl
                return
            }
        }
        catch {
            Start-Sleep -Milliseconds 750
        }
    }
} -ArgumentList $appUrl

Write-Host ""
Write-Host "Starting Family Companion at $appUrl" -ForegroundColor Green
Write-Host "To test AI: sign in, create your family, open AI Helper, enable Gemini consent, then try:"
Write-Host '  I want to go to Golden Park with my parents and sibling.' -ForegroundColor Yellow
Write-Host "Press Ctrl+C here to stop the app."

try {
    & $npmCommand.Source run dev
    if ($LASTEXITCODE -ne 0) {
        throw "The development server stopped with exit code $LASTEXITCODE."
    }
}
finally {
    Stop-Job -Job $browserJob -ErrorAction SilentlyContinue
    Remove-Job -Job $browserJob -Force -ErrorAction SilentlyContinue
}
