#!/usr/bin/env bash
# 建立（第一次）或更新 GAS 專案與網頁應用程式部署。需先 clasp login（buyer@ehobby.com.tw）。
set -euo pipefail
cd "$(dirname "$0")/.."
[ -s secrets/api_key.txt ] || { echo "缺少 secrets/api_key.txt"; exit 1; }
node scripts/prepare-deploy.js
node scripts/make-config.js
cd deploy
if [ ! -f .clasp.json ]; then
  clasp create-script --type sheets --title "條碼盤點紀錄" --rootDir .
  # create 可能會拉回預設 appsscript.json，重新覆蓋成我們的版本
  (cd .. && node scripts/prepare-deploy.js && node scripts/make-config.js)
fi
ls -la
clasp push -f
DEP_FILE=../secrets/deployment_id.txt
if [ -s "$DEP_FILE" ]; then
  clasp create-deployment -i "$(cat $DEP_FILE)" -d "update $(date +%F_%H%M)"
else
  out=$(clasp create-deployment -d "v1 $(date +%F_%H%M)")
  echo "$out"
  echo "$out" | grep -oE 'AKfy[A-Za-z0-9_-]+' | head -1 > "$DEP_FILE"
fi
node -e "
const c=require('./.clasp.json');const d=require('fs').readFileSync('$DEP_FILE','utf8').trim();
const info={scriptId:c.scriptId,spreadsheetId:c.parentId&&[].concat(c.parentId)[0],
 spreadsheetUrl:c.parentId?'https://docs.google.com/spreadsheets/d/'+[].concat(c.parentId)[0]+'/edit':'',
 editorUrl:'https://script.google.com/home/projects/'+c.scriptId+'/edit',webAppUrl:'https://script.google.com/macros/s/'+d+'/exec'};
require('fs').writeFileSync('../secrets/deploy_info.json',JSON.stringify(info,null,2));console.log(info)"
