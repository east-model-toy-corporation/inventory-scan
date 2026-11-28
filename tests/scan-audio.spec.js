const {test,expect,open,begin,scan} = require('./browser-fixture');

test('scan beeps recover across audio interruptions and respect the beep switch',async ({page,server}) => {
  await page.addInitScript(() => {
    const probe = window.audioProbe = {contexts:[],starts:[],resumes:0};
    class AudioContextStub {
      constructor() {
        this.state = 'suspended';
        this.currentTime = 1;
        this.destination = {};
        probe.contexts.push(this);
      }
      async resume() {
        probe.resumes++;
        if (this.rejectResume) throw new Error('Resume failed');
        if (probe.resumeGate) await probe.resumeGate;
        this.state = 'running';
      }
      async close() { this.state = 'closed'; }
      createOscillator() {
        return {
          frequency:{value:0},
          connect() {},
          start(time) { probe.starts.push([this.frequency.value,time]); },
          stop() {}
        };
      }
      createGain() { return {gain:{value:0},connect() {}}; }
    }
    window.AudioContext = undefined;
    window.webkitAudioContext = AudioContextStub;
  });
  const starts = () => page.evaluate(() => audioProbe.starts);
  await open(page,server);
  await page.getByLabel('有商品主檔（對照帳面）').check();
  await page.locator('#master-file').setInputFiles({name:'stock.csv',mimeType:'text/csv',
    buffer:Buffer.from('JAN,商品名稱,庫存\n000001,模型甲,5')});
  await expect(page.locator('#master-count')).toHaveText('已載入 1 筆');
  await begin(page);
  const manualToggle = page.locator('#manual-toggle');
  if (await manualToggle.isVisible() && await manualToggle.getAttribute('aria-expanded') === 'false') {
    await manualToggle.click();
  }
  const barcode = page.locator('#barcode');
  await barcode.fill('000001');
  await barcode.press('Enter');
  await expect.poll(starts).toEqual([[850,1]]);

  const before = await page.evaluate(() => {
    audioProbe.contexts[0].state = 'interrupted';
    audioProbe.resumeGate = new Promise(resolve => { audioProbe.releaseResume = resolve; });
    return audioProbe.resumes;
  });
  expect(await scan(page,'000001')).toBe(true);
  expect(await page.evaluate(() => audioProbe.resumes)).toBeGreaterThan(before);
  expect(await starts()).toEqual([[850,1]]);
  await page.evaluate(() => {
    audioProbe.releaseResume();
    audioProbe.resumeGate = null;
  });
  await expect.poll(starts).toEqual([[850,1],[850,1]]);

  await page.evaluate(() => {
    audioProbe.contexts[0].state = 'suspended';
    document.body.click();
  });
  await expect.poll(() => page.evaluate(() => audioProbe.contexts[0].state)).toBe('running');

  await page.evaluate(() => {
    audioProbe.contexts[0].state = 'suspended';
    audioProbe.contexts[0].rejectResume = true;
  });
  await scan(page,'UNKNOWN');
  await expect(page.getByRole('dialog',{name:'主檔查無此商品'})).toBeVisible();
  await expect.poll(starts).toEqual([[850,1],[850,1],[220,1],[220,1.25]]);
  expect(await page.evaluate(() => audioProbe.contexts.map(context => context.state))).toEqual(['closed','running']);

  await page.locator('#cancel-unknown').click();
  await page.evaluate(() => { audioProbe.contexts[1].state = 'closed'; });
  expect(await scan(page,'000001')).toBe(true);
  await expect.poll(starts).toEqual([[850,1],[850,1],[220,1],[220,1.25],[850,1]]);

  await page.getByRole('button',{name:'設定',exact:true}).click();
  await page.getByLabel('嗶聲').uncheck();
  await page.evaluate(() => { audioProbe.contexts[2].state = 'closed'; });
  await page.getByRole('button',{name:'刷讀',exact:true}).click();
  expect(await scan(page,'000001')).toBe(true);
  expect(await page.evaluate(() => audioProbe.contexts.length)).toBe(3);
  expect(await starts()).toHaveLength(5);
});
