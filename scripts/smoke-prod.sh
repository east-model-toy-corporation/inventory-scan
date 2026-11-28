#!/usr/bin/env bash
# 對正式 Web App 實測（使用「測試門市」場次，測完結束該場次）。
# 執行前須在環境中設定 INVENTORY_ADMIN_PASSWORD。
set +x
set -uo pipefail
if ! node -e 'process.exit(process.env.INVENTORY_ADMIN_PASSWORD ? 0 : 1)'; then
  echo '必須設定 INVENTORY_ADMIN_PASSWORD 環境變數' >&2
  exit 1
fi
cd "$(dirname "$0")/.."
URL=${SMOKE_URL:-$(node -p "require('./secrets/deploy_info.json').webAppUrl")}
KEY=${SMOKE_KEY:-$(cat secrets/api_key.txt)}
pass=0; fail=0
check(){ if node -e "const r=JSON.parse(process.argv[1]);process.exit(($2)?0:1)" "$3" 2>/dev/null; then echo "PASS $1"; pass=$((pass+1)); else echo "FAIL $1"; fail=$((fail+1)); return 1; fi; }
get(){ curl -sSL --max-time 60 "$URL?key=$KEY&$1"; }
post(){ curl -sSL --max-time 60 -H 'Content-Type: text/plain;charset=utf-8' --data-binary "$1" "$URL"; }
r=$(get "action=ping"); check ping "r.ok===true" "$r"
r=$(curl -sSL --max-time 60 "$URL?key=WRONG&action=ping"); check "錯誤金鑰被拒" "r.ok===false&&r.error==='unauthorized'" "$r"
r=$(get "action=openSession&store=%E6%B8%AC%E8%A9%A6%E9%96%80%E5%B8%82")
check "測試門市無進行中場次" "r.ok&&r.session===null" "$r" || exit 1
r=$(post '{"action":"startSession","key":"'$KEY'","store":"測試門市","mode":"none","createdBy":"部署測試"}')
check startSession "r.ok&&r.joined===false&&r.session.store==='測試門市'&&/^ST-[0-9]{8}-[A-Z0-9]+$/.test(r.session.code)" "$r" || exit 1
CODE=$(node -p "JSON.parse(process.argv[1]).session.code" "$r") || exit 1
NOW=$(date -u +%Y-%m-%dT%H:%M:%S.000Z)
LINES='[{"id":"SMOKE-1-'$CODE'","session":"'$CODE'","store":"測試門市","counter":"部署測試","device":"curl","barcode":"4904810049586","name":"測試品","qty":3,"createdAt":"'$NOW'","updatedAt":"'$NOW'","deleted":false},{"id":"SMOKE-2-'$CODE'","session":"'$CODE'","store":"測試門市","counter":"部署測試","device":"curl","barcode":"0000000000017","name":"","qty":2,"createdAt":"'$NOW'","updatedAt":"'$NOW'","deleted":false}]'
upload_lines(){ post '{"action":"upload","key":"'$KEY'","lines":'"$1"'}'; }
finish_smoke(){
  local deleted response
  deleted=$(node -e '
    const lines = JSON.parse(process.argv[1]);
    for (const line of lines) {
      line.deleted = true;
      line.updatedAt = new Date(Date.parse(line.updatedAt)+1).toISOString();
    }
    process.stdout.write(JSON.stringify(lines));
  ' "$LINES")
  response=$(upload_lines "$deleted")
  check "清除有效測試明細" "r.ok&&r.acks.length===2&&r.acks.every(a=>['updated','inserted'].includes(a.status))" "$response"
  response=$(node -e '
    const [key,code] = process.argv.slice(1);
    process.stdout.write(JSON.stringify({action:"endSession",key,code,endedBy:"部署測試",
      password:process.env.INVENTORY_ADMIN_PASSWORD}));
  ' "$KEY" "$CODE" | curl -sSL --max-time 60 -H 'Content-Type: text/plain;charset=utf-8' --data-binary @- "$URL")
  check "結束測試場次" "r.ok&&r.session.status==='已結束'&&r.session.store==='測試門市'" "$response"
}
r=$(upload_lines "$LINES"); check "上傳 2 筆" "r.ok&&r.acks.length===2&&r.acks.every(a=>a.status==='inserted')" "$r"
r=$(upload_lines "$LINES"); check "重送不重複" "r.ok&&r.acks.every(a=>a.status==='unchanged')" "$r"
r=$(post '{"action":"startSession","key":"'$KEY'","store":"測試門市","mode":"none","createdBy":"另一人"}'); check "同門市加入同一場次" "r.ok&&r.session.code==='$CODE'" "$r"
r=$(get "action=summary&session=$CODE&device=curl"); check "彙總 2 筆 5 件" "r.ok&&r.totals.lines===2&&r.totals.qty===5" "$r"
if finish_smoke; then
  r=$(upload_lines "$LINES"); check "已結束場次拒絕寫入" "r.ok&&r.rejected.length===2&&r.rejected.every(a=>a.error==='場次已結束')" "$r"
fi
echo "通過 $pass / 失敗 $fail（測試門市場次 $CODE）"
[ $fail -eq 0 ]
