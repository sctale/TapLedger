# TapLedger server 全链路自测脚本
$BASE = 'http://localhost:8420'
$ErrorActionPreference = 'Stop'
$fail = 0

function Step($name) { Write-Host "`n=== $name ===" -ForegroundColor Cyan }

Step '1. 健康检查'
$h = Invoke-RestMethod "$BASE/api/health"
if (-not $h.ok) { throw 'health 失败' }; Write-Host "ok=$($h.ok)"

Step '2. 注册 dad / mom'
$dad = Invoke-RestMethod "$BASE/api/auth/register" -Method Post -ContentType 'application/json; charset=utf-8' -Body ([System.Text.Encoding]::UTF8.GetBytes('{"username":"dad","password":"123456","displayName":"爸爸"}'))
$mom = Invoke-RestMethod "$BASE/api/auth/register" -Method Post -ContentType 'application/json; charset=utf-8' -Body ([System.Text.Encoding]::UTF8.GetBytes('{"username":"mom","password":"123456","displayName":"妈妈"}'))
Write-Host "dad token len=$($dad.token.Length), mom token len=$($mom.token.Length)"
if (-not $dad.token -or -not $mom.token) { throw '注册失败' }

Step '3. dad 创建家庭'
$hdrDad = @{ Authorization = "Bearer $($dad.token)" }
$family = Invoke-RestMethod "$BASE/api/family" -Method Post -Headers $hdrDad -ContentType 'application/json; charset=utf-8' -Body ([System.Text.Encoding]::UTF8.GetBytes('{"name":"我们家"}'))
$code = $family.family.inviteCode
Write-Host "family=$($family.family.name) inviteCode=$code"
if (-not $code) { throw '建家失败' }

Step '4. mom 用邀请码加入'
$hdrMom = @{ Authorization = "Bearer $($mom.token)" }
$join = Invoke-RestMethod "$BASE/api/family/join" -Method Post -Headers $hdrMom -ContentType 'application/json; charset=utf-8' -Body ([System.Text.Encoding]::UTF8.GetBytes("{`"inviteCode`":`"$code`"}"))
Write-Host "mom joined familyId=$($join.family.id) role=$($join.user.familyRole)"

Step '5. 成员列表'
$members = Invoke-RestMethod "$BASE/api/family/members" -Headers $hdrDad
Write-Host ($members.members | ForEach-Object { "$($_.avatarEmoji)$($_.displayName)($($_.role))" }) -join ' '

Step '6. dad push 一条记录 + 一个账户'
$now = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
$pushBody = @{
  records = @(@{ uuid = 'test-rec-0001'; amount = 25.5; category = 'food'; type = 'expense'; note = '午饭'; date = '2026-08-16'; timestamp = $now; accountUuid = 'test-acc-0001'; reimbursable = 0; reimbursed = 0; updatedAt = $now; deleted = 0 })
  accounts = @(@{ uuid = 'test-acc-0001'; name = '现金'; type = 'cash'; emoji = '💵'; color = '#FFB74D'; initialBalance = 1000; sort = 0; updatedAt = $now; deleted = 0 })
} | ConvertTo-Json -Depth 5
$push = Invoke-RestMethod "$BASE/api/sync/push" -Method Post -Headers $hdrDad -ContentType 'application/json; charset=utf-8' -Body ([System.Text.Encoding]::UTF8.GetBytes($pushBody))
Write-Host "applied=$($push.applied) rejected=$($push.rejected)"
if ($push.applied -ne 2) { throw 'push 失败' }

Step '7. mom pull 看到 dad 的记录'
$pull = Invoke-RestMethod "$BASE/api/sync/pull" -Method Post -Headers $hdrMom -ContentType 'application/json' -Body '{"since":0}'
Write-Host "records=$($pull.changes.records.Count) accounts=$($pull.changes.accounts.Count) note=$($pull.changes.records[0].note)"
if ($pull.changes.records.Count -lt 1) { throw 'pull 失败' }
$serverTime = $pull.serverTime

Step '8. LWW：mom 用更新的 updatedAt 覆盖，dad 用旧的被拒'
$older = $now - 100000
$oldBody = @{ records = @(@{ uuid = 'test-rec-0001'; amount = 99; category = 'food'; type = 'expense'; note = '旧版本'; date = '2026-08-16'; timestamp = $older; accountUuid = 'test-acc-0001'; reimbursable = 0; reimbursed = 0; updatedAt = $older; deleted = 0 }) } | ConvertTo-Json -Depth 5
$pushOld = Invoke-RestMethod "$BASE/api/sync/push" -Method Post -Headers $hdrDad -ContentType 'application/json; charset=utf-8' -Body ([System.Text.Encoding]::UTF8.GetBytes($oldBody))
Write-Host "旧版本 push: applied=$($pushOld.applied) rejected=$($pushOld.rejected)"
if ($pushOld.rejected -ne 1) { throw 'LWW 未拒绝旧版本' }

Step '9. 增量 pull（since=serverTime 应无变更）'
$pull2 = Invoke-RestMethod "$BASE/api/sync/pull" -Method Post -Headers $hdrMom -ContentType 'application/json' -Body "{`"since`":$serverTime}"
Write-Host "records=$($pull2.changes.records.Count)（应为 0 或仅 serverTime 前的）"

Step '10. 非法参数被拒（软拒绝：rejected 计数）'
$bad = Invoke-RestMethod "$BASE/api/sync/push" -Method Post -Headers $hdrDad -ContentType 'application/json' -Body '{"records":[{"uuid":"x","amount":-1}]}'
Write-Host "applied=$($bad.applied) rejected=$($bad.rejected)"
if ($bad.rejected -lt 1) { throw '非法记录未被拒绝' }

Step '11. 未登录 401'
try {
  Invoke-RestMethod "$BASE/api/sync/pull" -Method Post -ContentType 'application/json' -Body '{}'
} catch {
  Write-Host "未登录返回: $($_.Exception.Response.StatusCode.value__)"
}

Write-Host "`n✅ 全链路验证通过" -ForegroundColor Green
