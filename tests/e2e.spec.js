const fs = require('node:fs/promises');
const XLSX = require('xlsx');
const {test,expect,open,configure,begin,scan,itemRow,noPreflight} = require('./browser-fixture');
const button = (page,name) => page.getByRole('button',{name,exact:true});
const queue = (page,count) => expect(page.locator('#queue')).toHaveText('待上傳 '+count+' 筆',{timeout:15000});
const summary = page => button(page,'彙總').click();
const active = page => page.evaluate(() => InventoryApp.getState().active);
const sessionApi = (server,action,code) => server.apiUrl+'?key=test-key&action='+action+'&session='+encodeURIComponent(code);
const uploadStock = page => page.locator('#master-file').setInputFiles({name:'stock.csv',mimeType:'text/csv',
  buffer:Buffer.from('JAN,商品名稱,庫存\n000001,模型甲,5')});

test('camera dedupe, keyboard wedge, edits, deletion and persisted lines',async ({page,server}) => {
  await open(page,server);
  await button(page,'設定').click();
  await page.getByLabel('防重複間隔（毫秒）').fill('300');
  await button(page,'設定開始').click();
  await begin(page);
  // Keep the first two scans within one browser task.
  const duplicates = await page.evaluate(async () => {
    const app = window.InventoryApp;
    const first = app.handleScan('ABC','camera');
    const second = app.handleScan('ABC','camera');
    return Promise.all([first,second]);
  });
  expect(duplicates).toEqual([true,false]);
  await expect(page.locator('#scan-note')).toHaveText('重複略過');
  await expect.poll(() => scan(page,'ABC','camera')).toBe(true);
  const barcode = page.locator('#barcode');
  await barcode.fill('ABC');
  await barcode.press('Enter');
  await expect(barcode).toBeFocused();
  const line = page.locator('[data-barcode="ABC"]');
  await expect(button(line,'3')).toBeVisible();
  await button(line,'＋').click();
  await expect(button(line,'4')).toBeVisible();
  await button(line,'−').click();
  await button(line,'3').click();
  await line.getByLabel('編輯數量').fill('7');
  await button(line,'儲存').click();
  await scan(page,'DELETE');
  page.once('dialog',dialog => dialog.accept());
  await button(page.locator('[data-barcode="DELETE"]'),'−').click();
  await expect(page.locator('#scan-totals')).toHaveText('品項數 1 ／ 總件數 7');
  await page.reload();
  await expect(button(line,'7')).toBeVisible();
  await expect(page.locator('[data-barcode="DELETE"]')).toHaveCount(0);
});

test('offline queue, HTTP failure retries and idempotent sync without preflight',async ({page,context,server}) => {
  await open(page,server);
  await configure(page,server);
  await begin(page);
  const statsUrl = new URL('/__stats',server.apiUrl), failUrl = new URL('/__fail?on=1',server.apiUrl);
  await context.setOffline(true);
  for (let i=1;i<=5;i++) expect(await scan(page,'OFF-'+i)).toBe(true);
  await queue(page,5);
  await context.setOffline(false);
  await queue(page,0);
  const {code} = await active(page);
  const getSummary = () => fetch(sessionApi(server,'summary',code)).then(response => response.json());
  expect((await getSummary()).totals.lines).toBe(5);
  await fetch(failUrl);
  await scan(page,'RETRY');
  await expect(page.locator('#sync-status')).toContainText('將自動重試');
  await queue(page,1);
  const failed = await fetch(statsUrl).then(response => response.json());
  await expect.poll(async () => (await fetch(statsUrl).then(response => response.json())).posts,{timeout:10000}).toBeGreaterThan(failed.posts);
  failUrl.searchParams.set('on','0');
  await fetch(failUrl);
  await queue(page,0);
  await page.evaluate(() => window.InventoryApp.syncNow());
  expect((await getSummary()).totals.lines).toBe(6);
  const stats = await noPreflight(server);
  expect(stats.posts).toBeGreaterThan(3);
  expect(stats.detailRows).toBe(6);
});

test('two devices join and aggregate people, devices and overlapping barcodes',async ({page,browser,server}) => {
  await open(page,server);
  await configure(page,server);
  const secondContext = await browser.newContext();
  try {
    const second = await secondContext.newPage();
    await open(second,server);
    await configure(second,server);
    await Promise.all([begin(page),begin(second,{counter:'小陳'})]);
    expect((await active(second)).code).toBe((await active(page)).code);
    await scan(page,'SHARED','manual',2);
    await queue(page,0);
    expect(await second.evaluate(() => InventoryApp.getState().device)).not.toBe(await page.evaluate(() => InventoryApp.getState().device));
    await scan(second,'SHARED','manual',3);
    await scan(second,'SECOND','manual',4);
    await queue(second,0);
    await summary(page);
    await button(page,'重新整理').click();
    await expect(page.locator('#summary-source')).toContainText('已載入全場資料');
    await expect(page.locator('#summary-totals')).toContainText('總件數9');
    await expect(itemRow(page,'SHARED').locator('td').nth(3)).toHaveText('5');
    for (const [title,name,qty] of [['依盤點人','小林','2'],['依盤點人','小陳','7']]) {
      const group = page.locator('#summary-groups .panel').filter({has:page.getByRole('heading',{name:title})});
      const row = group.getByRole('row').filter({has:page.getByRole('cell',{name,exact:true})});
      await expect(row.locator('td').last()).toHaveText(qty);
    }
    const devices = page.locator('#summary-groups .panel').filter({has:page.getByRole('heading',{name:'依裝置'})});
    await expect(devices.locator('tbody tr td:last-child')).toHaveText(['2','7']);
    await noPreflight(server);
  } finally { await secondContext.close(); }
});

test('Excel, CSV and cloud master preserve barcodes and render comparisons',async ({page,server}) => {
  await open(page,server);
  await configure(page,server);
  await page.getByLabel('有商品主檔（對照帳面）').check();
  const upload = page.locator('#master-file');
  const count = page.locator('#master-count');
  await upload.setInputFiles({name:'master.csv',mimeType:'text/csv',buffer:Buffer.from('JAN,商品名稱,庫存\n000001,模型甲,5')});
  await expect(count).toHaveText('已載入 1 筆');
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([
    ['barcode','name','qty'],['000001','模型甲',5],['000002','模型乙',2]
  ]),'商品');
  await upload.setInputFiles({name:'master.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer:XLSX.write(book,{type:'buffer',bookType:'xlsx'})});
  await expect(count).toHaveText('已載入 2 筆');
  await upload.setInputFiles({name:'replace.csv',mimeType:'text/csv',buffer:Buffer.from('JAN,商品名稱,庫存\n000003,暫存,1')});
  await expect(count).toHaveText('已載入 1 筆');
  // Big5 encoding of JAN,商品名稱,庫存 followed by two rows.
  await upload.setInputFiles({name:'big5.csv',mimeType:'text/csv',buffer:Buffer.concat([
    Buffer.from('4a414e2cb0d3ab7ea657bad92cae77a6730a3030303030342cbcd2abac2c33','hex'),
    Buffer.from('\n000005,ABC,2')
  ])});
  await expect(count).toHaveText('已載入 2 筆');
  await upload.setInputFiles({name:'bom.csv',mimeType:'text/csv',buffer:Buffer.from('\uFEFFJAN,商品名稱,庫存\n000006,模型,1')});
  await expect(count).toHaveText('已載入 1 筆');
  await upload.setInputFiles({name:'master.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer:XLSX.write(book,{type:'buffer',bookType:'xlsx'})});
  await expect(count).toHaveText('已載入 2 筆');
  await begin(page);
  await expect(page.locator('#toast')).toHaveText('主檔已上傳到場次（2 筆）');
  await scan(page,'000001','manual',2);
  await expect(page.locator('#last-scan')).toContainText('模型甲');
  await expect(page.locator('#last-scan')).toContainText('帳面5');
  await expect(page.locator('#last-scan')).toContainText('差異-3 盤虧');
  await scan(page,'UNKNOWN');
  await page.getByRole('button',{name:'直接計入',exact:true}).click();
  await expect(page.locator('#last-scan')).toContainText('主檔查無');
  await queue(page,0);
  await summary(page);
  await button(page,'重新整理').click();
  await expect(page.locator('#summary-source')).toContainText('已載入全場資料');
  await expect(itemRow(page,'000002')).toContainText('未盤');
  await expect(itemRow(page,'UNKNOWN')).toContainText('主檔查無');
  await noPreflight(server);
});

test('a fresh joiner automatically loads the session master and can reload it',async ({page,browser,server}) => {
  await open(page,server);
  await configure(page,server);
  await page.getByLabel('有商品主檔（對照帳面）').check();
  await page.locator('#master-file').setInputFiles({name:'stock.csv',mimeType:'text/csv',
    buffer:Buffer.from('JAN,商品名稱,庫存\n000001,模型甲,5\n000002,模型乙,2')});
  await expect(page.locator('#master-count')).toHaveText('已載入 2 筆');
  await begin(page);
  const endpoint = sessionApi(server,'master',(await active(page)).code);
  await expect.poll(async () => (await (await fetch(endpoint)).json()).source).toBe('session');
  const context = await browser.newContext();
  try {
    const joiner = await context.newPage();
    await open(joiner,server);
    await configure(joiner,server);
    await expect(joiner.locator('#session-info')).toContainText('主檔 2 筆');
    await expect(joiner.locator('#master-controls')).toBeHidden();
    await begin(joiner,{counter:'小陳'});
    await scan(joiner,'000001','manual',2);
    await expect(joiner.locator('#last-scan')).toContainText('模型甲');
    await expect(joiner.locator('#last-scan')).toContainText('帳面5');
    await summary(joiner);
    await expect(itemRow(joiner,'000001')).toContainText('盤虧');
    await expect(itemRow(joiner,'000002')).toContainText('未盤');
    await button(joiner,'重新載入場次主檔').click();
    await expect(joiner.locator('#summary-source')).toContainText('已載入全場資料');
    await summary(page);
    page.once('dialog',dialog => dialog.accept());
    await button(page,'重新上傳主檔到此場次').click();
    await expect(page.locator('#toast')).toHaveText('主檔已上傳到場次（2 筆）');
    await noPreflight(server);
  } finally { await context.close(); }
});

test('pending session master survives a reload and uploads after cloud recovery',async ({page,server}) => {
  await open(page,server);
  await configure(page,server);
  await page.getByLabel('有商品主檔（對照帳面）').check();
  await page.locator('#master-file').setInputFiles({name:'stock.csv',mimeType:'text/csv',
    buffer:Buffer.from('JAN,商品名稱,庫存\n000001,模型甲,5')});
  await expect(page.locator('#master-count')).toHaveText('已載入 1 筆');
  await fetch(new URL('/__fail?on=1&action=master',server.apiUrl));
  await begin(page);
  const {code} = await active(page);
  await expect(page.locator('#sync-status')).toContainText('主檔待上傳');
  await expect(page.locator('#sync-status')).toContainText('將自動重試');
  await page.reload();
  await expect(page.locator('#sync-status')).toContainText('主檔待上傳');
  await scan(page,'000001');
  await expect(page.locator('#last-scan')).toContainText('帳面5');
  await fetch(new URL('/__fail?on=0',server.apiUrl));
  await expect(page.locator('#sync-status')).not.toContainText('主檔待上傳',{timeout:15000});
  const result = await fetch(sessionApi(server,'master',code)).then(response => response.json());
  expect(result).toMatchObject({source:'session',count:1});
  await queue(page,0);
});

test('optional zone changes apply only to subsequent scans and persist on the start screen',async ({page,server}) => {
  await open(page,server);
  await configure(page,server);
  await page.locator('#zone').fill('A-01');
  await begin(page);
  await scan(page,'000123','camera');
  const chip = page.locator('#zone-chip');
  const zoneDialog = page.getByRole('dialog',{name:'變更區域'});
  await expect(chip).toHaveText('區域：A-01');
  await chip.click();
  await zoneDialog.locator('#scan-zone').fill('B-02');
  await zoneDialog.getByRole('button',{name:'確定',exact:true}).click();
  await scan(page,'000123','camera');
  await expect(page.locator('#lines li')).toHaveCount(2);
  await expect(page.locator('#lines li').first()).toContainText('B-02');
  await expect(page.locator('#lines li').last()).toContainText('A-01');
  await chip.click();
  await zoneDialog.locator('#scan-zone').fill('取消的區域');
  await zoneDialog.getByRole('button',{name:'取消'}).click();
  await expect(chip).toHaveText('區域：B-02');
  await chip.click();
  await zoneDialog.getByRole('button',{name:'清除'}).click();
  await expect(chip).toHaveText('區域：未填');
  await scan(page,'000123');
  await queue(page,0);
  const code = (await active(page)).code;
  const cloud = await fetch(sessionApi(server,'summary',code)).then(response => response.json());
  expect(cloud.details.map(line => line.zone).sort()).toEqual(['','A-01','B-02']);
  await summary(page);
  await button(page,'重新整理').click();
  const zones = page.locator('#summary-groups .panel').filter({has:page.getByRole('heading',{name:'依區域'})});
  await expect(zones.locator('tbody tr')).toHaveCount(3);
  for (const zone of ['A-01','B-02','未填區域']) await expect(zones.getByRole('cell',{name:zone,exact:true})).toBeVisible();

  const pending = page.waitForEvent('download');
  await button(page,'匯出 Excel').click();
  const book = XLSX.read(await fs.readFile(await (await pending).path()));
  const details = XLSX.utils.sheet_to_json(book.Sheets.明細,{header:1});
  expect(details[0][4]).toBe('區域');
  expect(details.slice(1).map(row => row[4]).sort()).toEqual(['','A-01','B-02']);

  await button(page,'刷讀').click();
  await chip.click();
  await zoneDialog.locator('#scan-zone').fill('B-02');
  await zoneDialog.getByRole('button',{name:'確定',exact:true}).click();
  await page.reload();
  await expect(chip).toHaveText('區域：B-02');
  await button(page,'設定開始').click();
  await expect(page.locator('#zone')).toHaveValue('B-02');
  await expect(page.locator('#recent-zones option')).toHaveCount(2);
});

test('downloads contain expected spreadsheet cells and CSV BOM',async ({page,server}) => {
  await open(page,server);
  await expect(page.locator('#zone')).toHaveValue('');
  await begin(page);
  await expect(page.locator('#zone-chip')).toHaveText('區域：未填');
  await scan(page,'000123','manual',12);
  await summary(page);
  for (const [name,extension] of [['匯出 Excel','xlsx'],['匯出 CSV','csv']]) {
    const pending = page.waitForEvent('download');
    await button(page,name).click();
    const download = await pending;
    expect(download.suggestedFilename()).toMatch(new RegExp('^盤點_萬年總店_\\d{4}-\\d{2}-\\d{2}_\\d{8}-\\d{4}\\.'+extension+'$'));
    const data = await fs.readFile(await download.path());
    if (extension === 'xlsx') {
      const book = XLSX.read(data);
      expect(book.SheetNames).toEqual(['彙總','明細','依人員','依區域']);
      expect(book.Sheets.彙總.A2.v).toBe('000123');
      expect(book.Sheets.彙總.D2.v).toBe(12);
      expect(XLSX.utils.sheet_to_json(book.Sheets.明細,{header:1})[0]).toEqual(
        ['時間','場次名稱','門市','盤點人','區域','裝置','條碼','品名','數量']);
      expect(book.Sheets.明細.I2.v).toBe(12);
      expect(book.Sheets.依區域.A2.v).toBe('未填區域');
      expect(book.Sheets.明細.B2.v).toBe((await active(page)).name);
      expect(book.Sheets.彙總.G2.v).toBe((await active(page)).name);
    } else {
      expect([...data.subarray(0,3)]).toEqual([239,187,191]);
      const book = XLSX.read(data.toString('utf8').slice(1),{type:'string',raw:true});
      const rows = XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]],{header:1});
      expect(rows[1][0]).toBe('000123');
      expect(Number(rows[1][3])).toBe(12);
    }
  }
});

test('camera starts with a fake camera or displays a readable error',async ({page,server,browserName}) => {
  test.skip(browserName !== 'chromium','以 Chromium 模擬鏡頭');
  const errors = [];
  page.on('pageerror',error => errors.push(error.message));
  await open(page,server);
  await begin(page);
  await button(page,'開啟鏡頭').click();
  await expect.poll(async () => page.evaluate(() => {
    const video = document.querySelector('video');
    const error = document.querySelector('#camera-note').textContent;
    return (!video.paused && video.readyState >= 2) || /相機|鏡頭|HTTPS/.test(error);
  })).toBe(true);
  const stop = button(page,'停止');
  if (await stop.isVisible()) {
    await stop.click();
    await expect(page.locator('#preview')).toBeHidden();
  }
  expect(errors).toEqual([]);
});

test('ending flushes data, preserves summary and starts a new session under a new code',async ({page,server}) => {
  await open(page,server);
  await configure(page,server);
  const setServerDate = day => fetch(new URL('/__clock?time=2026-11-'+day+'T16:30:00Z',server.apiUrl));
  await setServerDate(24);
  await begin(page,{store:'武昌'});
  const previous = await active(page);
  expect(previous.name).toBe('武昌 2026/11/25');
  await setServerDate(25);
  const dialogs = [];
  page.on('dialog',dialog => { dialogs.push(dialog.message()); return dialog.accept(); });
  await scan(page,'FINAL','manual',4);
  await button(page,'結束盤點').click();
  await expect(page.locator('#start')).toBeVisible();
  expect(dialogs).toEqual(['確定結束『'+previous.name+'』盤點？結束後無法再刷讀，下次選此門市會開新場次']);
  expect(await active(page)).toBeNull();
  await summary(page);
  await button(page,'重新整理').click();
  await expect(page.locator('#summary-source')).toContainText('已載入全場資料');
  await expect(page.locator('#summary-session')).toHaveText(previous.name);
  await expect(itemRow(page,'FINAL')).toContainText('4');
  await button(page,'設定開始').click();
  await expect(page.locator('#session-info')).toContainText('將建立新場次：武昌');
  await begin(page);
  const next = await active(page);
  expect(next.code).not.toBe(previous.code);
  expect(next.name).toBe('武昌 2026/11/26');
});

test('another device ending a session rejects offline lines and exposes a persistent backup',async ({page,browser,context,server}) => {
  await open(page,server);
  await configure(page,server);
  await begin(page);
  const secondContext = await browser.newContext();
  try {
    const second = await secondContext.newPage();
    await open(second,server);
    await configure(second,server);
    await begin(second,{counter:'小陳'});
    await context.setOffline(true);
    await scan(page,'LATE','manual',3);
    await queue(page,1);
    second.on('dialog',dialog => dialog.accept());
    await button(second,'結束盤點').click();
    await expect(second.locator('#start')).toBeVisible();
    await context.setOffline(false);
    await expect(page.locator('#toast')).toHaveText('場次已結束，1 筆未上傳');
    await queue(page,0);
    await expect(page.locator('#start')).toBeVisible();
    await page.reload();
    await expect(page.locator('#rejected-backup')).toBeVisible();
    const download = page.waitForEvent('download');
    await page.locator('#rejected-backup').click();
    const backup = JSON.parse(await fs.readFile(await (await download).path(),'utf8'));
    expect(backup.lines).toMatchObject([{barcode:'LATE',qty:3,dirty:false,rejected:'場次已結束'}]);
    expect((await noPreflight(server)).detailRows).toBe(0);
  } finally { await secondContext.close(); }
});

test('offline start uses a cached session and confirmed offline ending syncs after reconnect',async ({page,context,server}) => {
  await open(page,server);
  await configure(page,server);
  await begin(page);
  const {code} = await active(page);
  await button(page,'切換').click();
  await context.setOffline(true);
  await page.locator('#store').selectOption('華山');
  await expect(page.locator('#session-info')).toHaveText('需連線才能開始新場次');
  await button(page,'開始盤點').click();
  await expect(page.locator('#toast')).toHaveText('需連線才能開始新場次');
  await begin(page,{store:'萬年總店'});
  expect((await active(page)).code).toBe(code);
  await scan(page,'OFFLINE-END');
  const confirmations = [];
  page.on('dialog',dialog => {
    confirmations.push(dialog.message());
    return confirmations.length === 2 ? dialog.dismiss() : dialog.accept();
  });
  await button(page,'結束盤點').click();
  await expect(page.locator('#end-session')).toBeEnabled();
  await expect(page.locator('#scan')).toBeVisible();
  await queue(page,1);
  await button(page,'結束盤點').click();
  await expect(page.locator('#sync-status')).toContainText('結束盤點待同步');
  expect(confirmations).toHaveLength(4);
  await context.setOffline(false);
  await expect(page.locator('#sync-status')).not.toContainText('結束盤點待同步');
  const get = await fetch(server.apiUrl+'?action=session&key=test-key&code='+code).then(response => response.json());
  expect(get.session.status).toBe('已結束');
});

test('a later participant supplies the missing master for an open session',async ({page,browser,server}) => {
  await open(page,server);
  await configure(page,server);
  await page.getByLabel('有商品主檔（對照帳面）').check();
  await begin(page);
  const {code} = await active(page);
  const context = await browser.newContext();
  try {
    const second = await context.newPage();
    await open(second,server);
    await configure(second,server);
    await expect(second.locator('#session-info')).toContainText('主檔 0 筆');
    await expect(second.locator('#master-file')).toBeVisible();
    await uploadStock(second);
    await expect(second.locator('#master-count')).toHaveText('已載入 1 筆');
    await begin(second);
    expect((await active(second)).code).toBe(code);
    await expect(second.locator('#toast')).toHaveText('主檔已上傳到場次（1 筆）');
  } finally { await context.close(); }
});

test('local-only sessions reopen by store and remain exportable after ending',async ({page,server}) => {
  await open(page,server);
  await begin(page,{store:'大江'});
  const previous = await active(page);
  await scan(page,'LOCAL','manual',2);
  await button(page,'切換').click();
  await expect(page.locator('#session-info')).toContainText('將加入進行中場次：'+previous.name);
  await begin(page);
  expect((await active(page)).code).toBe(previous.code);
  page.once('dialog',dialog => dialog.accept());
  await button(page,'結束盤點').click();
  await expect(page.locator('#start')).toBeVisible();
  await page.reload();
  await expect(page.locator('#session-info')).toContainText('將建立新場次');
  await summary(page);
  await expect(itemRow(page,'LOCAL')).toContainText('2');
  await button(page,'設定開始').click();
  await begin(page);
  expect((await active(page)).code).not.toBe(previous.code);
});

test('two devices pressing 開始盤點 at the same time for one store share a single open session',async ({page,browser,server}) => {
  await open(page,server);
  await configure(page,server);
  const otherContext = await browser.newContext();
  try {
    const other = await otherContext.newPage();
    await open(other,server);
    await configure(other,server);
    for (const [p,name] of [[page,'甲'],[other,'乙']]) {
      await p.locator('#store').selectOption('大江');
      await p.getByLabel('盤點人').fill(name);
    }
    await Promise.all([page,other].map(p => button(p,'開始盤點').click()));
    await Promise.all([page,other].map(p => expect(p.locator('#scan')).toBeVisible()));
    const [a,b] = await Promise.all([active(page),active(other)]);
    expect(a.code).toBe(b.code);
    expect(a.name).toMatch(/^大江 \d{4}\/\d{2}\/\d{2}$/);
  } finally { await otherContext.close(); }
});

test('POS BIFF8 import reports exceptions and counts under the selected master code',async ({page,server}) => {
  const {makePosFixture} = require('../scripts/make-pos-fixture');
  await open(page,server);
  await configure(page,server);
  await page.getByLabel('有商品主檔（對照帳面）').check();
  await page.locator('#master-file').setInputFiles({name:'pos-synthetic.xls',mimeType:'application/vnd.ms-excel',
    buffer:makePosFixture()});
  await expect(page.locator('#master-count')).toHaveText('已讀取 30 筆（表頭第 4 列，略過合計列 1 列）');
  const report = page.locator('#master-report');
  await expect(report).toContainText('庫點：測試門市');
  await expect(report).toContainText('庫點與所選門市');
  for (const [label,code] of [['負庫存 1 筆','DEMO11'],['重複條碼 1 筆','0000000000003']]) {
    await report.getByText(label,{exact:true}).click();
    await expect(report.getByText(code,{exact:true})).toBeVisible();
  }
  await begin(page);
  const manual = async code => {
    const input = page.locator('#barcode');
    await input.fill(code);
    await input.press('Enter');
  };
  await manual('POSSINGLE');
  await expect(page.locator('#last-scan')).toContainText('測試商品06');
  await expect(page.locator('#last-scan')).toContainText('對應到 POSSINGLE-SMP');
  await expect(page.locator('#lines [data-barcode="POSSINGLE-SMP"]')).toHaveCount(1);
  await manual('POSMULTI');
  const picker = page.getByRole('dialog',{name:'選擇主檔商品'});
  await expect(picker.getByRole('button',{name:/POSMULTI-SMP.*帳面 7/})).toBeVisible();
  await expect(picker.getByRole('button',{name:/POSMULTI-B.*帳面 8/})).toBeVisible();
  await expect(picker.getByRole('button',{name:'直接計入原條碼'})).toBeVisible();
  expect(await page.evaluate(() => InventoryApp.getState().scannerPaused)).toBe(true);
  await picker.getByRole('button',{name:/POSMULTI-B/}).click();
  await expect(picker).toBeHidden();
  await expect(page.locator('#lines [data-barcode="POSMULTI-B"]')).toHaveCount(1);
  await manual('POSBASE');
  await expect(picker.getByRole('button',{name:/POSBASE ／ 帳面 9/})).toBeVisible();
  await expect(picker.getByRole('button',{name:/POSBASE-SMP/})).toBeVisible();
  await picker.getByRole('button',{name:'取消',exact:true}).click();
  await expect(page.locator('#lines li')).toHaveCount(2);
  await manual('POSMULTI');
  await picker.getByRole('button',{name:'直接計入原條碼'}).click();
  await expect(page.locator('#lines [data-barcode="POSMULTI"]')).toHaveCount(1);
  await queue(page,0);
  await summary(page);
  await button(page,'重新整理').click();
  await expect(page.locator('#summary-source')).toContainText('已載入全場資料');
  await expect(itemRow(page,'POSSINGLE-SMP').locator('td').nth(3)).toHaveText('1');
  await expect(itemRow(page,'POSMULTI-B').locator('td').nth(3)).toHaveText('1');
  await expect(itemRow(page,'POSMULTI')).toContainText('主檔查無');

  const pending = page.waitForEvent('download');
  await button(page,'匯出 Excel').click();
  const book = XLSX.read(await fs.readFile(await (await pending).path()));
  const details = XLSX.utils.sheet_to_json(book.Sheets.明細,{header:1});
  expect(details.slice(1).map(row => row[6]).sort()).toEqual(['POSMULTI','POSMULTI-B','POSSINGLE-SMP']);
});
