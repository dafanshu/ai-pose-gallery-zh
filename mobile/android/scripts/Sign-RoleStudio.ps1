[CmdletBinding()]
param(
    [string]$Apk = (Join-Path $PSScriptRoot 'role-studio-unsigned.apk'),
    [string]$BuildToolsDir,
    [string]$KeyDir = (Join-Path $env:USERPROFILE 'RoleStudioSigning')
)
$ErrorActionPreference = 'Stop'
$Apk = (Resolve-Path -LiteralPath $Apk).Path
$folder = Split-Path -Parent $Apk
$checksum = @(Get-Content -LiteralPath (Join-Path $folder 'SHA256SUMS.txt'))
if ($checksum.Count -ne 1 -or $checksum[0] -notmatch '^([0-9a-fA-F]{64})\s+\*?role-studio-unsigned\.apk$') {
    throw 'Invalid checksum file. Use the original Actions artifact.'
}
$expectedHash = $Matches[1]
if ((Get-FileHash -Algorithm SHA256 -LiteralPath $Apk).Hash -ne $expectedHash) { throw 'APK checksum mismatch.' }

if (-not $BuildToolsDir) {
    $sdk = if ($env:ANDROID_HOME) { $env:ANDROID_HOME } elseif ($env:ANDROID_SDK_ROOT) { $env:ANDROID_SDK_ROOT } else { Join-Path $env:LOCALAPPDATA 'Android\Sdk' }
    $tools = Get-ChildItem -LiteralPath (Join-Path $sdk 'build-tools') -Directory |
        Where-Object { $_.Name -match '^\d+\.\d+\.\d+$' -and (Test-Path (Join-Path $_.FullName 'apksigner.bat')) } |
        Sort-Object { [version]$_.Name } -Descending | Select-Object -First 1
    if (-not $tools) { throw 'Install Android SDK Build-Tools 35 or newer, or pass -BuildToolsDir.' }
    $BuildToolsDir = $tools.FullName
}
$BuildToolsDir = (Resolve-Path -LiteralPath $BuildToolsDir).Path
$signer = Join-Path $BuildToolsDir 'apksigner.bat'
$align = Join-Path $BuildToolsDir 'zipalign.exe'
$aapt = Join-Path $BuildToolsDir 'aapt.exe'
foreach ($tool in @($signer, $align, $aapt)) { if (-not (Test-Path -LiteralPath $tool -PathType Leaf)) { throw "Missing tool: $tool" } }
$badging = (& $aapt dump badging $Apk) -join "`n"
if ($LASTEXITCODE -ne 0 -or $badging -notmatch "(?m)^package: name='com\.dafanshu\.rolestudio' versionCode='([0-9]+)'") { throw 'Wrong package.' }
$version = [int]$Matches[1]
if ($version -le 1000 -or $badging -match '(?m)^application-debuggable') { throw 'Use the unsigned personal release, not a debug APK.' }
$out = Join-Path $folder "role-studio-personal-$version.apk"
if (Test-Path -LiteralPath $out) { throw "Output already exists: $out" }

$keystore = Join-Path $KeyDir 'role-studio-release.p12'
$pin = Join-Path $KeyDir 'certificate-sha256.txt'
if (-not (Test-Path -LiteralPath $keystore -PathType Leaf)) {
    if (Test-Path -LiteralPath $pin) { throw 'Existing signing key missing. Restore your backup; do not create a replacement key.' }
    throw 'Signing key missing. Generate it once using docs/ANDROID-PERSONAL-SIGNING.md.'
}
if (Test-Path -LiteralPath $pin) {
    $pinned = (Get-Content -Raw -LiteralPath $pin).Trim()
    if ($pinned -notmatch '^[0-9a-fA-F]{64}$') { throw 'Invalid pinned certificate fingerprint.' }
}
$temp = Join-Path $folder ('.signing-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $temp | Out-Null
try {
    $aligned = Join-Path $temp 'aligned.apk'
    $signed = Join-Path $temp 'signed.apk'
    & $align -P 16 -f 4 $Apk $aligned
    if ($LASTEXITCODE -ne 0) { throw 'APK alignment failed.' }
    # apksigner prompts via console; passwords are not passed in parameters or environment.
    & $signer sign --ks $keystore --ks-key-alias role-studio --v4-signing-enabled false --out $signed $aligned
    if ($LASTEXITCODE -ne 0) { throw 'APK signing failed.' }
    $verified = (& $signer verify --print-certs $signed) -join "`n"
    if ($LASTEXITCODE -ne 0 -or $verified -notmatch '(?im)^Signer #1 certificate SHA-256 digest: ([a-f0-9]{64})\s*$') { throw 'APK certificate verification failed.' }
    $fingerprint = $Matches[1].ToLowerInvariant()
    if ($pinned -and $pinned -ne $fingerprint) { throw 'Signing certificate changed. Restore the original keystore.' }
    if (-not $pinned) { Set-Content -LiteralPath $pin -Encoding ascii -Value $fingerprint }
    Move-Item -LiteralPath $signed -Destination $out
    Write-Host "Signed APK: $out"
    Write-Host "Certificate SHA-256: $fingerprint"
} finally {
    Remove-Item -LiteralPath $temp -Recurse -Force
}
