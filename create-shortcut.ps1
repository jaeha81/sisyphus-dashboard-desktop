param(
  [switch]$Silent
)

$AppDir     = Split-Path -Parent $MyInvocation.MyCommand.Path
$AppName    = "Sisyphus Dashboard"
$TargetBat  = Join-Path $AppDir "dev-start.bat"
$Desktop    = [Environment]::GetFolderPath("Desktop")
$ShortcutPath = Join-Path $Desktop "$AppName.lnk"

$WshShell = New-Object -ComObject WScript.Shell
$Shortcut = $WshShell.CreateShortcut($ShortcutPath)

$Shortcut.TargetPath       = "cmd.exe"
$Shortcut.Arguments        = "/c `"$TargetBat`""
$Shortcut.WorkingDirectory = $AppDir
$Shortcut.WindowStyle      = 1
$Shortcut.Description      = "Sisyphus Dashboard - OpenCode AI Coding Desktop App"

$ElectronIcon = Join-Path $AppDir "node_modules\electron\dist\electron.exe"
if (Test-Path $ElectronIcon) {
  $Shortcut.IconLocation = "$ElectronIcon,0"
} else {
  $Shortcut.IconLocation = "cmd.exe,0"
}

$Shortcut.Save()

if (-not $Silent) {
  Write-Host ""
  Write-Host "  바탕화면 바로가기 생성 완료!" -ForegroundColor Green
  Write-Host "  경로: $ShortcutPath" -ForegroundColor DarkGray
  Write-Host ""
}
