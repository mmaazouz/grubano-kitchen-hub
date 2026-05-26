# =============================================================================
# scripts/prepare-deploy.ps1 - Grubano deployment preparation (Windows)
# =============================================================================
# Usage:
#   .\scripts\prepare-deploy.ps1              -> build + ZIP
#   .\scripts\prepare-deploy.ps1 -SkipBuild   -> reuse existing build
#   .\scripts\prepare-deploy.ps1 -NoZip       -> prepare deploy/ without zipping
#
# NOTE (CloudLinux o2switch):
#   node_modules is EXCLUDED from the ZIP.
#   After extraction on the server, run:
#     source ~/nodevenv/grubano.com/24/bin/activate
#     cd ~/grubano.com && npm ci --omit=dev
# =============================================================================

param(
    [switch]$SkipBuild,
    [switch]$NoZip
)

$ErrorActionPreference = "Stop"

# -- Config -------------------------------------------------------------------
$BuildDir  = ".next\standalone"
$StaticDir = ".next\static"
$DeployDir = "deploy"
$ZipFile   = "grubano-deploy.zip"

# -- Helpers ------------------------------------------------------------------
function Write-Step { param($msg) Write-Host ("`n>> " + $msg) -ForegroundColor Cyan }
function Write-OK   { param($msg) Write-Host ("  [OK]   " + $msg) -ForegroundColor Green }
function Write-Warn { param($msg) Write-Host ("  [WARN] " + $msg) -ForegroundColor Yellow }
function Write-Err  { param($msg) Write-Host ("  [ERR]  " + $msg) -ForegroundColor Red; exit 1 }
function Write-Info { param($msg) Write-Host ("  ->     " + $msg) -ForegroundColor Gray }

# =============================================================================
# 1. BUILD
# =============================================================================
Write-Step "Build Next.js 14 (standalone)"

if (-not (Test-Path ".env.local")) {
    Write-Err ".env.local missing. Copy .env.local.example and fill in values."
}

if ($SkipBuild) {
    Write-Warn "Build skipped (-SkipBuild)"
    if (-not (Test-Path $BuildDir)) { Write-Err ("Folder " + $BuildDir + " not found. Run without -SkipBuild.") }
} else {
    Write-Info "Running npm run build..."
    npm run build
    if ($LASTEXITCODE -ne 0) { Write-Err ("npm run build failed (exit code " + $LASTEXITCODE + ").") }
    if (-not (Test-Path $BuildDir)) { Write-Err ("Folder " + $BuildDir + " not found after build.") }
    Write-OK ("Build complete -> " + $BuildDir)
}

# =============================================================================
# 1b. PATCH server.js -- replace hardcoded Windows paths
# =============================================================================
Write-Step "Patch server.js (Windows paths -> Linux)"

$serverJsPath = $BuildDir + "\server.js"
if (-not (Test-Path $serverJsPath)) {
    Write-Err ($serverJsPath + " not found. Standalone build is incomplete.")
}

Write-Info "Running scripts\fix-server.js..."
node scripts\fix-server.js
if ($LASTEXITCODE -ne 0) {
    Write-Err "fix-server.js failed. See error above."
}

$serverContent = Get-Content $serverJsPath -Raw
if ($serverContent -match 'C:\\\\Users|C:\\Users') {
    Write-Err ("Windows path still present in " + $serverJsPath + "! Aborting.")
} else {
    Write-OK "server.js is clean for Linux (no Windows paths)"
}

$match = [regex]::Match($serverContent, '"outputFileTracingRoot"\s*:\s*"([^"]*)"')
if ($match.Success) {
    Write-Info ("outputFileTracingRoot = " + $match.Groups[1].Value)
}

# =============================================================================
# 2. PREPARE deploy/ FOLDER
# =============================================================================
Write-Step ("Preparing " + $DeployDir + "\")

if (Test-Path $DeployDir) {
    Write-Info ("Removing old " + $DeployDir + "\")
    Remove-Item -Recurse -Force $DeployDir
}
New-Item -ItemType Directory -Force $DeployDir | Out-Null

# 2a. Copy standalone content -- EXCLUDE node_modules
# CloudLinux on o2switch blocks extraction of node_modules from ZIP silently.
# node_modules must be installed on the server via: npm ci --omit=dev
Write-Info ("Copying " + $BuildDir + "\* -> " + $DeployDir + "\ (excluding node_modules)")
Get-ChildItem -Path $BuildDir -Force | Where-Object { $_.Name -ne "node_modules" } | ForEach-Object {
    Copy-Item -Path $_.FullName -Destination $DeployDir -Recurse -Force
}

if (Test-Path ($DeployDir + "\node_modules")) {
    Remove-Item -Recurse -Force ($DeployDir + "\node_modules")
    Write-OK "node_modules removed from deploy folder (CloudLinux: use npm ci on server)"
}

# 2b. Passenger wrapper server.js
Write-Info "Copying server.js (Passenger wrapper)"
Copy-Item "server.js" ($DeployDir + "\server.js") -Force

# 2c. .next\static\ (CSS/JS bundles -- critical to avoid blank page)
if (Test-Path $StaticDir) {
    Write-Info ("Copying " + $StaticDir + "\ -> " + $DeployDir + "\.next\static\")
    $dest = $DeployDir + "\.next\static"
    New-Item -ItemType Directory -Force $dest | Out-Null
    Copy-Item -Path ($StaticDir + "\*") -Destination $dest -Recurse -Force
    Write-OK ".next\static\ copied"
} else {
    Write-Warn ($StaticDir + " not found -- blank page likely. Run npm run build first.")
}

# 2d. public\ (favicon, images...)
if (Test-Path "public") {
    Write-Info "Copying public\"
    $pub = $DeployDir + "\public"
    if (-not (Test-Path $pub)) { New-Item -ItemType Directory -Force $pub | Out-Null }
    Copy-Item -Path "public\*" -Destination $pub -Recurse -Force
}

# 2e. .env.local (contains NEXTAUTH_SECRET, NEXTAUTH_URL, DATABASE_URL...)
Write-Info "Copying .env.local"
Copy-Item ".env.local" ($DeployDir + "\.env.local") -Force

# 2f. package.json + package-lock.json (required for npm ci on server)
Write-Info "Copying package.json + package-lock.json"
Copy-Item "package.json"      ($DeployDir + "\package.json")      -Force
Copy-Item "package-lock.json" ($DeployDir + "\package-lock.json") -Force
Write-OK "package.json / package-lock.json copied"

# 2g. prisma/schema.prisma (for prisma db push on server)
Write-Info "Copying prisma\schema.prisma"
$prismaDir = $DeployDir + "\prisma"
New-Item -ItemType Directory -Force $prismaDir | Out-Null
Copy-Item "prisma\schema.prisma" ($prismaDir + "\schema.prisma") -Force
Write-OK "prisma\schema.prisma copied"

# 2h. .htaccess (Passenger config)
Write-Info "Generating .htaccess"
$htaccess = "PassengerEnabled on`r`n" +
            "PassengerAppRoot /home/deyi0010/grubano.com`r`n" +
            "PassengerAppType node`r`n" +
            "PassengerStartupFile server.js`r`n" +
            "PassengerNodejs /home/deyi0010/nodevenv/grubano.com/24/bin/node`r`n" +
            "PassengerMaxPoolSize 2`r`n" +
            "PassengerMaxRequests 1000`r`n" +
            "PassengerStartTimeout 120`r`n"
[System.IO.File]::WriteAllText(
    (Join-Path (Get-Location) ($DeployDir + "\.htaccess")),
    $htaccess,
    [System.Text.Encoding]::ASCII
)
Write-OK ".htaccess generated"

# Safety check: no node_modules in deploy folder
if (Test-Path ($DeployDir + "\node_modules")) {
    Write-Err ("SAFETY: node_modules detected in " + $DeployDir + " -- CloudLinux will block extraction. Aborting.")
} else {
    Write-OK "Safety check passed: no node_modules in deploy folder"
}

Write-OK ("Folder " + $DeployDir + "\ ready")

# =============================================================================
# 3. CREATE grubano-deploy.zip
# =============================================================================
if (-not $NoZip) {
    Write-Step ("Creating " + $ZipFile + " (no node_modules)")

    if (Test-Path $ZipFile) { Remove-Item $ZipFile -Force }

    Compress-Archive -Path ($DeployDir + "\*") -DestinationPath $ZipFile -Force
    $sizeMb = [math]::Round((Get-Item $ZipFile).Length / 1MB, 1)
    Write-OK ($ZipFile + " created (" + $sizeMb + " MB)")

    # Verify: no node_modules entries in ZIP
    Write-Info "Verifying ZIP contents..."
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zipObj  = [System.IO.Compression.ZipFile]::OpenRead((Resolve-Path $ZipFile).Path)
    $nmCount = ($zipObj.Entries | Where-Object { $_.FullName -match "node_modules" }).Count
    $zipObj.Dispose()

    if ($nmCount -gt 0) {
        Write-Err ("SAFETY: " + $nmCount + " node_modules entries found in ZIP. CloudLinux will block extraction.")
    } else {
        Write-OK ("ZIP verified: 0 node_modules entries")
    }
}

# =============================================================================
# 4. SHOW FINAL STRUCTURE
# =============================================================================
Write-Step ("Final structure of " + $DeployDir + "\")

function Show-Tree {
    param($Dir, $Depth = 0, $MaxDepth = 3)
    if ($Depth -gt $MaxDepth) { return }
    $indent = "  " * $Depth
    Get-ChildItem -Path $Dir -Force |
        Where-Object { $_.Name -ne "node_modules" } |
        ForEach-Object {
            $tag   = if ($_.PSIsContainer) { "[DIR] " } else { "[FILE]" }
            $color = if ($_.PSIsContainer) { "White" } else { "Gray" }
            Write-Host ($indent + $tag + " " + $_.Name) -ForegroundColor $color
            if ($_.PSIsContainer) { Show-Tree -Dir $_.FullName -Depth ($Depth + 1) -MaxDepth $MaxDepth }
        }
}

Show-Tree -Dir $DeployDir
Write-Host "  (node_modules excluded -- install via npm ci on server)" -ForegroundColor DarkGray

# =============================================================================
# 5. SERVER INSTRUCTIONS
# =============================================================================
Write-Host ""
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  DEPLOY READY                                              " -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "  STEP 1 -- Upload ZIP via cPanel File Manager:" -ForegroundColor White
Write-Host "    1. cPanel > File Manager > /home/deyi0010/" -ForegroundColor DarkCyan
Write-Host ("    2. Upload " + $ZipFile) -ForegroundColor DarkCyan
Write-Host "    3. Extract to grubano.com/" -ForegroundColor DarkCyan
Write-Host ""
Write-Host "  STEP 2 -- Install dependencies (cPanel > Terminal):" -ForegroundColor White
Write-Host "    source ~/nodevenv/grubano.com/24/bin/activate" -ForegroundColor DarkCyan
Write-Host "    cd ~/grubano.com" -ForegroundColor DarkCyan
Write-Host "    npm ci --omit=dev" -ForegroundColor DarkCyan
Write-Host ""
Write-Host "  STEP 3 -- Push Prisma schema:" -ForegroundColor White
Write-Host "    bash ~/grubano.com/scripts/server/prisma-push.sh" -ForegroundColor DarkCyan
Write-Host ""
Write-Host "  STEP 4 -- Restart app:" -ForegroundColor White
Write-Host "    chmod -R 755 ~/grubano.com/.next/" -ForegroundColor DarkCyan
Write-Host "    touch ~/grubano.com/tmp/restart.txt" -ForegroundColor DarkCyan
Write-Host ""
Write-Host "  STEP 5 -- Verify:" -ForegroundColor White
Write-Host "    curl -I https://grubano.com/eat" -ForegroundColor DarkCyan
Write-Host ""
Write-Host "  [WARN] NEXTAUTH_SECRET and NEXTAUTH_URL must be in .env.local!" -ForegroundColor Yellow
Write-Host ""
