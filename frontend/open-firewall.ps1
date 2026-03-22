# Run once as Administrator so Windows allows inbound TCP on the dashboard port.
# Right-click PowerShell -> Run as administrator, then:
#   Set-Location C:\path\to\OpenDashboardBIM
#   .\frontend\open-firewall.ps1

$Port = if ($env:PORT) { [int]$env:PORT } else { 8000 }
$RuleName = "Open Dashboard FastAPI (port $Port)"

$existing = Get-NetFirewallRule -DisplayName $RuleName -ErrorAction SilentlyContinue
if ($existing) {
    Write-Host "Rule already exists: $RuleName"
    exit 0
}

New-NetFirewallRule -DisplayName $RuleName `
    -Direction Inbound `
    -Action Allow `
    -Protocol TCP `
    -LocalPort $Port `
    -Profile Domain, Private, Public

Write-Host "Firewall rule added: allow TCP $Port (Domain, Private, Public profiles)."
