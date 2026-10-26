<#
.SYNOPSIS
  Builds the desktop app's signed .msixbundle (x64 + Arm64) with winapp CLI (design section 9.2).

.PARAMETER Variant
  Release: the Store package (Identity msmsrep.Text-to-SVGDiagramsforExcel, Release build).
  Dev: the development package (Identity ...Dev, display name "(Dev)", Debug build with DevTools).

.PARAMETER CertPath
  Self-signed .pfx whose subject is the Store Publisher (create it once with
  "winapp cert generate --manifest desktop/package/Package.appxmanifest ...").

.PARAMETER CertPassword
  The .pfx password. Defaults to the MSIX_CERT_PASSWORD environment variable.

.PARAMETER Publish
  Release only: submits the bundle to the Store (winapp store publish).

.EXAMPLE
  ./desktop/package/pack.ps1 -Variant Dev -CertPath C:\certs\textsvg.pfx
#>
[CmdletBinding()]
param(
    [ValidateSet('Release', 'Dev')]
    [string]$Variant = 'Dev',
    [string]$CertPath = (Join-Path $PSScriptRoot 'cert\TextToSvgDiagramsForExcel.pfx'),
    [string]$CertPassword = $env:MSIX_CERT_PASSWORD,
    [ValidateSet('x64', 'arm64')]
    [string[]]$Arch = @('x64', 'arm64'),
    [switch]$Publish
)

$ErrorActionPreference = 'Stop'
$StoreAppId = '9N78SZM66WM9'
$Root = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$Project = Join-Path $Root 'desktop\src\TextToSvgDiagramsForExcel.Desktop\TextToSvgDiagramsForExcel.Desktop.csproj'
$Out = Join-Path $Root "desktop\out\$Variant"

function Invoke-Checked([string]$Command, [string[]]$Arguments) {
    # PowerShell decodes the piped output with the console's encoding (Shift_JIS
    # on Japanese Windows), but npm writes UTF-8. With the console in UTF-8,
    # dotnet and winapp write UTF-8 too, so every tool's text shows correctly.
    $consoleEncoding = [Console]::OutputEncoding
    [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
    try {
        # To the host, so the tools' output does not become the caller's return values.
        & $Command @Arguments | Out-Host
    } finally {
        [Console]::OutputEncoding = $consoleEncoding
    }
    if ($LASTEXITCODE -ne 0) {
        throw "$Command failed with exit code $LASTEXITCODE"
    }
}

if (-not (Test-Path $CertPath)) {
    throw "Certificate not found: $CertPath (packages are always signed; see design section 9.3)."
}
if (-not $CertPassword) {
    throw 'Set -CertPassword or MSIX_CERT_PASSWORD.'
}
if ($Publish -and $Variant -ne 'Release') {
    throw 'Only the Release package can be published.'
}

$version = (Get-Content (Join-Path $Root 'package.json') -Raw | ConvertFrom-Json).version
# The Store requires the fourth part of the version to be 0.
$version4 = "$version.0"
$configuration = if ($Variant -eq 'Release') { 'Release' } else { 'Debug' }

if (Test-Path $Out) {
    Remove-Item $Out -Recurse -Force
}
New-Item -ItemType Directory -Force $Out | Out-Null

# 1. The rendering engine (web/).
Push-Location $Root
try {
    Invoke-Checked 'npm' @('run', 'build:engine')
} finally {
    Pop-Location
}

# 2. One self-contained folder per architecture, with the package images.
$folders = foreach ($a in $Arch) {
    $folder = Join-Path $Out $a
    Invoke-Checked 'dotnet' @('publish', $Project, '-c', $configuration, '-r', "win-$a", '--self-contained',
        '-p:SkipEngineBuild=true', '-o', $folder)
    Copy-Item (Join-Path $PSScriptRoot 'Images') (Join-Path $folder 'Images') -Recurse -Force
    $folder
}

# 3. The manifest for this variant.
[xml]$manifest = Get-Content (Join-Path $PSScriptRoot 'Package.appxmanifest') -Raw
$ns = New-Object System.Xml.XmlNamespaceManager $manifest.NameTable
$ns.AddNamespace('m', 'http://schemas.microsoft.com/appx/manifest/foundation/windows10')
$ns.AddNamespace('uap', 'http://schemas.microsoft.com/appx/manifest/uap/windows10')
$identity = $manifest.SelectSingleNode('/m:Package/m:Identity', $ns)
$identity.Version = $version4
$fileName = 'TextToSvgDiagramsForExcel'
if ($Variant -eq 'Dev') {
    # A separate identity, so it installs next to the Store version with its own data.
    $identity.Name = "$($identity.Name).Dev"
    $manifest.SelectSingleNode('/m:Package/m:Properties/m:DisplayName', $ns).InnerText += ' (Dev)'
    $visual = $manifest.SelectSingleNode('//uap:VisualElements', $ns)
    $visual.DisplayName += ' (Dev)'
    $fileName += '.Dev'
}
$manifestPath = Join-Path $Out 'Package.appxmanifest'
$manifest.Save($manifestPath)

# 4. Bundle and sign (each folder's architecture comes from its executable).
#    One architecture makes a plain .msix instead of a bundle.
$bundle = if ($folders.Count -gt 1) {
    Join-Path $Out "${fileName}_$version4.msixbundle"
} else {
    Join-Path $Out "${fileName}_${version4}_$($Arch[0]).msix"
}
Invoke-Checked 'winapp' (@('package') + $folders + @('--manifest', $manifestPath, '--cert', $CertPath,
    '--cert-password', $CertPassword, '--output', $bundle))
Write-Host "Created $bundle"

# 5. Store submission (the first submission and the listing are made in Partner Center).
if ($Publish) {
    Invoke-Checked 'winapp' @('store', 'publish', $bundle, '--appId', $StoreAppId)
}
