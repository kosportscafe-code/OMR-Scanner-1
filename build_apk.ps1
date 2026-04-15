# OMR_Scanner_Build_Script.ps1
# Automated APK Construction using Bubblewrap CLI
# Converts the offline-ready PWA into a Native Android APK (TWA)

$appName = "OMR Scanner"
$apkName = "OMR_Scanner_v1.0.apk"
$projectDir = Get-Location

Write-Host "=======================================================" -ForegroundColor Cyan
Write-Host " INITIALIZING $appName APK BUILD SEQUENCE " -ForegroundColor Cyan
Write-Host "=======================================================" -ForegroundColor Cyan

# 1. Install Bubblewrap CLI
Write-Host "`n[1/5] Checking for Bubblewrap CLI..." -ForegroundColor Yellow
Try {
    $bubblewrapVersion = npx @bubblewrap/cli --version *>&1
    Write-Host "Bubblewrap is installed. Proceeding..." -ForegroundColor Green
} Catch {
    Write-Host "Bubblewrap not found. Installing globally via npm..." -ForegroundColor Yellow
    npm install -g @bubblewrap/cli
}

# 2. Initialize the Bubblewrap Project
Write-Host "`n[2/5] Initializing Android Project from manifest.json..." -ForegroundColor Yellow
# Bubblewrap uses the manifest.json to generate the Android scaffolding
# It targets Android 7.0+ (API 24) by default
npx @bubblewrap/cli init --manifest=manifest.json

# 3. Build the APK (Debug & Release)
Write-Host "`n[3/5] Building the Native Android APK..." -ForegroundColor Yellow
Write-Host "NOTE: Bubblewrap will prompt you to install JDK and Android Command Line Tools if missing."
Write-Host "NOTE: A default keystore (omr-scanner-key) will be generated for signing."
npx @bubblewrap/cli build

# 4. Export and Rename to Final APK
Write-Host "`n[4/5] Exporting Final APK..." -ForegroundColor Yellow
$builtApkPath = "app-release-signed.apk" # Default Bubblewrap output

if (Test-Path $builtApkPath) {
    Rename-Item -Path $builtApkPath -NewName $apkName -Force
    $fileInfo = Get-Item $apkName
    $sizeMB = [math]::Round($fileInfo.Length / 1MB, 2)
    Write-Host "SUCCESS: Final APK generated -> $apkName ($sizeMB MB)" -ForegroundColor Green
} else {
    Write-Host "ERROR: Build failed or APK was not found. Please check the logs above." -ForegroundColor Red
    exit
}

# 5. Local Hosting & QR Code Generation (for easy installation)
Write-Host "`n[5/5] Generating Installation QR Code..." -ForegroundColor Yellow
$ipAddress = (Test-Connection -ComputerName (hostname) -Count 1).IPV4Address.IPAddressToString
if (-not $ipAddress) { $ipAddress = "localhost" }

Write-Host "Starting local file server on port 8080..." -ForegroundColor Cyan
# Start a background server to serve the APK locally
Start-Job -ScriptBlock { npx serve -p 8080 --cors }

Start-Sleep -Seconds 3 # Give server time to spin up
$downloadLink = "http://${ipAddress}:8080/$apkName"

Write-Host "Generating QR Code for: $downloadLink"
npx qrcode-terminal $downloadLink

Write-Host "`n=======================================================" -ForegroundColor Cyan
Write-Host " INSTALLATION INSTRUCTIONS " -ForegroundColor Cyan
Write-Host "=======================================================" -ForegroundColor Cyan
Write-Host "Minimum Supported OS: Android 7.0+ (API Level 24)"
Write-Host "`nTransfer Methods:"
Write-Host "1. QR Code (WiFi): Scan the QR code above using your phone's camera while on the same WiFi network."
Write-Host "2. USB Transfer: Connect your phone to this PC via USB and copy '$apkName' to your Downloads folder."
Write-Host "`nRequired Phone Settings:"
Write-Host "Before installing, ensure that 'Install from Unknown Sources' is enabled in your Android Security or Browser settings."
Write-Host "=======================================================" -ForegroundColor Cyan
