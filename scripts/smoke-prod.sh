#!/usr/bin/env bash
# 對正式 Web App 實測（使用「測試門市」場次，測完結束該場次）。
set -uo pipefail
cd "$(dirname "$0")/.."
URL=${SMOKE_URL:-$(node -p "require('./secrets/deploy_info.json').webAppUrl")}
KEY=${SMOKE_KEY:-$(cat secrets/api_key.txt)}
pass=0; fail=0
check(){ if node -e "const r=JSON.parse(process.argv[1]);process.exit(($2)?0:1)" "$3" 2>/dev/null; then echo "PASS $1"; pass=$((pass+1)); else echo "FAIL $1 :: ${3:0:300}"; fail=$((fail+1)); fi; }
get(){ curl -sSL --max-time 60 "$URL?key=$KEY&$1"; }
post(){ curl -sSL --max-time 60 -H 'Content-Type: text/plain;charset=utf-8' --data-binary "$1" "$URL"; }
r=$(get "action=ping"); check ping "r.ok===true" "$r"
r=$(curl -sSL --max-time 60 "$URL?key=WRONG&action=ping"); check "錯誤金鑰被拒" "r.ok===false&&r.error==='unauthorized'" "$r"
r=$(post '{"action":"startSession","key":"'$KEY'","store":"測試門市","mode":"none","createdBy":"部署測試"}'); check startSession "r.ok&&r.session&&r.session.code" "$r"
CODE=$(node -p "JSON.parse(process.argv[1]).session.code" "$r")
NOW=$(date -u +%Y-%m-%dT%H:%M:%S.000Z)
LINES='[{"id":"SMOKE-1-'$CODE'","session":"'$CODE'","store":"測試門市","counter":"部署測試","device":"curl","barcode":"4904810049586","name":"測試品","qty":3,"createdAt":"'$NOW'","updatedAt":"'$NOW'","deleted":false},{"id":"SMOKE-2-'$CODE'","session":"'$CODE'","store":"測試門市","counter":"部署測試","device":"curl","barcode":"0000000000017","name":"","qty":2,"createdAt":"'$NOW'","updatedAt":"'$NOW'","deleted":false}]'
r=$(post '{"action":"upload","key":"'$KEY'","lines":'"$LINES"'}'); check "上傳 2 筆" "r.ok&&r.acks.length===2&&r.acks.every(a=>a.status==='inserted')" "$r"
r=$(post '{"action":"upload","key":"'$KEY'","lines":'"$LINES"'}'); check "重送不重複" "r.ok&&r.acks.every(a=>a.status==='unchanged')" "$r"
r=$(post '{"action":"startSession","key":"'$KEY'","store":"測試門市","mode":"none","createdBy":"另一人"}'); check "同門市加入同一場次" "r.ok&&r.session.code==='$CODE'" "$r"
r=$(get "action=summary&session=$CODE&device=curl"); check "彙總 2 筆 5 件" "r.ok&&r.totals.lines===2&&r.totals.qty===5" "$r"
r=$(post '{"action":"endSession","key":"'$KEY'","code":"'$CODE'","endedBy":"部署測試"}'); check "結束測試場次" "r.ok" "$r"
r=$(post '{"action":"upload","key":"'$KEY'","lines":'"${LINES/qty\":3/qty\":9}"'}'); check "已結束場次拒絕寫入" "r.ok&&r.rejected.length>=1" "$r"
echo "通過 $pass / 失敗 $fail（測試場次 $CODE，門市「測試門市」，已結束）"
[ $fail -eq 0 ]
