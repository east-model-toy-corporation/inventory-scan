const {test} = require('node:test');
const assert = require('node:assert/strict');
const {createGas} = require('./gas-mock');
const base = {id:'A1',session:'S1',store:'萬年總店',counter:'小林',device:'甲',barcode:'001234',
  name:'模型',qty:2,createdAt:'2026-11-24T01:00:00.000Z',updatedAt:'2026-11-24T01:00:00.000Z',deleted:false};
const later = '2026-11-24T01:01:00.000Z';
const upload = (gas, ...lines) => gas.post({action:'upload',lines});
const summary = (gas, device) => gas.get({action:'summary',session:'S1',device});
const session = (gas,mode = 'master') => gas.post({action:'createSession',code:'S1',name:'例行盤點',
  store:base.store,createdBy:base.counter,mode});
const rows = (gas,name) => gas.spreadsheet.getSheetByName(name).getDataRange().getValues();

test('setup creates and freezes the required headers',() => {
  const gas = createGas();
  gas.setup();
  gas.setup();
  const expected = {
    主檔:'門市 條碼 品名 帳面數量 貨號',
    場次:'場次代碼 場次名稱 門市 模式 建立者 建立時間 狀態',
    刷讀明細:'時間 場次 門市 盤點人 裝置 條碼 品名 數量 id 更新時間 狀態',
    彙總:'場次 門市 條碼 品名 帳面數量 實盤數量 差異 狀態 盤點人數 最後更新'
  };
  for (const [name,value] of Object.entries(expected)) {
    assert.deepEqual(rows(gas,name),[value.split(' ')]);
    assert.equal(gas.spreadsheet.getSheetByName(name).frozen,1);
  }
});
test('existing detail sheets retain rows and IDs when the old fourth column is removed',() => {
  const gas = createGas();
  const sheet = gas.spreadsheet.insertSheet('刷讀明細');
  sheet.appendRow('時間 場次 門市 舊欄位 盤點人 裝置 條碼 品名 數量 id 更新時間 狀態'.split(' '));
  sheet.appendRow(['2026-11-24 09:00:00',base.session,base.store,'A',base.counter,base.device,
    base.barcode,base.name,base.qty,base.id,base.updatedAt,'有效']);
  assert.equal(summary(gas).totals.qty,2);
  assert.equal(upload(gas,{...base,qty:3,updatedAt:later}).acks[0].status,'updated');
  gas.setup();
  const detail = rows(gas,'刷讀明細');
  assert.equal(detail.length,2);
  assert.equal(detail[0].length,11);
  assert.deepEqual(detail[1].slice(3),[base.counter,base.device,base.barcode,base.name,3,base.id,later,'有效']);
});
test('upserts are idempotent, reject older versions and preserve Taipei time and barcode',() => {
  const gas = createGas();
  assert.equal(upload(gas,base).acks[0].status,'inserted');
  assert.equal(upload(gas,base).acks[0].status,'unchanged');
  assert.equal(rows(gas,'刷讀明細').length,2);
  assert.equal(rows(gas,'刷讀明細')[1][0],'2026-11-24 09:00:00');
  assert.equal(rows(gas,'刷讀明細')[1][5],'001234');
  assert.equal(upload(gas,{...base,qty:5,updatedAt:later}).acks[0].status,'updated');
  assert.deepEqual(upload(gas,base).acks[0],{id:base.id,updatedAt:later,status:'stale'});
  assert.equal(summary(gas).totals.qty,5);
});
test('deleted lines are excluded from totals and grouped summaries',() => {
  const gas = createGas();
  session(gas,'none');
  upload(gas,base,{...base,id:'B1',device:'乙',counter:'小陳',qty:3},
    {...base,id:'A2',barcode:'999',qty:10});
  upload(gas,{...base,id:'A2',barcode:'999',deleted:true,updatedAt:later});
  assert.equal(rows(gas,'刷讀明細')[3][10],'已刪除');
  const result = summary(gas,'甲');
  assert.deepEqual(result.totals,{lines:2,qty:5,items:1});
  assert.deepEqual(result.byCounter,[{counter:'小林',lines:1,qty:2},{counter:'小陳',lines:1,qty:3}]);
  assert.deepEqual(result.byDevice,[{device:'甲',lines:1,qty:2},{device:'乙',lines:1,qty:3}]);
  assert.equal(result.items[0].mineQty,2);
});
test('master compares all five statuses and writes a sorted all-session summary',() => {
  const gas = createGas();
  session(gas);
  gas.post({action:'master',store:base.store,replace:true,items:[
    {barcode:'001234',name:'模型',bookQty:1},
    {barcode:'P2',name:'商品二',bookQty:5},
    {barcode:'P3',name:'商品三',bookQty:2},
    {barcode:'P4',name:'商品四',bookQty:4}
  ]});
  upload(gas,base,...['P2','P3','P5'].map(barcode => ({...base,id:barcode,barcode})),{...base,id:'Z',session:'Z'});
  const items = summary(gas).items;
  assert.deepEqual(items.map(item => [item.barcode,item.countedQty,item.diff,item.status]),[
    ['001234',2,1,'盤盈'],['P2',2,-3,'盤虧'],['P3',2,0,'相符'],['P4',0,-4,'未盤'],['P5',2,'','主檔查無']
  ]);
  const sheet = rows(gas,'彙總').slice(1);
  assert.equal(sheet.length,6);
  assert.deepEqual(sheet[0],['S1',base.store,'001234','模型',1,2,1,'盤盈',1,'2026-11-24 09:00:00']);
  assert.equal(sheet[3][9],'');
  assert.equal(items[0].updatedAt,base.updatedAt);
  assert.equal(sheet[5][0],'Z');
});
test('master reads numeric cells as strings, preserves zeros and applies store precedence',() => {
  const gas = createGas();
  gas.setup();
  const sheet = gas.spreadsheet.getSheetByName('主檔');
  sheet.appendRow(['',4904810049586,'共用',4,'']);
  sheet.appendRow([base.store,'0000123','門市商品',3,'']);
  sheet.appendRow(['華山','other','其他門市',1,'']);
  const result = gas.get({action:'master',store:base.store});
  assert.deepEqual(result.items.map(item => item.barcode),['4904810049586','0000123']);
  gas.post({action:'master',store:base.store,replace:true,items:[{barcode:'4904810049586',name:'門市優先',bookQty:8}]});
  assert.equal(gas.get({action:'master',store:base.store}).items[0].name,'門市優先');
  assert.equal(gas.get({action:'master',store:'華山'}).items.length,2);
});
test('API key enforcement and session creation are consistent',() => {
  const gas = createGas();
  assert.deepEqual(gas.get({action:'ping',key:'wrong'}),{ok:false,error:'unauthorized'});
  assert.equal(gas.post({action:'upload',key:''}).error,'unauthorized');
  assert.equal(createGas({key:null}).get({action:'ping'}).error,'unauthorized');
  assert.equal(gas.get({action:'ping'}).ok,true);
  assert.equal(gas.get({action:'session',code:'S1'}).session,null);
  const first = session(gas);
  assert.deepEqual(session(gas,'none'),first);
  assert.deepEqual(gas.get({action:'session',code:'S1'}).session,first.session);
  const sessionRows = rows(gas,'場次');
  assert.equal(sessionRows.length,2);
  const taipei = sessionRows[1][5];
  assert.match(taipei,/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  assert.equal(new Date(taipei.replace(' ','T')+'+08:00').toISOString(),first.session.createdAt);
  const legacy = '2026-11-24T01:00:00.123Z';
  gas.spreadsheet.getSheetByName('場次').getRange(2,6).setValues([[legacy]]);
  assert.equal(gas.get({action:'session',code:'S1'}).session.createdAt,legacy);
});
test('invalid lines are rejected without discarding valid lines',() => {
  const gas = createGas();
  const result = upload(gas,base,{...base,id:'long',barcode:'X'.repeat(65)},
    {...base,id:'bad-qty',qty:1.5},{...base,id:'bad-time',updatedAt:'yesterday'},
    {...base,id:'bad-counter',counter:''},{...base,id:'negative',qty:-1},null);
  assert.equal(result.acks.length,1);
  assert.equal(result.rejected.length,6);
  assert.equal(rows(gas,'刷讀明細').length,2);
  assert.equal(upload(gas,...Array(501).fill(base)).ok,false);
});
test('UPC aliases, distinct devices with the same name and renamed devices aggregate correctly',() => {
  const gas = createGas();
  session(gas);
  gas.post({action:'master',store:base.store,replace:true,items:[{barcode:'0123456789012',name:'模型',bookQty:3}]});
  upload(gas,{...base,barcode:'123456789012',device:'D-1｜甲'},
    {...base,id:'next',barcode:'0123456789012',device:'D-1｜乙'},
    {...base,id:'other',barcode:'0123456789012',device:'D-2｜乙'});
  const result = summary(gas,'D-1｜乙');
  assert.equal(result.items.length,1);
  assert.equal(result.items[0].mineQty,4);
  assert.equal(result.items[0].countedQty,6);
  assert.equal(result.byDevice.length,2);
});
