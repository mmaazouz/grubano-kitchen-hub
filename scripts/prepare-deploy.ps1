# =============================================================================
# scripts/prepare-deploy.ps1 - Preparation du deploiement Grubano (Windows)
# =============================================================================
# Usage :
#   .\scripts\prepare-deploy.ps1              -> build + prepare deploy/ + ZIP
#   .\scripts\prepare-deploy.ps1 -SkipBuild   -> reutilise le build existant
#   .\scripts\prepare-deploy.ps1 -NoZip       -> prepare deploy/ sans zipper
#
# Prerequis : Node.js 18+, npm, PowerShell 5.1+
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
$ZipFile   = "deploy.zip"

# -- Helpers ------------------------------------------------------------------
function Write-Step { param($msg) Write-Host "`n>> $msg" -ForegroundColor Cyan }
function Write-OK   { param($msg) Write-Host "  [OK]   $msg" -ForegroundColor Green }
function Write-Warn { param($msg) Write-Host "  [WARN] $msg" -ForegroundColor Yellow }
function Write-Err  { param($msg) Write-Host "  [ERR]  $msg" -ForegroundColor Red; exit 1 }
function Write-Info { param($msg) Write-Host "  ->     $msg" -ForegroundColor Gray }

# =============================================================================
# 1. BUILD
# =============================================================================
Write-Step "Build Next.js 14 (standalone)"

if (-not (Test-Path ".env.local")) {
    Write-Err ".env.local manquant. Copie .env.local.example et remplis les valeurs."
}

if ($SkipBuild) {
    Write-Warn "Build ignore (-SkipBuild)"
    if (-not (Test-Path $BuildDir)) { Write-Err "Dossier $BuildDir introuvable. Lance sans -SkipBuild." }
} else {
    Write-Info "npm run build..."
    npm run build
    if ($LASTEXITCODE -ne 0) { Write-Err "npm run build a echoue (code $LASTEXITCODE)." }
    if (-not (Test-Path $BuildDir)) { Write-Err "Dossier $BuildDir introuvable apres build." }
    Write-OK "Build termine -> $BuildDir"
}

# =============================================================================
# 1b. PATCH server.js — remplacer les chemins Windows codés en dur
# =============================================================================
Write-Step "Patch server.js (chemins Windows -> Linux)"

$serverJsPath = "$BuildDir\server.js"
if (-not (Test-Path $serverJsPath)) {
    Write-Err "$serverJsPath introuvable. Le build standalone est incomplet."
}

Write-Info "Execution de scripts\fix-server.js..."
node scripts\fix-server.js
if ($LASTEXITCODE -ne 0) {
    Write-Err "fix-server.js a echoue (code $LASTEXITCODE). Voir erreur ci-dessus."
}

# Verification hard : aucun chemin Windows ne doit subsister
$serverContent = Get-Content $serverJsPath -Raw
if ($serverContent -match 'C:\\\\Users|C:\\Users') {
    Write-Err "Chemin Windows toujours present dans $serverJsPath ! Deploiement annule."
} else {
    Write-OK "server.js est propre pour Linux (aucun chemin Windows)"
}

# Afficher la valeur de outputFileTracingRoot apres patch
$match = [regex]::Match($serverContent, '"outputFileTracingRoot"\s*:\s*"([^"]*)"')
if ($match.Success) {
    Write-Info "outputFileTracingRoot = $($match.Groups[1].Value)"
} else {
    Write-Warn "outputFileTracingRoot non trouve dans server.js apres patch"
}

# =============================================================================
# 2. PREPARER LE DOSSIER deploy/
# =============================================================================
Write-Step "Preparation de $DeployDir\"

# Nettoyer et recreer
if (Test-Path $DeployDir) {
    Write-Info "Suppression de l'ancien $DeployDir\"
    Remove-Item -Recurse -Force $DeployDir
}
New-Item -ItemType Directory -Force $DeployDir | Out-Null

# 2a. Contenu standalone (node_modules, .next/server, package.json...)
Write-Info "Copie $BuildDir\* -> $DeployDir\"
Copy-Item -Path "$BuildDir\*" -Destination $DeployDir -Recurse -Force

# 2b. server.js Passenger (remplace le genere avec chemins hardcodes)
Write-Info "Copie server.js (wrapper Passenger) -> $DeployDir\"
Copy-Item "server.js" "$DeployDir\server.js" -Force

# 2c. .next\static\ (bundles CSS/JS - CRITIQUE pour eviter page blanche)
if (Test-Path $StaticDir) {
    Write-Info "Copie $StaticDir\ -> $DeployDir\.next\static\"
    $dest = "$DeployDir\.next\static"
    New-Item -ItemType Directory -Force $dest | Out-Null
    Copy-Item -Path "$StaticDir\*" -Destination $dest -Recurse -Force
    Write-OK ".next\static\ copie"
} else {
    Write-Warn "$StaticDir introuvable - page blanche probable. Lance npm run build d'abord."
}

# 2d. public\ (favicon, images...)
if (Test-Path "public") {
    Write-Info "Copie public\ -> $DeployDir\public\"
    $pub = "$DeployDir\public"
    if (-not (Test-Path $pub)) { New-Item -ItemType Directory -Force $pub | Out-Null }
    Copy-Item -Path "public\*" -Destination $pub -Recurse -Force
}

# 2e. .env.local
Write-Info "Copie .env.local -> $DeployDir\"
Copy-Item ".env.local" "$DeployDir\.env.local" -Force

Write-OK "Dossier $DeployDir\ pret"

# =============================================================================
# 3. CREER deploy.zip
# =============================================================================
if (-not $NoZip) {
    Write-Step "Creation de $ZipFile"

    if (Test-Path $ZipFile) { Remove-Item $ZipFile -Force }

    Compress-Archive -Path "$DeployDir\*" -DestinationPath $ZipFile -Force
    $sizeMb = [math]::Round((Get-Item $ZipFile).Length / 1MB, 1)
    Write-OK "$ZipFile cree ($sizeMb Mo)"
}

# =============================================================================
# 4. STRUCTURE FINALE deploy/
# =============================================================================
Write-Step "Structure du dossier $DeployDir\ (hors node_modules)"

function Show-Tree {
    param($Dir, $Depth = 0, $MaxDepth = 3)
    if ($Depth -gt $MaxDepth) { return }
    $indent = "  " * $Depth
    Get-ChildItem -Path $Dir -Force |
        Where-Object { $_.Name -ne "node_modules" } |
        ForEach-Object {
            $tag   = if ($_.PSIsContainer) { "[DIR] " } else { "[FILE]" }
            $color = if ($_.PSIsContainer) { "White" } else { "Gray" }
            Write-Host "$indent$tag $($_.Name)" -ForegroundColor $color
            if ($_.PSIsContainer) { Show-Tree -Dir $_.FullName -Depth ($Depth + 1) -MaxDepth $MaxDepth }
        }
}

Show-Tree -Dir $DeployDir

Write-Host ""
Write-Host "  [DIR]  node_modules\  (present, non affiche)" -ForegroundColor DarkGray

# =============================================================================
# 5. INSTRUCTIONS UPLOAD O2SWITCH
# =============================================================================
Write-Host ""
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  [OK] DEPLOY PRET - Instructions upload o2switch           " -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "  OPTION A - rsync via SSH (Linux/WSL, recommande) :" -ForegroundColor White
Write-Host "    rsync -avz --delete deploy/ deyi0010@<IP>:/home/deyi0010/grubano.com/" -ForegroundColor DarkCyan
Write-Host ""
Write-Host "  OPTION B - ZIP via cPanel :" -ForegroundColor White
Write-Host "    1. cPanel > File Manager" -ForegroundColor DarkCyan
Write-Host "    2. Naviguer dans /home/deyi0010/grubano.com/" -ForegroundColor DarkCyan
if (-not $NoZip) {
    Write-Host "    3. Uploader deploy.zip puis Extraire ici" -ForegroundColor DarkCyan
}
Write-Host ""
Write-Host "  CONFIGURATION cPanel > Setup Node.js App :" -ForegroundColor White
Write-Host "    * Node.js version  : 18.x / 20.x / 22.x" -ForegroundColor DarkCyan
Write-Host "    * App root         : /home/deyi0010/grubano.com" -ForegroundColor DarkCyan
Write-Host "    * App startup file : server.js   (wrapper Passenger)" -ForegroundColor DarkCyan
Write-Host "    * App URL          : app.grubano.com" -ForegroundColor DarkCyan
Write-Host "    * Cliquer Restart" -ForegroundColor DarkCyan
Write-Host ""
Write-Host "  [WARN] APRES chaque deploiement -> Restart dans cPanel !" -ForegroundColor Yellow
Write-Host ""
