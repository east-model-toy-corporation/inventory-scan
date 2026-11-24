const path = require('node:path');
const {devices} = require('@playwright/test');
const {test,expect,open,configure,begin,scan} = require('./browser-fixture');

test('capture iPhone 14 views and the session banner',async ({browser,server,browserName}) => {
  test.skip(browserName !== 'webkit','使用 iPhone 14 的 WebKit 設定');
  const context = await browser.newContext({...devices['iPhone 14']});
  try {
    const page = await context.newPage();
    const capture = file => page.screenshot({path:path.join(__dirname,'../screens',file+'.png'),fullPage:true});
    await open(page,server);
    await page.locator('#counter').fill('林怡君');
    await expect(page.locator('#session-info')).toContainText('將建立新場次');
    await page.locator('#zone').fill('公仔區 A-03');
    await capture('01-start');
    await page.getByLabel('有商品主檔（對照帳面）').check();
    await page.locator('#master-file').setInputFiles({name:'sample.csv',mimeType:'text/csv',buffer:Buffer.from(
      '條碼,品名,帳面數量\n0490481004958,太空探測車模型,8\n4904810049586,合金工程車模型,4\n4904810222333,組裝機器人模型,6'
    )});
    await expect(page.locator('#master-count')).toHaveText('已載入 3 筆');
    await begin(page,{counter:'林怡君'});
    await scan(page,'0490481004958','manual',6);
    await scan(page,'UNLISTED-01','manual',2);
    await expect(page.getByRole('dialog')).toBeVisible();
    await capture('10-not-in-master');
    await page.getByRole('button',{name:'用品名搜尋'}).click();
    await page.locator('#master-query').fill('模型');
    await expect(page.locator('.master-result')).toHaveCount(3);
    await capture('11-name-search');
    await page.getByRole('button',{name:'← 返回'}).click();
    await page.getByRole('button',{name:'直接計入',exact:true}).click();
    await scan(page,'4904810049586','manual',7);
    await capture('02-scan-master');
    await page.getByRole('button',{name:'彙總',exact:true}).click();
    await expect(page.getByRole('heading',{name:'依區域'})).toBeVisible();
    await capture('04-summary');
    await page.getByRole('button',{name:'切換',exact:true}).click();
    await configure(page,server);
    await page.locator('#store').selectOption('武昌');
    await page.getByLabel('無主檔（直接累計）').check();
    await begin(page,{counter:'林怡君'});
    await scan(page,'4904810049586','manual',12);
    await scan(page,'TOY-A104','manual',3);
    await capture('03-scan-nomaster');
    await expect(page.locator('#end-session')).toBeVisible();
    await capture('08-session-banner');
    await expect(page.locator('#queue')).toHaveText('待上傳 0 筆');
    await page.getByRole('button',{name:'設定',exact:true}).click();
    await capture('05-settings');
    await page.getByRole('button',{name:'刷讀',exact:true}).click();
    await context.setOffline(true);
    await scan(page,'TOY-A200','manual',3);
    await scan(page,'TOY-A201','manual',2);
    await expect(page.locator('#queue')).toHaveText('待上傳 2 筆');
    await capture('06-offline-queue');
  } finally { await context.close(); }
});
