const {test} = require('node:test');
const assert = require('node:assert/strict');
const C = require('../js/core');

test('parseMaster handles BOM, aliases and barcode representations; the last duplicate wins',() => {
  const items = C.parseMaster([
    ['\uFEFF  JAN','商品名稱','庫存','sku'],
    ['000123','舊品名','1','OLD'],
    [],
    ['', '無條碼', '5'],
    [4904810049586,'模型甲',3,'A'],
    ['4.90481E+12','模型乙',2,'B'],
    ['000123','新品名','1,200','NEW']
  ]);
  assert.deepEqual(items,[
    {barcode:'000123',name:'新品名',bookQty:1200,sku:'NEW'},
    {barcode:'4904810049586',name:'模型甲',bookQty:3,sku:'A'},
    {barcode:'4.90481E+12',name:'模型乙',bookQty:2,sku:'B'}
  ]);
});

test('findProduct matches UPC-A and zero-prefixed EAN-13, with exact matches preferred',() => {
  const upc = {barcode:'123456789012'}, ean = {barcode:'0123456789012'};
  assert.equal(C.findProduct(C.masterIndex([upc]),ean.barcode),upc);
  assert.equal(C.findProduct(C.masterIndex([ean]),upc.barcode),ean);
  assert.equal(C.findProduct(C.masterIndex([ean,upc]),upc.barcode),upc);
  assert.equal(C.findProduct(C.masterIndex([ean]),'1123456789012'),undefined);
});

test('upsertScan increments the existing line only within its scope',() => {
  const scope = {session:'S1',store:'萬年總店',counter:'小林',device:'D1'};
  const first = C.upsertScan([],scope,'000123','模型',2,1000);
  const updated = C.upsertScan([first],scope,'000123','模型',3,2000);
  assert.equal(updated.id,first.id);
  assert.equal(updated.createdAt,first.createdAt);
  assert.ok(updated.updatedAt > first.updatedAt);
  assert.equal(updated.qty,5);
  assert.equal(updated.dirty,true);
  const otherCounter = C.upsertScan([updated],{...scope,counter:'小陳'},'000123','模型',1,3000);
  assert.notEqual(otherCounter.id,first.id);
  assert.equal(otherCounter.qty,1);
});

test('sessionCode includes store prefix, local MMDD and an unambiguous suffix',() => {
  const date = new Date(2026,10,24);
  assert.match(C.sessionCode('萬年總店',date),/^WN-1124-[A-HJ-NP-Z2-9]{3}$/);
  assert.match(C.sessionCode('自訂門市',date),/^ST-1124-[A-HJ-NP-Z2-9]{3}$/);
});

test('csv starts with a UTF-8 BOM and retains leading zeros and escaped fields',() => {
  const csv = C.csv([['條碼','品名'],['000123','模型,"甲"']]);
  assert.deepEqual([...Buffer.from(csv).subarray(0,3)],[0xef,0xbb,0xbf]);
  assert.equal(csv,'\uFEFF條碼,品名\r\n000123,"模型,""甲"""');
});

test('searchMaster matches all terms across name, barcode and SKU and caps results',() => {
  const first = {name:'Tomica 合金工程車',barcode:'4904810049586',sku:'ENG-A'};
  const second = {name:'Tomica 合金消防車',barcode:'4904810049807',sku:'FIRE-B'};
  const items = [first,second];
  assert.deepEqual(C.searchMaster(items,'  tOmIcA  工程 '),[first]);
  assert.deepEqual(C.searchMaster(items,'0498 fire-b'),[second]);
  assert.deepEqual(C.searchMaster(items,'合金',1),[first]);
  assert.deepEqual(C.searchMaster(items,'工程 FIRE-B'),[]);
  assert.deepEqual(C.searchMaster(items,'  '),[]);
});
