# query-weekly-data.ps1
# Queries Cloudflare D1 for weekly COLA filing data
# Outputs: content-queue/weekly-data-{date}.json

param(
    [string]$WeekEnding = (Get-Date -Format "yyyy-MM-dd"),
    [switch]$DryRun
)

# Load environment variables from .env if exists
$envFile = Join-Path $PSScriptRoot "..\..\..\.env"
if (Test-Path $envFile) {
    Get-Content $envFile | ForEach-Object {
        if ($_ -match "^([^#][^=]+)=(.*)$") {
            [Environment]::SetEnvironmentVariable($matches[1], $matches[2], "Process")
        }
    }
}

# Configuration
$config = @{
    AccountId = $env:CLOUDFLARE_ACCOUNT_ID
    DatabaseId = $env:CLOUDFLARE_D1_DATABASE_ID
    ApiToken = $env:CLOUDFLARE_API_TOKEN
}

# Validate configuration
if (-not $config.AccountId -or -not $config.DatabaseId -or -not $config.ApiToken) {
    Write-Error "Missing required environment variables. Set CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_D1_DATABASE_ID, CLOUDFLARE_API_TOKEN"
    exit 1
}

# Calculate date range (last 7 days from week ending)
$weekEndDate = [DateTime]::Parse($WeekEnding)
$weekStartDate = $weekEndDate.AddDays(-6)

Write-Host "Querying D1 for week: $($weekStartDate.ToString('yyyy-MM-dd')) to $($weekEndDate.ToString('yyyy-MM-dd'))"

# D1 API endpoint
$apiUrl = "https://api.cloudflare.com/client/v4/accounts/$($config.AccountId)/d1/database/$($config.DatabaseId)/query"

$headers = @{
    "Authorization" = "Bearer $($config.ApiToken)"
    "Content-Type" = "application/json"
}

# Function to execute D1 query
function Invoke-D1Query {
    param([string]$Sql)

    $body = @{
        sql = $Sql
    } | ConvertTo-Json

    try {
        $response = Invoke-RestMethod -Uri $apiUrl -Method POST -Headers $headers -Body $body
        if ($response.success) {
            return $response.result[0].results
        } else {
            Write-Error "D1 query failed: $($response.errors | ConvertTo-Json)"
            return $null
        }
    } catch {
        Write-Error "API request failed: $_"
        return $null
    }
}

# Query 1: Total filings this week
Write-Host "  Querying total filings..."
$totalFilings = Invoke-D1Query -Sql @"
SELECT COUNT(*) as count FROM colas
WHERE approval_date >= '$($weekStartDate.ToString('MM/dd/yyyy'))'
  AND approval_date <= '$($weekEndDate.ToString('MM/dd/yyyy'))'
"@

# Query 2: Signal breakdown
Write-Host "  Querying signal breakdown..."
$signalBreakdown = Invoke-D1Query -Sql @"
SELECT signal, COUNT(*) as count FROM colas
WHERE approval_date >= '$($weekStartDate.ToString('MM/dd/yyyy'))'
  AND approval_date <= '$($weekEndDate.ToString('MM/dd/yyyy'))'
GROUP BY signal
"@

# Query 3: Top filing companies
Write-Host "  Querying top filers..."
$topFilers = Invoke-D1Query -Sql @"
SELECT
    c.canonical_name as company,
    COUNT(*) as count
FROM colas co
JOIN company_aliases ca ON co.company_name = ca.raw_name
JOIN companies c ON ca.company_id = c.id
WHERE co.approval_date >= '$($weekStartDate.ToString('MM/dd/yyyy'))'
  AND co.approval_date <= '$($weekEndDate.ToString('MM/dd/yyyy'))'
GROUP BY c.id
ORDER BY count DESC
LIMIT 15
"@

# Query 4: Notable new brands
Write-Host "  Querying new brands..."
$newBrands = Invoke-D1Query -Sql @"
SELECT
    brand_name,
    company_name,
    class_type_code,
    approval_date
FROM colas
WHERE approval_date >= '$($weekStartDate.ToString('MM/dd/yyyy'))'
  AND approval_date <= '$($weekEndDate.ToString('MM/dd/yyyy'))'
  AND signal = 'NEW_BRAND'
ORDER BY approval_date DESC
LIMIT 25
"@

# Query 5: Category breakdown
Write-Host "  Querying category breakdown..."
$categoryBreakdown = Invoke-D1Query -Sql @"
SELECT
    CASE
        WHEN class_type_code LIKE '%WHISKY%' OR class_type_code LIKE '%WHISKEY%' OR class_type_code LIKE '%BOURBON%' THEN 'Whiskey'
        WHEN class_type_code LIKE '%VODKA%' THEN 'Vodka'
        WHEN class_type_code LIKE '%TEQUILA%' THEN 'Tequila'
        WHEN class_type_code LIKE '%RUM%' THEN 'Rum'
        WHEN class_type_code LIKE '%GIN%' THEN 'Gin'
        WHEN class_type_code LIKE '%WINE%' OR class_type_code LIKE '%VERMOUTH%' THEN 'Wine'
        WHEN class_type_code LIKE '%BEER%' OR class_type_code LIKE '%MALT%' OR class_type_code LIKE '%ALE%' THEN 'Beer'
        WHEN class_type_code LIKE '%COCKTAIL%' OR class_type_code LIKE '%RTD%' THEN 'RTD'
        WHEN class_type_code LIKE '%BRANDY%' OR class_type_code LIKE '%COGNAC%' THEN 'Brandy'
        WHEN class_type_code LIKE '%LIQUEUR%' OR class_type_code LIKE '%CORDIAL%' THEN 'Liqueur'
        ELSE 'Other'
    END as category,
    COUNT(*) as count
FROM colas
WHERE approval_date >= '$($weekStartDate.ToString('MM/dd/yyyy'))'
  AND approval_date <= '$($weekEndDate.ToString('MM/dd/yyyy'))'
GROUP BY category
ORDER BY count DESC
"@

# Query 6: New companies
Write-Host "  Querying new companies..."
$newCompanies = Invoke-D1Query -Sql @"
SELECT
    company_name,
    brand_name,
    class_type_code,
    approval_date
FROM colas
WHERE approval_date >= '$($weekStartDate.ToString('MM/dd/yyyy'))'
  AND approval_date <= '$($weekEndDate.ToString('MM/dd/yyyy'))'
  AND signal = 'NEW_COMPANY'
ORDER BY approval_date DESC
LIMIT 15
"@

# Build output object
$output = @{
    week_ending = $weekEndDate.ToString("yyyy-MM-dd")
    week_start = $weekStartDate.ToString("yyyy-MM-dd")
    generated_at = (Get-Date -Format "o")
    summary = @{
        total_filings = if ($totalFilings) { $totalFilings[0].count } else { 0 }
        new_brands = ($signalBreakdown | Where-Object { $_.signal -eq "NEW_BRAND" }).count
        new_skus = ($signalBreakdown | Where-Object { $_.signal -eq "NEW_SKU" }).count
        new_companies = ($signalBreakdown | Where-Object { $_.signal -eq "NEW_COMPANY" }).count
        refiles = ($signalBreakdown | Where-Object { $_.signal -eq "REFILE" }).count
    }
    top_filers = $topFilers | ForEach-Object {
        @{
            company = $_.company
            count = $_.count
        }
    }
    category_breakdown = $categoryBreakdown | ForEach-Object {
        @{
            category = $_.category
            count = $_.count
        }
    }
    notable_new_brands = $newBrands | ForEach-Object {
        @{
            brand = $_.brand_name
            company = $_.company_name
            category = $_.class_type_code
            date = $_.approval_date
        }
    }
    new_companies = $newCompanies | ForEach-Object {
        @{
            company = $_.company_name
            first_brand = $_.brand_name
            category = $_.class_type_code
            date = $_.approval_date
        }
    }
    story_hooks = @()
}

# Generate story hooks based on data
$hooks = @()

# Top filer hook
if ($output.top_filers.Count -gt 0) {
    $topFiler = $output.top_filers[0]
    $hooks += "$($topFiler.company) leads with $($topFiler.count) filings this week"
}

# Category trend hook
if ($output.category_breakdown.Count -gt 0) {
    $topCategory = $output.category_breakdown[0]
    $hooks += "$($topCategory.category) dominates with $($topCategory.count) filings"
}

# New companies hook
if ($output.new_companies.Count -gt 3) {
    $hooks += "$($output.new_companies.Count) new companies entered the market this week"
}

$output.story_hooks = $hooks

# Output
$outputPath = Join-Path $PSScriptRoot "..\content-queue\weekly-data-$($weekEndDate.ToString('yyyy-MM-dd')).json"

if ($DryRun) {
    Write-Host "`nDry run - would write to: $outputPath"
    Write-Host "`nPreview:"
    $output | ConvertTo-Json -Depth 5
} else {
    # Ensure content-queue directory exists
    $queueDir = Join-Path $PSScriptRoot "..\content-queue"
    if (-not (Test-Path $queueDir)) {
        New-Item -ItemType Directory -Path $queueDir -Force | Out-Null
    }

    $output | ConvertTo-Json -Depth 5 | Out-File -FilePath $outputPath -Encoding utf8
    Write-Host "`nSaved to: $outputPath"
}

# Summary
Write-Host "`n=== Weekly Data Summary ==="
Write-Host "Total Filings: $($output.summary.total_filings)"
Write-Host "New Brands: $($output.summary.new_brands)"
Write-Host "New SKUs: $($output.summary.new_skus)"
Write-Host "New Companies: $($output.summary.new_companies)"
Write-Host "Top Filer: $($output.top_filers[0].company) ($($output.top_filers[0].count))"
