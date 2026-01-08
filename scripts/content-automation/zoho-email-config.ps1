# zoho-email-config.ps1
# Configure Zoho Mail API for email scanning
# Run this script once to set up authentication

param(
    [switch]$Test,
    [switch]$ShowConfig
)

$ErrorActionPreference = "Stop"

# Load existing .env file if it exists
$envFile = Join-Path $PSScriptRoot "..\..\..\.env"
$envVars = @{}

if (Test-Path $envFile) {
    Get-Content $envFile | ForEach-Object {
        if ($_ -match "^([^#][^=]+)=(.*)$") {
            $envVars[$matches[1]] = $matches[2]
        }
    }
}

Write-Host "=================================================="
Write-Host "  Zoho Mail API Configuration"
Write-Host "=================================================="
Write-Host ""

if ($ShowConfig) {
    Write-Host "Current Configuration:"
    Write-Host "----------------------"

    if ($envVars.ContainsKey("ZOHO_CLIENT_ID")) {
        Write-Host "  ZOHO_CLIENT_ID: $($envVars["ZOHO_CLIENT_ID"].Substring(0, 10))..."
    } else {
        Write-Host "  ZOHO_CLIENT_ID: (not set)"
    }

    if ($envVars.ContainsKey("ZOHO_CLIENT_SECRET")) {
        Write-Host "  ZOHO_CLIENT_SECRET: ****** (hidden)"
    } else {
        Write-Host "  ZOHO_CLIENT_SECRET: (not set)"
    }

    if ($envVars.ContainsKey("ZOHO_REFRESH_TOKEN")) {
        Write-Host "  ZOHO_REFRESH_TOKEN: ****** (hidden)"
    } else {
        Write-Host "  ZOHO_REFRESH_TOKEN: (not set)"
    }

    if ($envVars.ContainsKey("ZOHO_ACCOUNT_ID")) {
        Write-Host "  ZOHO_ACCOUNT_ID: $($envVars["ZOHO_ACCOUNT_ID"])"
    } else {
        Write-Host "  ZOHO_ACCOUNT_ID: (not set)"
    }

    exit 0
}

if ($Test) {
    Write-Host "Testing Zoho Mail API connection..."
    Write-Host ""

    # Check if configured
    if (-not $envVars.ContainsKey("ZOHO_CLIENT_ID")) {
        Write-Host "✗ ZOHO_CLIENT_ID not configured"
        Write-Host "  Run this script without -Test to configure"
        exit 1
    }

    # Get access token using refresh token
    $tokenUrl = "https://accounts.zoho.com/oauth/v2/token"
    $tokenBody = @{
        refresh_token = $envVars["ZOHO_REFRESH_TOKEN"]
        client_id = $envVars["ZOHO_CLIENT_ID"]
        client_secret = $envVars["ZOHO_CLIENT_SECRET"]
        grant_type = "refresh_token"
    }

    try {
        $tokenResponse = Invoke-RestMethod -Uri $tokenUrl -Method POST -Body $tokenBody
        Write-Host "✓ Access token obtained successfully"

        # Test API access
        $apiUrl = "https://mail.zoho.com/api/accounts"
        $headers = @{
            "Authorization" = "Zoho-oauthtoken $($tokenResponse.access_token)"
        }

        $accountsResponse = Invoke-RestMethod -Uri $apiUrl -Method GET -Headers $headers
        Write-Host "✓ API access confirmed"
        Write-Host ""
        Write-Host "Accounts found:"
        $accountsResponse.data | ForEach-Object {
            Write-Host "  - $($_.emailAddress) (ID: $($_.accountId))"
        }

    } catch {
        Write-Host "✗ Error: $($_.Exception.Message)"
        exit 1
    }

    exit 0
}

# Configuration wizard
Write-Host "This script will guide you through configuring Zoho Mail API access."
Write-Host ""
Write-Host "Prerequisites:"
Write-Host "  1. Zoho Mail account with API access"
Write-Host "  2. Zoho API Console app created (https://api-console.zoho.com/)"
Write-Host ""

Write-Host "Step 1: Create Zoho API Application"
Write-Host "------------------------------------"
Write-Host "  1. Go to https://api-console.zoho.com/"
Write-Host "  2. Click 'Add Client'"
Write-Host "  3. Select 'Self Client' (for server-side access)"
Write-Host "  4. Enter a name (e.g., 'BevAlc Content Automation')"
Write-Host "  5. Note down the Client ID and Client Secret"
Write-Host ""

$clientId = Read-Host "Enter your Client ID"
$clientSecret = Read-Host "Enter your Client Secret" -AsSecureString
$clientSecretPlain = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($clientSecret))

Write-Host ""
Write-Host "Step 2: Generate Authorization Code"
Write-Host "------------------------------------"
Write-Host "  1. In the Zoho API Console, go to your Self Client"
Write-Host "  2. Click 'Generate Code' tab"
Write-Host "  3. Enter scope: ZohoMail.messages.READ,ZohoMail.folders.READ"
Write-Host "  4. Set duration: 10 minutes"
Write-Host "  5. Click 'Create' and copy the code"
Write-Host ""

$authCode = Read-Host "Enter the Authorization Code"

Write-Host ""
Write-Host "Exchanging authorization code for tokens..."

# Exchange auth code for tokens
$tokenUrl = "https://accounts.zoho.com/oauth/v2/token"
$tokenBody = @{
    code = $authCode
    client_id = $clientId
    client_secret = $clientSecretPlain
    grant_type = "authorization_code"
}

try {
    $tokenResponse = Invoke-RestMethod -Uri $tokenUrl -Method POST -Body $tokenBody
    Write-Host "✓ Tokens received successfully!"

    $refreshToken = $tokenResponse.refresh_token
    $accessToken = $tokenResponse.access_token

    # Get account ID
    Write-Host ""
    Write-Host "Fetching account information..."

    $apiUrl = "https://mail.zoho.com/api/accounts"
    $headers = @{
        "Authorization" = "Zoho-oauthtoken $accessToken"
    }

    $accountsResponse = Invoke-RestMethod -Uri $apiUrl -Method GET -Headers $headers

    if ($accountsResponse.data.Count -eq 1) {
        $accountId = $accountsResponse.data[0].accountId
        Write-Host "✓ Found account: $($accountsResponse.data[0].emailAddress)"
    } else {
        Write-Host "Multiple accounts found. Please select one:"
        $i = 1
        $accountsResponse.data | ForEach-Object {
            Write-Host "  $i. $($_.emailAddress)"
            $i++
        }
        $selection = Read-Host "Enter number"
        $accountId = $accountsResponse.data[[int]$selection - 1].accountId
    }

    # Save to .env file
    Write-Host ""
    Write-Host "Saving configuration to .env file..."

    # Update or add Zoho variables
    $envVars["ZOHO_CLIENT_ID"] = $clientId
    $envVars["ZOHO_CLIENT_SECRET"] = $clientSecretPlain
    $envVars["ZOHO_REFRESH_TOKEN"] = $refreshToken
    $envVars["ZOHO_ACCOUNT_ID"] = $accountId

    # Write back to .env file
    $envContent = $envVars.GetEnumerator() | ForEach-Object {
        "$($_.Key)=$($_.Value)"
    }
    $envContent | Out-File -FilePath $envFile -Encoding utf8

    Write-Host "✓ Configuration saved to $envFile"
    Write-Host ""
    Write-Host "=================================================="
    Write-Host "  Configuration Complete!"
    Write-Host "=================================================="
    Write-Host ""
    Write-Host "Zoho Mail API is now configured."
    Write-Host ""
    Write-Host "To test the configuration:"
    Write-Host "  .\zoho-email-config.ps1 -Test"
    Write-Host ""
    Write-Host "To view current configuration:"
    Write-Host "  .\zoho-email-config.ps1 -ShowConfig"

} catch {
    Write-Host ""
    Write-Host "✗ Error: $($_.Exception.Message)"
    Write-Host ""
    Write-Host "Common issues:"
    Write-Host "  - Authorization code expired (valid for 10 minutes)"
    Write-Host "  - Incorrect Client ID or Secret"
    Write-Host "  - Scope not authorized during code generation"
    Write-Host ""
    Write-Host "Please try again with a fresh authorization code."
    exit 1
}
