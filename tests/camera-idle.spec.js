const {test,expect,begin} = require('./browser-fixture');
const {assertVideoCoversPreview} = require('./preview-fill');

test('a blank camera feed pauses recognition and tapping the overlay resumes it',async ({page,server}) => {
  await page.addInitScript(() => {
    window.cameraDraws = 0;
    const drawImage = CanvasRenderingContext2D.prototype.drawImage;
    CanvasRenderingContext2D.prototype.drawImage = function (source,...args) {
      if (source instanceof HTMLVideoElement) window.cameraDraws++;
      return drawImage.call(this,source,...args);
    };
  });
  await page.goto(server.appUrl+'/?idlePause=800&engine=zxing');
  await begin(page);
  await page.getByRole('button',{name:'開啟鏡頭'}).click();

  const overlay = page.getByRole('button',{name:'一段時間沒有掃到條碼，已暫停辨識以減少發熱。點一下繼續掃描'});
  const quantity = () => page.evaluate(() => window.InventoryApp.getState().lines.reduce((sum,line) => sum+line.qty,0));
  const draws = () => page.evaluate(() => window.cameraDraws);
  await expect(overlay).toBeVisible();
  const pausedDraws = await draws();
  expect(pausedDraws).toBeGreaterThan(0);
  const video = page.locator('#video');
  const pausedTime = await video.evaluate(element => element.currentTime);
  await expect.poll(() => video.evaluate(element => element.currentTime)).toBeGreaterThan(pausedTime+.4);
  expect(await draws()).toBe(pausedDraws);
  expect(await quantity()).toBe(0);
  await expect(overlay).toBeVisible();

  await overlay.tap();
  await expect(overlay).toBeHidden();
  await assertVideoCoversPreview(page);
  await expect.poll(draws).toBeGreaterThan(pausedDraws);
  expect(await quantity()).toBe(0);
});
