# Inicio de la demo local: Anvil, despliegue y Vite.
$ErrorActionPreference = "Stop"
$demoRoot = [System.IO.Path]::GetFullPath($PSScriptRoot)
$demoRuntime = Join-Path $demoRoot ".demo"
$demoStateFile = Join-Path $demoRuntime "processes.json"

function Resolve-FoundryTool([string]$toolName) {
    if ($env:FOUNDRY_BIN) {
        $toolPath = Join-Path $env:FOUNDRY_BIN "$toolName.exe"
        if (!(Test-Path -LiteralPath $toolPath)) { throw "FOUNDRY_BIN no contiene $toolName.exe: $env:FOUNDRY_BIN" }
        return (Resolve-Path -LiteralPath $toolPath).Path
    }
    $toolPath = Join-Path $env:USERPROFILE ".foundry\bin\$toolName.exe"
    if (Test-Path -LiteralPath $toolPath) { return $toolPath }
    $toolCommand = Get-Command "$toolName.exe" -CommandType Application -ErrorAction SilentlyContinue
    if ($toolCommand) { return $toolCommand.Source }
    throw "No se encontro $toolName.exe. Instala Foundry en $env:USERPROFILE\.foundry\bin, agregalo al PATH o configura FOUNDRY_BIN. Consulta README.md."
}

function Save-DemoProcesses {
    $records = @($demoProcesses | ForEach-Object {
        @{ id = $_.Id; startedUtcTicks = $_.StartTime.ToUniversalTime().Ticks.ToString(); executable = $_.Path }
    })
    @{ workspace = $demoRoot; processes = $records } | ConvertTo-Json -Depth 4 |
        Set-Content -LiteralPath $demoStateFile -Encoding UTF8
}

function Wait-DemoPort([int]$port, [System.Diagnostics.Process]$demoProcess) {
    for ($attempt = 0; $attempt -lt 60; $attempt++) {
        if ($demoProcess.HasExited) { throw "El proceso de la demo termino antes de abrir el puerto $port. Revisa los logs en .demo." }
        $listener = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
            Where-Object { $_.OwningProcess -eq $demoProcess.Id }
        if ($listener) { return }
        Start-Sleep -Milliseconds 250
    }
    throw "La demo no abrio el puerto $port a tiempo. Revisa los logs en .demo."
}

$forgePath = Resolve-FoundryTool "forge"
$anvilPath = Resolve-FoundryTool "anvil"
$nodePath = (Get-Command node.exe -CommandType Application -ErrorAction Stop).Source
$npmPath = (Get-Command npm.cmd -CommandType Application -ErrorAction Stop).Source
foreach ($port in @(8545, 3000)) {
    if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) {
        throw "El puerto $port ya esta ocupado. Si pertenece a esta demo, ejecuta .\stop-demo.ps1. Se requiere un nodo limpio y el puerto web 3000 libre."
    }
}
if (Test-Path -LiteralPath $demoStateFile) {
    throw "Existe un registro de una demo anterior. Ejecuta .\stop-demo.ps1 para cerrarla o limpiar su registro antes de iniciar otra."
}

$webRoot = Join-Path $demoRoot "web"
if (!(Test-Path -LiteralPath (Join-Path $webRoot "node_modules"))) {
    Push-Location $webRoot
    try {
        & $npmPath ci
        if ($LASTEXITCODE -ne 0) { throw "No se pudieron instalar las dependencias web." }
    } finally { Pop-Location }
}

New-Item -ItemType Directory -Path $demoRuntime -Force | Out-Null
$demoProcesses = @()
try {
    Write-Host "1. Iniciando Anvil en http://127.0.0.1:8545 ..." -ForegroundColor Cyan
    $demoNode = Start-Process -FilePath $anvilPath -ArgumentList "--host 127.0.0.1 --port 8545" -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput (Join-Path $demoRuntime "anvil.log") -RedirectStandardError (Join-Path $demoRuntime "anvil-error.log")
    $demoProcesses += $demoNode
    Save-DemoProcesses
    Wait-DemoPort 8545 $demoNode

    Write-Host "2. Desplegando contratos y circulos de ejemplo..." -ForegroundColor Cyan
    Push-Location (Join-Path $demoRoot "foundry")
    $demoPreviousPrivateKey = $env:PRIVATE_KEY
    try {
        # Solo para esta demo: garantiza las direcciones deterministas usadas por la interfaz.
        $env:PRIVATE_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
        & $forgePath script script/Deploy.s.sol --rpc-url http://127.0.0.1:8545 --broadcast
        if ($LASTEXITCODE -ne 0) { throw "Fallo el despliegue de contratos." }
    } finally {
        $env:PRIVATE_KEY = $demoPreviousPrivateKey
        Pop-Location
    }

    Write-Host "3. Iniciando interfaz en http://localhost:3000 ..." -ForegroundColor Cyan
    $demoWeb = Start-Process -FilePath $nodePath -ArgumentList "node_modules/vite/bin/vite.js --host 127.0.0.1 --port 3000 --strictPort" `
        -WorkingDirectory $webRoot -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput (Join-Path $demoRuntime "web.log") -RedirectStandardError (Join-Path $demoRuntime "web-error.log")
    $demoProcesses += $demoWeb
    Save-DemoProcesses
    Wait-DemoPort 3000 $demoWeb
    Write-Host "Demo lista: http://localhost:3000. Para detenerla: .\stop-demo.ps1. Logs: .demo" -ForegroundColor Green
} catch {
    foreach ($demoProcess in $demoProcesses) {
        if (!$demoProcess.HasExited) { $demoProcess.Kill(); $demoProcess.WaitForExit() }
    }
    Remove-Item -LiteralPath $demoStateFile -Force -ErrorAction SilentlyContinue
    throw
}
