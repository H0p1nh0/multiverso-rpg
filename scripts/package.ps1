$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$manifestPath = Join-Path $root 'system.json'
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
$repo = 'https://github.com/H0p1nh0/multiverso-rpg'

if ($manifest.id -cne 'multiverso-rpg' -or $manifest.version -cnotmatch '^[0-9]+\.[0-9]+\.[0-9]+$') {
    throw 'ID ou versão inválidos no system.json.'
}
$tag = "v$($manifest.version)"
$zipName = 'multiverso-rpg.zip'
if ($manifest.url -cne $repo -or
    $manifest.manifest -cne "$repo/releases/latest/download/system.json" -or
    $manifest.download -cne "$repo/releases/download/$tag/$zipName") {
    throw 'As URLs de publicação não correspondem ao repositório e à versão.'
}

$paths = @(git -C $root -c core.quotepath=false ls-files --cached -- main.mjs system.json lang module styles templates)
if ($LASTEXITCODE -ne 0) { throw 'Falha ao listar os arquivos do sistema.' }
$required = @('system.json') + $manifest.esmodules + $manifest.styles + @($manifest.languages.path)
foreach ($path in $required) {
    if ($paths -cnotcontains $path) { throw "Arquivo do manifesto ausente do Git: $path" }
}
foreach ($path in $paths) {
    $file = Get-Item -LiteralPath (Join-Path $root $path)
    if ($file.PSIsContainer -or $file.LinkType) {
        throw "O pacote exige um arquivo regular: $path"
    }
}

$dist = Join-Path $root 'dist'
$null = New-Item -ItemType Directory -Path $dist -Force
$zipPath = Join-Path $dist $zipName
$stream = [System.IO.File]::Open($zipPath, [System.IO.FileMode]::Create)
try {
    $zip = [System.IO.Compression.ZipArchive]::new($stream, 'Create', $true)
    try {
        foreach ($path in $paths) {
            $null = [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
                $zip, (Join-Path $root $path), $path, 'Optimal'
            )
        }
    } finally {
        $zip.Dispose()
    }
} finally {
    $stream.Dispose()
}

Copy-Item -LiteralPath $manifestPath -Destination (Join-Path $dist 'system.json')
Write-Output "Pacote $tag criado em $dist ($($paths.Count) arquivos no ZIP)."
