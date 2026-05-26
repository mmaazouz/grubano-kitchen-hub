# =============================================================================
# scripts/prepare-deploy.ps1 - Preparation du deploiement Grubano (Windows)
# =============================================================================
# Usage :
#   .\scripts\prepare-deploy.ps1              -> build + ZIP complet
#   .\scripts\prepare-deploy.ps1 -SkipBuild   -> reutilise le build existant
#   .\scripts\prepare-deploy.ps1 -NoZip       -> prepare deploy/ sans zipper
#
# IMPORTANT (CloudLinux o2switch) :
#   node_modules est EXCLU du ZIP.
#   Apres extraction sur le serveur, lancer :
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
# 1b. PATCH server.js — remplacer les chemins Windows codes en dur
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

$serverContent = Get-Content $serverJsPath -Raw
if ($serverContent -match 'C:\\\\Users|C:\\Users') {
    Write-Err "Chemin Windows toujours present dans $serverJsPath ! Deploiement annule."
} else {
    Write-OK "server.js est propre pour Linux (aucun chemin Windows)"
}

$match = [regex]::Match($serverContent, '"outputFileTracingRoot"\s*:\s*"([^"]*)"')
if ($match.Success) {
    Write-Info "outputFileTracingRoot = $($match.Groups[1].Value)"
}

# =============================================================================
# 2. PREPARER LE DOSSIER deploy/
# =============================================================================
Write-Step "Preparation de $DeployDir\"

if (Test-Path $DeployDir) {
    Write-Info "Suppression de l'ancien $DeployDir\"
    Remove-Item -Recurse -Force $DeployDir
}
New-Item -ItemType Directory -Force $DeployDir | Out-Null

# 2a. Contenu standalone (sans node_modules — CloudLinux bloque l'extraction de node_modules via ZIP)
Write-Info "Copie $BuildDir\* -> $DeployDir\ (hors node_modules)"
Copy-Item -Path "$BuildDir\*" -Destination $DeployDir -Recurse -Force
if (Test-Path "$DeployDir\node_modules") {
    Remove-Item -Recurse -Force "$DeployDir\node_modules"
    Write-OK "node_modules supprime du dossier deploy (CloudLinux: utiliser npm ci sur le serveur)"
}

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
    Write-Warn "$StaticDir introuvable - page blanche probable."
}

# 2d. public\ (favicon, images...)
if (Test-Path "public") {
    Write-Info "Copie public\ -> $DeployDir\public\"
    $pub = "$DeployDir\public"
    New-Item -ItemType Directory -Force $pub | Out-Null
    Copy-Item -Path "public\*" -Destination $pub -Recurse -Force
}

# 2e. .env.local (contient NEXTAUTH_SECRET, NEXTAUTH_URL, DATABASE_URL...)
Write-Info "Copie .env.local -> $DeployDir\"
Copy-Item ".env.local" "$DeployDir\.env.local" -Force

# 2f. package.json + package-lock.json (necessaires pour npm ci sur le serveur)
Write-Info "Copie package.json + package-lock.json -> $DeployDir\"
Copy-Item "package.json"      "$DeployDir\package.json"      -Force
Copy-Item "package-lock.json" "$DeployDir\package-lock.json" -Force
Write-OK "package.json / package-lock.json copies"

# 2g. prisma/schema.prisma (pour prisma db push sur le serveur)
Write-Info "Copie prisma\ -> $DeployDir\prisma\"
$prismaDir = "$DeployDir\prisma"
New-Item -ItemType Directory -Force $prismaDir | Out-Null
Copy-Item "prisma\schema.prisma" "$prismaDir\schema.prisma" -Force
Write-OK "prisma\schema.prisma copie"

# 2h. .htaccess Passenger
Write-Info "Generation .htaccess -> $DeployDir\"
$htaccess = @"
PassengerEnabled on
PassengerAppRoot /home/deyi0010/grubano.com
PassengerAppType node
PassengerStartupFile server.js
PassengerNodejs /home/deyi0010/nodevenv/grubano.com/24/bin/node
PassengerMaxPoolSize 2
PassengerMaxRequests 1000
PassengerStartTimeout 120
"@
Set-Content -Path "$DeployDir\.htaccess" -Value $htaccess -Encoding ASCII
Write-OK ".htaccess genere"

# Verification finale : pas de root node_modules dans le deploy
if (Test-Path "$DeployDir\node_modules") {
    Write-Err "SECURITE: node_modules detecte dans $DeployDir — CloudLinux va bloquer. Correction necessaire."
} else {
    Write-OK "Verification securite : pas de node_modules dans le ZIP"
}

Write-OK "Dossier $DeployDir\ pret"

# =============================================================================
# 3. CREER grubano-deploy.zip
# =============================================================================
if (-not $NoZip) {
    Write-Step "Creation de $ZipFile (sans node_modules)"

    if (Test-Path $ZipFile) { Remove-Item $ZipFile -Force }

    Compress-Archive -Path "$DeployDir\*" -DestinationPath $ZipFile -Force
    $sizeMb = [math]::Round((Get-Item $ZipFile).Length / 1MB, 1)
    Write-OK "$ZipFile cree ($sizeMb Mo)"

    # Verification : pas de node_modules dans le ZIP
    Write-Info "Verification du contenu du ZIP..."
    $zipEntries = [System.IO.Compression.ZipFile]::OpenRead((Resolve-Path $ZipFile).Path).Entries |
        Where-Object { $_.FullName -match "node_modules" }
    if ($zipEntries.Count -gt 0) {
        Write-Err "SECURITE: node_modules detecte dans le ZIP ($($zipEntries.Count) entrees). CloudLinux va bloquer."
    } else {
        Write-OK "ZIP propre : 0 entree node_modules"
    }
}

# =============================================================================
# 4. STRUCTURE FINALE deploy/
# =============================================================================
Write-Step "Structure du dossier $DeployDir\"

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
Write-Host "  (node_modules exclu — installer via npm ci sur le serveur)" -ForegroundColor DarkGray

# =============================================================================
# 5. INSTRUCTIONS UPLOAD O2SWITCH
# =============================================================================
Write-Host ""
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  [OK] DEPLOY PRET                                          " -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "  ETAPE 1 — Upload du ZIP via cPanel File Manager :" -ForegroundColor White
Write-Host "    1. cPanel > File Manager > /home/deyi0010/" -ForegroundColor DarkCyan
Write-Host "    2. Uploader $ZipFile" -ForegroundColor DarkCyan
Write-Host "    3. Extraire dans grubano.com/" -ForegroundColor DarkCyan
Write-Host ""
Write-Host "  ETAPE 2 — Installer les dependances (cPanel > Terminal) :" -ForegroundColor White
Write-Host "    source ~/nodevenv/grubano.com/24/bin/activate" -ForegroundColor DarkCyan
Write-Host "    cd ~/grubano.com" -ForegroundColor DarkCyan
Write-Host "    npm ci --omit=dev" -ForegroundColor DarkCyan
Write-Host ""
Write-Host "  ETAPE 3 — Pousser le schema Prisma :" -ForegroundColor White
Write-Host "    bash ~/grubano.com/scripts/server/prisma-push.sh" -ForegroundColor DarkCyan
Write-Host ""
Write-Host "  ETAPE 4 — Redemarrer l'application :" -ForegroundColor White
Write-Host "    chmod -R 755 ~/grubano.com/.next/" -ForegroundColor DarkCyan
Write-Host "    touch ~/grubano.com/tmp/restart.txt" -ForegroundColor DarkCyan
Write-Host ""
Write-Host "  ETAPE 5 — Verifier :" -ForegroundColor White
Write-Host "    curl -I https://grubano.com/eat" -ForegroundColor DarkCyan
Write-Host ""
Write-Host "  [WARN] NEXTAUTH_SECRET et NEXTAUTH_URL doivent etre dans .env.local !" -ForegroundColor Yellow
Write-Host ""
