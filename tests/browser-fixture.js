const {test:base,expect} = require('@playwright/test');
const {start} = require('./mock-server');
const test = base.extend({
  server:async ({},use) => {
    const server = await start();
    try { await use(server); }
    finally { await server.close(); }
  }
});
async function open(page,server) {
  await page.goto(server.appUrl+'/?syncInterval=300');
  await expect(page.locator('#code')).not.toHaveValue('');
}
async function configure(page,server) {
  await page.getByRole('button',{name:'設定',exact:true}).click();
  await page.getByLabel('GAS API 網址').fill(server.apiUrl);
  await page.getByLabel('API 金鑰').fill('test-key');
  await page.getByRole('button',{name:'測試連線'}).click();
  await expect(page.locator('#ping-result')).toContainText('連線成功');
  await page.getByRole('button',{name:'設定開始',exact:true}).click();
}
async function begin(page,{code = 'TEST-S1',counter = '小林',join = false} = {}) {
  if (join) await page.getByLabel('加入既有場次').check();
  await page.getByLabel('場次代碼').fill(code);
  await page.getByLabel('盤點人').fill(counter);
  await page.getByRole('button',{name:'開始盤點',exact:true}).click();
  await expect(page.locator('#scan')).toBeVisible();
}
const scan = (page,code,source = 'manual',qty = 1) =>
  page.evaluate(([value,input,count]) => window.InventoryApp.handleScan(value,input,count),[code,source,qty]);
const itemRow = (page,code) => page.locator('#item-table tbody tr').filter({has:page.getByRole('cell',{name:code,exact:true})});
async function noPreflight(server) {
  const stats = await fetch(new URL('/__stats',server.apiUrl)).then(response => response.json());
  expect(stats.options).toBe(0);
  return stats;
}
module.exports = {test,expect,open,configure,begin,scan,itemRow,noPreflight};
