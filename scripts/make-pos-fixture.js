const fs = require('node:fs');
const path = require('node:path');
const XLSX = require('xlsx');

function makePosFixture() {
  const headers = ['商品型號','品名規格','庫點','單價','折扣','合計','金額','F','F',
    ...Array(16).fill(''),'架號','上架日','最後日'];
  const codes = ['9876543210001','123450000002','0000000000003','007','DEMOITEM',
    'POSSINGLE-SMP','POSMULTI-SMP','POSMULTI-B','POSBASE','POSBASE-SMP'];
  const products = Array.from({length:30},(_,index) => {
    const number = String(index+1).padStart(2,'0');
    const qty = index === 10 ? -1 : index+1;
    return [codes[index] || 'DEMO'+number,'測試商品'+number,'測試門市',100,0,qty,qty*100,0,qty,
      ...Array(16).fill(0),'R01','',''];
  });
  const rows = [[],['庫存明細查詢(明細)'],['製表日期:20260101   品牌區間:~'],headers,
    ...products,[...products[2].slice(0,5),12],[],['','測試空條碼'],['合計','','','','',100]];
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet['!merges'] = ['A2:AB2','A3:AB3','A38:E38'].map(XLSX.utils.decode_range);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book,sheet,'庫存明細查詢(明細)');
  return XLSX.write(book,{type:'buffer',bookType:'biff8'});
}

if (require.main === module) {
  const file = path.join(__dirname,'../tests/fixtures/pos-synthetic.xls');
  fs.mkdirSync(path.dirname(file),{recursive:true});
  fs.writeFileSync(file,makePosFixture());
}
module.exports = {makePosFixture};
