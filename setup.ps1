# One-time setup for Nexa. This is the only step that needs internet;
# afterwards the assistant runs fully offline. start.bat runs it automatically
# the first time, so on a new PC you only need to double-click start.bat.
#
#   powershell -ExecutionPolicy Bypass -File setup.ps1                 # default model
#   powershell -ExecutionPolicy Bypass -File setup.ps1 -Model gemma3:4b
#   powershell -ExecutionPolicy Bypass -File setup.ps1 -NoDesktop     # Start menu shortcut only
param([string]$Model = "gemma3:1b", [switch]$NoDesktop)

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

function Step($text) { Write-Host "`n==> $text" -ForegroundColor Cyan }
function Note($text) { Write-Host "    $text" -ForegroundColor DarkGray }
function Fail($text) { Write-Host "`n$text" -ForegroundColor Red; exit 1 }
function Has-Winget { [bool](Get-Command winget -ErrorAction SilentlyContinue) }

# Returns the full path of a working Python 3.10+, or $null. Skips the Microsoft
# Store placeholder "python", which only opens the Store.
function Test-Python($exe, [string[]]$pre = @()) {
    try {
        $out = & $exe @pre -c "import sys; print(sys.executable if sys.version_info >= (3, 10) else '')" 2>$null
        if ($LASTEXITCODE -eq 0 -and "$out".Trim()) { return "$out".Trim() }
    } catch {}
    return $null
}

function Find-Python {
    if (Get-Command py -ErrorAction SilentlyContinue) {
        $p = Test-Python "py" @("-3")
        if ($p) { return $p }
    }
    $exes = @()
    if (Get-Command python -ErrorAction SilentlyContinue) { $exes += "python" }
    $exes += @(Get-ChildItem "$env:LOCALAPPDATA\Programs\Python\Python3*\python.exe", "$env:ProgramFiles\Python3*\python.exe" -ErrorAction SilentlyContinue |
        Sort-Object FullName -Descending | ForEach-Object { $_.FullName })
    foreach ($e in $exes) {
        $p = Test-Python $e
        if ($p) { return $p }
    }
    return $null
}

function Find-Ollama {
    $cmd = Get-Command ollama -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    $exe = Join-Path $env:LOCALAPPDATA "Programs\Ollama\ollama.exe"
    if (Test-Path $exe) { return $exe }
    return $null
}

function Test-OllamaServer {
    try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 http://127.0.0.1:11434/api/tags | Out-Null; return $true }
    catch { return $false }
}

function Has-NvidiaGpu {
    if (Get-Command nvidia-smi -ErrorAction SilentlyContinue) { return $true }
    try { return [bool](Get-CimInstance Win32_VideoController | Where-Object { $_.Name -match "NVIDIA" }) }
    catch { return $false }
}

function New-Shortcut($folder) {
    $shell = New-Object -ComObject WScript.Shell
    $lnk = $shell.CreateShortcut((Join-Path $folder "Nexa.lnk"))
    # pythonw runs her without a console window; what she hears goes to logs\nexa.log.
    $lnk.TargetPath = Join-Path $PSScriptRoot ".venv\Scripts\pythonw.exe"
    $lnk.Arguments = "`"$(Join-Path $PSScriptRoot 'server.py')`" --launch"
    $lnk.WorkingDirectory = $PSScriptRoot
    $lnk.IconLocation = Join-Path $PSScriptRoot "static\nexa.ico"
    $lnk.Description = "Talk to Nexa, your offline AI assistant"
    $lnk.Save()
}

Step "Python"
if (-not (Test-Path .venv\Scripts\python.exe)) {
    $python = Find-Python
    if (-not $python) {
        if (-not (Has-Winget)) { Fail "Python 3.10 or newer is required. Install it from https://www.python.org/downloads/, then run start.bat again." }
        Note "Installing Python 3.13..."
        winget install --id Python.Python.3.13 -e --scope user --accept-source-agreements --accept-package-agreements
        $python = Find-Python
        if (-not $python) { Fail "Python didn't install. Install it from https://www.python.org/downloads/, then run start.bat again." }
    }
    Note "Using $python"
    & $python -m venv .venv
    if ($LASTEXITCODE -ne 0) { Fail "Couldn't create Nexa's Python environment (.venv)." }
}

Step "Python packages (about 300 MB)"
.\.venv\Scripts\python.exe -m pip install --upgrade pip -q --disable-pip-version-check
.\.venv\Scripts\python.exe -m pip install -r requirements.txt -q --disable-pip-version-check
if ($LASTEXITCODE -ne 0) { Fail "Installing Python packages failed. Check the internet connection and run start.bat again. If it keeps failing, install Python 3.13 from python.org, delete the .venv folder and try again." }

if (Has-NvidiaGpu) {
    Step "NVIDIA graphics card found: adding its speed-up for hearing and the casual voices (about 2 GB)"
    # cuDNN 9.5 still runs on older cards (GTX 10-series); newer cuDNN releases fail on them.
    .\.venv\Scripts\python.exe -m pip install nvidia-cublas-cu12 nvidia-cuda-runtime-cu12 nvidia-cufft-cu12 nvidia-curand-cu12 "nvidia-cudnn-cu12==9.5.1.17" -q --disable-pip-version-check
    if ($LASTEXITCODE -ne 0) {
        Note "Skipped: hearing will use the processor instead (a little slower), and the casual voices won't be available."
    } else {
        # The GPU build of ONNX Runtime replaces the normal one so the casual voices run on the card.
        # 1.23.2 uses CUDA 12, which older cards need (1.31 needs CUDA 13, which they don't support).
        .\.venv\Scripts\python.exe -m pip uninstall -y -q onnxruntime
        .\.venv\Scripts\python.exe -m pip install --force-reinstall --no-deps "onnxruntime-gpu==1.23.2" -q --disable-pip-version-check
        if ($LASTEXITCODE -ne 0) {
            .\.venv\Scripts\python.exe -m pip install onnxruntime -q --disable-pip-version-check
            Note "Skipped: the casual voices need the GPU build of ONNX Runtime, which didn't install."
        }
    }
}

Step "Ollama (runs the AI brain on this PC)"
$ollama = Find-Ollama
if (-not $ollama) {
    if (-not (Has-Winget)) { Fail "Install Ollama from https://ollama.com/download, then run start.bat again." }
    winget install --id Ollama.Ollama -e --accept-source-agreements --accept-package-agreements
    $ollama = Find-Ollama
    if (-not $ollama) { Fail "Ollama didn't install. Get it from https://ollama.com/download, then run start.bat again." }
}
if (-not (Test-OllamaServer)) {
    Start-Process -FilePath $ollama -ArgumentList "serve" -WindowStyle Hidden
    for ($i = 0; $i -lt 30 -and -not (Test-OllamaServer); $i++) { Start-Sleep -Seconds 1 }
}

Step "Downloading the AI brain '$Model'"
& $ollama pull $Model
if ($LASTEXITCODE -ne 0) { Fail "Downloading the AI model failed. Check the internet connection and run start.bat again." }

Step "Downloading Nexa's hearing and voices"
.\.venv\Scripts\python.exe server.py --prefetch
if ($LASTEXITCODE -ne 0) { Fail "Downloading the speech or voice models failed. Check the internet connection and run start.bat again." }

Step "Shortcuts"
foreach ($place in @(@("Desktop", "Desktop"), @("Programs", "Start menu"))) {
    if ($NoDesktop -and $place[0] -eq "Desktop") { continue }
    try {
        New-Shortcut ([Environment]::GetFolderPath($place[0]))
        Note "Added Nexa to the $($place[1])."
    } catch {
        Note "Couldn't add a $($place[1]) shortcut: $($_.Exception.Message)"
    }
}

Set-Content -Path .venv\nexa-ready -Value $Model  # tells start.bat that setup finished
Set-Content -Path .venv\owner-voice-ready -Value "1"  # upgrades older installs with owner voice recognition
Write-Host "`nAll set. Open Nexa from the desktop shortcut (no internet needed from now on)." -ForegroundColor Green
