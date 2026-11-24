const {test,expect,open,begin,scan,itemRow} = require('./browser-fixture');

const state = page => page.evaluate(() => window.InventoryApp.getState());
async function manual(page,barcode,qty) {
  await page.locator('#qty').fill(String(qty));
  await page.locator('#barcode').fill(barcode);
  await page.locator('#barcode').press('Enter');
}
test('the last-scan card commits total quantity by confirm, blur or Enter and supports quick adjustments',async ({page,server}) => {
  await open(page,server);
  await begin(page);
  await manual(page,'ABC',20);
  const qty = page.locator('#last-qty');
  await expect(page.locator('#qty')).toHaveValue('1');
  await expect(qty).toHaveValue('20');
  await qty.fill('21');
  expect((await state(page)).scannerPaused).toBe(true);
  await expect(page.locator('#scan-paused')).toBeVisible();
  await page.getByRole('button',{name:'確定，繼續掃描'}).click();
  expect((await state(page)).scannerPaused).toBe(false);
  await qty.fill('20');
  await qty.press('Enter');
  await expect(qty).toHaveValue('20');
  expect((await state(page)).lines[0].qty).toBe(20);

  for (const [name,count] of [['+5',25],['+10',35],['+12',47],['減少一件',46],['增加一件',47]]) {
    await page.getByRole('button',{name,exact:true}).click();
    await expect(qty).toHaveValue(String(count));
    expect((await state(page)).scannerPaused).toBe(false);
  }
  await qty.fill('12');
  await page.locator('#barcode').focus();
  expect((await state(page)).scannerPaused).toBe(false);
  expect((await state(page)).lines[0].qty).toBe(12);
  for (const invalid of ['','abc','1000000']) {
    await qty.fill(invalid);
    await page.locator('#barcode').focus();
    await expect(qty).toHaveValue('12');
  }
  page.once('dialog',dialog => dialog.dismiss());
  await qty.fill('0');
  await qty.press('Enter');
  await expect(qty).toHaveValue('12');
  page.once('dialog',dialog => dialog.accept());
  await qty.fill('0');
  await qty.press('Enter');
  await expect(page.locator('#last-scan')).toBeHidden();
  const result = await state(page);
  expect(result.lines[0].deleted).toBe(true);
  expect(result.dialogOpen).toBe(false);
  expect(result.lastFeedback).toBe('ok');
});

test('unknown scans await a choice and can be matched, counted directly, or canceled',async ({page,server}) => {
  await open(page,server);
  await page.getByLabel('有商品主檔（對照帳面）').check();
  await page.locator('#master-file').setInputFiles({
    name:'stock.csv',mimeType:'text/csv',buffer:Buffer.from('條碼,品名,帳面數量,貨號\nKNOWN,合金工程車,8,ENG')
  });
  await expect(page.locator('#master-count')).toHaveText('已載入 1 筆');
  await begin(page);
  const dialog = page.getByRole('dialog');
  const choose = name => dialog.getByRole('button',{name,exact:true}).click();
  const query = page.locator('#master-query');
  const countUnknown = () => choose('直接計入');
  const search = () => choose('用品名搜尋');

  await manual(page,'UNKNOWN',2);
  await expect(dialog).toContainText('UNKNOWN');
  await expect(dialog).toContainText('數量 2');
  await expect(page.locator('#last-scan')).toContainText('主檔查無此商品');
  expect(await state(page)).toMatchObject({dialogOpen:true,scannerPaused:true,lastFeedback:'notInMaster',lines:[]});
  expect(await scan(page,'KNOWN','camera',5)).toBe(false);
  expect(await scan(page,'KNOWN','manual',5)).toBe(false);
  await page.locator('#scan-form').evaluate(form => form.dispatchEvent(new Event('submit',{cancelable:true})));
  expect((await state(page)).lines).toEqual([]);
  await countUnknown();
  await expect(page.locator('#barcode')).toBeFocused();
  await expect(page.locator('#qty')).toHaveValue('1');
  expect(await state(page)).toMatchObject({dialogOpen:false,scannerPaused:false,lastFeedback:'notInMaster',lines:[{barcode:'UNKNOWN',qty:2}]});

  await manual(page,'KNOWN',1);
  expect(await state(page)).toMatchObject({dialogOpen:false,lastFeedback:'ok'});
  await manual(page,'MAP-ME',3);
  await search();
  await expect(query).toBeFocused();
  await query.fill('工程 eng');
  await query.press('Enter');
  await expect(dialog.getByRole('button',{name:/合金工程車/})).toContainText('本機已盤 1');
  await dialog.getByRole('button',{name:/合金工程車/}).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator('#last-scan')).toContainText('-4 盤虧');
  expect((await state(page)).lines.map(({barcode,qty}) => [barcode,qty])).toEqual([['UNKNOWN',2],['KNOWN',4]]);
  await page.locator('#last-qty').fill('8');
  await page.locator('#last-qty').press('Enter');
  await expect(page.locator('#last-scan')).toContainText('0 相符');

  await manual(page,'RETURN',1);
  await search();
  await choose('← 返回');
  await countUnknown();
  await manual(page,'NO-RESULT',4);
  await search();
  await query.fill('missing');
  await expect(dialog.getByText('查無結果',{exact:true})).toBeVisible();
  await choose('查無結果，返回直接計入');
  expect((await state(page)).lines.find(line => line.barcode === 'NO-RESULT').qty).toBe(4);

  await manual(page,'CANCEL',5);
  await choose('取消（不計入）');
  await manual(page,'SEARCH-CANCEL',5);
  await search();
  await choose('取消');
  await manual(page,'ESCAPE',5);
  await search();
  await query.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(page.locator('#qty')).toHaveValue('1');
  await expect(page.locator('#barcode')).toBeFocused();
  expect((await state(page)).lines).toHaveLength(4);

  await page.getByRole('button',{name:'彙總',exact:true}).click();
  await page.locator('#filter-summary').selectOption('主檔查無');
  await expect(page.locator('#item-table tbody tr')).toHaveCount(3);
  await expect(itemRow(page,'KNOWN')).toHaveCount(0);
  for (const barcode of ['UNKNOWN','RETURN','NO-RESULT']) {
    await expect(itemRow(page,barcode)).toContainText('主檔查無');
  }
});
