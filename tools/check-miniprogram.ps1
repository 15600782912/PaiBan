param([string]$DevToolsPath = 'C:\Program Files (x86)\Tencent\微信web开发者工具')
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$miniRoot = Join-Path $projectRoot 'miniprogram'
if (!(Test-Path -LiteralPath $DevToolsPath)) {
    $runningTool = Get-Process -ErrorAction SilentlyContinue | Where-Object {
        $_.ProcessName -eq '微信开发者工具' -and $_.Path
    } | Select-Object -First 1
    if ($runningTool) { $DevToolsPath = Split-Path -Parent $runningTool.Path }
}
$compilerDir = @(
    (Join-Path $DevToolsPath 'code\package.nw\node_modules\wcc-exec'),
    (Join-Path $DevToolsPath 'resources\app.asar.unpacked\node_modules\wcc-exec')
) | Where-Object { Test-Path -LiteralPath (Join-Path $_ 'wcc.exe') } | Select-Object -First 1
if (!$compilerDir) { throw 'WeChat native compilers not found. Supply -DevToolsPath.' }
$wccPath = Join-Path $compilerDir 'wcc.exe'
$wcscPath = Join-Path $compilerDir 'wcsc.exe'
if (!(Test-Path -LiteralPath $wccPath) -or !(Test-Path -LiteralPath $wcscPath)) {
    throw 'WeChat native compilers not found. Supply -DevToolsPath.'
}
Get-ChildItem -LiteralPath $miniRoot -Recurse -File -Filter '*.js' | ForEach-Object {
    & node --check $_.FullName
    if ($LASTEXITCODE -ne 0) { throw "Invalid JavaScript: $($_.FullName)" }
}
Get-ChildItem -LiteralPath $miniRoot -Recurse -File -Filter '*.json' | ForEach-Object {
    Get-Content -LiteralPath $_.FullName -Raw | ConvertFrom-Json | Out-Null
}
$uniqueName = 'zhubo-check-' + [Guid]::NewGuid().ToString('N')
$wxmlOutput = Join-Path ([IO.Path]::GetTempPath()) ($uniqueName + '-wxml.js')
$wxssOutput = Join-Path ([IO.Path]::GetTempPath()) ($uniqueName + '-wxss.js')
Push-Location $miniRoot
try {
    $wxmlFiles = @(Get-ChildItem -LiteralPath @('pages','components') -Recurse -File -Filter '*.wxml' | ForEach-Object {
        $_.FullName.Substring($miniRoot.Length + 1).Replace('\', '/')
    })
    & $wccPath @wxmlFiles -o $wxmlOutput
    if ($LASTEXITCODE -ne 0) { throw 'WXML compilation failed' }
    $wxssFiles = @('app.wxss') + @(Get-ChildItem -LiteralPath @('pages','components') -Recurse -File -Filter '*.wxss' | ForEach-Object {
        $_.FullName.Substring($miniRoot.Length + 1).Replace('\', '/')
    })
    & $wcscPath -pc $wxssFiles.Count @wxssFiles -o $wxssOutput
    if ($LASTEXITCODE -ne 0) { throw 'WXSS compilation failed' }
    Write-Output 'JavaScript, JSON, native WXML and WXSS checks passed.'
} finally {
    Pop-Location
    foreach ($temporaryFile in @($wxmlOutput, $wxssOutput)) {
        if (Test-Path -LiteralPath $temporaryFile) { Remove-Item -LiteralPath $temporaryFile }
    }
}
