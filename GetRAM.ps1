$os = Get-CimInstance Win32_OperatingSystem
$totalGB = [math]::Round($os.TotalVisibleMemorySize / 1MB, 1)
$freeGB = [math]::Round($os.FreePhysicalMemory / 1MB, 1)
$usedGB = $totalGB - $freeGB
$pct = [math]::Round(($usedGB / $totalGB) * 100, 0)
$result = "Total RAM: $totalGB GB`nUsed: $usedGB GB ($pct%)`nFree: $freeGB GB"
$result | Out-File "$env:TEMP\ram_info.txt" -Encoding UTF8
Write-Host $result
Read-Host "Press Enter to close"
