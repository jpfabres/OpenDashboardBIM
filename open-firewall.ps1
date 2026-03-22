# Run once as Administrator so Windows allows inbound TCP on the hackathon port.
# Right-click PowerShell -> Run as administrator, then:
#   Set-Location c:\imasd-code
#   .\open-firewall.ps1

$Port = if ($env:PORT) { [int]$env:PORT } else { 8000 }
$RuleName = "Hackathon FastAPI (port $Port)"

$existing = Get-NetFirewallRule -DisplayName $RuleName -ErrorAction SilentlyContinue
if ($existing) {
    Write-Host "Rule already exists: $RuleName"
    exit 0
}

# Include Public so phones can connect when Wi‑Fi is classified as a public network in Windows.
New-NetFirewallRule -DisplayName $RuleName `
    -Direction Inbound `
    -Action Allow `
    -Protocol TCP `
    -LocalPort $Port `
    -Profile Domain, Private, Public

Write-Host "Firewall rule added: allow TCP $Port (Domain, Private, Public profiles)."
