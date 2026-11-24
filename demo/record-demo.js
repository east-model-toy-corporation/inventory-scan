// 錄製 iPhone 14 尺寸操作示範：node demo/record-demo.js → demo/demo.mp4
const path = require('node:path'), fs = require('node:fs'), {execFileSync} = require('node:child_process');
const {chromium, devices} = require('playwright');
const {start} = require('../tests/mock-server');
const out = path.join(__dirname,'raw');
(async () => {
  fs.rmSync(out,{recursive:true,force:true});
  const server = await start();
  const browser = await chromium.launch({args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream',
    '--use-file-for-fake-video-capture='+path.join(__dirname,'../tests/fixtures/ean13.y4m')]});
  const {viewport,userAgent,deviceScaleFactor,isMobile,hasTouch} = devices['iPhone 14'];
  const context = await browser.newContext({viewport,userAgent,deviceScaleFactor,isMobile,hasTouch,permissions:['camera'],
    recordVideo:{dir:out,size:viewport}});
  await context.addInitScript(() => {
    window.addEventListener('DOMContentLoaded',() => {
      const box = document.createElement('div'); box.id = '__cap';
      box.style.cssText = 'position:fixed;left:8px;right:8px;bottom:14px;z-index:99999;pointer-events:none;background:rgba(10,30,26,.88);color:#fff;font:700 17px/1.45 system-ui,"PingFang TC",sans-serif;padding:10px 12px;border-radius:12px;border:2px solid #7ff0c4;text-align:center;box-shadow:0 4px 16px rgba(0,0,0,.35)';
      document.body.appendChild(box);
    });
  });
  const page = await context.newPage();
  const wait = ms => page.waitForTimeout(ms);
  const cap = async (text,ms = 2600) => { await page.evaluate(t => { const b = document.getElementById('__cap'); b.textContent = t; b.hidden = !t; },text); await wait(ms); };
  const manual = async () => { const t = page.getByRole('button',{name:'⌨ 手動輸入'}); if (await t.isVisible() && await t.getAttribute('aria-expanded') === 'false') { await t.click(); await wait(800); } };
  const btn = name => page.getByRole('button',{name,exact:true});
  await page.goto(server.appUrl+'/');
  await wait(800);
  // 示範用：同一條碼 10 分鐘內不重複計入（假鏡頭畫面固定不動）
  await btn('設定').click(); await page.locator('#dedupe').fill('600000'); await page.locator('#dedupe').dispatchEvent('change');
  await btn('設定開始').click();
  await cap('① 選擇門市、輸入盤點人',1200);
  await page.locator('#store').selectOption('武昌'); await wait(900);
  await page.locator('#counter').pressSequentially('林怡君',{delay:150}); await wait(1200);
  await cap('系統自動判斷：此門市沒有進行中的場次 → 開新場次「武昌＋今天日期」',3000);
  await cap('② 選「有商品主檔」，匯入 POS 匯出的庫存檔',1200);
  await page.getByLabel('有商品主檔（對照帳面）').check(); await wait(900);
  await page.locator('#master-file').setInputFiles({name:'武昌庫存.csv',mimeType:'text/csv',buffer:Buffer.from(
    '條碼,品名,帳面數量\n4904810049586,合金工程車模型,20\n0490481004958,太空探測車模型,8\n4904810222333,組裝機器人模型,6\n4904810333444,鋼彈 RX-78 模型,5')});
  await page.locator('#master-count').scrollIntoViewIfNeeded();
  await cap('主檔已載入 4 筆（品名＋帳面數），同場次其他人也會共用',2800);
  await btn('開始盤點').click(); await wait(1000);
  await cap('③ 按「開啟鏡頭」，對準條碼即可連續掃描，不用每次重開',1500);
  await btn('開啟鏡頭').click();
  await page.waitForFunction(() => InventoryApp.getState().lines.some(l => l.barcode === '4904810049586'),null,{timeout:20000});
  await cap('嗶！刷到「合金工程車模型」，鏡頭正下方立刻顯示品名、帳面與差異',3200);
  await cap('④ 按 +10：數量 1 → 11，鏡頭不會暫停',1200);
  await btn('+10').click(); await wait(2000);
  await cap('⑤ 已知總數就直接改：點數量欄 → 鏡頭暫停辨識',1200);
  await page.locator('#last-qty').click(); await wait(1800);
  await page.locator('#last-qty').fill(''); await page.locator('#last-qty').pressSequentially('20',{delay:250});
  await cap('輸入總數 20（是 20，不是 21），帳面 20 → 差異 0 相符',2600);
  await cap('按「確定，繼續掃描」→ 鏡頭恢復辨識',1200);
  await btn('確定，繼續掃描').click(); await wait(2000);
  await cap('鏡頭開著時版面精簡：鏡頭＋數量卡片一屏看完，不用往下滑',3000);
  await cap('⑥ 接著用掃描槍／手動輸入刷下一個商品（主檔裡沒有的條碼）',1400);
  await manual();
  await page.locator('#barcode').click(); await page.locator('#barcode').pressSequentially('4711111000013',{delay:70}); await page.keyboard.press('Enter');
  await page.getByRole('dialog').waitFor();
  await cap('警示！紅色「主檔查無此商品」＋警示音（手機會震動），掃描先暫停',3200);
  await cap('⑦ 選「用品名搜尋」，在主檔找正確的商品',1200);
  await btn('用品名搜尋').click(); await wait(900);
  await page.locator('#master-query').pressSequentially('鋼彈',{delay:250});
  await cap('輸入「鋼彈」→ 找到「鋼彈 RX-78 模型」，點選後數量計入這個主檔商品',2600);
  await page.locator('.master-result').first().click(); await wait(2600);
  await cap('⑧ 再刷一個主檔查無的條碼',1200);
  await manual();
  await page.locator('#barcode').click(); await page.locator('#barcode').pressSequentially('4799999000027',{delay:70}); await page.keyboard.press('Enter');
  await page.getByRole('dialog').waitFor(); await wait(1600);
  await btn('用品名搜尋').click(); await wait(700);
  await page.locator('#master-query').pressSequentially('恐龍',{delay:250});
  await cap('主檔搜尋不到「恐龍」→ 顯示「查無結果」',2600);
  await cap('按「← 返回」回到警示畫面',1200);
  await btn('← 返回').click(); await wait(1600);
  await cap('選「直接計入」：用刷到的條碼記下，標記「主檔查無」',1500);
  await btn('直接計入').click(); await wait(2600);
  await cap('⑨ 到「彙總」頁查看全場結果',1200);
  await btn('彙總').click(); await wait(2200);
  await cap('篩選「主檔查無」→ 只列出要再核對的商品',1200);
  await page.locator('#filter-summary').selectOption({label:'主檔查無'}); await wait(1000);
  await page.locator('#item-table').scrollIntoViewIfNeeded(); await wait(2800);
  await cap('示範結束：刷讀資料會自動上傳到 Google 試算表彙整',3000);
  const video = page.video();
  await context.close(); await browser.close(); await server.close();
  const raw = await video.path();
  execFileSync('ffmpeg',['-y','-loglevel','error','-i',raw,'-vf','scale=780:-2:flags=lanczos,fps=30','-c:v','libx264','-pix_fmt','yuv420p','-crf','20','-movflags','+faststart',path.join(__dirname,'demo.mp4')]);
  fs.rmSync(out,{recursive:true,force:true});
  console.log('done');
})().catch(e => { console.error(e); process.exit(1); });
