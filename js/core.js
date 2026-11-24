(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.InvCore = factory();
})(typeof self === 'undefined' ? this : self, function () {
  const clean = value => String(value == null ? '' : value).trim();
  const random = (length, alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789') =>
    Array.from({length}, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
  const pad = value => String(value).padStart(2,'0');
  const dateParts = date => [date.getFullYear(),pad(date.getMonth()+1),pad(date.getDate()),pad(date.getHours()),pad(date.getMinutes())];
  function sessionCode(store, date = new Date()) {
    const initials = {'萬年總店':'WN','華山':'HS','夢時代':'DM','武昌':'WC','大江':'DJ'};
    const parts = dateParts(date);
    return (initials[store] || clean(store).replace(/[^a-z0-9]/gi,'').slice(0,4).toUpperCase() || 'ST') +
      '-' + parts.slice(1,3).join('') + '-' + random(3);
  }
  function barcodeText(value) {
    if (typeof value === 'number' && Number.isInteger(value)) return value.toLocaleString('en-US',{useGrouping:false,maximumFractionDigits:0});
    const text = clean(value);
    const match = /^(\d+)(?:\.(\d+))?[eE]([+-]?\d{1,3})$/.exec(text);
    if (!match) return text;
    const digits = match[1] + (match[2] || '');
    const point = match[1].length + Number(match[3]);
    if (point > digits.length || point < 1 || /[1-9]/.test(digits.slice(point))) return text;
    return digits.slice(0,point);
  }
  const masterIndex = items => new Map(items.map(item => [item.barcode,item]));
  function findProduct(master, code) {
    const alternate = /^0\d{12}$/.test(code) ? code.slice(1) : /^\d{12}$/.test(code) ? '0' + code : '';
    return master.get(code) || master.get(alternate);
  }
  function parseMaster(rows) {
    const aliases = [
      ['條碼','barcode','國際條碼','jan','ean'], ['品名','商品名稱','name'],
      ['帳面數量','帳面','庫存','數量','qty'], ['貨號','sku']
    ];
    const headers = (rows[0] || []).map(value => clean(String(value ?? '').replace(/\uFEFF/g,'')).toLowerCase());
    const [code,name,qty,sku] = aliases.map(options => headers.findIndex(header => options.includes(header)));
    if ([code,name,qty].includes(-1)) throw new Error('找不到條碼、品名或帳面數量欄位');
    const items = new Map();
    for (const row of rows.slice(1)) {
      const barcode = barcodeText(row[code]);
      if (!barcode) continue;
      if (barcode.length > 64) throw new Error('條碼最多 64 字');
      const bookQty = Number(clean(row[qty]).replace(/,/g,''));
      if (!Number.isFinite(bookQty)) throw new Error('帳面數量格式錯誤：' + barcode);
      // 如有重複條碼，以最後一列的資料為準。
      items.set(barcode,{barcode,name:clean(row[name]),bookQty,sku:clean(row[sku])});
    }
    return [...items.values()];
  }
  const sameScope = (line, scope) => ['session','store','counter','device'].every(key => line[key] === scope[key]);
  function upsertScan(lines, scope, barcode, name, qty, now = Date.now()) {
    const old = lines.find(line => !line.deleted && line.barcode === barcode && sameScope(line,scope));
    if (old) return editLine(old,{qty:old.qty+qty,name:name || old.name},now);
    const createdAt = new Date(now).toISOString();
    return {...scope,id:scope.device+'-'+now.toString(36)+'-'+random(8),barcode,name,qty,
      createdAt,updatedAt:createdAt,deleted:false,dirty:true};
  }
  function editLine(line, patch, now = Date.now()) {
    return {...line,...patch,dirty:true,updatedAt:new Date(Math.max(now,Date.parse(line.updatedAt)+1)).toISOString()};
  }
  function deduped(seen, code, source, windowMs, now = Date.now()) {
    if (source !== 'camera' || !windowMs) return false;
    for (const [key,time] of seen) if (now-time >= windowMs) seen.delete(key);
    if (seen.has(code)) return true;
    seen.set(code,now);
    return false;
  }
  const batch = lines => lines.filter(line => line.dirty).slice(0,200);
  const acknowledged = (line, ack, sent) => line && sent && line.updatedAt === sent.updatedAt &&
    ack.id === line.id && Date.parse(ack.updatedAt) >= Date.parse(line.updatedAt);
  function itemStatus(bookQty, qty) {
    if (bookQty === '') return '主檔查無';
    if (qty === 0) return '未盤';
    return qty > bookQty ? '盤盈' : qty < bookQty ? '盤虧' : '相符';
  }
  const deviceId = value => value.split('｜',1)[0];
  function summarize(session, lines, master, device) {
    const compare = session.mode === 'master';
    const groups = ['counter','device'];
    const buckets = groups.map(() => new Map());
    const items = new Map();
    const details = lines.filter(line => line.session === session.code && !line.deleted);
    const deviceNames = new Map();
    let qty = 0;
    for (const line of details) {
      const product = compare && findProduct(master,line.barcode);
      const barcode = product ? product.barcode : line.barcode;
      if (!items.has(barcode)) items.set(barcode,{barcode,name:product ? product.name : line.name,
        bookQty:product ? product.bookQty : '',countedQty:0,mineQty:0});
      const item = items.get(barcode);
      item.countedQty += line.qty;
      if (deviceId(line.device) === deviceId(device)) item.mineQty += line.qty;
      qty += line.qty;
      groups.forEach((key,index) => {
        const value = key === 'device' ? deviceId(line.device) : line[key];
        if (key === 'device' && line.device.includes('｜')) deviceNames.set(value,line.device);
        const bucket = buckets[index];
        if (!bucket.has(value)) bucket.set(value,{[key]:value,lines:0,qty:0});
        bucket.get(value).lines++;
        bucket.get(value).qty += line.qty;
      });
    }
    const totals = {lines:details.length,qty,items:items.size};
    if (compare) for (const product of master.values()) {
      if (!items.has(product.barcode)) items.set(product.barcode,{...product,countedQty:0,mineQty:0});
    }
    const [byCounter,byDevice] = buckets.map(bucket => [...bucket.values()]);
    return {session,totals,byCounter,byDevice:byDevice.map(row => ({...row,device:deviceNames.get(row.device) || row.device})),details,
      items:[...items.values()].sort((a,b) => a.barcode.localeCompare(b.barcode)).map(item => ({
        ...item,diff:item.bookQty === '' ? '' : item.countedQty-item.bookQty,
        status:compare ? itemStatus(item.bookQty,item.countedQty) : ''
      }))};
  }
  const itemRows = items => [['條碼','品名','帳面','實盤','差異','狀態'],...items.map(item =>
    [item.barcode,item.name,item.bookQty,item.countedQty,item.diff,item.status])];
  const groupRows = (rows,key,label) => [[label,'筆數','件數'],...rows.map(row => [row[key],row.lines,row.qty])];
  function exportRows(summary) {
    return {
      彙總:itemRows(summary.items),
      明細:[['時間','場次','門市','盤點人','裝置','條碼','品名','數量'],...summary.details.map(line =>
        [line.createdAt,line.session,line.store,line.counter,line.device,line.barcode,line.name,line.qty])],
      依人員:groupRows(summary.byCounter,'counter','盤點人')
    };
  }
  function csv(rows) {
    return '\uFEFF'+rows.map(row => row.map(value => {
      const text = String(value == null ? '' : value);
      const safe = typeof value === 'string' && /^\s*[=+@-]/.test(text) ? "'" + text : text;
      return /[",\r\n]/.test(safe) ? '"' + safe.replace(/"/g,'""') + '"' : safe;
    }).join(',')).join('\r\n');
  }
  function filename(session, extension, date = new Date()) {
    const parts = dateParts(date);
    return '盤點_'+session+'_'+parts.slice(0,3).join('')+'-'+parts.slice(3).join('')+'.'+extension;
  }
  return {clean,random,sessionCode,barcodeText,masterIndex,findProduct,parseMaster,sameScope,
    upsertScan,editLine,deduped,batch,acknowledged,itemStatus,summarize,itemRows,exportRows,groupRows,csv,filename};
});
