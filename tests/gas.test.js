const {createHash} = require('node:crypto');
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {createGas} = require('./gas-mock');
const base = {id:'A1',session:'S1',store:'萬年總店',counter:'小林',device:'甲',barcode:'001234',
  name:'模型',qty:2,createdAt:'2026-11-24T01:00:00.000Z',updatedAt:'2026-11-24T01:00:00.000Z',deleted:false};
const later = '2026-11-24T01:01:00.000Z';
const upload = (gas, ...lines) => gas.post({action:'upload',lines});
const summary = (gas, device) => gas.get({action:'summary',session:'S1',device});
const startSession = (gas,mode = 'master',store = base.store) =>
  gas.post({action:'startSession',store,createdBy:base.counter,mode});
const session = (gas,mode = 'master',code = 'S1',store = base.store) => {
  gas.setup();
  gas.spreadsheet.getSheetByName('場次').appendRow([code,'例行盤點',store,mode,base.counter,base.createdAt,'進行中']);
};
const rows = (gas,name) => gas.spreadsheet.getSheetByName(name).getDataRange().getValues();

test('setup creates and freezes the required headers',() => {
  const gas = createGas();
  gas.setup();
  gas.setup();
  const expected = {
    主檔:'場次 門市 條碼 品名 帳面數量 貨號',
    場次:'場次代碼 場次名稱 門市 模式 建立者 建立時間 狀態 結束時間 結束者',
    刷讀明細:'時間 場次 門市 盤點人 區域 裝置 條碼 品名 數量 id 更新時間 狀態',
    彙總:'場次 門市 條碼 品名 帳面數量 實盤數量 差異 狀態 盤點人數 最後更新'
  };
  for (const [name,value] of Object.entries(expected)) {
    assert.deepEqual(rows(gas,name),[value.split(' ')]);
    assert.equal(gas.spreadsheet.getSheetByName(name).frozen,1);
  }
});
for (const oldColumn of [null,'舊欄位','區域']) {
  test('migrates detail rows and preserves IDs from layout: '+(oldColumn || '11 columns'),() => {
    const gas = createGas();
    const sheet = gas.spreadsheet.insertSheet('刷讀明細');
    const header = '時間 場次 門市 盤點人 裝置 條碼 品名 數量 id 更新時間 狀態'.split(' ');
    const row = ['2026-11-24 09:00:00',base.session,base.store,base.counter,base.device,
      base.barcode,base.name,base.qty,base.id,base.updatedAt,'有效'];
    if (oldColumn) { header.splice(3,0,oldColumn); row.splice(3,0,'A-01'); }
    sheet.appendRow(header);
    sheet.appendRow(row);
    const migrated = summary(gas);
    const zone = oldColumn === '區域' ? 'A-01' : '';
    assert.equal(migrated.details[0].zone,zone);
    assert.equal(migrated.totals.qty,2);
    assert.equal(upload(gas,{...base,zone,qty:3,updatedAt:later}).acks[0].status,'updated');
    gas.setup();
    const detail = rows(gas,'刷讀明細');
    assert.equal(detail.length,2);
    assert.equal(detail[0].length,12);
    assert.deepEqual(detail[1].slice(3),[base.counter,zone,base.device,base.barcode,base.name,3,base.id,later,'有效']);
  });
}
test('details keep separate zone lines while barcode totals combine all zones',() => {
  const gas = createGas();
  const uploaded = upload(gas,base,{...base,id:'A2',zone:'001'},{...base,id:'A3',zone:'B-02'},
    {...base,id:'bad-type',zone:1},{...base,id:'too-long',zone:'A'.repeat(101)});
  assert.equal(uploaded.acks.length,3);
  assert.equal(uploaded.rejected.length,2);
  assert.equal(upload(gas,{...base,id:'A2',zone:'001',qty:5,updatedAt:later}).acks[0].status,'updated');
  assert.equal(rows(gas,'刷讀明細')[2][4],'001');
  const result = summary(gas);
  assert.deepEqual(result.details.map(line => line.zone),['','001','B-02']);
  assert.deepEqual(result.byZone,[
    {zone:'未填區域',lines:1,qty:2},{zone:'001',lines:1,qty:5},{zone:'B-02',lines:1,qty:2}
  ]);
  assert.deepEqual(result.totals,{lines:3,qty:9,items:1});
  assert.equal(result.items[0].countedQty,9);
});
test('upserts are idempotent, reject older versions and preserve Taipei time and barcode',() => {
  const gas = createGas();
  assert.equal(upload(gas,base).acks[0].status,'inserted');
  assert.equal(upload(gas,base).acks[0].status,'unchanged');
  assert.equal(rows(gas,'刷讀明細').length,2);
  assert.equal(rows(gas,'刷讀明細')[1][0],'2026-11-24 09:00:00');
  assert.equal(rows(gas,'刷讀明細')[1][6],'001234');
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
  assert.equal(rows(gas,'刷讀明細')[3][11],'已刪除');
  const result = summary(gas,'甲');
  assert.deepEqual(result.totals,{lines:2,qty:5,items:1});
  assert.deepEqual(result.byCounter,[{counter:'小林',lines:1,qty:2},{counter:'小陳',lines:1,qty:3}]);
  assert.deepEqual(result.byDevice,[{device:'甲',lines:1,qty:2},{device:'乙',lines:1,qty:3}]);
  assert.equal(result.items[0].mineQty,2);
});
test('master compares all five statuses and writes a sorted all-session summary',() => {
  const gas = createGas();
  session(gas);
  gas.post({action:'master',session:'S1',store:base.store,replace:true,items:[
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
  const sheet = gas.spreadsheet.insertSheet('主檔');
  sheet.appendRow(['門市','條碼','品名','帳面數量','貨號']);
  sheet.appendRow(['',4904810049586,'共用',4,'']);
  sheet.appendRow([base.store,'0000123','門市商品',3,'']);
  sheet.appendRow(['華山','other','其他門市',1,'']);
  const result = gas.get({action:'master',store:base.store});
  assert.deepEqual(result.items.map(item => item.barcode),['4904810049586','0000123']);
  assert.equal(result.source,'store');
  assert.equal(result.count,2);
  gas.setup();
  assert.deepEqual(rows(gas,'主檔')[0],['場次','門市','條碼','品名','帳面數量','貨號']);
  assert.deepEqual(rows(gas,'主檔')[2],['',base.store,'0000123','門市商品',3,'']);
  sheet.appendRow(['',base.store,'4904810049586','門市優先',8,'']);
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
  const first = startSession(gas);
  assert.equal(first.joined,false);
  assert.deepEqual(startSession(gas,'none'),{...first,joined:true});
  const {code} = first.session;
  assert.deepEqual(gas.get({action:'session',code}).session,first.session);
  const sessionRows = rows(gas,'場次');
  assert.equal(sessionRows.length,2);
  const taipei = sessionRows[1][5];
  assert.match(taipei,/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  assert.equal(new Date(taipei.replace(' ','T')+'+08:00').toISOString(),first.session.createdAt);
  const legacy = '2026-11-24T01:00:00.123Z';
  gas.spreadsheet.getSheetByName('場次').getRange(2,6).setValues([[legacy]]);
  assert.equal(gas.get({action:'session',code}).session.createdAt,legacy);
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
  gas.post({action:'master',session:'S1',store:base.store,replace:true,items:[{barcode:'0123456789012',name:'模型',bookQty:3}]});
  upload(gas,{...base,barcode:'123456789012',device:'D-1｜甲'},
    {...base,id:'next',barcode:'0123456789012',device:'D-1｜乙'},
    {...base,id:'other',barcode:'0123456789012',device:'D-2｜乙'});
  const result = summary(gas,'D-1｜乙');
  assert.equal(result.items.length,1);
  assert.equal(result.items[0].mineQty,4);
  assert.equal(result.items[0].countedQty,6);
  assert.equal(result.byDevice.length,2);
});

test('session masters replace only their own rows and override store fallback in summaries',() => {
  const gas = createGas();
  session(gas);
  session(gas,'master','S2','武昌');
  const sheet = gas.spreadsheet.getSheetByName('主檔');
  sheet.appendRow(['','',base.barcode,'門市商品',12,'']);
  const load = code => gas.get({action:'master',session:code});
  const save = (code,items) => gas.post({action:'master',session:code,store:base.store,items,replace:true});
  assert.equal(load('S2').source,'store');
  assert.equal(load('missing').source,'store');
  assert.equal(save('missing',[]).error,'場次不存在');
  assert.equal(save(undefined,[]).error,'場次不存在');
  assert.equal(rows(gas,'主檔').length,2);
  const item = {barcode:base.barcode,name:'場次商品',bookQty:3};
  assert.equal(save('S1',[item,{...item,barcode:'old'}]).count,2);
  assert.equal(save('S2',[{...item,bookQty:7}]).count,1);
  assert.equal(save('S1',[item]).count,1);
  assert.deepEqual(load('S1'),{ok:true,source:'session',count:1,items:[{...item,sku:''}]});
  assert.equal(load('S2').items[0].bookQty,7);
  assert.equal(gas.get({action:'master',store:base.store}).items[0].bookQty,12);
  upload(gas,base);
  assert.equal(summary(gas).items[0].diff,-1);
  assert.equal(save('S1',[]).count,0);
  assert.equal(summary(gas).items[0].diff,-10);
});

test('master accepts 30000 items and rejects larger replacements without changing rows',() => {
  const gas = createGas();
  session(gas);
  const items = Array.from({length:30000},(_,index) => ({barcode:String(index),bookQty:1}));
  const request = {action:'master',session:'S1',replace:true,items};
  assert.equal(gas.post(request).count,30000);
  assert.equal(gas.post({...request,items:[...items,items[0]]}).ok,false);
  assert.equal(gas.get({action:'master',session:'S1'}).count,30000);
});

test('a valid hash bootstraps the key once and the existing property takes precedence',() => {
  const key = '測試-key';
  const keyHash = createHash('sha256').update(key).digest('hex');
  const gas = createGas({key:null,keyHash});
  assert.equal(gas.get({action:'ping',key:'wrong'}).error,'unauthorized');
  assert.equal(gas.props.has('API_KEY'),false);
  assert.equal(gas.post({action:'startSession',store:base.store,createdBy:base.counter,mode:'master',key}).ok,true);
  assert.equal(gas.props.get('API_KEY'),key);
  assert.equal(gas.get({action:'ping',key:'wrong'}).error,'unauthorized');
  gas.props.set('API_KEY','new-key');
  assert.equal(gas.get({action:'ping',key}).error,'unauthorized');
  assert.equal(gas.get({action:'ping',key:'new-key'}).ok,true);
});

test('a second start commits while the first waits for the lock; both return one session',() => {
  let interleave = true, second;
  const gas = createGas({onLockWait:() => {
    if (!interleave) return;
    interleave = false;
    second = startSession(gas,'master','武昌');
  }});
  const first = startSession(gas,'none','武昌');
  assert.equal(second.joined,false);
  assert.equal(first.joined,true);
  assert.deepEqual(first.session,second.session);
  assert.equal(rows(gas,'場次').length,2);
});

test('open sessions keep their Taipei start date across days and close independently by store',() => {
  const gas = createGas();
  let now = Date.parse('2026-11-24T16:30:00Z');
  gas.context.Date = class extends Date { static now() { return now; } };
  const getOpen = store => gas.get({action:'openSession',store});
  assert.equal(getOpen('武昌').session,null);
  const {session} = startSession(gas,'master','武昌');
  assert.equal(session.name,'武昌 2026/11/25');
  const other = startSession(gas,'none','華山').session;
  now += 86400000;
  assert.deepEqual(startSession(gas,'none','武昌').session,session);
  const master = {action:'master',session:session.code,replace:true,ifMissing:true,
    items:[{barcode:base.barcode,bookQty:2}]};
  assert.equal(gas.post(master).count,1);
  assert.equal(gas.post(master).error,'場次已有主檔');
  assert.equal(gas.post({...master,ifMissing:false}).count,1);
  assert.equal(getOpen('武昌').masterCount,1);
  const line = {...base,session:session.code,store:session.store};
  assert.equal(upload(gas,line).acks.length,1);
  const end = {action:'endSession',code:session.code,endedBy:'小陳'};
  const closed = gas.post(end).session;
  assert.equal(closed.status,'已結束');
  assert.equal(closed.endedAt,new Date(now).toISOString());
  assert.equal(closed.endedBy,'小陳');
  assert.deepEqual(gas.post({...end,endedBy:'小林'}).session,closed);
  assert.equal(getOpen('武昌').session,null);
  assert.deepEqual(getOpen('華山').session,other);
  assert.deepEqual(upload(gas,{...line,qty:3,updatedAt:later}).rejected,[{id:line.id,error:'場次已結束'}]);
  assert.equal(gas.post(master).error,'場次已結束');
  assert.equal(gas.get({action:'summary',session:session.code}).totals.qty,2);
  const next = startSession(gas,'none','武昌');
  assert.equal(next.joined,false);
  assert.notEqual(next.session.code,session.code);
  assert.equal(next.session.name,'武昌 2026/11/26');
});

test('legacy duplicate open sessions are closed in place, keeping the newest and historical rows',() => {
  const gas = createGas();
  const sheet = gas.spreadsheet.insertSheet('場次');
  sheet.appendRow('場次代碼 場次名稱 門市 模式 建立者 建立時間 狀態'.split(' '));
  for (const code of ['OLD','NEW']) {
    sheet.appendRow([code,code,'武昌','none','小林',base.createdAt,'進行中']);
  }
  gas.setup();
  gas.setup();
  assert.deepEqual(rows(gas,'場次')[0].slice(7),['結束時間','結束者']);
  assert.equal(gas.get({action:'openSession',store:'武昌'}).session.code,'NEW');
  assert.equal(gas.get({action:'session',code:'OLD'}).session.status,'已結束');
});

test('a 6000-item master formats barcode cells as text before a single batch write',() => {
  const gas = createGas();
  session(gas);
  const sheet = gas.spreadsheet.getSheetByName('主檔');
  const getRange = sheet.getRange.bind(sheet);
  const operations = [];
  sheet.getRange = (row,col,height,width) => {
    const range = getRange(row,col,height,width);
    const {setValues,setNumberFormat} = range;
    range.setValues = values => {
      operations.push(['write',row,col,height,width]);
      return setValues(values);
    };
    range.setNumberFormat = format => {
      if (col === 3) operations.push(['format',row,col,height,width,format]);
      return setNumberFormat(format);
    };
    return range;
  };
  const items = Array.from({length:6000},(_,index) => ({
    barcode:String(index).padStart(13,'0'),name:'測試商品'+index,bookQty:index,sku:''
  }));
  assert.equal(gas.post({action:'master',session:'S1',items,replace:true}).count,6000);
  assert.deepEqual(operations,[['format',2,3,6000,1,'@'],['write',2,1,6000,6]]);
  assert.deepEqual(rows(gas,'主檔').slice(1).map(row => row[2]),items.map(item => item.barcode));
});
