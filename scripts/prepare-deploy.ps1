# =============================================================================
# scripts/prepare-deploy.ps1 - Grubano deployment preparation (Windows)
# =============================================================================
# Usage:
#   .\scripts\prepare-deploy.ps1              -> build + ZIP
#   .\scripts\prepare-deploy.ps1 -SkipBuild   -> reuse existing build
#   .\scripts\prepare-deploy.ps1 -NoZip       -> prepare deploy/ without zipping
#
# NOTE:
#   .next/standalone/ has its own trimmed node_modules (contains next, etc.).
#   This is NOT the root node_modules. We copy it as-is into the ZIP.
#   No npm ci needed on server -- everything is bundled by standalone build.
# =============================================================================

param(
    [switch]$SkipBuild,
    [switch]$NoZip
)

$ErrorActionPreference = "Stop"

# -- Config -------------------------------------------------------------------
$StandaloneDir = ".next\standalone"
$StaticDir     = ".next\static"
$DeployDir     = "deploy-temp"
$ZipFile       = "grubano-deploy.zip"

# -- Helpers ------------------------------------------------------------------
function Write-Step { param($msg) Write-Host ("`n>> " + $msg) -ForegroundColor Cyan }
function Write-OK   { param($msg) Write-Host ("  [OK]   " + $msg) -ForegroundColor Green }
function Write-Warn { param($msg) Write-Host ("  [WARN] " + $msg) -ForegroundColor Yellow }
function Write-Err  { param($msg) Write-Host ("  [ERR]  " + $msg) -ForegroundColor Red; exit 1 }
function Write-Info { param($msg) Write-Host ("  ->     " + $msg) -ForegroundColor Gray }

# =============================================================================
# 1. BUILD
# =============================================================================
Write-Step "Build Next.js (standalone)"

if (-not (Test-Path ".env.local")) {
    Write-Err ".env.local missing. Copy .env.local.example and fill in values."
}

if ($SkipBuild) {
    Write-Warn "Build skipped (-SkipBuild)"
    if (-not (Test-Path $StandaloneDir)) {
        Write-Err ("Folder " + $StandaloneDir + " not found. Run without -SkipBuild.")
    }
} else {
    Write-Info "Running npm run build..."
    npm run build
    if ($LASTEXITCODE -ne 0) {
        Write-Err ("npm run build failed (exit code " + $LASTEXITCODE + ").")
    }
    if (-not (Test-Path $StandaloneDir)) {
        Write-Err ("Folder " + $StandaloneDir + " not found after build. Check next.config.js has output: standalone.")
    }
    Write-OK ("Build complete -> " + $StandaloneDir)
}

# =============================================================================
# 1b. PATCH server.js -- replace hardcoded Windows paths with Linux paths
# =============================================================================
Write-Step "Patch server.js (Windows paths -> Linux)"

$serverJsPath = $StandaloneDir + "\server.js"
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
    Write-OK "server.js is clean (no Windows paths)"
}

# =============================================================================
# 2. PREPARE deploy-temp/ FOLDER
# =============================================================================
Write-Step ("Preparing " + $DeployDir + "\")

# Clean slate
Remove-Item -Recurse -Force $DeployDir -ErrorAction SilentlyContinue
Remove-Item -Force $ZipFile -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $DeployDir | Out-Null

# 2a. Copy entire standalone output -- INCLUDING its own node_modules
# .next/standalone/node_modules is a trimmed set built by Next.js standalone.
# It contains next, react, and all runtime packages. It is NOT the root
# node_modules. The server REQUIRES this to start. Do not delete it.
Write-Info ("Copying " + $StandaloneDir + "\* -> " + $DeployDir + "\ (including standalone node_modules)")
Copy-Item -Recurse -Force ($StandaloneDir + "\*") ($DeployDir + "\")
Write-OK "Standalone output copied (with node_modules)"

# Verify node_modules/next is present
if (-not (Test-Path ($DeployDir + "\node_modules\next"))) {
    Write-Err ("node_modules\next missing from standalone output. Build may have failed or output is not standalone mode.")
}
Write-OK "node_modules\next verified present"

# 2b. .next/static/ -- CSS/JS bundles (not inside standalone by default)
if (Test-Path $StaticDir) {
    Write-Info ("Copying " + $StaticDir + "\ -> " + $DeployDir + "\.next\static\")
    New-Item -ItemType Directory -Force -Path ($DeployDir + "\.next\static") | Out-Null
    Copy-Item -Recurse -Force ($StaticDir + "\*") ($DeployDir + "\.next\static\")
    Write-OK ".next\static copied"
} else {
    Write-Warn ($StaticDir + " not found -- blank page likely. Run npm run build first.")
}

# 2c. .env.local (runtime secrets: NEXTAUTH_SECRET, DATABASE_URL, etc.)
Write-Info "Copying .env.local"
Copy-Item -Force ".env.local" ($DeployDir + "\.env.local")
Write-OK ".env.local copied"

# 2d. prisma/schema.prisma (for prisma db push on server)
Write-Info "Copying prisma\schema.prisma"
New-Item -ItemType Directory -Force -Path ($DeployDir + "\prisma") | Out-Null
Copy-Item -Force "prisma\schema.prisma" ($DeployDir + "\prisma\schema.prisma")
Write-OK "prisma\schema.prisma copied"

# 2e. public/ (favicon, images, static assets)
if (Test-Path "public") {
    Write-Info "Copying public\"
    New-Item -ItemType Directory -Force -Path ($DeployDir + "\public") | Out-Null
    Copy-Item -Recurse -Force "public\*" ($DeployDir + "\public\")
    Write-OK "public\ copied"
}

# 2f. .htaccess (Passenger config) -- ASCII, no BOM
Write-Info "Generating .htaccess"
$htaccess = "PassengerEnabled on`n" +
            "PassengerAppRoot /home/deyi0010/grubano.com`n" +
            "PassengerAppType node`n" +
            "PassengerStartupFile server.js`n" +
            "PassengerNodejs /home/deyi0010/nodevenv/grubano.com/24/bin/node`n" +
            "PassengerMaxPoolSize 2`n" +
            "PassengerMaxRequests 1000`n" +
            "PassengerStartTimeout 120`n"
[System.IO.File]::WriteAllText(
    (Join-Path (Get-Location) ($DeployDir + "\.htaccess")),
    $htaccess,
    [System.Text.Encoding]::ASCII
)
Write-OK ".htaccess generated"

Write-OK ($DeployDir + "\ ready")

# =============================================================================
# 3. CREATE grubano-deploy.zip
# =============================================================================
if (-not $NoZip) {
    Write-Step ("Creating " + $ZipFile)

    Compress-Archive -Path ($DeployDir + "\*") -DestinationPath $ZipFile -Force

    $sizeMb = [math]::Round((Get-Item $ZipFile).Length / 1MB, 1)
    Write-OK ($ZipFile + " created (" + $sizeMb + " MB)")

    # Size sanity check -- standalone build with trimmed node_modules is typically 30-100 MB
    if ($sizeMb -lt 30) {
        Write-Warn ("ZIP is only " + $sizeMb + " MB -- standalone node_modules may be missing.")
    }

    # Verify node_modules/next is in ZIP
    # Compress-Archive on Windows uses backslashes in ZIP entry paths.
    Write-Info "Verifying ZIP contains node_modules\next..."
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zipObj  = [System.IO.Compression.ZipFile]::OpenRead((Resolve-Path $ZipFile).Path)
    $hasNext = ($zipObj.Entries | Where-Object { $_.FullName -like "node_modules\next\*" } | Select-Object -First 1)

    # Show ZIP top-level content tree (unique first-level entries, skip deep node_modules)
    Write-Host ""
    Write-Host "  ZIP content (top 2 levels):" -ForegroundColor Cyan
    $zipObj.Entries |
        ForEach-Object { $_.FullName -replace '[\\/].*', '' } |
        Sort-Object -Unique |
        ForEach-Object { Write-Host ("    [DIR] " + $_) -ForegroundColor White }
    Write-Host ""
    $zipObj.Entries |
        Where-Object { $_.FullName -notmatch '[/\\]' } |
        ForEach-Object { Write-Host ("    [FILE] " + $_.FullName) -ForegroundColor Gray }

    $zipObj.Dispose()

    if ($hasNext) {
        Write-OK ("ZIP verified: node_modules\next present (" + $sizeMb + " MB)")
    } else {
        Write-Err ("node_modules\next NOT found in ZIP. Standalone build may be missing its node_modules.")
    }
}

# =============================================================================
# 4. SHOW FINAL STRUCTURE (top 3 levels, no deep node_modules)
# =============================================================================
Write-Step ("Final structure of " + $DeployDir + "\")

function Show-Tree {
    param($Dir, $Depth = 0, $MaxDepth = 2)
    if ($Depth -gt $MaxDepth) { return }
    $indent = "  " * $Depth
    Get-ChildItem -Path $Dir -Force |
        ForEach-Object {
            $tag   = if ($_.PSIsContainer) { "[DIR] " } else { "[FILE]" }
            $color = if ($_.PSIsContainer) { "White" } else { "Gray" }
            Write-Host ($indent + $tag + " " + $_.Name) -ForegroundColor $color
            if ($_.PSIsContainer -and $_.Name -ne "node_modules") {
                Show-Tree -Dir $_.FullName -Depth ($Depth + 1) -MaxDepth $MaxDepth
            }
        }
}

Show-Tree -Dir $DeployDir

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
Write-Host "  STEP 2 -- Set permissions (cPanel > Terminal):" -ForegroundColor White
Write-Host "    chmod -R 755 ~/grubano.com/.next/" -ForegroundColor DarkCyan
Write-Host "    chmod 600    ~/grubano.com/.env.local" -ForegroundColor DarkCyan
Write-Host "    touch        ~/grubano.com/tmp/restart.txt" -ForegroundColor DarkCyan
Write-Host ""
Write-Host "  STEP 3 -- Push Prisma schema (first deploy or schema changes):" -ForegroundColor White
Write-Host "    bash ~/grubano.com/scripts/server/prisma-push.sh" -ForegroundColor DarkCyan
Write-Host ""
Write-Host "  STEP 4 -- Verify:" -ForegroundColor White
Write-Host "    curl -I https://grubano.com/eat" -ForegroundColor DarkCyan
Write-Host ""
Write-Host "  NOTE: node_modules is bundled inside the ZIP (standalone build)." -ForegroundColor Yellow
Write-Host "  No npm ci needed on the server." -ForegroundColor Yellow
Write-Host ""
