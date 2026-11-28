const {expect} = require('@playwright/test');

async function assertVideoCoversPreview(page) {
  const preview = page.locator('#preview');
  const video = preview.locator('video');
  await expect(preview).toBeVisible();
  await expect(video).toHaveCSS('object-fit','cover');
  await expect.poll(() => video.evaluate(element => {
    const box = element.parentElement.getBoundingClientRect();
    const frame = element.getBoundingClientRect();
    const {videoWidth,videoHeight} = element;
    const scale = Math.max(box.width/videoWidth,box.height/videoHeight);
    return {
      playing: !element.paused && element.readyState >= 2 && element.currentTime > 0,
      coversBox: box.width > 0 && box.height > 0 &&
        frame.left <= box.left+1 && frame.top <= box.top+1 &&
        frame.right >= box.right-1 && frame.bottom >= box.bottom-1,
      coversAtSourceScale: videoWidth*scale >= box.width-1e-6 &&
        videoHeight*scale >= box.height-1e-6
    };
  })).toEqual({playing:true,coversBox:true,coversAtSourceScale:true});
}

module.exports = {assertVideoCoversPreview};
