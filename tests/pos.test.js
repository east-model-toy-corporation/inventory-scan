const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const XLSX = require('xlsx');
const C = require('../js/core');
const {makePosFixture} = require('../scripts/make-pos-fixture');

function parseWorkbook(data) {
  const book = XLSX.read(data,{type:'array',raw:true});
  const sheet = book.SheetNames[0];
  return C.parseMaster(XLSX.utils.sheet_to_json(book.Sheets[sheet],{header:1,raw:true,defval:'',range:0}),sheet);
}

test('detects the POS header in a synthetic BIFF8 workbook and reports import exceptions',() => {
  const items = parseWorkbook(makePosFixture());
  assert.equal(items.length,30);
  assert.deepEqual(items.report,{
    headerRow:4,sheet:'庫存明細查詢(明細)',totalRows:34,skippedTotals:1,blankBarcode:1,
    negativeQty:['DEMO11'],duplicates:['0000000000003'],locations:['測試門市'],suffixed:4
  });
  assert.deepEqual(items.slice(0,5).map(item => item.barcode),
    ['9876543210001','123450000002','0000000000003','007','DEMOITEM']);
  assert.equal(items[2].bookQty,12);
  assert.equal(items[10].bookQty,-1);
  assert.deepEqual(items[0],{barcode:'9876543210001',name:'測試商品01',bookQty:1,sku:'',
    price:100,location:'測試門市',shelf:'R01'});
});

test('uses the first exact quantity heading and skips each supported totals marker',() => {
  const items = C.parseMaster([['型號','品名','合計金額','合計','合計'],
    ['007','測試商品',200,2,7],['合計'],['總計'],['小計']]);
  assert.equal(items[0].bookQty,2);
  assert.equal(items.report.skippedTotals,3);
});

test('suffix lookup indexes multiple variants and supports the UPC alternate',() => {
  const items = [{barcode:'0012345678901'},{barcode:'0012345678901-SMP'},
    {barcode:'POSMULTI-A'},{barcode:'POSMULTI-B'},{barcode:'POS-ONE-SMP'}];
  const suffixes = C.suffixIndex(items);
  assert.deepEqual(C.findVariants(suffixes,'012345678901'),[items[1]]);
  assert.deepEqual(C.findVariants(suffixes,'POSMULTI'),items.slice(2,4));
  assert.deepEqual(C.findVariants(suffixes,'POS-ONE'),items.slice(4));
  assert.deepEqual(C.findVariants(suffixes,'POSMULTI-B'),[]);
  assert.deepEqual(C.findVariants(suffixes,'ABSENT'),[]);
});

const sample = path.join(__dirname,'fixtures/pos-sample.xls');
test('real POS export matches aggregate import expectations',{skip:!fs.existsSync(sample)},() => {
  const items = parseWorkbook(fs.readFileSync(sample));
  assert.equal(items.length,5143);
  assert.equal(items.report.headerRow,4);
  assert.equal(items.report.skippedTotals,1);
  assert.equal(items.report.negativeQty.length,3);
  assert.equal(items.report.duplicates.length,0);
});
