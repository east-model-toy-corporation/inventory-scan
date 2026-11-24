const path = require('node:path');
const {test,expect,begin} = require('./browser-fixture');

const sizes = [
  {name:'iPhone 14',width:390,height:844,scale:3,file:'12-compact-iphone14.png'},
  {name:'iPhone SE',width:375,height:667,scale:2,file:'13-compact-iphonese.png'},
  {name:'Android',width:360,height:780,scale:3,file:'14-compact-android.png'}
];

async function insideViewport(locator,height) {
  await expect(locator).toBeVisible();
  const box = await locator.boundingBox();
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y+box.height).toBeLessThanOrEqual(height);
}

for (const {name,width,height,scale,file} of sizes) {
  test.describe(name,() => {
    test.use({viewport:{width,height},screen:{width,height},deviceScaleFactor:scale,isMobile:true,hasTouch:true});

    test('camera, quantity controls and unknown-item dialog fit on screen',async ({page,server}) => {
      await page.goto(server.appUrl+'/?engine=zxing');
      await page.getByLabel('有商品主檔（對照帳面）').check();
      await page.locator('#master-file').setInputFiles({
        name:'stock.csv',mimeType:'text/csv',
        buffer:Buffer.from('條碼,品名,帳面數量\n4904810049586,模型汽車,5\nB2,模型火車,9\nC3,模型飛機,7')
      });
      await expect(page.locator('#master-count')).toHaveText('已載入 3 筆');
      await page.locator('#zone').fill('A-03');
      await begin(page);
      await page.getByRole('button',{name:'開啟鏡頭'}).click();
      const body = page.locator('body');
      const qty = page.locator('#last-qty');
      const chip = page.getByRole('button',{name:'區域：A-03'});
      await expect(chip).toBeVisible();
      await expect(body).toHaveClass(/\bscan-compact\b/);
      await expect(qty).toHaveValue(/^\d+$/);
      await expect(page.locator('#last-details')).toContainText('4904810049586');
      const measure = async () => {
        const viewport = await page.evaluate(() => ({height:window.innerHeight,y:window.scrollY}));
        expect(viewport).toEqual({height,y:0});
        for (const selector of ['#camera-panel','#video','#last-qty','#last-controls [data-adjust="-1"]',
          '#last-controls [data-adjust="1"]','#last-controls [data-adjust="5"]',
          '#last-controls [data-adjust="10"]','#last-controls [data-adjust="12"]']) {
          await insideViewport(page.locator(selector),height);
        }
      };
      await measure();
      const header = await page.locator('.app-header').boundingBox();
      const zone = await chip.boundingBox();
      expect(zone.x + zone.width).toBeLessThanOrEqual(width);
      expect(zone.y + zone.height).toBeLessThanOrEqual(header.y + header.height);
      await page.screenshot({path:path.join(__dirname,'../screens',file),fullPage:false});

      await qty.focus();
      const confirm = page.getByRole('button',{name:'確定，繼續掃描'});
      await insideViewport(confirm,height);
      await measure();
      await expect(page.locator('#scan-paused')).toBeVisible();
      // Blur to the toggle so the form can be explicitly expanded.
      const toggle = page.getByRole('button',{name:'⌨ 手動輸入'});
      await toggle.focus();
      await expect(confirm).toBeHidden();
      await expect(toggle).toHaveAttribute('aria-expanded','false');
      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-expanded','true');
      await page.locator('#barcode').fill('UNKNOWN');
      await page.locator('#barcode').press('Enter');

      const dialog = page.getByRole('dialog');
      await expect(dialog).toContainText('UNKNOWN');
      await insideViewport(dialog,height);
      await dialog.getByRole('button',{name:'用品名搜尋'}).click();
      const query = dialog.getByRole('searchbox');
      await query.fill('模型');
      const results = dialog.locator('.master-result');
      await expect(results).toHaveCount(3);
      await insideViewport(results.first(),height);
      await insideViewport(results.last(),height);
      await insideViewport(dialog,height);
      await insideViewport(dialog.getByRole('button',{name:'← 返回'}),height);
      await insideViewport(query,height);
      await insideViewport(dialog.getByRole('button',{name:'取消',exact:true}),height);
      await dialog.getByRole('button',{name:'取消',exact:true}).click();

      await page.getByRole('button',{name:'停止',exact:true}).click();
      await expect(body).not.toHaveClass(/\bscan-compact\b/);
      await expect(page.locator('#barcode')).toBeVisible();
    });
  });
}
