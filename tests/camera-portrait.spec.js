const {test,expect,begin} = require('./browser-fixture');
const {assertVideoCoversPreview} = require('./preview-fill');

async function useNativeCameraSize(page) {
  // Keep the fake camera's native orientation even when the app requests landscape.
  await page.addInitScript(() => {
    const getUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = constraints => getUserMedia({
      ...constraints,video:{...constraints.video,resizeMode:{exact:'none'}}
    });
  });
}

test('portrait camera fills the compact preview and counts the barcode',async ({page,server}) => {
  await useNativeCameraSize(page);
  await page.goto(server.appUrl+'/?engine=zxing');
  await begin(page);
  await page.getByRole('button',{name:'開啟鏡頭'}).click();
  await expect(page.locator('body')).toHaveClass(/\bscan-compact\b/);

  await assertVideoCoversPreview(page);
  expect(await page.locator('#video').evaluate(video => video.videoHeight > video.videoWidth)).toBe(true);
  await expect.poll(() => page.evaluate(() => {
    const line = window.InventoryApp.getState().lines.find(item => item.barcode === '4904810049586');
    return line ? line.qty : 0;
  })).toBeGreaterThanOrEqual(1);
});

test('portrait preview stays covered on reopen, camera switch and scan tab return',async ({page,server}) => {
  await useNativeCameraSize(page);
  await page.goto(server.appUrl+'/?engine=zxing');
  await begin(page);

  const openCamera = page.getByRole('button',{name:'開啟鏡頭',exact:true});
  await openCamera.click();
  await assertVideoCoversPreview(page);

  await page.getByRole('button',{name:'停止',exact:true}).click();
  await openCamera.click();
  await assertVideoCoversPreview(page);

  await page.getByRole('button',{name:'切換前後鏡頭',exact:true}).click();
  await assertVideoCoversPreview(page);

  const video = page.locator('#video');
  await video.evaluate(element => {
    element.setAttribute('width',String(element.videoWidth));
    element.setAttribute('height',String(element.videoHeight));
    element.style.width = '1px';
    element.dispatchEvent(new Event('resize'));
  });
  expect(await video.evaluate(element => [
    element.getAttribute('width'),element.getAttribute('height'),element.style.width
  ])).toEqual([null,null,'100%']);
  await assertVideoCoversPreview(page);

  await page.getByRole('button',{name:'彙總',exact:true}).click();
  expect(await video.evaluate(element => element.srcObject === null)).toBe(true);
  await page.getByRole('button',{name:'刷讀',exact:true}).click();
  await openCamera.click();
  await assertVideoCoversPreview(page);
});

test('portrait preview stays covered through viewport resize and scroll',async ({page,server}) => {
  await useNativeCameraSize(page);
  await page.goto(server.appUrl+'/?engine=zxing');
  await begin(page);
  await page.getByRole('button',{name:'開啟鏡頭',exact:true}).click();
  await assertVideoCoversPreview(page);

  const viewport = page.viewportSize();
  for (const height of [viewport.height-100,viewport.height]) {
    await page.setViewportSize({...viewport,height});
    await assertVideoCoversPreview(page);
    for (const [target,type] of [['window','resize'],['visualViewport','resize'],['visualViewport','scroll']]) {
      const width = await page.locator('#video').evaluate((video,[target,type]) => {
        // Simulate WebKit shrinking the video box during a browser chrome change.
        video.style.width = '1px';
        video.style.minWidth = '1px';
        window[target].dispatchEvent(new Event(type));
        return video.style.width;
      },[target,type]);
      expect(width).toBe('100%');
      await assertVideoCoversPreview(page);
    }
  }
});
