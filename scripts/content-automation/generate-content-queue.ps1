# generate-content-queue.ps1
# Orchestrates the content generation pipeline
# Runs all data collection and content generation steps

param(
    [string]$WeekEnding = (Get-Date -Format "yyyy-MM-dd"),
    [switch]$DryRun,
    [switch]$SkipNews,
    [switch]$SkipStories
)

$ErrorActionPreference = "Stop"
$scriptRoot = $PSScriptRoot

Write-Host "=================================================="
Write-Host "  BevAlc Intelligence Content Generation Pipeline"
Write-Host "  Week Ending: $WeekEnding"
Write-Host "=================================================="
Write-Host ""

# Ensure content-queue directory exists
$queueDir = Join-Path $scriptRoot "..\content-queue"
if (-not (Test-Path $queueDir)) {
    New-Item -ItemType Directory -Path $queueDir -Force | Out-Null
    Write-Host "Created content-queue directory"
}

# Track results
$results = @{
    started_at = Get-Date -Format "o"
    week_ending = $WeekEnding
    steps = @()
    errors = @()
}

function Add-StepResult {
    param(
        [string]$Step,
        [string]$Status,
        [string]$Output,
        [string]$Error
    )
    $results.steps += @{
        step = $Step
        status = $Status
        output = $Output
        error = $Error
        timestamp = Get-Date -Format "o"
    }
}

# ============================================================
# STEP 1: Query D1 for weekly data
# ============================================================
Write-Host "[1/5] Data Mining - Querying D1..."
Write-Host "-------------------------------------"

try {
    $queryScript = Join-Path $scriptRoot "query-weekly-data.ps1"
    if (Test-Path $queryScript) {
        if ($DryRun) {
            & $queryScript -WeekEnding $WeekEnding -DryRun
        } else {
            & $queryScript -WeekEnding $WeekEnding
        }
        $outputFile = Join-Path $queueDir "weekly-data-$WeekEnding.json"
        if (Test-Path $outputFile) {
            Add-StepResult -Step "Data Mining" -Status "success" -Output $outputFile
            Write-Host "  [OK] Weekly data saved to $outputFile"
        } else {
            Add-StepResult -Step "Data Mining" -Status "warning" -Output "File not created (dry-run?)"
        }
    } else {
        throw "Script not found: $queryScript"
    }
} catch {
    Add-StepResult -Step "Data Mining" -Status "error" -Error $_.Exception.Message
    Write-Host "  [ERR] Error: $($_.Exception.Message)"
    $results.errors += "Data Mining failed: $($_.Exception.Message)"
}

Write-Host ""

# ============================================================
# STEP 2: News Aggregation (Email + Site Monitoring)
# ============================================================
if (-not $SkipNews) {
    Write-Host "[2/5] News Aggregation - Scanning sources..."
    Write-Host "---------------------------------------------"

    # Check if Zoho is configured
    if ($env:ZOHO_CLIENT_ID) {
        Write-Host "  Zoho Mail configured - would scan emails"
        Write-Host "  (Email scanning not yet implemented in PowerShell)"
        Write-Host "  Run: python scan_emails.py (when available)"
        Add-StepResult -Step "Email Scanning" -Status "skipped" -Output "Not implemented"
    } else {
        Write-Host "  Zoho Mail not configured - skipping email scan"
        Write-Host "  Run: .\zoho-email-config.ps1 to set up"
        Add-StepResult -Step "Email Scanning" -Status "skipped" -Output "Zoho not configured"
    }

    Write-Host "  Site monitoring: (placeholder)"
    Write-Host "  Would check ttb.gov, competitor sites, etc."
    Add-StepResult -Step "Site Monitoring" -Status "skipped" -Output "Not implemented"

    # Create placeholder news digest
    $newsDigest = @{
        scan_date = $WeekEnding
        scan_type = "placeholder"
        note = "Email and site scanning not yet implemented"
        email_results = @{
            emails_scanned = 0
            items = @()
        }
        site_results = @{
            sites_checked = 0
            items = @()
        }
    }

    if (-not $DryRun) {
        $newsFile = Join-Path $queueDir "news-digest-$WeekEnding.json"
        $newsDigest | ConvertTo-Json -Depth 5 | Out-File -FilePath $newsFile -Encoding utf8
        Write-Host "  -> Placeholder saved to $newsFile"
    }
} else {
    Write-Host "[2/5] News Aggregation - SKIPPED (-SkipNews flag)"
    Add-StepResult -Step "News Aggregation" -Status "skipped" -Output "User skipped"
}

Write-Host ""

# ============================================================
# STEP 3: Story Generation
# ============================================================
if (-not $SkipStories) {
    Write-Host "[3/5] Story Generation - Finding interesting brands..."
    Write-Host "------------------------------------------------------"

    # Read weekly data to find story candidates
    $weeklyDataFile = Join-Path $queueDir "weekly-data-$WeekEnding.json"
    if (Test-Path $weeklyDataFile) {
        $weeklyData = Get-Content $weeklyDataFile | ConvertFrom-Json

        Write-Host "  Found $($weeklyData.notable_new_brands.Count) new brands"
        Write-Host "  Story generation requires Claude - use /absurd-story command"

        # Create placeholder stories file
        $stories = @{
            generated_at = Get-Date -Format "o"
            week_ending = $WeekEnding
            note = "Run /absurd-story command to generate stories"
            candidates = $weeklyData.notable_new_brands | Select-Object -First 5
            stories = @()
        }

        if (-not $DryRun) {
            $storiesFile = Join-Path $queueDir "stories-$WeekEnding.json"
            $stories | ConvertTo-Json -Depth 5 | Out-File -FilePath $storiesFile -Encoding utf8
            Write-Host "  -> Candidates saved to $storiesFile"
        }

        Add-StepResult -Step "Story Generation" -Status "partial" -Output "Candidates identified"
    } else {
        Write-Host "  [ERR] Weekly data not found - skipping"
        Add-StepResult -Step "Story Generation" -Status "skipped" -Output "No weekly data"
    }
} else {
    Write-Host "[3/5] Story Generation - SKIPPED (-SkipStories flag)"
    Add-StepResult -Step "Story Generation" -Status "skipped" -Output "User skipped"
}

Write-Host ""

# ============================================================
# STEP 4: Content Writing
# ============================================================
Write-Host "[4/5] Content Writing - Generating articles..."
Write-Host "----------------------------------------------"

Write-Host "  Content writing requires Claude - use these commands:"
Write-Host "    /company-spotlight [company]  - Generate company content"
Write-Host "    /trend-report [category]      - Generate trend analysis"
Write-Host ""
Write-Host "  Creating articles placeholder..."

$articles = @{
    generated_at = Get-Date -Format "o"
    week_ending = $WeekEnding
    note = "Use Claude commands to generate content"
    articles = @()
}

if (-not $DryRun) {
    $articlesFile = Join-Path $queueDir "articles-$WeekEnding.json"
    $articles | ConvertTo-Json -Depth 5 | Out-File -FilePath $articlesFile -Encoding utf8
    Write-Host "  -> Placeholder saved to $articlesFile"
}

Add-StepResult -Step "Content Writing" -Status "partial" -Output "Placeholder created"

Write-Host ""

# ============================================================
# STEP 5: Newsletter Assembly
# ============================================================
Write-Host "[5/5] Newsletter Assembly..."
Write-Host "----------------------------"

$weeklyDataFile = Join-Path $queueDir "weekly-data-$WeekEnding.json"
if (Test-Path $weeklyDataFile) {
    $weeklyData = Get-Content $weeklyDataFile | ConvertFrom-Json

    # Assemble newsletter structure
    $newsletter = @{
        generated_at = Get-Date -Format "o"
        week_ending = $WeekEnding
        subject_line = "$($weeklyData.category_breakdown[0].category) Leads with $($weeklyData.summary.total_filings) Filings - Week of $WeekEnding"
        preview_text = "$($weeklyData.summary.new_brands) new brands, $($weeklyData.summary.new_companies) new companies"
        sections = @{
            hero_stat = @{
                number = $weeklyData.summary.total_filings
                label = "Filings This Week"
            }
            the_numbers = @(
                @{ label = "New Brands"; value = $weeklyData.summary.new_brands }
                @{ label = "New SKUs"; value = $weeklyData.summary.new_skus }
                @{ label = "New Companies"; value = $weeklyData.summary.new_companies }
            )
            top_filers = $weeklyData.top_filers | Select-Object -First 5
            category_breakdown = $weeklyData.category_breakdown
            story_hooks = $weeklyData.story_hooks
        }
        status = "ready_for_review"
    }

    if (-not $DryRun) {
        $newsletterFile = Join-Path $queueDir "newsletter-$WeekEnding.json"
        $newsletter | ConvertTo-Json -Depth 5 | Out-File -FilePath $newsletterFile -Encoding utf8
        Write-Host "  [OK] Newsletter assembled: $newsletterFile"
    }

    Add-StepResult -Step "Newsletter Assembly" -Status "success" -Output "Newsletter ready"

} else {
    Write-Host "  [ERR] Cannot assemble - weekly data missing"
    Add-StepResult -Step "Newsletter Assembly" -Status "error" -Error "Weekly data missing"
}

Write-Host ""

# ============================================================
# SUMMARY
# ============================================================
$results.completed_at = Get-Date -Format "o"

Write-Host "=================================================="
Write-Host "  Pipeline Complete"
Write-Host "=================================================="
Write-Host ""
Write-Host "Content Queue Files:"
Get-ChildItem $queueDir -Filter "*$WeekEnding*" | ForEach-Object {
    Write-Host "  - $($_.Name)"
}
Write-Host ""

$successCount = ($results.steps | Where-Object { $_.status -eq "success" }).Count
$partialCount = ($results.steps | Where-Object { $_.status -eq "partial" }).Count
$errorCount = ($results.steps | Where-Object { $_.status -eq "error" }).Count

Write-Host "Results: $successCount success, $partialCount partial, $errorCount errors"

if ($results.errors.Count -gt 0) {
    Write-Host ""
    Write-Host "Errors:"
    $results.errors | ForEach-Object { Write-Host "  - $_" }
}

Write-Host ""
Write-Host "Next Steps:"
Write-Host "  1. Review weekly-data-$WeekEnding.json"
Write-Host "  2. Run /absurd-story to generate stories"
Write-Host "  3. Run /company-spotlight for notable companies"
Write-Host "  4. Review and edit newsletter-$WeekEnding.json"
Write-Host "  5. Send newsletter via send_weekly_report.py"

# Save pipeline results
if (-not $DryRun) {
    $resultsFile = Join-Path $queueDir "pipeline-results-$WeekEnding.json"
    $results | ConvertTo-Json -Depth 5 | Out-File -FilePath $resultsFile -Encoding utf8
}
