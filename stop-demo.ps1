# Detiene exclusivamente los procesos registrados por start-demo.ps1.
$ErrorActionPreference = "Stop"
$demoRoot = [System.IO.Path]::GetFullPath($PSScriptRoot)
$demoStateFile = Join-Path $demoRoot ".demo\processes.json"
if (!(Test-Path -LiteralPath $demoStateFile)) {
    Write-Host "No hay procesos registrados para esta demo." -ForegroundColor Yellow
    return
}
$demoState = Get-Content -LiteralPath $demoStateFile -Raw | ConvertFrom-Json
if ($demoState.workspace -ne $demoRoot) { throw "El registro no pertenece a este proyecto. No se detuvo ningun proceso." }

foreach ($record in $demoState.processes) {
    $demoProcess = Get-Process -Id $record.id -ErrorAction SilentlyContinue
    if (!$demoProcess) { continue }
    # PID + inicio + ejecutable evitan cerrar otro proceso si Windows reutilizo el PID.
    if ($demoProcess.StartTime.ToUniversalTime().Ticks.ToString() -ne $record.startedUtcTicks -or $demoProcess.Path -ne $record.executable) {
        Write-Warning "El PID $($record.id) ya no corresponde a la demo; se conserva ese proceso."
        continue
    }
    Stop-Process -InputObject $demoProcess -Force
    $demoProcess.WaitForExit()
    Write-Host "Proceso de la demo detenido: $($record.id)." -ForegroundColor Green
}
Remove-Item -LiteralPath $demoStateFile -Force
Write-Host "Demo detenida. Los procesos de otros proyectos se conservan." -ForegroundColor Green
