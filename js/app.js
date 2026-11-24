(function () {
  const C = window.InvCore, S = window.InvStorage, api = window.InvApi.request;
  const $ = id => document.getElementById(id);
  const chosen = name => document.querySelector('input[name="'+name+'"]:checked').value;
  const stores = ['萬年總店','華山','夢時代','武昌','大江'];
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  const device = S.get('device',null) || 'D-'+C.random(12);
  S.set('device',device);
  const config = Object.assign({
    url:'',key:'',deviceName:(ios ? (/iPhone/.test(ua) ? 'iPhone' : 'iPad') : /Android/.test(ua) ? 'Android' : '電腦')+'-'+device.slice(-4),
    dedupe:1500,beep:true,vibrate:true
  },S.get('config',{}));
  let custom = S.get('stores',[]), sessions = S.get('sessions',{}), masters = S.get('masters',{});
  let active = S.get('active',null), lines = new Map(), lastId, editingId, remote, view = 'start';
  let busy = false, retryAt = 0, delay = 2000, lastSync = '', syncError = '', toastTimer, audio;
  let summaryDue = false, nextSummaryAt = 0;
  let lookupToken = 0, lastMutation = 0;
  const seen = new Map();
  const interval = Math.max(200,Number(new URLSearchParams(location.search).get('syncInterval')) || 3000);
  const localReady = S.load().then(rows => {
    lines = new Map(rows.map(line => [line.id,line]));
    for (const line of rows) lastMutation = Math.max(lastMutation,Date.parse(line.updatedAt) || 0);
  });
  const values = () => [...lines.values()];
  const itemsFor = store => Object.prototype.hasOwnProperty.call(masters,store) ? masters[store] : [];
  const clock = value => new Date(value).toLocaleString('zh-TW',{timeZone:'Asia/Taipei',hour12:false});
  const deviceLabel = id => {
    if (id === device) return config.deviceName;
    const position = id.indexOf('｜');
    return position < 0 ? id : id.slice(position+1)+' · '+id.slice(position-4,position);
  };
  function node(tag,text,style) {
    const element = document.createElement(tag);
    if (text != null) element.textContent = text;
    if (style) element.className = style;
    return element;
  }
  function replace(element,...children) {
    element.textContent = '';
    element.append(...children);
  }
  function button(text, action, style) {
    const element = node('button',text,style);
    element.type = 'button';
    element.addEventListener('click',action);
    return element;
  }
  function toast(message) {
    $('toast').textContent = message;
    $('toast').hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { $('toast').hidden = true; },3200);
  }
  function save(key,value) {
    if (!S.set(key,value)) toast('無法儲存本機設定');
  }
  function showQueue() {
    const dirty = values().filter(line => line.dirty).length;
    $('queue').textContent = config.url ? '待上傳 '+dirty+' 筆' : '未設定雲端，僅存本機';
    $('sync-status').textContent = config.url ? [
      !navigator.onLine ? '離線中' : '', lastSync ? '上次同步 '+clock(lastSync) : '', syncError
    ].filter(Boolean).join(' · ') : '';
  }
  function rememberSession(session,pending) {
    sessions = {...sessions,[session.code]:{...session,pending}};
    save('sessions',sessions);
  }
  function own(line) {
    return line.device === device || line.device.startsWith(device+'｜');
  }
  function scope() {
    return {session:active.code,store:active.store,counter:active.counter,device};
  }
  function wireDevice(line) {
    return {...line,device:device+'｜'+config.deviceName};
  }
  async function syncNow(force = true) {
    await localReady;
    if (busy || !config.url || !navigator.onLine || (!force && Date.now() < retryAt)) return;
    const connection = {...config};
    const sameConnection = () => connection.url === config.url && connection.key === config.key;
    const pending = Object.values(sessions).filter(session => session.pending);
    if (!pending.length && !C.batch(values()).length) {
      refreshAfterSync();
      return;
    }
    busy = true;
    try {
      for (const session of pending) {
        const result = await api(connection,'createSession',session,true);
        if (!sameConnection()) return;
        if (result.session.store !== session.store || result.session.mode !== session.mode) {
          throw new Error('場次代碼已被其他門市或模式使用，請確認場次設定');
        }
        if (sessions[session.code] === session) rememberSession(result.session,false);
      }
      const batch = C.batch(values());
      if (batch.length) {
        const snapshots = new Map(batch.map(line => [line.id,line]));
        await Promise.all(batch.map(line => writes.get(line.id) || (unpersisted.has(line.id) ? S.put(line) : undefined)));
        const result = await api(connection,'upload',{lines:batch.map(wireDevice)},true);
        if (!sameConnection()) return;
        for (const ack of result.acks) {
          const current = lines.get(ack.id);
          if (!C.acknowledged(current,ack,snapshots.get(ack.id))) continue;
          const updated = {...current,dirty:false};
          lines.set(updated.id,updated);
          try { await S.put(updated); }
          catch (error) {
            if (lines.get(updated.id) === updated) lines.set(current.id,current);
            throw error;
          }
        }
        if (result.rejected.length || result.acks.length < batch.length) {
          throw new Error(result.rejected.length ? '明細上傳失敗：'+result.rejected[0].error : '部分明細未收到上傳確認');
        }
      }
      delay = 2000;
      retryAt = 0;
      lastSync = new Date().toISOString();
      syncError = '';
      if (active && active.mode === 'master') summaryDue = true;
      refreshAfterSync();
    } catch (error) {
      if (sameConnection()) {
        syncError = error.message+'，將自動重試';
        retryAt = Date.now()+delay;
        delay = Math.min(delay*2,60000);
      }
    } finally { busy = false; showQueue(); }
  }
  function storeOptions(selected) {
    const options = [...stores,...custom];
    if (selected && !options.includes(selected) && selected !== '+') options.push(selected);
    replace($('store'),...options.map(store => new Option(store,store)),new Option('＋自訂門市…','+'));
    $('store').value = selected && selected !== '+' ? selected : options[0];
  }
  function storeChanged() {
    $('custom-entry').hidden = $('store').value !== '+';
    if ($('store').value !== '+' && chosen('session-type') === 'new') $('code').value = C.sessionCode($('store').value);
    showMaster();
  }
  function showMaster() {
    $('master-controls').hidden = chosen('mode') !== 'master';
    const items = itemsFor($('store').value);
    $('master-count').textContent = '已載入 '+items.length+' 筆';
    $('send-master').disabled = !items.length || !config.url;
    $('load-master').disabled = !config.url;
  }
  function useMaster(store,items) {
    masters = {...masters,[store]:items};
    save('masters',masters);
    showMaster();
  }
  function setSessionType() {
    lookupToken++;
    const join = chosen('session-type') === 'join';
    $('lookup').hidden = !join;
    $('name-field').hidden = join;
    $('session-info').textContent = '';
    $('code').value = join ? '' : C.sessionCode($('store').value);
  }
  async function lookup(code) {
    const token = ++lookupToken;
    const local = Object.prototype.hasOwnProperty.call(sessions,code) ? sessions[code] : null;
    let session = local, cloudSession;
    let message = '';
    if (config.url) {
      $('session-info').textContent = '正在查詢場次…';
      try {
        cloudSession = (await api(config,'session',{code})).session;
        session = cloudSession || local;
        if (!session) message = '雲端查無此場次，仍可開始盤點';
      } catch (error) { message = error.message+'，仍可開始盤點'; }
    } else if (!session) message = '未設定雲端，仍可加入並在本機盤點';
    if (token !== lookupToken || C.clean($('code').value).toUpperCase() !== code) return null;
    if (session) {
      if (cloudSession && ($('store').value !== session.store || chosen('mode') !== session.mode)) {
        toast('已套用雲端場次的門市與盤點模式');
      }
      storeOptions(session.store);
      $('custom-entry').hidden = true;
      document.querySelector('input[name="mode"][value="'+(session.mode === 'master' ? 'master' : 'none')+'"]').checked = true;
      message = [session.store,session.mode === 'master' ? '有商品主檔' : '無主檔',session.createdAt ? clock(session.createdAt) : '',message].filter(Boolean).join(' · ');
      showMaster();
    }
    $('session-info').textContent = message;
    return session;
  }
  function identity() {
    $('identity').textContent = active ? [active.code,active.store,active.counter].join(' ／ ') : '尚未開始盤點';
    $('switch').hidden = !active;
  }
  function go(next) {
    if (!active && ['scan','summary'].includes(next)) { toast('請先開始盤點'); return; }
    if (view === 'scan' && next !== 'scan') scanner.stop();
    if (next === 'start' && active && view !== 'start' && chosen('session-type') === 'new') {
      $('code').value = C.sessionCode($('store').value);
      $('session-info').textContent = '';
    }
    view = next;
    for (const tab of document.querySelectorAll('[data-view]')) {
      const current = tab.dataset.view === next;
      $(tab.dataset.view).hidden = !current;
      if (current) tab.setAttribute('aria-current','page');
      else tab.removeAttribute('aria-current');
    }
    if (next === 'scan') {
      renderScan();
      if (window.matchMedia('(pointer:fine)').matches) $('barcode').focus();
    }
    if (next === 'summary') renderSummary();
    if (next === 'settings') renderSettings();
    window.scrollTo(0,0);
  }
  async function begin(event) {
    event.preventDefault();
    await localReady;
    const code = C.clean($('code').value).toUpperCase();
    const counter = C.clean($('counter').value);
    if (!code || !counter || $('store').value === '+') { toast('請填寫門市、盤點人與場次'); return; }
    $('begin').disabled = true;
    try {
      const join = chosen('session-type') === 'join';
      let session = join ? await lookup(code) : null;
      if (!session) session = {code,name:join ? '' : C.clean($('session-name').value),store:$('store').value,
        mode:chosen('mode'),createdBy:counter,createdAt:new Date().toISOString()};
      rememberSession(session,!join || !!session.pending || !session.status);
      if (join && config.url && session.mode === 'master' && !itemsFor(session.store).length) {
        try { useMaster(session.store,(await api(config,'master',{store:session.store})).items); }
        catch (error) { toast(error.message); }
      }
      active = {...session,counter};
      lastId = editingId = remote = null;
      summaryDue = false;
      nextSummaryAt = 0;
      seen.clear();
      save('active',active);
      identity();
      go('scan');
      syncNow(false);
    } finally { $('begin').disabled = false; }
  }
  function unlockAudio() {
    if (!config.beep) return;
    const Audio = window.AudioContext || window.webkitAudioContext;
    if (!Audio) return;
    try {
      if (!audio) audio = new Audio();
      if (audio.state !== 'running') audio.resume().catch(() => {});
    } catch (_) { /* 繼續刷讀 */ }
  }
  function feedback(unknown) {
    if (config.vibrate && navigator.vibrate) navigator.vibrate(60);
    if (!config.beep || !audio || audio.state !== 'running') return;
    try {
      const tone = audio.createOscillator(), volume = audio.createGain();
      tone.frequency.value = unknown ? 310 : 850;
      volume.gain.value = .12;
      tone.connect(volume);
      volume.connect(audio.destination);
      tone.start();
      tone.stop(audio.currentTime+.095);
    } catch (_) { /* 繼續刷讀 */ }
  }
  const writes = new Map(), unpersisted = new Set();
  function mutationTime() {
    lastMutation = Math.max(Date.now(),lastMutation+1);
    return lastMutation;
  }
  function record(line) {
    lines.set(line.id,line);
    showQueue();
    renderScan();
    const write = S.put(line);
    writes.set(line.id,write);
    unpersisted.add(line.id);
    const finished = () => { if (writes.get(line.id) === write) writes.delete(line.id); };
    write.then(() => { if (writes.get(line.id) === write) unpersisted.delete(line.id); finished(); },error => { finished(); toast(error.message); });
    return write.then(() => true,() => false);
  }
  async function handleScan(code,source = 'camera',qty = 1) {
    await localReady;
    if (!active || view !== 'scan') return false;
    const raw = C.clean(code);
    if (!raw || raw.length > 64 || !Number.isInteger(qty) || qty < 1 || qty > 999999) return false;
    const product = active.mode === 'master' && C.findProduct(C.masterIndex(itemsFor(active.store)),raw);
    const barcode = product ? product.barcode : raw;
    if (C.deduped(seen,barcode,source,config.dedupe)) {
      $('scan-note').textContent = '重複略過';
      return false;
    }
    const line = C.upsertScan(values(),scope(),barcode,product ? product.name : '',qty,mutationTime());
    if (line.qty > 999999) { toast('單筆數量最多 999,999 件'); return false; }
    lastId = line.id;
    $('scan-note').textContent = '';
    feedback(active.mode === 'master' && !product);
    return record(line);
  }
  function update(line,qty) {
    const current = lines.get(line.id);
    if (!current || current.deleted) return;
    if (!Number.isInteger(qty) || qty < 0 || qty > 999999) { toast('請輸入 0 到 999,999 的整數'); return; }
    if (qty === 0 && !window.confirm('確定刪除此筆刷讀明細？')) return;
    editingId = null;
    lastId = line.id;
    record(C.editLine(current,{qty,deleted:qty === 0},mutationTime()));
  }
  function combined() {
    const merged = new Map();
    for (const line of remote ? [...remote.details,...(remote.tombstones || [])] : []) merged.set(line.id,line);
    for (const line of values()) {
      if (line.session !== active.code) continue;
      const server = merged.get(line.id);
      if (!server || line.updatedAt > server.updatedAt) merged.set(line.id,line);
    }
    const master = C.masterIndex(itemsFor(active.store));
    if (remote && active.mode === 'master') for (const item of remote.items) {
      if (item.bookQty !== '') master.set(item.barcode,item);
    }
    return C.summarize(active,[...merged.values()],master,device);
  }
  function metrics(target,entries) {
    replace(target,...entries.map(([label,value,style]) => {
      const element = node('span',label,style);
      element.append(node('b',value));
      return element;
    }));
  }
  function renderScan() {
    if (!active) return;
    const visible = values().filter(line => C.sameScope(line,scope()) && !line.deleted)
      .sort((a,b) => b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id));
    $('scan-totals').textContent = '品項數 '+visible.length+' ／ 總件數 '+visible.reduce((n,line) => n+line.qty,0);
    const master = C.masterIndex(itemsFor(active.store));
    const compare = active.mode === 'master';
    const filter = C.clean($('filter-lines').value).toLowerCase();
    const rows = visible.filter(line => (line.name+' '+line.barcode).toLowerCase().includes(filter)).map(line => {
      const product = compare && C.findProduct(master,line.barcode);
      const row = node('li');
      row.dataset.barcode = line.barcode;
      const title = node('div',null,'line-text');
      title.append(node('strong',product ? product.name || line.barcode : line.name || line.barcode));
      if (line.name || product) title.append(node('small',line.barcode));
      if (compare && !product) title.append(node('small','主檔查無','unknown'));
      const actions = node('div',null,'line-actions');
      if (editingId === line.id) {
        const form = node('form',null,'line-actions');
        const input = node('input');
        Object.assign(input,{type:'number',value:line.qty,min:0,max:999999,required:true,inputMode:'numeric'});
        input.setAttribute('aria-label','編輯數量');
        const submit = node('button','儲存');
        form.append(input,submit,button('取消',() => { editingId = null; renderScan(); }));
        form.addEventListener('submit',event => { event.preventDefault(); update(line,input.valueAsNumber); });
        actions.append(form);
      } else actions.append(button('−',() => update(line,line.qty-1)),
        button(line.qty,() => {
          editingId = line.id;
          renderScan();
          const input = $('lines').querySelector('input');
          if (input) { input.focus(); input.select(); }
        }),button('＋',() => update(line,line.qty+1)),button('刪除',() => update(line,0),'danger'));
      row.append(title,actions);
      return row;
    });
    replace($('lines'),...rows);
    const last = lines.get(lastId);
    $('last-scan').hidden = !last || last.deleted;
    if (!last || last.deleted) return;
    const product = compare && C.findProduct(master,last.barcode);
    const heading = node('h3',product ? product.name || last.barcode : compare ? '主檔查無' : last.barcode,compare && !product ? 'unknown' : '');
    const detail = node('div',null,'metrics');
    const matches = barcode => barcode === last.barcode || (product && C.findProduct(master,barcode) === product);
    const localQty = values().filter(line => !line.deleted && line.session === active.code && own(line) &&
      matches(line.barcode)).reduce((total,line) => total+line.qty,0);
    const counts = [[compare ? '本機已盤' : '累計',localQty]];
    let total = localQty;
    if (remote) {
      total += remote.items.filter(item => matches(item.barcode))
        .reduce((qty,item) => qty+item.countedQty-item.mineQty,0);
      counts.push(['全場已盤',total]);
    }
    if (compare) {
      const diff = product ? total-product.bookQty : null;
      counts.push(['帳面',product ? product.bookQty : '—'],['差異',diff === null ? '—' :
        (diff > 0 ? '+' : '')+diff+' '+C.itemStatus(product.bookQty,total),diff > 0 ? 'positive' : diff < 0 ? 'negative' : '']);
    }
    metrics(detail,counts);
    replace($('last-scan'),heading,...(compare ? [node('p',last.barcode)] : []),detail);
  }
  const summaryStatusClasses = {
    '盤盈':'surplus', '盤虧':'shortage', '相符':'matched', '主檔查無':'unknown', '未盤':'uncounted'
  };
  function table(rows, itemTable = false) {
    const container = node('div',null,'table-wrap'), element = node('table');
    const head = node('thead'), body = node('tbody');
    rows.forEach((cells,index) => {
      const row = node('tr');
      cells.forEach((value, column) => {
        const cell = node(index ? 'td' : 'th',value);
        if (itemTable && index && column === 5 && value) {
          replace(cell,node('span',value,'status-pill '+summaryStatusClasses[value]));
        }
        row.append(cell);
      });
      (index ? body : head).append(row);
    });
    element.append(head,body);
    container.append(element);
    return container;
  }
  function renderSummary() {
    if (!active) return;
    const summary = combined();
    $('summary-source').textContent = remote ? '已載入全場資料'+(remote.updatedAt ? ' · '+clock(remote.updatedAt) : '') :
      '僅本機資料'+(config.url ? ' · 可重新整理取得全場資料' : '');
    metrics($('summary-totals'),[['筆數',summary.totals.lines],['品項數',summary.totals.items],['總件數',summary.totals.qty]]);
    const filter = $('filter-summary').value;
    const filtered = summary.items.filter(item => filter === 'all' ||
      (filter === 'diff' ? item.diff !== '' && item.diff !== 0 : item.status === filter));
    replace($('item-table'),table(C.itemRows(filtered),true));
    const groups = [['依盤點人',summary.byCounter,'counter','盤點人'],
      ['依裝置',summary.byDevice.map(row => ({...row,device:deviceLabel(row.device)})),'device','裝置']];
    replace($('summary-groups'),...groups.map(([title,rows,key,label]) => {
      const panel = node('div',null,'panel stack');
      panel.append(node('h3',title),table(C.groupRows(rows,key,label)));
      return panel;
    }));
  }
  function refreshAfterSync() {
    if (summaryDue && active && active.mode === 'master' && Date.now() >= nextSummaryAt) refresh(true);
  }
  async function refresh(automatic = false) {
    if (!config.url) { renderSummary(); return; }
    if ($('refresh').disabled) return;
    const current = active, url = config.url, key = config.key;
    summaryDue = false;
    nextSummaryAt = Date.now()+10000;
    $('refresh').disabled = true;
    try {
      const result = await api(config,'summary',{session:current.code,device:wireDevice({}).device});
      if (active !== current || config.url !== url || config.key !== key) return;
      remote = result;
      if (view === 'scan') renderScan();
      renderSummary();
    } catch (error) {
      if (!automatic) toast(error.message);
    }
    finally { $('refresh').disabled = false; }
  }
  function download(content,type,name) {
    const url = URL.createObjectURL(new Blob([content],{type}));
    const link = node('a');
    Object.assign(link,{href:url,download:name});
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url),10000);
  }
  function exportSummary(extension) {
    const rows = C.exportRows(combined());
    const name = C.filename(active.code,extension);
    if (extension === 'csv') download(C.csv(rows.彙總),'text/csv;charset=utf-8',name);
    else {
      const book = XLSX.utils.book_new();
      for (const [label,data] of Object.entries(rows)) XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet(data),label);
      XLSX.writeFile(book,name);
    }
  }
  function renderSettings() {
    for (const [id,key] of [['url','url'],['key','key'],['device-name','deviceName'],['dedupe','dedupe']]) $(id).value = config[key];
    for (const key of ['beep','vibrate']) $(key).checked = config[key];
    replace($('custom-stores'),...(custom.length ? custom.map(store => {
      const row = node('li',store);
      row.append(button('移除',() => {
        custom = custom.filter(item => item !== store);
        save('stores',custom);
        storeOptions($('store').value === store ? '' : $('store').value);
        storeChanged();
        renderSettings();
      },'danger'));
      return row;
    }) : [node('li','尚無自訂門市')]));
  }
  function saveConfig() {
    const url = C.clean($('url').value), key = C.clean($('key').value);
    if (url && (!/^https?:\/\//i.test(url) || !$('url').validity.valid)) { $('ping-result').textContent = '請輸入有效的雲端網址'; return false; }
    if (config.url !== url || config.key !== key) {
      lastSync = syncError = '';
      retryAt = 0; delay = 2000;
      remote = null;
      summaryDue = false;
      nextSummaryAt = 0;
    }
    Object.assign(config,{url,key,deviceName:C.clean($('device-name').value) || config.deviceName,
      dedupe:Math.max(0,Math.floor(Number($('dedupe').value) || 0)),beep:$('beep').checked,vibrate:$('vibrate').checked});
    save('config',config);
    showQueue();
    showMaster();
    return true;
  }
  const scanner = window.InvScanner.create($('video'),handleScan,(running,torch,error) => {
    $('camera').textContent = running ? '停止' : '開啟鏡頭';
    $('preview').hidden = !running;
    $('torch').hidden = !torch;
    $('torch').setAttribute('aria-pressed','false');
    $('camera-note').textContent = error;
  });
  for (const tab of document.querySelectorAll('[data-view]')) tab.onclick = () => go(tab.dataset.view);
  $('switch').onclick = () => go('start');
  $('store').onchange = storeChanged;
  $('add-store').onclick = () => {
    const store = C.clean($('custom-name').value);
    if (!store || store === '+') { toast('請輸入自訂門市名稱'); return; }
    if (!stores.includes(store) && !custom.includes(store)) {
      custom.push(store);
      save('stores',custom);
    }
    storeOptions(store);
    storeChanged();
    $('custom-name').value = '';
  };
  for (const radio of document.querySelectorAll('input[name="session-type"]')) radio.onchange = setSessionType;
  for (const radio of document.querySelectorAll('input[name="mode"]')) radio.onchange = showMaster;
  $('code').oninput = () => { lookupToken++; $('session-info').textContent = ''; };
  $('code').onchange = () => {
    if (chosen('session-type') === 'join' && C.clean($('code').value)) lookup(C.clean($('code').value).toUpperCase());
  };
  $('lookup').onclick = () => {
    const code = C.clean($('code').value).toUpperCase();
    if (code) lookup(code);
    else $('code').focus();
  };
  $('load-master').onclick = async () => {
    const store = $('store').value;
    if (store === '+') return toast('請先選擇門市');
    try { useMaster(store,(await api(config,'master',{store})).items); }
    catch (error) { toast(error.message); }
  };
  $('master-file').onchange = async () => {
    const file = $('master-file').files[0], store = $('store').value;
    if (!file) return;
    try {
      if (store === '+') throw new Error('請先選擇門市');
      const csv = /\.csv$/i.test(file.name);
      const data = await file.arrayBuffer();
      let book;
      if (csv) {
        const bytes = new Uint8Array(data);
        const hasBom = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
        let content;
        try { content = new TextDecoder('utf-8',{fatal:!hasBom}).decode(data); }
        catch (_) { content = new TextDecoder('big5').decode(data); }
        book = XLSX.read(content,{type:'string',raw:true});
      } else {
        book = XLSX.read(data,{type:'array',raw:true});
      }
      const rows = XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]],{header:1,raw:true,defval:''});
      useMaster(store,C.parseMaster(rows));
    } catch (error) { toast(error.message || '無法讀取主檔'); }
    finally { $('master-file').value = ''; }
  };
  $('send-master').onclick = async () => {
    const store = $('store').value;
    try {
      const result = await api(config,'master',{store,items:itemsFor(store),replace:true},true);
      toast('已上傳 '+result.count+' 筆主檔');
    } catch (error) { toast(error.message); }
  };
  $('start-form').onsubmit = begin;
  $('scan-form').onsubmit = async event => {
    event.preventDefault();
    unlockAudio();
    const code = $('barcode').value, qty = $('qty').valueAsNumber;
    $('barcode').value = '';
    $('qty').value = 1;
    $('barcode').focus();
    await handleScan(code,'manual',qty);
  };
  $('camera').onclick = () => { unlockAudio(); scanner.toggle(); };
  $('flip').onclick = () => { unlockAudio(); scanner.switchCamera(); };
  $('torch').onclick = async () => {
    try { $('torch').setAttribute('aria-pressed',String(await scanner.toggleTorch())); }
    catch (_) { toast('無法切換手電筒'); }
  };
  $('filter-lines').oninput = renderScan;
  $('refresh').onclick = () => refresh();
  $('filter-summary').onchange = renderSummary;
  $('export-xlsx').onclick = () => exportSummary('xlsx');
  $('export-csv').onclick = () => exportSummary('csv');
  for (const id of ['url','key','device-name','dedupe','beep','vibrate']) $(id).onchange = saveConfig;
  $('ping').onclick = async () => {
    if (!saveConfig()) return;
    $('ping').disabled = true;
    $('ping-result').textContent = '正在測試連線…';
    try { const result = await api(config,'ping'); $('ping-result').textContent = '連線成功 · '+clock(result.time); }
    catch (error) { $('ping-result').textContent = error.message; }
    finally { $('ping').disabled = false; }
  };
  $('backup').onclick = () => download(JSON.stringify({device,deviceName:config.deviceName,lines:values(),sessions,masters},null,2),
    'application/json',C.filename(active ? active.code : '本機備份','json'));
  $('clear-lines').onclick = async () => {
    if (!window.confirm('確定清除本機已上傳資料？')) return;
    try {
      for (const line of values()) {
        if (line.dirty || lines.get(line.id) !== line) continue;
        const write = S.remove(line.id);
        await write;
        if (lines.get(line.id) === line) lines.delete(line.id);
      }
      showQueue();
      toast('已清除本機已上傳資料');
    } catch (error) { toast(error.message); }
  };
  document.addEventListener('touchend',unlockAudio,{once:true});
  document.addEventListener('click',unlockAudio,{once:true});
  document.addEventListener('visibilitychange',() => {
    if (document.hidden) scanner.stop();
    else syncNow(false);
  });
  window.addEventListener('pagehide',() => scanner.stop());
  window.addEventListener('online',() => { showQueue(); syncNow(); });
  window.addEventListener('offline',showQueue);
  window.InventoryApp = {handleScan,syncNow,getState:() => ({
    active:active && {...active},lines:values().map(line => ({...line})),device,view,
    pending:values().filter(line => line.dirty).length
  })};
  localReady.then(() => {
    $('ios-note').hidden = !ios && !/Line\//i.test(ua);
    storeOptions(active && active.store);
    $('counter').value = active ? active.counter : '';
    if (active && active.mode === 'master') document.querySelector('input[name="mode"][value="master"]').checked = true;
    storeChanged();
    identity();
    showQueue();
    if (active) {
      lastId = values().filter(line => !line.deleted && C.sameScope(line,scope()))
        .sort((a,b) => b.updatedAt.localeCompare(a.updatedAt))[0];
      lastId = lastId && lastId.id;
      go('scan');
    }
    setInterval(() => syncNow(false),interval);
    syncNow(false);
  });
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
})();
