const path = require('node:path');
const {test,expect,begin} = require('./browser-fixture');

for (const engine of ['zxing','default']) {
  test(`decodes the camera fixture with the ${engine} engine and dedupes repeated frames`,async ({page,server}) => {
    await page.goto(server.appUrl+(engine === 'zxing' ? '/?engine=zxing' : '/'));
    await begin(page);
    await page.getByRole('button',{name:'開啟鏡頭'}).click();
    const quantity = () => page.evaluate(() => {
      const line = window.InventoryApp.getState().lines.find(item => item.barcode === '4904810049586');
      return line ? line.qty : 0;
    });
    await expect.poll(quantity).toBeGreaterThanOrEqual(1);
    await expect(page.locator('#scan-note')).toHaveText('重複略過');
    expect(await page.evaluate(() => window.InventoryApp.getState().lastFeedback)).toBe('duplicate');
    const video = page.locator('#video');
    const tracks = await video.evaluateHandle(element => element.srcObject.getTracks());
    await page.waitForTimeout(1000);
    expect(await quantity()).toBe(1);
    if (engine === 'zxing') {
      await page.screenshot({path:path.join(__dirname,'../screens/07-camera-scan.png'),fullPage:false});
      await page.locator('#last-scan').scrollIntoViewIfNeeded();
      await page.screenshot({path:path.join(__dirname,'../screens/09-quick-qty.png'),fullPage:false});
    }
    await page.getByRole('button',{name:'停止',exact:true}).click();
    await expect.poll(() => video.evaluate(element => element.srcObject === null)).toBe(true);
    expect(await tracks.evaluate(items => items.map(track => track.readyState))).toEqual(['ended']);
  });
}

test('camera uses the manual quantity and pauses decoding while the card quantity is focused',async ({page,server}) => {
  await page.goto(server.appUrl+'/?engine=zxing');
  await page.getByRole('button',{name:'設定',exact:true}).click();
  await page.locator('#dedupe').fill('300');
  await page.getByRole('button',{name:'設定開始',exact:true}).click();
  await begin(page);
  await page.locator('#qty').fill('3');
  await page.locator('#last-scan').evaluate(card => {
    const observer = new MutationObserver(() => {
      if (card.hidden) return;
      observer.disconnect();
      card.querySelector('#last-qty').focus();
    });
    observer.observe(card,{attributes:true,attributeFilter:['hidden']});
  });
  await page.getByRole('button',{name:'開啟鏡頭'}).click();
  const qty = page.locator('#last-qty');
  await expect(page.locator('#qty')).toHaveValue('1');
  await expect(qty).toHaveValue('3');
  await expect(qty).toBeFocused();
  const quantity = () => page.evaluate(() => window.InventoryApp.getState().lines[0].qty);
  const initial = await quantity();
  await expect(page.locator('#scan-paused')).toBeVisible();
  await page.waitForTimeout(2000);
  expect(await quantity()).toBe(initial);
  expect(await page.locator('#video').evaluate(video => video.srcObject.getVideoTracks()[0].readyState)).toBe('live');
  await page.getByRole('button',{name:'確定，繼續掃描'}).click();
  await page.getByRole('button',{name:'+10',exact:true}).click();
  expect(await page.evaluate(() => window.InventoryApp.getState().scannerPaused)).toBe(false);
  await expect.poll(quantity).toBeGreaterThanOrEqual(initial+10);
  await expect.poll(quantity).toBeGreaterThan(initial+10);
});

test('an unknown camera barcode opens the dialog and direct counting resumes recognition',async ({page,server}) => {
  await page.goto(server.appUrl+'/?engine=zxing');
  await page.getByLabel('有商品主檔（對照帳面）').check();
  await page.locator('#master-file').setInputFiles({
    name:'stock.csv',mimeType:'text/csv',buffer:Buffer.from('條碼,品名,帳面數量\nKNOWN,模型,5')
  });
  await expect(page.locator('#master-count')).toHaveText('已載入 1 筆');
  await begin(page);
  await page.getByRole('button',{name:'開啟鏡頭'}).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('4904810049586');
  expect(await page.evaluate(() => window.InventoryApp.getState())).toMatchObject({scannerPaused:true,lines:[]});
  await dialog.getByRole('button',{name:'直接計入',exact:true}).click();
  expect(await page.evaluate(() => window.InventoryApp.getState())).toMatchObject({
    scannerPaused:false,dialogOpen:false,lines:[{barcode:'4904810049586',qty:1}]
  });
});
