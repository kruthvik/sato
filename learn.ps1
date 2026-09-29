[CmdletBinding(PositionalBinding = $false)]
param(
    [Parameter(Position = 0, ValueFromRemainingArguments = $true)]
    [string[]] $PiArgs = @()
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = "Stop"
$script:LearnExitCode = 0
$workspace = [System.IO.Path]::GetFullPath($PSScriptRoot)
$previousAgentDir = [Environment]::GetEnvironmentVariable("PI_CODING_AGENT_DIR", "Process")

function Write-LearnError {
    param([string] $Message)
    [Console]::Error.WriteLine("[Pi Learn] ERROR: $Message")
}

function Write-Utf8Json {
    param(
        [Parameter(Mandatory = $true)] [string] $Path,
        [Parameter(Mandatory = $true)] [object] $Value
    )
    $json = $Value | ConvertTo-Json -Depth 10
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($Path, $json + [Environment]::NewLine, $utf8NoBom)
}

function Assert-WorkspaceChild {
    param([Parameter(Mandatory = $true)] [string] $Path)
    $resolved = [System.IO.Path]::GetFullPath($Path)
    $workspacePrefix = $workspace.TrimEnd('\', '/') + [System.IO.Path]::DirectorySeparatorChar
    if (-not $resolved.StartsWith($workspacePrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to operate outside the learning workspace: $resolved"
    }
    return $resolved
}

function Clear-LearnDirectory {
    param(
        [Parameter(Mandatory = $true)] [string] $RelativePath,
        [Parameter(Mandatory = $true)] [string] $Label
    )
    $target = Assert-WorkspaceChild (Join-Path $workspace $RelativePath)
    if (-not (Test-Path -LiteralPath $target)) {
        New-Item -ItemType Directory -Path $target -Force | Out-Null
    }

    foreach ($child in Get-ChildItem -LiteralPath $target -Force) {
        $childPath = Assert-WorkspaceChild $child.FullName
        if (($child.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
            Remove-Item -LiteralPath $childPath -Force
        } else {
            Remove-Item -LiteralPath $childPath -Recurse -Force
        }
    }
    Write-Host "[Pi Learn] $Label cleared."
}

function Show-LearnHelp {
    Write-Host ""
    Write-Host "[Pi Learn Commands]"
    Write-Host "  .\learn.ps1                  Start an interactive learning session"
    Write-Host "  .\learn.ps1 /new             Start a fresh Pi chat (older chats keep their plans)"
    Write-Host "  .\learn.ps1 /view [file]     Open Markdown & LaTeX viewer in browser (alias: /preview)"
    Write-Host "  .\learn.ps1 /install <pkg>   Install extension into local .learn-runtime"
    Write-Host "  .\learn.ps1 /uninstall <pkg> Remove extension from local .learn-runtime"
    Write-Host "  .\learn.ps1 /list-extensions List extensions in local .learn-runtime"
    Write-Host "  .\learn.ps1 /install-typical Install typical Pi extensions into isolated local profile"
    Write-Host "  .\learn.ps1 /clear-session   Clear the dashboard mirror only; use /new-session inside Pi to reset a chat"
    Write-Host "  .\learn.ps1 /doctor          Verify workspace, providers, and isolated profile"
    Write-Host "  .\learn.ps1 /settings        Open Settings & Integration Hub"
    Write-Host "  .\learn.ps1 /clear-sources   Clear files in sources/"
    Write-Host "  .\learn.ps1 /clear-work      Clear files in content/exports/drill-work/"
    Write-Host "  .\learn.ps1 /clear-all       Clear both generated-work locations"
    Write-Host "  .\learn.ps1 /help            Show this help"
    Write-Host ""
    Write-Host "All other arguments are forwarded to Pi. The script can be run from any directory."
}

function Assert-CommandAvailable {
    param([Parameter(Mandatory = $true)] [string] $Name)
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "Required command '$Name' was not found on PATH."
    }
}

function Initialize-LearnRuntime {
    Assert-CommandAvailable "bun"
    Assert-CommandAvailable "pi"

    $agentDir = Assert-WorkspaceChild (Join-Path $workspace ".learn-runtime")
    $defaultAgentDir = [System.IO.Path]::GetFullPath((Join-Path $env:USERPROFILE ".pi\agent"))
    if ($agentDir.Equals($defaultAgentDir, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "The workspace learning profile resolves to the global Pi profile: $agentDir"
    }
    [Environment]::SetEnvironmentVariable("PI_CODING_AGENT_DIR", $agentDir, "Process")
    New-Item -ItemType Directory -Path $agentDir -Force | Out-Null

    & bun (Join-Path $workspace "scripts\sync-skills.js") | Out-Host
    if ($LASTEXITCODE -ne 0) {
        throw "Could not synchronize agent skills."
    }

    $settingsPath = Join-Path $agentDir "settings.json"
    if (-not (Test-Path -LiteralPath $settingsPath)) {
        Write-Utf8Json -Path $settingsPath -Value @{ packages = @() }
    }

    $subagentConfigDir = Join-Path $agentDir "extensions\subagent"
    $subagentConfigPath = Join-Path $subagentConfigDir "config.json"
    New-Item -ItemType Directory -Path $subagentConfigDir -Force | Out-Null
    if (-not (Test-Path -LiteralPath $subagentConfigPath)) {
        Write-Utf8Json -Path $subagentConfigPath -Value @{ asyncByDefault = $false }
    }

    $providers = @(
        @{ Label = "subagent runtime"; Package = "npm:pi-subagents"; Manifest = "npm\node_modules\pi-subagents\package.json" },
        @{ Label = "learner question UI"; Package = "npm:@juicesharp/rpiv-ask-user-question"; Manifest = "npm\node_modules\@juicesharp/rpiv-ask-user-question\package.json" },
        @{ Label = "researcher web tools"; Package = "npm:pi-web-search-and-fetch"; Manifest = "npm\node_modules\pi-web-search-and-fetch\package.json" },
        @{ Label = "Antigravity Gemini provider"; Package = "npm:pi-antigravity"; Manifest = "npm\node_modules\pi-antigravity\package.json" }
    )
    foreach ($provider in $providers) {
        if (-not (Test-Path -LiteralPath (Join-Path $agentDir $provider.Manifest))) {
            Write-Host "[Pi Learn] Installing $($provider.Label)..."
            & pi install $provider.Package | Out-Host
            if ($LASTEXITCODE -ne 0) {
                throw "Failed to install $($provider.Package)."
            }
        }
    }

    $themesDir = Assert-WorkspaceChild (Join-Path $workspace ".pi\themes")
    if (-not (Test-Path -LiteralPath $themesDir)) {
        New-Item -ItemType Directory -Path $themesDir -Force | Out-Null
    }
    $runtimeThemesDir = Assert-WorkspaceChild (Join-Path $agentDir "themes")
    if (-not (Test-Path -LiteralPath $runtimeThemesDir)) {
        New-Item -ItemType Directory -Path $runtimeThemesDir -Force | Out-Null
    }
    foreach ($themeItem in Get-ChildItem -LiteralPath $themesDir -Filter "*.json" -ErrorAction SilentlyContinue) {
        $destThemePath = Join-Path $runtimeThemesDir $themeItem.Name
        if (-not (Test-Path -LiteralPath $destThemePath)) {
            Copy-Item -LiteralPath $themeItem.FullName -Destination $destThemePath -Force
        }
    }

    # Credentials live only in this workspace profile. Authenticate here on first use;
    # never read or copy a global Pi profile into the learning environment.

    return $agentDir
}

function Invoke-LearnDoctor {
    param([Parameter(Mandatory = $true)] [string] $AgentDir)
    $effectiveAgentDir = [Environment]::GetEnvironmentVariable("PI_CODING_AGENT_DIR", "Process")
    if (-not $effectiveAgentDir -or -not ([System.IO.Path]::GetFullPath($effectiveAgentDir)).Equals($AgentDir, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Effective Pi profile does not match the isolated learning profile."
    }
    $defaultAgentDir = [System.IO.Path]::GetFullPath((Join-Path $env:USERPROFILE ".pi\agent"))
    $expectedAgentDir = Assert-WorkspaceChild (Join-Path $workspace ".learn-runtime")
    if (-not $AgentDir.Equals($expectedAgentDir, [System.StringComparison]::OrdinalIgnoreCase) -or
        $AgentDir.Equals($defaultAgentDir, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Learning profile must stay inside the workspace, separate from global Pi."
    }
    $settingsPath = Join-Path $AgentDir "settings.json"
    if (Test-Path -LiteralPath $settingsPath) {
        $settingsText = [System.IO.File]::ReadAllText($settingsPath).Replace('/', '\')
        $normalizedDefaultAgentDir = $defaultAgentDir.Replace('/', '\')
        if ($settingsText.IndexOf($normalizedDefaultAgentDir, [System.StringComparison]::OrdinalIgnoreCase) -ge 0) {
            throw "Isolated settings reference the global Pi profile: $settingsPath"
        }
    }

    Write-Host "[Pi Learn] Profile isolation verified."
    Write-Host "[Pi Learn] Running workspace checks..."
    & bun run setup | Out-Host
    if ($LASTEXITCODE -ne 0) {
        return $LASTEXITCODE
    }

    Write-Host ""
    Write-Host "[Pi Learn] Installed isolated packages:"
    & pi list | Out-Host
    if ($LASTEXITCODE -ne 0) {
        return $LASTEXITCODE
    }

    Write-Host ""
    Write-Host "[Pi Learn] Runtime ready"
    Write-Host "  Workspace: $workspace"
    Write-Host "  Profile:   $AgentDir"
    Write-Host "  Pi:        $(& pi --version)"
    Write-Host "  Bun:       $(& bun --version)"
    return 0
}

function Invoke-LearnPi {
    param(
        [Parameter(Mandatory = $false)]
        [AllowNull()]
        [AllowEmptyCollection()]
        [string[]] $Arguments = @()
    )
    if ($null -eq $Arguments) {
        $Arguments = @()
    }
    # Learning flows use registered tools for controlled file and evidence work.
    # Raw shell execution is unavailable in the learner-facing Pi session.
    $safeArgs = @($Arguments) + @("--exclude-tools", "bash,powershell")
    & pi @safeArgs
    $script:LearnExitCode = $LASTEXITCODE
}

function Invoke-Learn {
    if (-not (Test-Path -LiteralPath (Join-Path $workspace ".pi"))) {
        throw "No .pi directory found beside learn.ps1: $workspace"
    }

    if ($null -eq $PiArgs) {
        $PiArgs = @()
    }

    $command = ""
    if ($PiArgs -and $PiArgs.Count -gt 0) {
        $command = $PiArgs[0].ToLowerInvariant()
    }

    switch ($command) {
        "/help" { Show-LearnHelp; $script:LearnExitCode = 0; return }
        "help" { Show-LearnHelp; $script:LearnExitCode = 0; return }
        "/clear-session" {
            $sessionFile = Join-Path $workspace "_learning\current-session.json"
            if (Test-Path -LiteralPath $sessionFile) {
                Remove-Item -LiteralPath $sessionFile -Force
                Write-Host "[Pi Learn] Dashboard mirror cleared. Existing Pi chats keep their plans."
            } else {
                Write-Host "[Pi Learn] No dashboard mirror found. Existing Pi chats keep their plans."
            }
            $script:LearnExitCode = 0
            return
        }
        "/new" {
            $sessionFile = Join-Path $workspace "_learning\current-session.json"
            if (Test-Path -LiteralPath $sessionFile) {
                Remove-Item -LiteralPath $sessionFile -Force
            }
            Write-Host "[Pi Learn] Starting a fresh chat. Existing Pi chats keep their plans."
            $agentDir = Initialize-LearnRuntime
            Write-Host ""
            $forwardArgs = @($PiArgs | Select-Object -Skip 1)
            Invoke-LearnPi -Arguments $forwardArgs
            return
        }
        "new" {
            $sessionFile = Join-Path $workspace "_learning\current-session.json"
            if (Test-Path -LiteralPath $sessionFile) {
                Remove-Item -LiteralPath $sessionFile -Force
            }
            Write-Host "[Pi Learn] Starting a fresh chat. Existing Pi chats keep their plans."
            $agentDir = Initialize-LearnRuntime
            Write-Host ""
            $forwardArgs = @($PiArgs | Select-Object -Skip 1)
            Invoke-LearnPi -Arguments $forwardArgs
            return
        }
        "/view" {
            Assert-CommandAvailable "bun"
            $target = if ($PiArgs.Count -gt 1) { $PiArgs[1] } else { "" }
            Write-Host "[Pi Learn] Launching Markdown & LaTeX Document Viewer..."
            & bun (Join-Path $workspace "scripts\content-viewer.ts") $target
            $script:LearnExitCode = $LASTEXITCODE
            return
        }
        "/preview" {
            Assert-CommandAvailable "bun"
            $target = if ($PiArgs.Count -gt 1) { $PiArgs[1] } else { "" }
            Write-Host "[Pi Learn] Launching Markdown & LaTeX Document Viewer..."
            & bun (Join-Path $workspace "scripts\content-viewer.ts") $target
            $script:LearnExitCode = $LASTEXITCODE
            return
        }
        "/install" {
            if ($PiArgs.Count -lt 2) {
                Write-Host "Usage: .\learn.ps1 /install <npm-package-or-git-url>"
                $script:LearnExitCode = 1
                return
            }
            $agentDir = Initialize-LearnRuntime
            $packages = @($PiArgs | Select-Object -Skip 1)
            foreach ($pkg in $packages) {
                Write-Host "[Pi Learn] Installing extension '$pkg' into local .learn-runtime..."
                & pi install $pkg
            }
            $script:LearnExitCode = $LASTEXITCODE
            return
        }
        "/uninstall" {
            if ($PiArgs.Count -lt 2) {
                Write-Host "Usage: .\learn.ps1 /uninstall <package-name>"
                $script:LearnExitCode = 1
                return
            }
            $agentDir = Initialize-LearnRuntime
            $packages = @($PiArgs | Select-Object -Skip 1)
            foreach ($pkg in $packages) {
                Write-Host "[Pi Learn] Removing extension '$pkg' from local .learn-runtime..."
                & pi remove $pkg
            }
            $script:LearnExitCode = $LASTEXITCODE
            return
        }
        "/list-extensions" {
            $agentDir = Initialize-LearnRuntime
            Write-Host "[Pi Learn] Installed extensions in local .learn-runtime profile:"
            & pi list
            $script:LearnExitCode = $LASTEXITCODE
            return
        }
        "/install-typical" {
            $agentDir = Initialize-LearnRuntime
            $typical = @(
                "npm:pi-extmgr",
                "npm:@narumitw/pi-plan-mode",
                "npm:context-mode",
                "npm:@juicesharp/rpiv-todo",
                "npm:pi-zentui",
                "npm:pi-playwright"
            )
            Write-Host "[Pi Learn] Installing typical Pi extensions into isolated local profile..."
            Write-Host "[Pi Learn] Global ~/.pi/agent profile will NOT be affected."
            Write-Host ""
            foreach ($pkg in $typical) {
                Write-Host "[Pi Learn] Installing $pkg..."
                & pi install $pkg
            }
            Write-Host ""
            Write-Host "[Pi Learn] Typical extensions installed locally in .learn-runtime."
            $script:LearnExitCode = 0
            return
        }
        "/settings" {
            Assert-CommandAvailable "bun"
            Write-Host "[Pi Learn] Launching Settings & Integration Hub..."
            & bun (Join-Path $workspace "scripts\settings-server.ts")
            $script:LearnExitCode = $LASTEXITCODE
            return
        }
        "/clear-sources" { Clear-LearnDirectory "sources" "sources/"; $script:LearnExitCode = 0; return }
        "/clear-work" { Clear-LearnDirectory "content\exports\drill-work" "content/exports/drill-work/"; $script:LearnExitCode = 0; return }
        "/clear-all" {
            Clear-LearnDirectory "sources" "sources/"
            Clear-LearnDirectory "content\exports\drill-work" "content/exports/drill-work/"
            $script:LearnExitCode = 0;
            return
        }
    }

    $agentDir = Initialize-LearnRuntime
    if ($command -eq "/doctor" -or $command -eq "doctor") {
        $script:LearnExitCode = Invoke-LearnDoctor -AgentDir $agentDir
        return
    }

    Write-Host "[Pi Learn] Starting hermetic learning session..."
    Write-Host "[Pi Learn] Global dev packages bypassed; local learning tools isolated."
    Write-Host ""
    Invoke-LearnPi -Arguments $PiArgs
    return
}

Push-Location -LiteralPath $workspace
try {
    Invoke-Learn
} catch {
    Write-LearnError $_.Exception.Message
    $script:LearnExitCode = 1
} finally {
    if ($null -eq $previousAgentDir) {
        [Environment]::SetEnvironmentVariable("PI_CODING_AGENT_DIR", $null, "Process")
    } else {
        [Environment]::SetEnvironmentVariable("PI_CODING_AGENT_DIR", $previousAgentDir, "Process")
    }
    Pop-Location
}

exit $script:LearnExitCode
