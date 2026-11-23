# Builds the extension packages for every browser without needing Node.js.
# Same output as build.js:
#   letterboxd-dl-<version>.zip          Chrome, Edge, Opera, Brave (Load unpacked / Web Store)
#   letterboxd-dl-<version>-firefox.zip  Firefox (AMO upload / about:debugging)
#   letterboxd-dl-<version>-safari.zip   Safari (convert on a Mac, see build-safari.sh)
#
# Usage (from the repo root):
#   powershell -ExecutionPolicy Bypass -File build.ps1

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem

$root = $PSScriptRoot
$extDir = Join-Path $root "extension"
$version = (Get-Content (Join-Path $extDir "manifest.chrome.json") -Raw | ConvertFrom-Json).version

$targets = @(
  @{ Manifest = "manifest.chrome.json";  Output = "letterboxd-dl-$version.zip" },
  @{ Manifest = "manifest.firefox.json"; Output = "letterboxd-dl-$version-firefox.zip" },
  @{ Manifest = "manifest.safari.json";  Output = "letterboxd-dl-$version-safari.zip" }
)

# Every manifest variant (and the dev manifest.json) is skipped; the chosen one is
# added as manifest.json.
function Test-ManifestFile($file) {
  return $file.DirectoryName -eq $extDir -and $file.Name -match '^manifest(\..+)?\.json$'
}

foreach ($target in $targets) {
  $manifestPath = Join-Path $extDir $target.Manifest
  $manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json
  if ($manifest.version -ne $version) {
    throw "$($target.Manifest) has version $($manifest.version), expected $version"
  }

  $zipPath = Join-Path $root $target.Output
  if (Test-Path $zipPath) { Remove-Item $zipPath -Confirm:$false }

  $archive = [IO.Compression.ZipFile]::Open($zipPath, "Create")
  try {
    Get-ChildItem $extDir -Recurse -File |
      Where-Object { -not (Test-ManifestFile $_) } |
      ForEach-Object {
        # Zip entries must use forward slashes, or macOS/Linux unzip breaks folders.
        $entry = $_.FullName.Substring($extDir.Length + 1).Replace("\", "/")
        [void][IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $_.FullName, $entry, "Optimal")
      }
    [void][IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $manifestPath, "manifest.json", "Optimal")
  }
  finally {
    $archive.Dispose()
  }

  Write-Host "Created $($target.Output)"
}

Write-Host "Done."
