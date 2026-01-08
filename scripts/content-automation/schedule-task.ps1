# schedule-task.ps1
# Set up Windows Task Scheduler for automated content generation
# Must be run as Administrator

param(
    [switch]$Install,
    [switch]$Uninstall,
    [switch]$Status,
    [switch]$RunNow
)

$ErrorActionPreference = "Stop"

$taskName = "BevAlc-Weekly-Content"
$scriptRoot = $PSScriptRoot
$pipelineScript = Join-Path $scriptRoot "generate-content-queue.ps1"

# Check if running as admin
function Test-Administrator {
    $currentUser = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($currentUser)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

if ($Install -or $Uninstall) {
    if (-not (Test-Administrator)) {
        Write-Host "This operation requires Administrator privileges."
        Write-Host "Please run PowerShell as Administrator and try again."
        exit 1
    }
}

if ($Status) {
    Write-Host "=================================================="
    Write-Host "  Scheduled Task Status"
    Write-Host "=================================================="
    Write-Host ""

    $task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue

    if ($task) {
        Write-Host "Task Name: $taskName"
        Write-Host "Status: $($task.State)"
        Write-Host ""

        $taskInfo = Get-ScheduledTaskInfo -TaskName $taskName
        Write-Host "Last Run: $($taskInfo.LastRunTime)"
        Write-Host "Last Result: $($taskInfo.LastTaskResult)"
        Write-Host "Next Run: $($taskInfo.NextRunTime)"
        Write-Host ""

        $trigger = $task.Triggers | Select-Object -First 1
        Write-Host "Schedule: Weekly on $($trigger.DaysOfWeek) at $($trigger.StartBoundary)"
    } else {
        Write-Host "Task '$taskName' is not installed."
        Write-Host ""
        Write-Host "To install, run:"
        Write-Host "  .\schedule-task.ps1 -Install"
    }

    exit 0
}

if ($RunNow) {
    Write-Host "Running task immediately..."

    $task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue

    if ($task) {
        Start-ScheduledTask -TaskName $taskName
        Write-Host "Task started. Check Task Scheduler for results."
    } else {
        Write-Host "Task not installed. Running pipeline directly..."
        & $pipelineScript
    }

    exit 0
}

if ($Uninstall) {
    Write-Host "Removing scheduled task..."

    $task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue

    if ($task) {
        Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
        Write-Host "✓ Task '$taskName' removed successfully."
    } else {
        Write-Host "Task '$taskName' was not installed."
    }

    exit 0
}

if ($Install) {
    Write-Host "=================================================="
    Write-Host "  Installing Scheduled Task"
    Write-Host "=================================================="
    Write-Host ""

    # Verify script exists
    if (-not (Test-Path $pipelineScript)) {
        Write-Host "✗ Pipeline script not found: $pipelineScript"
        exit 1
    }

    Write-Host "Task: $taskName"
    Write-Host "Script: $pipelineScript"
    Write-Host "Schedule: Every Saturday at 10:00 AM"
    Write-Host ""

    # Check for existing task
    $existingTask = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    if ($existingTask) {
        $overwrite = Read-Host "Task already exists. Overwrite? (y/n)"
        if ($overwrite -ne 'y') {
            Write-Host "Cancelled."
            exit 0
        }
        Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
    }

    # Create the action
    $action = New-ScheduledTaskAction `
        -Execute "powershell.exe" `
        -Argument "-ExecutionPolicy Bypass -NoProfile -File `"$pipelineScript`"" `
        -WorkingDirectory $scriptRoot

    # Create the trigger (Saturday at 10:00 AM)
    $trigger = New-ScheduledTaskTrigger `
        -Weekly `
        -DaysOfWeek Saturday `
        -At "10:00AM"

    # Create settings
    $settings = New-ScheduledTaskSettingsSet `
        -AllowStartIfOnBatteries `
        -DontStopIfGoingOnBatteries `
        -StartWhenAvailable `
        -RunOnlyIfNetworkAvailable `
        -WakeToRun

    # Create the principal (run whether logged in or not)
    $principal = New-ScheduledTaskPrincipal `
        -UserId $env:USERNAME `
        -LogonType S4U `
        -RunLevel Limited

    # Register the task
    try {
        Register-ScheduledTask `
            -TaskName $taskName `
            -Action $action `
            -Trigger $trigger `
            -Settings $settings `
            -Principal $principal `
            -Description "Generate weekly content for BevAlc Intelligence" `
            | Out-Null

        Write-Host "✓ Task installed successfully!"
        Write-Host ""
        Write-Host "The task will run every Saturday at 10:00 AM."
        Write-Host ""
        Write-Host "To check status:"
        Write-Host "  .\schedule-task.ps1 -Status"
        Write-Host ""
        Write-Host "To run immediately:"
        Write-Host "  .\schedule-task.ps1 -RunNow"
        Write-Host ""
        Write-Host "To remove:"
        Write-Host "  .\schedule-task.ps1 -Uninstall"

    } catch {
        Write-Host "✗ Failed to install task: $($_.Exception.Message)"
        exit 1
    }

    exit 0
}

# Default: show help
Write-Host "=================================================="
Write-Host "  BevAlc Content Automation Scheduler"
Write-Host "=================================================="
Write-Host ""
Write-Host "This script manages the Windows scheduled task for"
Write-Host "automated content generation."
Write-Host ""
Write-Host "Usage:"
Write-Host "  .\schedule-task.ps1 -Install     # Install weekly task"
Write-Host "  .\schedule-task.ps1 -Uninstall   # Remove task"
Write-Host "  .\schedule-task.ps1 -Status      # Show task status"
Write-Host "  .\schedule-task.ps1 -RunNow      # Run immediately"
Write-Host ""
Write-Host "Schedule:"
Write-Host "  Every Saturday at 10:00 AM"
Write-Host "  (After weekly update completes at 9 AM)"
Write-Host ""
Write-Host "Note: -Install and -Uninstall require Administrator privileges."
