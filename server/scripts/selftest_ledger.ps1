# TapLedger dual-ledger (personal/family) + account system self-test
$BASE = 'http://localhost:8421'
$ErrorActionPreference = 'Stop'
function Step($name) { Write-Host ""
    Write-Host "=== $name ===" -ForegroundColor Cyan }
function Hdr($t) { return @{ Authorization = "Bearer $($t)" } }
function PostJ($url, $hdr, $body) {
    $json = if ($body -is [string]) { $body } else { $body | ConvertTo-Json -Depth 5 }
    return Invoke-RestMethod $url -Method Post -Headers $hdr -ContentType 'application/json; charset=utf-8' -Body ([System.Text.Encoding]::UTF8.GetBytes($json))
}

Step '1. health'
$h = Invoke-RestMethod "$BASE/api/health"
Write-Host "ok=$($h.ok)"

Step '2. register dad/mom (auto personal ledger)'
$dad = PostJ "$BASE/api/auth/register" @{} '{"username":"ledgerdad","password":"123456","displayName":"Dad"}'
$mom = PostJ "$BASE/api/auth/register" @{} '{"username":"ledgermom","password":"123456","displayName":"Mom"}'
Write-Host "dad personalLedgerId=$($dad.user.personalLedgerId) mom personalLedgerId=$($mom.user.personalLedgerId)"
if (-not $dad.user.personalLedgerId -or -not $mom.user.personalLedgerId) { throw 'register did not create personal ledger' }

Step '3. dad ledgers (only personal)'
$hdrDad = Hdr $dad.token
$led = Invoke-RestMethod "$BASE/api/ledgers" -Headers $hdrDad
Write-Host ($led.ledgers | ForEach-Object { "$($_.type):$($_.name):$($_.id)" }) -join ' | '
if ($led.ledgers.Count -ne 1) { throw 'expected 1 ledger after register' }

Step '4. dad create family ledger'
$family = PostJ "$BASE/api/family" $hdrDad '{"name":"MyHome"}'
$fid = $family.family.id
Write-Host "familyId=$fid"
if (-not $fid) { throw 'create family failed' }

Step '5. dad ledgers (personal + family = 2)'
$led2 = Invoke-RestMethod "$BASE/api/ledgers" -Headers $hdrDad
Write-Host ($led2.ledgers | ForEach-Object { "$($_.type):$($_.name):$($_.id)" }) -join ' | '
if ($led2.ledgers.Count -ne 2) { throw 'expected 2 ledgers after creating family' }

Step '6. mom join family'
$hdrMom = Hdr $mom.token
$joinBody = "{`"inviteCode`":`"$($family.family.inviteCode)`"}"
PostJ "$BASE/api/family/join" $hdrMom $joinBody | Out-Null
Write-Host 'mom joined ok'

Step '7. dad push record to family ledger'
$now = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
$pushBody = @{
    ledgerId = $fid
    records = @(@{ uuid = 'rec-fam-0001'; amount = 25.5; category = 'food'; type = 'expense'; note = 'family lunch'; date = '2026-08-16'; timestamp = $now; accountUuid = 'acc-fam-0001'; reimbursable = 0; reimbursed = 0; updatedAt = $now; deleted = 0 })
    accounts = @(@{ uuid = 'acc-fam-0001'; name = 'cash'; type = 'cash'; emoji = 'v'; color = '#FFB74D'; initialBalance = 1000; sort = 0; updatedAt = $now; deleted = 0 })
} | ConvertTo-Json -Depth 5
$pushFam = PostJ "$BASE/api/sync/push" $hdrDad $pushBody
Write-Host "applied=$($pushFam.applied) rejected=$($pushFam.rejected)"
if ($pushFam.applied -ne 2) { throw 'family push failed' }

Step '8. mom pull family ledger sees record'
$pullBody = "{`"since`":0,`"ledgerId`":$fid}"
$pullFam = PostJ "$BASE/api/sync/pull" $hdrMom $pullBody
Write-Host "records=$($pullFam.changes.records.Count) note=$($pullFam.changes.records[0].note)"
if ($pullFam.changes.records.Count -lt 1) { throw 'family pull failed' }

Step '9. isolation: mom personal ledger pull is empty'
$momPersonal = Invoke-RestMethod "$BASE/api/ledgers" -Headers $hdrMom
$momPid = ($momPersonal.ledgers | Where-Object { $_.type -eq 'personal' }).id
$pullMom = PostJ "$BASE/api/sync/pull" $hdrMom "{`"since`":0,`"ledgerId`":$momPid}"
Write-Host "mom personal records=$($pullMom.changes.records.Count) (expect 0)"
if ($pullMom.changes.records.Count -ne 0) { throw 'isolation failed: family data leaked into personal' }

Step '10. unauthorized/inexistent ledger rejected'
$rejected = $false
try { PostJ "$BASE/api/sync/pull" $hdrMom "{`"since`":0,`"ledgerId`":99999}" | Out-Null } catch { $rejected = $true }
Write-Host "inexistent ledger rejected=$rejected"
if (-not $rejected) { throw 'inexistent ledger not rejected' }

Step '11. missing ledgerId rejected'
$missed = $false
try { PostJ "$BASE/api/sync/pull" $hdrDad '{"since":0}' | Out-Null } catch { $missed = $true }
Write-Host "missing ledgerId rejected=$missed"
if (-not $missed) { throw 'missing ledgerId not rejected' }

Write-Host ""
Write-Host 'PASS: dual-ledger + account system self-test OK' -ForegroundColor Green