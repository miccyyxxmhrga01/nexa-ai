# Removes Nexa from this PC: her folder, her shortcuts and her entry in Settings > Apps.
# It asks before deleting your saved keys and chats, and leaves Ollama and its models installed.
# Settings > Apps runs it; it only removes a folder that Nexa's installer made.
Add-Type -AssemblyName System.Windows.Forms
$dir = $PSScriptRoot
$title = "Uninstall Nexa"

if (-not (Test-Path (Join-Path $dir ".nexa-installed"))) {
    [System.Windows.Forms.MessageBox]::Show("This copy of Nexa wasn't installed with Nexa Setup, so it isn't removed automatically. Delete its folder yourself:`n$dir", $title) | Out-Null
    exit 1
}
if ([System.Windows.Forms.MessageBox]::Show("Remove Nexa from this PC?", $title, "YesNo", "Question") -ne "Yes") { exit 0 }
$wipe = [System.Windows.Forms.MessageBox]::Show(
    "Also delete your saved API keys, chats and Nexa's settings?`n`nChoose No to keep them for a future install.",
    $title, "YesNo", "Question")

# Stop Nexa if she's running from this folder.
Get-CimInstance Win32_Process -Filter "Name='python.exe' OR Name='pythonw.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith("$dir\", [StringComparison]::OrdinalIgnoreCase) } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

# Her shortcuts, but only ones that point into this folder.
$shell = New-Object -ComObject WScript.Shell
foreach ($folder in @([Environment]::GetFolderPath("Desktop"), [Environment]::GetFolderPath("Programs"))) {
    $lnk = Join-Path $folder "Nexa.lnk"
    if ((Test-Path $lnk) -and $shell.CreateShortcut($lnk).TargetPath.StartsWith("$dir\", [StringComparison]::OrdinalIgnoreCase)) {
        Remove-Item $lnk -Force -ErrorAction SilentlyContinue
    }
}

Remove-Item "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Nexa" -Recurse -ErrorAction SilentlyContinue
# Her data folder was named Ciel (her first name) until the app moved it to Nexa.
if ($wipe -eq "Yes") {
    foreach ($name in "Nexa", "Ciel") { Remove-Item (Join-Path $env:LOCALAPPDATA $name) -Recurse -Force -ErrorAction SilentlyContinue }
}

[System.Windows.Forms.MessageBox]::Show(
    "Nexa was removed.`n`nOllama and its AI models are still installed; remove Ollama in Settings > Apps if you don't need it.",
    $title) | Out-Null

# The folder holding this script goes last, once the script has finished.
Start-Process cmd.exe -ArgumentList "/c timeout /t 2 /nobreak >nul & rmdir /s /q `"$dir`"" -WindowStyle Hidden
