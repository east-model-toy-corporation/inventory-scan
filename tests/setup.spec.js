const {test,expect} = require('./browser-fixture');

test.use({useMockDefault:true});

test('setup link enables the default API from the GitHub Pages subpath',async ({page,server}) => {
  const app = server.appUrl+'/inventory-scan/?syncInterval=300';
  await page.goto(app);
  const banner = page.locator('#missing-api-key');
  await expect(banner).toBeVisible();
  await expect(banner).toContainText('尚未設定 API 金鑰：請到「設定」輸入，或使用主管提供的設定連結');
  await banner.getByRole('button',{name:'設定',exact:true}).click();
  await expect(page.getByLabel('API 金鑰')).toBeVisible();
  expect(await page.evaluate(() => window.InvStorage.get('config',null))).toBeNull();

  await page.goto('about:blank');
  await page.goto(app+'#key=test%2Dkey');
  await expect(page).toHaveURL(app);
  await expect(page.locator('#toast')).toHaveText('已設定 API 金鑰');
  await expect(banner).toBeHidden();
  await expect(page.locator('#session-info')).toContainText('將建立新場次');
  await page.reload();

  await page.getByRole('button',{name:'設定',exact:true}).click();
  await expect(page.getByLabel('API 金鑰')).toHaveValue('test-key');
  await expect(page.getByLabel('GAS API 網址')).toHaveValue('');
  await page.getByRole('button',{name:'測試連線'}).click();
  await expect(page.locator('#ping-result')).toContainText('連線成功');
});

test('setup URL overrides the default until cleared in settings',async ({page,server}) => {
  const app = server.appUrl+'/inventory-scan/';
  const customUrl = server.apiUrl+'?custom=1';
  const ping = url => page.waitForRequest(request => {
    const target = new URL(request.url());
    return target.searchParams.get('action') === 'ping' &&
      target.searchParams.get('custom') === new URL(url).searchParams.get('custom');
  });
  await page.goto(app+'#key=test-key&url='+encodeURIComponent(customUrl));
  await expect(page).toHaveURL(app);
  await page.reload();
  await page.getByRole('button',{name:'設定',exact:true}).click();
  const url = page.getByLabel('GAS API 網址');
  const pingButton = page.getByRole('button',{name:'測試連線'});
  await expect(url).toHaveValue(customUrl);
  const customPing = ping(customUrl);
  await pingButton.click();
  await customPing;
  await expect(page.locator('#ping-result')).toContainText('連線成功');

  await url.clear();
  const defaultPing = ping(server.apiUrl);
  await pingButton.click();
  await defaultPing;
  await expect(page.locator('#ping-result')).toContainText('連線成功');
});
