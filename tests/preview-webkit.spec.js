const {readFileSync} = require('node:fs');
const path = require('node:path');
const {test,expect,begin} = require('./browser-fixture');
const {assertVideoCoversPreview} = require('./preview-fill');

test('WebKit portrait preview fills the box after leaving and returning to scan',async ({page,server,browserName}) => {
  test.skip(browserName !== 'webkit','Exercises WebKit without a fake camera');
  await page.goto(server.appUrl);
  await begin(page);

  const video = page.locator('#video');
  const clip = readFileSync(path.join(__dirname,'fixtures/preview-portrait.webm')).toString('base64');
  await video.evaluate(async (element,base64) => {
    document.querySelector('#camera-preview').hidden = false;
    element.parentElement.hidden = false;
    document.body.classList.add('scan-compact');
    element.loop = true;
    const bytes = Uint8Array.from(atob(base64),character => character.charCodeAt(0));
    element.src = URL.createObjectURL(new Blob([bytes],{type:'video/webm'}));
    await element.play();
  },clip);
  await assertVideoCoversPreview(page);
  expect(await video.evaluate(element => element.videoHeight > element.videoWidth)).toBe(true);

  await page.getByRole('button',{name:'設定開始',exact:true}).click();
  await expect(page.locator('#scan')).toBeHidden();
  await video.evaluate(element => {
    // Keep the clip attached and simulate the box WebKit can leave behind.
    document.querySelector('#camera-preview').hidden = false;
    element.parentElement.hidden = false;
    element.style.width = '55%';
    element.style.minWidth = '55%';
  });
  await page.getByRole('button',{name:'刷讀',exact:true}).click();
  await assertVideoCoversPreview(page);
});
