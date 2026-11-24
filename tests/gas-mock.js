const {createHash} = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = new vm.Script(fs.readFileSync(path.join(__dirname,'../gas/Code.gs'),'utf8'),{filename:'Code.gs'});

class Sheet {
  constructor() { this.rows = []; this.frozen = 0; this.maxRows = 1000; this.maxColumns = 26; }
  getLastRow() {
    return this.rows.reduce((last,row,index) => row.some(value => value !== '') ? index+1 : last,0);
  }
  getLastColumn() {
    return this.rows.reduce((last,row) => row.reduce((max,value,index) => value !== '' ? Math.max(max,index+1) : max,last),0);
  }
  getMaxRows() { return this.maxRows; }
  getMaxColumns() { return this.maxColumns; }
  insertRowsAfter(_,count) { this.maxRows += count; }
  insertColumnsAfter(_,count) { this.maxColumns += count; }
  getRange(r,c,nr = 1,nc = 1) {
    const set = (i,j,value) => {
      while (this.rows.length < i) this.rows.push([]);
      const row = this.rows[i-1];
      while (row.length < j) row.push('');
      row[j-1] = value;
    };
    const range = {
      getValues: () => Array.from({length:nr},(_,i) => Array.from({length:nc},(_,j) => {
        const row = this.rows[r+i-1];
        return row && row[c+j-1] !== undefined ? row[c+j-1] : '';
      })),
      setValues: rows => {
        if (rows.length !== nr || rows.some(row => row.length !== nc)) throw new Error('Range dimensions differ');
        rows.forEach((row,i) => row.forEach((value,j) => set(r+i,c+j,
          typeof value === 'string' && value.startsWith("'") ? value.slice(1) : value)));
        return range;
      },
      setValue: value => range.setValues([[value]]),
      setFontWeight: () => range,
      setBackground: () => range,
      setNumberFormat: () => range,
      clearContent: () => {
        for (let i=0;i<nr;i++) for (let j=0;j<nc;j++) set(r+i,c+j,'');
        return range;
      }
    };
    return range;
  }
  getDataRange() { return this.getRange(1,1,Math.max(1,this.getLastRow()),Math.max(1,this.getLastColumn())); }
  appendRow(row) { this.getRange(this.getLastRow()+1,1,1,row.length).setValues([row]); return this; }
  clear() { return this.clearContents(); }
  clearContents() { this.rows = []; return this; }
  setFrozenRows(count) { this.frozen = count; return this; }
  insertColumnBefore(column) { this.rows.forEach(row => row.splice(column-1,0,'')); this.maxColumns++; }
  deleteColumn(column) { this.rows.forEach(row => row.splice(column-1,1)); this.maxColumns--; }
  deleteRows(start,count) { this.rows.splice(start-1,count); }
}

function createGas({key = 'test-key',keyHash} = {}) {
  const sheets = new Map();
  const props = new Map();
  if (key) props.set('API_KEY',key);
  const spreadsheet = {
    getId: () => 'test-sheet',
    getSheetByName: name => sheets.get(name) || null,
    insertSheet: name => { const sheet = new Sheet(); sheets.set(name,sheet); return sheet; }
  };
  const context = vm.createContext({
    SpreadsheetApp:{getActiveSpreadsheet:() => spreadsheet,openById:() => spreadsheet,flush() {}},
    ContentService:{MimeType:{JSON:'application/json'},createTextOutput:content => ({
      getContent:() => content,setMimeType() { return this; }
    })},
    LockService:{getScriptLock:() => ({waitLock() {},releaseLock() {}})},
    PropertiesService:{getScriptProperties:() => ({
      getProperty:name => props.get(name) || null,setProperty:(name,value) => props.set(name,value)
    })},
    Utilities:{
      DigestAlgorithm:{SHA_256:'sha256'},Charset:{UTF_8:'utf8'},
      computeDigest:(algorithm,value,charset) => Array.from(createHash(algorithm).update(value,charset).digest(),
        byte => byte > 127 ? byte - 256 : byte),
      formatDate:(date,timeRegion) => {
      const format = new Intl.DateTimeFormat('en-CA',{timeZone:timeRegion,year:'numeric',month:'2-digit',
        day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
      const parts = Object.fromEntries(format.formatToParts(date).map(part => [part.type,part.value]));
      return parts.year+'-'+parts.month+'-'+parts.day+' '+parts.hour+':'+parts.minute+':'+parts.second;
    }},
    Session:{getScriptTimeZone:() => 'Asia/Taipei'},
    Logger:{log() {}}
  });
  if (keyHash !== undefined) context.API_KEY_SHA256 = keyHash;
  source.runInContext(context);
  const decode = output => JSON.parse(output.getContent());
  return {context,spreadsheet,props,setup:() => context.setup(),
    get:parameter => decode(context.doGet({parameter:{key,...parameter}})),
    post:data => decode(context.doPost({postData:{type:'text/plain;charset=utf-8',contents:JSON.stringify({key,...data})}}))};
}
module.exports = {createGas};
