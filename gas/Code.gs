const HEADERS = {
  主檔: ['場次','門市','條碼','品名','帳面數量','貨號'],
  場次: ['場次代碼','場次名稱','門市','模式','建立者','建立時間','狀態'],
  刷讀明細: ['時間','場次','門市','盤點人','裝置','條碼','品名','數量','id','更新時間','狀態'],
  彙總: ['場次','門市','條碼','品名','帳面數量','實盤數量','差異','狀態','盤點人數','最後更新']
};
const clean = value => String(value == null ? '' : value).trim();
const stamp = value => new Date(value).toISOString();
const taipeiTime = value => Utilities.formatDate(new Date(value),'Asia/Taipei','yyyy-MM-dd HH:mm:ss');
const readTaipeiTime = value => typeof value === 'string' && /^\d{4}-\d\d-\d\d /.test(value) ?
  stamp(value.replace(' ', 'T') + '+08:00') : stamp(value);
const byBarcode = (a, b) => a.barcode.localeCompare(b.barcode);
function locked(work) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const result = work();
    SpreadsheetApp.flush();
    return result;
  } finally { lock.releaseLock(); }
}
function sheets() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('SPREADSHEET_ID');
  const book = id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
  if (!book) throw new Error('請先執行 setup');
  return Object.fromEntries(Object.entries(HEADERS).map(([name, headers]) => {
    const sheet = book.getSheetByName(name) || book.insertSheet(name);
    if (!sheet.getLastRow()) {
      ensureSize(sheet, 1, headers.length);
      sheet.getRange(1,1,1,headers.length).setValues([headers]).setFontWeight('bold').setBackground('#e5f1ee');
      sheet.setFrozenRows(1);
    } else if (name === '主檔' && sheet.getRange(1,1).getValues()[0][0] === '門市') {
      sheet.insertColumnBefore(1);
      sheet.getRange(1,1).setValue('場次').setFontWeight('bold').setBackground('#e5f1ee');
      sheet.setFrozenRows(1);
    } else if (name === '刷讀明細' && sheet.getLastColumn() >= headers.length + 1) {
      const previous = sheet.getRange(1,1,1,headers.length + 1).getValues()[0];
      // 舊版明細在門市後多一欄，刪除該欄即可保留原有資料與格式。
      if (headers.every((header,index) => header === previous[index < 3 ? index : index + 1])) {
        sheet.deleteColumn(4);
      }
    }
    return [name, sheet];
  }));
}
function setup() {
  return locked(() => {
    const book = SpreadsheetApp.getActiveSpreadsheet();
    if (book) PropertiesService.getScriptProperties().setProperty('SPREADSHEET_ID', book.getId());
    sheets();
  });
}
function ensureSize(sheet, rows, cols) {
  if (rows > sheet.getMaxRows()) sheet.insertRowsAfter(sheet.getMaxRows(), rows - sheet.getMaxRows());
  if (cols > sheet.getMaxColumns()) sheet.insertColumnsAfter(sheet.getMaxColumns(), cols - sheet.getMaxColumns());
}
function write(sheet, start, rows, textCols) {
  if (!rows.length) return;
  ensureSize(sheet, start + rows.length - 1, rows[0].length);
  for (const col of textCols) sheet.getRange(start,col,rows.length,1).setNumberFormat('@');
  sheet.getRange(start,1,rows.length,rows[0].length).setValues(rows.map(row =>
    row.map(value => typeof value === 'string' && /^[=']/.test(value) ? "'" + value : value)));
}
function replaceRows(sheet, rows, cols) {
  const previous = sheet.getLastRow();
  write(sheet, 2, rows, cols);
  if (previous > rows.length + 1) sheet.getRange(rows.length + 2, 1, previous - rows.length - 1, sheet.getLastColumn()).clearContent();
}
const read = sheet => sheet.getDataRange().getValues().slice(1).filter(row => row.some(value => value !== ''));
const deviceId = value => clean(value).split('｜',1)[0];
const barcodeText = value => clean(value).replace(/^(\d+)\.0+$/, '$1');
function indexMaster(rows) {
  const sessions = new Map(), stores = new Map();
  for (const [session, store, code, name, qty, sku] of rows) {
    const barcode = barcodeText(code);
    if (!barcode) continue;
    const scope = clean(session);
    const index = scope ? sessions : stores;
    const key = scope || clean(store);
    if (!index.has(key)) index.set(key,new Map());
    index.get(key).set(barcode,{barcode,name:clean(name),bookQty:Number(qty) || 0,sku:clean(sku)});
  }
  return {sessions,stores};
}
function masterFor({sessions,stores}, code, store) {
  if (sessions.has(code)) return {master:sessions.get(code),source:'session'};
  const master = new Map([...(stores.get('') || []), ...(stores.get(store) || [])]);
  return {master,source:master.size ? 'store' : 'none'};
}
function asSession([code,name,store,mode,createdBy,createdAt,status]) {
  return {code,name,store,mode,createdBy,createdAt:createdAt ? readTaipeiTime(createdAt) : '',status};
}
function asLine([createdAt,session,store,counter,device,barcode,name,qty,id,updatedAt,status]) {
  if (typeof createdAt === 'string' && /^\d{4}-\d\d-\d\d /.test(createdAt)) {
    createdAt = stamp(createdAt.replace(' ', 'T') + '+08:00');
  }
  return {createdAt,session,store,counter,device,barcode:barcodeText(barcode),name,qty:Number(qty),id,
    updatedAt: stamp(updatedAt),deleted:status === '已刪除'};
}
function asRow(line) {
  return [taipeiTime(line.createdAt),
    line.session,line.store,line.counter,line.device,line.barcode,line.name,line.qty,line.id,
    line.updatedAt,line.deleted ? '已刪除' : '有效'];
}
function itemStatus(bookQty, count) {
  if (bookQty === '') return '主檔查無';
  if (!count) return '未盤';
  return count > bookQty ? '盤盈' : count < bookQty ? '盤虧' : '相符';
}
function calculateSummary(session, lines, master, device) {
  const compare = session && session.mode === 'master';
  const groups = ['counter','device'];
  const buckets = groups.map(() => new Map());
  const items = new Map();
  const details = [], tombstones = [];
  const deviceNames = new Map();
  let qty = 0;
  let updatedAt = '';
  for (const line of lines) {
    if (line.updatedAt > updatedAt) updatedAt = line.updatedAt;
    if (line.deleted) { tombstones.push(line); continue; }
    details.push(line);
    const alternate = /^0\d{12}$/.test(line.barcode) ? line.barcode.slice(1) :
      /^\d{12}$/.test(line.barcode) ? '0' + line.barcode : '';
    const product = compare && (master.get(line.barcode) || master.get(alternate));
    const barcode = product ? product.barcode : line.barcode;
    if (!items.has(barcode)) items.set(barcode, {barcode, name: product ? product.name : line.name,
      bookQty: product ? product.bookQty : '', countedQty:0, mineQty:0, counters:new Set(), updatedAt:''});
    const item = items.get(barcode);
    item.countedQty += line.qty;
    if (deviceId(line.device) === deviceId(device)) item.mineQty += line.qty;
    item.counters.add(line.counter);
    if (line.updatedAt > item.updatedAt) item.updatedAt = line.updatedAt;
    qty += line.qty;
    groups.forEach((key, index) => {
      const bucket = buckets[index];
      const value = key === 'device' ? deviceId(line.device) : line[key];
      if (key === 'device' && line.device.includes('｜')) deviceNames.set(value,line.device);
      if (!bucket.has(value)) bucket.set(value, {[key]:value, lines:0,qty:0});
      bucket.get(value).lines++;
      bucket.get(value).qty += line.qty;
    });
  }
  const totals = {lines:details.length, qty, items:items.size};
  if (compare) for (const product of master.values()) {
    if (!items.has(product.barcode)) items.set(product.barcode, {...product,countedQty:0,mineQty:0,counters:new Set(),updatedAt:''});
  }
  const [byCounter,byDevice] = buckets.map(bucket => [...bucket.values()]);
  return {session, totals, byCounter, byDevice:byDevice.map(row => ({...row,device:deviceNames.get(row.device) || row.device})), details, tombstones, updatedAt,
    items:[...items.values()].sort(byBarcode).map(({counters,...item}) => ({
      ...item, counterCount:counters.size, diff:item.bookQty === '' ? '' : item.countedQty - item.bookQty,
      status:compare ? itemStatus(item.bookQty,item.countedQty) : ''
    }))};
}
function rebuild(s, lines, requested, device) {
  const masters = indexMaster(read(s.主檔));
  const sessions = new Map(read(s.場次).map(row => [clean(row[0]),asSession(row)]));
  const groups = new Map([...sessions.keys()].map(code => [code,[]]));
  for (const line of lines) {
    if (!groups.has(line.session)) groups.set(line.session,[]);
    groups.get(line.session).push(line);
  }
  const rows = [];
  let result = calculateSummary(null,[],new Map(),device);
  for (const code of [...groups.keys()].sort()) {
    const group = groups.get(code);
    const session = sessions.get(code) || {code,store:group[0].store,mode:'none'};
    const summary = calculateSummary(session,group,masterFor(masters,code,session.store).master,device);
    if (code === requested) result = summary;
    for (const item of summary.items) rows.push([code,session.store,item.barcode,item.name,item.bookQty,
      item.countedQty,item.diff,item.status,item.counterCount,item.updatedAt ? taipeiTime(item.updatedAt) : '']);
  }
  replaceRows(s.彙總,rows,[1,3,10]);
  return result;
}
function validateLine(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('明細格式錯誤');
  const line = {};
  for (const key of ['id','session','store','counter','device','barcode','name']) {
    if (typeof raw[key] !== 'string' && key !== 'name') throw new Error('欄位錯誤：' + key);
    line[key] = clean(raw[key]);
    if ((!line[key] && key !== 'name') || line[key].length > (key === 'barcode' ? 64 : 500)) throw new Error('欄位錯誤：' + key);
  }
  if (!Number.isInteger(raw.qty) || raw.qty < 0 || raw.qty > 999999) throw new Error('數量錯誤');
  if (raw.deleted !== undefined && typeof raw.deleted !== 'boolean') throw new Error('狀態錯誤');
  for (const key of ['createdAt','updatedAt']) {
    if (!['string','number'].includes(typeof raw[key]) || !Number.isFinite(new Date(raw[key]).getTime())) throw new Error('時間錯誤');
    line[key] = stamp(raw[key]);
  }
  return {...line,qty:raw.qty,deleted:raw.deleted === true};
}
function upload(s, body) {
  if (!Array.isArray(body.lines) || body.lines.length > 500) throw new Error('每次最多上傳 500 筆');
  const sheet = s.刷讀明細;
  const lines = sheet.getDataRange().getValues().slice(1).map(row => row[8] ? asLine(row) : null);
  const positions = new Map();
  lines.forEach((line,i) => { if (line) positions.set(line.id,i); });
  const changes = new Set();
  const acks = [], rejected = [];
  for (const raw of body.lines) {
    let line;
    try { line = validateLine(raw); }
    catch (error) { rejected.push({id:raw && raw.id,error:error.message}); continue; }
    let index = positions.get(line.id);
    const old = lines[index];
    let status = 'inserted';
    if (old) status = line.updatedAt > old.updatedAt ? 'updated' : line.updatedAt === old.updatedAt ? 'unchanged' : 'stale';
    if (status === 'inserted' || status === 'updated') {
      if (!old) { index = lines.length; positions.set(line.id,index); }
      lines[index] = line;
      changes.add(index);
    }
    acks.push({id:line.id,updatedAt:lines[index].updatedAt,status});
  }
  const sorted = [...changes].sort((a,b) => a-b);
  for (let i=0; i<sorted.length;) {
    const start = sorted[i++];
    let end = start + 1;
    while (sorted[i] === end) { i++; end++; }
    write(sheet,start+2,lines.slice(start,end).map(asRow),[1,2,6,9,10]);
  }
  rebuild(s,lines.filter(Boolean));
  return {acks,rejected};
}
function route(s, body, post) {
  if (!post) {
    switch (body.action) {
      case 'ping': return {version:'1.0',time:stamp(Date.now())};
      case 'master': {
        const code = clean(body.session);
        const session = code && read(s.場次).find(row => clean(row[0]) === code);
        const {master,source} = masterFor(indexMaster(read(s.主檔)),code,clean(session ? session[2] : body.store));
        return {items:[...master.values()],source,count:master.size};
      }
      case 'session': {
        const row = read(s.場次).find(row => row[0] === clean(body.code));
        return {session:row ? asSession(row) : null};
      }
      case 'summary': return rebuild(s,read(s.刷讀明細).filter(row => row[8]).map(asLine),clean(body.session),clean(body.device));
    }
  } else switch (body.action) {
    case 'upload': return upload(s,body);
    case 'master': {
      const code = clean(body.session);
      const session = code && read(s.場次).find(row => clean(row[0]) === code);
      if (!session) throw new Error('場次不存在');
      if (!Array.isArray(body.items) || body.replace !== true) throw new Error('主檔格式錯誤');
      if (body.items.length > 30000) throw new Error('每次最多上傳 30000 筆主檔');
      const rows = body.items.map(item => {
        const barcode = item && barcodeText(item.barcode);
        if (!barcode || barcode.length > 64 || !Number.isFinite(Number(item.bookQty))) throw new Error('主檔欄位錯誤');
        return [code,session[2],barcode,clean(item.name),Number(item.bookQty),clean(item.sku)];
      });
      replaceRows(s.主檔,[...read(s.主檔).filter(row => clean(row[0]) !== code),...rows],[1,3,6]);
      return {count:rows.length};
    }
    case 'createSession': {
      const code = clean(body.code);
      const old = read(s.場次).find(row => row[0] === code);
      if (old) return {session:asSession(old)};
      if (!code || !clean(body.store) || !['master','none'].includes(body.mode)) throw new Error('場次資料不完整');
      const row = [code,clean(body.name),clean(body.store),body.mode,clean(body.createdBy),taipeiTime(Date.now()),'進行中'];
      write(s.場次,s.場次.getLastRow()+1,[row],[1,6]);
      return {session:asSession(row)};
    }
  }
  throw new Error('未知的操作');
}
function sha256hex(key) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,key,Utilities.Charset.UTF_8)
    .map(byte => (byte & 255).toString(16).padStart(2,'0')).join('');
}
function authorize(key) {
  const props = PropertiesService.getScriptProperties();
  const stored = props.getProperty('API_KEY');
  if (stored && key === stored) return;
  if (!stored && typeof API_KEY_SHA256 !== 'undefined' && typeof key === 'string' && key &&
      sha256hex(key) === API_KEY_SHA256) {
    props.setProperty('API_KEY',key);
    return;
  }
  throw new Error('unauthorized');
}
function respond(e, post) {
  let result;
  try {
    const body = post ? JSON.parse(e.postData.contents) : e.parameter || {};
    result = locked(() => {
      authorize(body.key);
      return {ok:true,...route(sheets(),body,post)};
    });
  } catch (error) { result = {ok:false,error:error.message}; }
  return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
}
function doGet(e) { return respond(e,false); }
function doPost(e) { return respond(e,true); }
