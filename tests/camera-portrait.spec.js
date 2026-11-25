const {test,expect,begin} = require('./browser-fixture');

test('portrait camera fills the compact preview and counts the barcode',async ({page,server}) => {
  // Keep the fake camera's native orientation even when the app requests landscape.
  await page.addInitScript(() => {
    const getUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = constraints => getUserMedia({
      ...constraints,video:{...constraints.video,resizeMode:{exact:'none'}}
    });
  });
  await page.goto(server.appUrl+'/?engine=zxing');
  await begin(page);
  await page.getByRole('button',{name:'開啟鏡頭'}).click();
  await expect(page.locator('body')).toHaveClass(/\bscan-compact\b/);

  const video = page.locator('#video');
  await expect.poll(() => video.evaluate(element =>
    !element.paused && element.readyState >= 2 && element.currentTime > 0)).toBe(true);
  await expect(video).toHaveCSS('object-fit','cover');
  const geometry = await video.evaluate(element => {
    const box = element.parentElement.getBoundingClientRect();
    const frame = element.getBoundingClientRect();
    const scale = Math.max(box.width/element.videoWidth,box.height/element.videoHeight);
    return {
      portrait:element.videoHeight > element.videoWidth,
      edgeDifferences:['left','right','top','bottom'].map(edge => Math.abs(frame[edge]-box[edge])),
      boxWidth:box.width,boxHeight:box.height,
      imageWidth:element.videoWidth*scale,imageHeight:element.videoHeight*scale
    };
  });
  expect(geometry.portrait).toBe(true);
  expect(Math.max(...geometry.edgeDifferences)).toBeLessThanOrEqual(1);
  expect(geometry.imageWidth).toBeGreaterThanOrEqual(geometry.boxWidth-1e-6);
  expect(geometry.imageHeight).toBeGreaterThanOrEqual(geometry.boxHeight-1e-6);
  await expect.poll(() => page.evaluate(() => {
    const line = window.InventoryApp.getState().lines.find(item => item.barcode === '4904810049586');
    return line ? line.qty : 0;
  })).toBeGreaterThanOrEqual(1);
});
