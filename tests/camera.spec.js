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
    const video = page.locator('#video');
    const tracks = await video.evaluateHandle(element => element.srcObject.getTracks());
    await page.waitForTimeout(1000);
    expect(await quantity()).toBe(1);
    if (engine === 'zxing') {
      await page.screenshot({path:path.join(__dirname,'../screens/07-camera-scan.png'),fullPage:false});
    }
    await page.getByRole('button',{name:'停止',exact:true}).click();
    await expect.poll(() => video.evaluate(element => element.srcObject === null)).toBe(true);
    expect(await tracks.evaluate(items => items.map(track => track.readyState))).toEqual(['ended']);
  });
}
