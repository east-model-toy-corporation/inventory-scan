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
  let recentZones = S.get('zones',[]);
  let custom = S.get('stores',[]), sessions = S.get('sessions',{});
  let masters = new Map(), draftMaster, openPreview = null, lookingUp = false, ending = false, preferredMode = 'none';
  let lastSession = S.get('lastSession',null), syncing;
  const summarySession = () => active || lastSession;
  const sessionName = C.sessionName;
  let active = S.get('active',null), lines = new Map(), lastId, editingId, remote, view = 'start';
  let retryAt = 0, delay = 2000, lastSync = '', syncError = '', toastTimer, audio;
  let summaryDue = false, nextSummaryAt = 0;
  let lookupToken = 0, lastMutation = 0;
  const seen = new Map();
  let qtyEdit, unknownScan, zoneOpen = false, lastFeedback = null;
  const interval = Math.max(200,Number(new URLSearchParams(location.search).get('syncInterval')) || 3000);
  const localReady = Promise.all([S.load(),S.loadMasters()]).then(async ([rows,records]) => {
    masters = records;
    const legacy = S.get('masters',{});
    for (const {code,store,mode} of Object.values(sessions)) {
      if (mode !== 'master' || masters.has(code) || !Object.prototype.hasOwnProperty.call(legacy,store)) continue;
      const record = {code,store,items:legacy[store],local:true};
      masters.set(code,record);
      try { await S.putMaster(record); }
      catch (error) { toast(error.message); }
    }
    lines = new Map(rows.map(line => [line.id,{...line,zone:line.zone || ''}]));
    for (const line of rows) lastMutation = Math.max(lastMutation,Date.parse(line.updatedAt) || 0);
  });
  const values = () => [...lines.values()];
  const itemsFor = code => masters.has(code) ? masters.get(code).items : [];
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
  const uploadable = line => {
    const session = sessions[line.session];
    return !session || (!session.local && !session.pending && !session.pendingEnd &&
      (!session.cloud || session.cloud === config.url));
  };
  function showQueue() {
    const dirty = values().filter(line => line.dirty && uploadable(line)).length;
    const rejected = values().filter(line => line.rejected).length;
    const legacyPending = config.url && Object.values(sessions).some(session => session.pending && !session.status);
    $('rejected-backup').hidden = !rejected && !legacyPending;
    if (config.url) $('queue').textContent = '待上傳 '+dirty+' 筆';
    else replace($('queue'),node('span','未設定雲端，','queue-local-prefix'),'僅存本機');
    $('sync-status').textContent = config.url ? [
      !navigator.onLine ? '離線中' : '', lastSync ? '上次同步 '+clock(lastSync) : '',
      [...masters.values()].some(master => master.pending) ? '主檔待上傳' : '',
      Object.values(sessions).some(session => session.pendingEnd) ? '結束盤點待同步' : '',
      rejected ? '場次已結束，'+rejected+' 筆未上傳' : '',
      legacyPending ? '舊版未同步場次可匯出本機備份' : '', syncError
    ].filter(Boolean).join(' · ') : '';
  }
  function rememberSession(session) {
    sessions = {...sessions,[session.code]:session};
    save('sessions',sessions);
  }
  function invalidateCachedSessions(store,cloud,openCode) {
    for (const cached of Object.values(sessions)) {
      if (cached.store === store && cached.status === '進行中' && cached.code !== openCode &&
          !cached.local && (!cached.cloud || cached.cloud === cloud)) {
        rememberSession({...cached,status:'已結束'});
      }
    }
  }
  function own(line) {
    return line.device === device || line.device.startsWith(device+'｜');
  }
  function scope() {
    return {session:active.code,store:active.store,counter:active.counter,device,zone:active.zone || ''};
  }
  function wireDevice(line) {
    return {...line,device:device+'｜'+config.deviceName};
  }
  function syncNow(force = true, code) {
    if (ending && !force) return Promise.resolve();
    if (!syncing) syncing = sync(force,code).finally(() => { syncing = null; });
    return syncing;
  }
  async function sync(force, code) {
    await localReady;
    if (!config.url || !navigator.onLine || (!force && Date.now() < retryAt)) return;
    const connection = {...config};
    const sameConnection = () => connection.url === config.url && connection.key === config.key;
    const pendingEnds = Object.values(sessions).filter(session => !code && session.pendingEnd && session.cloud === connection.url);
    const inScope = line => (!code || code === line.session) && uploadable(line);
    const pendingMasters = [...masters.values()].filter(master => master.pending && inScope({session:master.code}));
    if (!pendingEnds.length && !pendingMasters.length && !C.batch(values().filter(inScope)).length) {
      refreshAfterSync();
      return;
    }
    try {
      for (const session of pendingEnds) {
        const result = await api(connection,'endSession',{code:session.code,endedBy:session.endedBy},true);
        if (!sameConnection()) return;
        rememberSession({...result.session,cloud:session.cloud});
      }
      let masterError;
      for (const master of pendingMasters) {
        if (masters.get(master.code) !== master) continue;
        try {
          const result = await api(connection,'master',{
            session:master.code,store:master.store,items:master.items,replace:true,ifMissing:!master.overwrite
          },true);
          if (!sameConnection()) return;
          if (masters.get(master.code) === master) {
            await useMaster({...master,pending:false,local:false});
            toast('主檔已上傳到場次（'+result.count+' 筆）');
          }
        } catch (error) {
          if (!sameConnection()) return;
          if (error.message === '場次已結束') await rejectEnded(master.code);
          else if (error.message === '場次已有主檔') {
            if (masters.get(master.code) === master) {
              await fetchMaster(master,true);
              toast('已載入場次主檔');
            }
          } else if (code) masterError = error;
          else throw error;
        }
      }
      const batch = C.batch(values().filter(inScope));
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
        const ended = result.rejected.filter(row => row.error === '場次已結束');
        for (const code of new Set(ended.map(row => snapshots.get(row.id).session))) await rejectEnded(code);
        const otherError = result.rejected.find(row => row.error !== '場次已結束');
        if (otherError || result.acks.length + ended.length < batch.length) {
          throw new Error(otherError ? '明細上傳失敗：'+otherError.error : '部分明細未收到上傳確認');
        }
      }
      if (masterError) throw masterError;
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
    } finally { showQueue(); }
  }
  function storeOptions(selected) {
    const options = [...stores,...custom];
    if (selected && !options.includes(selected) && selected !== '+') options.push(selected);
    replace($('store'),...options.map(store => new Option(store,store)),new Option('＋自訂門市…','+'));
    $('store').value = selected && selected !== '+' ? selected : options[0];
  }
  function storeChanged() {
    const store = $('store').value;
    $('custom-entry').hidden = store !== '+';
    lookup(store);
  }
  function showMaster() {
    const preview = openPreview && openPreview.session;
    const draft = draftMaster && draftMaster.store === $('store').value ? draftMaster : null;
    for (const radio of document.querySelectorAll('input[name="mode"]')) {
      radio.disabled = lookingUp || !!preview;
      radio.checked = radio.value === (preview ? preview.mode : preferredMode);
    }
    $('master-controls').hidden = lookingUp || $('store').value === '+' || chosen('mode') !== 'master' ||
      !!(preview && openPreview.masterCount);
    $('master-count').textContent = '已載入 '+(draft ? draft.items.length : 0)+' 筆';
    $('load-master').disabled = !config.url;
    const activeMaster = active && active.mode === 'master';
    const connected = config.url && activeMaster && !active.local && (!active.cloud || active.cloud === config.url);
    $('session-master-actions').hidden = !activeMaster;
    $('send-master').disabled = !connected || !itemsFor(active.code).length;
    $('reload-master').disabled = !connected;
  }
  async function useMaster(record) {
    await S.putMaster(record);
    masters.set(record.code,record);
    showMaster();
    showQueue();
  }
  async function fetchMaster(session,replacePending = false) {
    const {code,store} = session;
    const previous = masters.get(code);
    const connection = {...config};
    const result = await api(connection,'master',{session:code,store});
    if (connection.url !== config.url || connection.key !== config.key ||
        masters.get(code) !== previous || (previous && previous.pending && !replacePending)) return;
    if (result.source === 'none' && previous && previous.local) return;
    await useMaster({code,store,items:result.items});
    if (active && active.code === code) {
      remote = null;
      nextSummaryAt = 0;
      summaryDue = true;
      if (view === 'scan') renderScan();
      if (view === 'summary') renderSummary();
    }
  }
  function cachedOpen(store) {
    const session = Object.values(sessions).reverse().find(item => item.store === store &&
      (item.status === '進行中' || (!config.url && item.pending && !item.status)) &&
      (config.url ? !item.local && !item.pending && (!item.cloud || item.cloud === config.url) : item.local || !item.cloud));
    return {session:session || null,masterCount:session ? itemsFor(session.code).length : 0};
  }
  async function lookup(store) {
    const token = ++lookupToken;
    const connection = {...config};
    openPreview = null;
    lookingUp = !!connection.url && navigator.onLine && store !== '+';
    showMaster();
    $('session-info').textContent = store === '+' ? '' : '正在查詢場次…';
    if (store === '+') return null;
    let result = cachedOpen(store);
    let message = '', authoritative = false;
    const offline = '需連線才能開始新場次';
    if (connection.url) {
      try {
        if (navigator.onLine) {
          result = await api(connection,'openSession',{store});
          authoritative = true;
        }
        else if (!result.session) message = offline;
      } catch (error) {
        if (!error.unavailable) {
          result = {session:null,masterCount:0};
          message = error.message;
        } else if (!result.session) message = offline;
      }
    }
    if (token !== lookupToken || connection.url !== config.url || connection.key !== config.key) return null;
    lookingUp = false;
    const {session,masterCount} = result;
    if (authoritative) invalidateCachedSessions(store,connection.url,session && session.code);
    if (session) {
      const saved = sessions[session.code];
      if (!saved || !saved.pendingEnd) {
        rememberSession({...session,status:'進行中',cloud:connection.url,local:!connection.url,pending:false});
      }
    }
    openPreview = result;
    if (!message) message = session ?
      '將加入進行中場次：'+sessionName(session)+'（開始於 '+clock(session.createdAt)+'，模式 '+
        (session.mode === 'master' ? '有商品主檔' : '無主檔')+'，主檔 '+masterCount+' 筆）' :
      '將建立新場次：'+store+' '+C.taipeiDate(new Date());
    $('session-info').textContent = message;
    showMaster();
    return result;
  }
  function renderRecentZones() {
    replace($('recent-zones'),...recentZones.map(zone => {
      const option = node('option');
      option.value = zone;
      return option;
    }));
  }
  function rememberZone(zone) {
    $('zone').value = zone;
    save('zone',zone);
    if (zone) {
      recentZones = [zone,...recentZones.filter(value => value !== zone)].slice(0,10);
      save('zones',recentZones);
      renderRecentZones();
    }
  }
  function closeZone(zone) {
    if (!zoneOpen) return;
    if (zone !== undefined && active) {
      if (zone !== (active.zone || '')) seen.clear();
      active.zone = zone;
      save('active',active);
      rememberZone(zone);
      identity();
    }
    zoneOpen = false;
    $('zone-overlay').hidden = true;
    refreshPause();
    $('zone-chip').focus({preventScroll:true});
  }
  function identity() {
    $('identity').textContent = active ? [sessionName(active),active.counter].join(' ／ ') : '尚未開始盤點';
    const zoneLabel = '區域：'+(active && active.zone || '未填');
    $('zone-chip').textContent = zoneLabel;
    $('zone-chip').title = zoneLabel;
    $('zone-chip').hidden = !active || view !== 'scan';
    $('switch').hidden = !active;
    $('end-session').hidden = !active || !['scan','summary'].includes(view);
  }
  function go(next) {
    if ((next === 'scan' && !active) || (next === 'summary' && !summarySession())) { toast('請先開始盤點'); return; }
    if (view === 'scan' && next !== 'scan') {
      closeZone();
      finishQty();
      if (unknownScan) finishUnknown();
      scanner.stop();
    }
    view = next;
    identity();
    if (next === 'start') storeChanged();
    for (const tab of document.querySelectorAll('[data-view]')) {
      const current = tab.dataset.view === next;
      $(tab.dataset.view).hidden = !current;
      if (current) tab.setAttribute('aria-current','page');
      else tab.removeAttribute('aria-current');
    }
    if (next === 'scan') {
      manualExpanded = false;
      showManual();
      renderScan();
      if (window.matchMedia('(pointer:fine)').matches) $('barcode').focus({preventScroll:true});
    }
    if (next === 'summary') { showMaster(); renderSummary(); }
    if (next === 'settings') renderSettings();
    window.scrollTo(0,0);
  }
  async function begin(event) {
    event.preventDefault();
    await localReady;
    const store = $('store').value, counter = C.clean($('counter').value), mode = preferredMode;
    const zone = C.clean($('zone').value);
    if (!counter || store === '+') { toast('請填寫門市與盤點人'); return; }
    if ($('begin').disabled || ending) return;
    $('begin').disabled = true;
    $('store').disabled = true;
    try {
      const connection = {...config};
      await lookup(store);
      if (connection.url !== config.url || connection.key !== config.key) throw new Error('雲端設定已變更，請重新開始盤點');
      let session, joined;
      if (config.url) {
        const closing = Object.values(sessions).find(item => item.store === store && item.pendingEnd && item.cloud === config.url);
        if (closing) {
          await syncNow();
          if (sessions[closing.code].pendingEnd) throw new Error('需連線才能完成上一場盤點');
        }
        try {
          if (!navigator.onLine) throw Object.assign(new Error(),{unavailable:true});
          ({session,joined} = await api(connection,'startSession',{store,mode,createdBy:counter},true));
        } catch (error) {
          if (!error.unavailable) throw error;
          session = cachedOpen(store).session;
          if (!session) throw new Error('需連線才能開始新場次');
          joined = true;
        }
      } else {
        session = cachedOpen(store).session;
        joined = !!session;
        if (!session) {
          const date = new Date();
          session = {code:C.sessionCode(store,date)+'-'+C.random(8),name:store+' '+C.taipeiDate(date),
            store,mode,createdBy:counter,createdAt:date.toISOString(),status:'進行中'};
        }
      }
      if (connection.url !== config.url || connection.key !== config.key) throw new Error('雲端設定已變更，請重新開始盤點');
      const {code} = session;
      if (connection.url) invalidateCachedSessions(store,connection.url,code);
      session = {...session,status:'進行中',cloud:connection.url,local:!connection.url,pending:false};
      rememberSession(session);
      if (session.mode === 'master') {
        if (joined && config.url && navigator.onLine) {
          try { await fetchMaster(session); }
          catch (error) { toast(error.message); }
        }
        const draft = draftMaster && draftMaster.store === store ? draftMaster : null;
        if (draft && (!joined || !itemsFor(code).length)) {
          await useMaster({code,store,items:draft.items,local:draft.imported,
            pending:!!config.url && draft.imported});
        }
      }
      if (draftMaster && draftMaster.store === store) draftMaster = null;
      active = {...session,counter,zone};
      rememberZone(zone);
      save('counter',counter);
      lastId = editingId = remote = null;
      summaryDue = false;
      nextSummaryAt = 0;
      seen.clear();
      save('active',active);
      identity();
      go('scan');
      syncNow(false);
    } catch (error) { toast(error.message); }
    finally { $('begin').disabled = $('store').disabled = false; }
  }
  function closeSession(session) {
    rememberSession(session);
    if (!active || active.code !== session.code) return;
    lastSession = {...session,counter:active.counter};
    save('lastSession',lastSession);
    active = null;
    save('active',null);
    go('start');
  }
  async function rejectEnded(code) {
    if (sessions[code]) closeSession({...sessions[code],status:'已結束'});
    const master = masters.get(code);
    if (master && master.pending) await useMaster({...master,pending:false});
    let count = 0;
    for (const line of values()) {
      if (line.session !== code || !line.dirty) continue;
      const rejected = {...line,dirty:false,rejected:'場次已結束'};
      await (writes.get(line.id) || Promise.resolve());
      await S.put(rejected);
      lines.set(line.id,rejected);
      count++;
    }
    showQueue();
    if (count) toast('場次已結束，'+count+' 筆未上傳');
  }
  async function endActiveSession() {
    const current = active;
    if (!current || ending || $('begin').disabled ||
        !window.confirm('確定結束『'+sessionName(current)+'』盤點？結束後無法再刷讀，下次選此門市會開新場次')) return;
    finishQty();
    ending = true;
    $('end-session').disabled = true;
    scanner.stop();
    const cloud = current.local ? '' : current.cloud || config.url;
    try {
      let ended = {...current,status:'已結束',endedAt:new Date().toISOString(),endedBy:current.counter};
      if (cloud) {
        if (cloud !== config.url) throw new Error('請先恢復此場次的雲端連線設定');
        const pending = () => values().filter(line => line.session === current.code && line.dirty).length;
        const remaining = () => pending() + Number(!!(masters.get(current.code) || {}).pending);
        await syncing;
        let previous;
        do {
          previous = remaining();
          await syncNow(true,current.code);
        } while (remaining() && remaining() < previous);
        if (active !== current) return;
        const confirmPending = () => window.confirm('尚有資料未同步。確定結束盤點？未上傳的明細將保留在本機備份。');
        let confirmed = false;
        if (!navigator.onLine || remaining()) {
          if (!confirmPending()) return;
          confirmed = true;
        }
        try {
          if (!navigator.onLine) throw Object.assign(new Error(),{unavailable:true});
          const result = await api(config,'endSession',{code:current.code,endedBy:current.counter},true);
          ended = {...result.session,cloud};
        } catch (error) {
          if (!error.unavailable) throw error;
          if (!confirmed && !confirmPending()) return;
          ended.pendingEnd = true;
          ended.cloud = cloud;
        }
        rememberSession(ended);
        if (remaining()) await rejectEnded(current.code);
      }
      closeSession(ended);
      showQueue();
    } catch (error) { toast(error.message); }
    finally {
      ending = false;
      $('end-session').disabled = false;
    }
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
    if (config.vibrate && navigator.vibrate) navigator.vibrate(unknown ? [200,100,200] : 60);
    if (!config.beep || !audio || audio.state !== 'running') return;
    try {
      const start = audio.currentTime;
      for (const offset of unknown ? [0,.25] : [0]) {
        const tone = audio.createOscillator(), volume = audio.createGain();
        tone.frequency.value = unknown ? 220 : 850;
        volume.gain.value = .12;
        tone.connect(volume);
        volume.connect(audio.destination);
        tone.start(start+offset);
        tone.stop(start+offset+(unknown ? .15 : .095));
      }
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
  async function handleScan(code,source = 'camera',qty = $('qty').valueAsNumber) {
    if (!active || ending || view !== 'scan' || zoneOpen || unknownScan || (qtyEdit && source === 'camera')) return false;
    const raw = C.clean(code);
    if (!raw || raw.length > 64 || !Number.isInteger(qty) || qty < 1 || qty > 999999) return false;
    const product = active.mode === 'master' && C.findProduct(C.masterIndex(itemsFor(active.code)),raw);
    const barcode = product ? product.barcode : raw;
    if (C.deduped(seen,barcode,source,config.dedupe)) {
      lastFeedback = 'duplicate';
      $('scan-note').textContent = '重複略過';
      return false;
    }
    if (active.mode === 'master' && !product) {
      lastFeedback = 'notInMaster';
      unknownScan = {barcode,qty};
      refreshPause();
      feedback(true);
      $('scan-note').textContent = '';
      $('unknown-scan').textContent = '條碼 '+barcode+' ／ 數量 '+qty;
      $('unknown-overlay').hidden = false;
      showMasterSearch(false);
      renderScan();
      return false;
    }
    return countScan(barcode,product,qty);
  }
  function countScan(barcode,product,qty) {
    const line = C.upsertScan(values(),scope(),barcode,product ? product.name : '',qty,mutationTime());
    if (line.qty > 999999) { toast('單筆數量最多 999,999 件'); return false; }
    lastId = line.id;
    $('scan-note').textContent = '';
    $('qty').value = 1;
    if (active.mode !== 'master' || product) {
      lastFeedback = 'ok';
      feedback(false);
    }
    return record(line);
  }
  function refreshPause() {
    if (qtyEdit || unknownScan || zoneOpen) scanner.pause();
    else scanner.resume();
    $('scan-paused').hidden = !qtyEdit;
    $('camera-preview').hidden = !qtyEdit && $('preview').hidden;
    $('confirm-qty').hidden = !qtyEdit;
    $('last-scan').classList.toggle('editing',!!qtyEdit);
    $('camera-panel').classList.toggle('paused',!!(qtyEdit || unknownScan));
  }
  function finishQty() {
    if (!qtyEdit) return;
    const line = lines.get(qtyEdit);
    const text = $('last-qty').value.trim();
    qtyEdit = null;
    if (line && /^\d+$/.test(text) && Number(text) <= 999999 && Number(text) !== line.qty) {
      update(line,Number(text));
    }
    renderScan();
    refreshPause();
  }
  function showMasterSearch(show) {
    $('unknown-choices').hidden = show;
    $('unknown-search').hidden = !show;
    if (show) {
      $('master-query').value = '';
      renderMasterResults();
    }
    $(show ? 'master-query' : 'search-master').focus();
  }
  function localCount(matches) {
    return values().filter(line => !line.deleted && line.session === active.code && own(line) &&
      matches(line.barcode)).reduce((total,line) => total+line.qty,0);
  }
  function renderMasterResults() {
    const query = $('master-query').value;
    const results = C.searchMaster(itemsFor(active.code),query);
    const master = C.masterIndex(itemsFor(active.code));
    const counts = new Map();
    for (const line of lines.values()) {
      if (line.deleted || line.session !== active.code || !own(line)) continue;
      const product = C.findProduct(master,line.barcode);
      if (product) counts.set(product.barcode,(counts.get(product.barcode) || 0)+line.qty);
    }
    const rows = results.map(product => {
      const result = button('',() => finishUnknown(true,product),'master-result');
      result.append(node('strong',product.name || product.barcode),
        node('small',product.barcode+' ／ 帳面 '+product.bookQty+' ／ 本機已盤 '+
          (counts.get(product.barcode) || 0)));
      return result;
    });
    if (!rows.length && query.trim()) {
      rows.push(node('p','查無結果'),button('查無結果，返回直接計入',() => finishUnknown(true),'primary'));
    }
    replace($('master-results'),...rows);
  }
  function finishUnknown(count = false,product) {
    if (!unknownScan) return;
    const {barcode,qty} = unknownScan;
    unknownScan = null;
    $('unknown-overlay').hidden = true;
    $('qty').value = 1;
    if (count && active && !ending) countScan(product ? product.barcode : barcode,product,qty);
    renderScan();
    refreshPause();
    $('barcode').focus({preventScroll:true});
  }
  function update(line,qty) {
    const current = lines.get(line.id);
    if (!active || ending || !current || current.session !== active.code || current.deleted || current.rejected) return;
    if (!Number.isInteger(qty) || qty < 0 || qty > 999999) { toast('請輸入 0 到 999,999 的整數'); return; }
    if (qty === 0 && !window.confirm('確定刪除此筆刷讀明細？')) return;
    editingId = null;
    lastId = line.id;
    record(C.editLine(current,{qty,deleted:qty === 0},mutationTime()));
  }
  function combined() {
    const session = summarySession();
    const merged = new Map();
    for (const line of remote ? [...remote.details,...(remote.tombstones || [])] : []) merged.set(line.id,line);
    for (const line of values()) {
      if (line.session !== session.code || line.rejected) continue;
      const server = merged.get(line.id);
      if (!server || line.updatedAt > server.updatedAt) merged.set(line.id,line);
    }
    const master = C.masterIndex(itemsFor(session.code));
    if (remote && session.mode === 'master' && !masters.has(session.code)) for (const item of remote.items) {
      if (item.bookQty !== '') master.set(item.barcode,item);
    }
    return C.summarize(session,[...merged.values()],master,device);
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
    const current = scope();
    const visible = values().filter(line => C.sameScope(line,{...current,zone:line.zone}) && !line.deleted)
      .sort((a,b) => b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id));
    $('scan-totals').textContent = '品項數 '+new Set(visible.map(line => line.barcode)).size+' ／ 總件數 '+visible.reduce((n,line) => n+line.qty,0);
    const master = C.masterIndex(itemsFor(active.code));
    const compare = active.mode === 'master';
    const filter = C.clean($('filter-lines').value).toLowerCase();
    const rows = visible.filter(line => (line.name+' '+line.barcode+' '+line.zone).toLowerCase().includes(filter)).map(line => {
      const product = compare && C.findProduct(master,line.barcode);
      const row = node('li');
      row.dataset.barcode = line.barcode;
      const title = node('div',null,'line-text');
      title.append(node('strong',product ? product.name || line.barcode : line.name || line.barcode));
      if (line.name || product) title.append(node('small',line.barcode));
      if (line.zone) title.append(node('small',line.zone,'zone-tag'));
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
    $('last-scan').hidden = !unknownScan && (!last || last.deleted);
    $('scan-placeholder').hidden = !$('last-scan').hidden;
    $('last-controls').hidden = !!unknownScan;
    if (unknownScan) {
      $('last-scan').classList.add('last-unknown');
      replace($('last-details'),node('h3','主檔查無此商品','unknown'),node('p',unknownScan.barcode));
      return;
    }
    if (!last || last.deleted) return;
    const product = compare && C.findProduct(master,last.barcode);
    $('last-scan').classList.toggle('last-unknown',compare && !product);
    if (!qtyEdit) $('last-qty').value = last.qty;
    const heading = node('h3',product ? product.name || last.barcode : compare ? '主檔查無此商品' : last.barcode,compare && !product ? 'unknown' : '');
    const detail = node('div',null,'metrics');
    const matches = barcode => barcode === last.barcode || (product && C.findProduct(master,barcode) === product);
    const localQty = localCount(matches);
    const counts = [[compare ? '本機已盤' : '累計',localQty]];
    let total = localQty;
    if (remote) {
      total += remote.items.filter(item => matches(item.barcode))
        .reduce((qty,item) => qty+item.countedQty-item.mineQty,0);
    }
    if (remote) counts.push(['全場已盤',total]);
    else if (compare) counts.push(['全場已盤','—','compact-metric']);
    if (compare) {
      const diff = product ? total-product.bookQty : null;
      counts.push(['帳面',product ? product.bookQty : '—'],['差異',diff === null ? '—' :
        (diff > 0 ? '+' : '')+diff+' '+C.itemStatus(product.bookQty,total),diff > 0 ? 'positive' : diff < 0 ? 'negative' : '']);
    }
    metrics(detail,counts);
    replace($('last-details'),heading,...(compare || last.zone ? [node('p',[compare ? last.barcode : '',last.zone].filter(Boolean).join(' ・ '))] : []),detail);
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
    const session = summarySession();
    if (!session) return;
    $('summary-session').textContent = sessionName(session);
    const summary = combined();
    $('summary-source').textContent = remote ? '已載入全場資料'+(remote.updatedAt ? ' · '+clock(remote.updatedAt) : '') :
      '僅本機資料'+(config.url ? ' · 可重新整理取得全場資料' : '');
    metrics($('summary-totals'),[['筆數',summary.totals.lines],['品項數',summary.totals.items],['總件數',summary.totals.qty]]);
    const filter = $('filter-summary').value;
    const filtered = summary.items.filter(item => filter === 'all' ||
      (filter === 'diff' ? item.diff !== '' && item.diff !== 0 : item.status === filter));
    replace($('item-table'),table(C.itemRows(filtered),true));
    const groups = [['依盤點人',summary.byCounter,'counter','盤點人'],
      ['依區域',summary.byZone,'zone','區域'],
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
    const current = summarySession(), url = config.url, key = config.key;
    if (!url || !current || current.local || (current.cloud && current.cloud !== url)) { renderSummary(); return; }
    if ($('refresh').disabled) return;
    summaryDue = false;
    nextSummaryAt = Date.now()+10000;
    $('refresh').disabled = true;
    try {
      const result = await api(config,'summary',{session:current.code,device:wireDevice({}).device});
      if (summarySession() !== current || config.url !== url || config.key !== key) return;
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
    const name = C.filename(sessionName(summarySession()),extension);
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
    if (view === 'start') storeChanged();
    else showMaster();
    return true;
  }
  const viewport = window.visualViewport;
  function keepQtyVisible() {
    if (!qtyEdit || !document.body.classList.contains('scan-compact')) return;
    const top = viewport ? viewport.offsetTop : 0;
    const bottom = top + (viewport ? viewport.height : window.innerHeight);
    const controls = $('last-controls');
    const box = controls.getBoundingClientRect();
    if (box.top < top || box.bottom > bottom) {
      const target = box.height <= bottom-top ? controls : $('confirm-qty');
      target.scrollIntoView({block:'nearest'});
    }
  }
  function updateViewport() {
    document.body.style.setProperty('--vvh',viewport.height+'px');
    document.body.style.setProperty('--vv-top',viewport.offsetTop+'px');
    document.body.classList.toggle('keyboard-open',viewport.height < window.innerHeight-100);
    keepQtyVisible();
  }
  if (viewport) {
    viewport.addEventListener('resize',updateViewport);
    viewport.addEventListener('scroll',updateViewport);
    updateViewport();
  }
  const scanner = window.InvScanner.create($('video'),handleScan,(running,torch,error) => {
    document.body.classList.toggle('scan-compact',running && view === 'scan');
    $('camera').textContent = running ? '停止' : '開啟鏡頭';
    $('preview').hidden = !running;
    $('camera-preview').hidden = !running && !qtyEdit;
    $('torch').hidden = !torch;
    $('torch').setAttribute('aria-pressed','false');
    $('camera-note').textContent = error;
  });
  for (const tab of document.querySelectorAll('[data-view]')) tab.onclick = () => go(tab.dataset.view);
  $('end-session').onclick = endActiveSession;
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
  for (const radio of document.querySelectorAll('input[name="mode"]')) radio.onchange = () => {
    preferredMode = chosen('mode');
    showMaster();
  };
  $('load-master').onclick = async () => {
    const store = $('store').value;
    if (store === '+') return toast('請先選擇門市');
    try {
      draftMaster = {store,items:(await api(config,'master',{store})).items,imported:false};
      showMaster();
    } catch (error) { toast(error.message); }
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
      draftMaster = {store,items:C.parseMaster(rows),imported:true};
      showMaster();
    } catch (error) { toast(error.message || '無法讀取主檔'); }
    finally { $('master-file').value = ''; }
  };
  $('send-master').onclick = async () => {
    const master = active && masters.get(active.code);
    if (!master || ending || !window.confirm('覆蓋場次主檔？')) return;
    try {
      await useMaster({...master,pending:true,overwrite:true});
      syncNow();
    } catch (error) { toast(error.message); }
  };
  $('reload-master').onclick = async () => {
    const current = active;
    try {
      await fetchMaster(current);
      if (active === current) refresh();
    } catch (error) { toast(error.message); }
  };
  $('start-form').onsubmit = begin;
  const manualToggle = $('manual-toggle');
  const manualForm = $('scan-form');
  let manualExpanded = false;
  function showManual() {
    manualToggle.setAttribute('aria-expanded',String(manualExpanded || manualForm.contains(document.activeElement)));
  }
  manualToggle.onclick = () => {
    manualExpanded = manualToggle.getAttribute('aria-expanded') === 'false';
    if (!manualExpanded) manualToggle.focus({preventScroll:true});
    showManual();
  };
  manualForm.addEventListener('focusin',showManual);
  manualForm.addEventListener('focusout',event => {
    if (!manualForm.contains(event.relatedTarget)) manualToggle.setAttribute('aria-expanded',String(manualExpanded));
  });
  manualForm.onsubmit = async event => {
    event.preventDefault();
    if (unknownScan) return;
    unlockAudio();
    const code = $('barcode').value;
    $('barcode').value = '';
    $('barcode').focus({preventScroll:true});
    await handleScan(code,'manual');
  };
  $('last-qty').onfocus = event => {
    qtyEdit = qtyEdit || lastId;
    refreshPause();
    event.target.select();
    if (document.body.classList.contains('scan-compact')) setTimeout(keepQtyVisible,300);
  };
  $('last-qty').onblur = event => {
    if (event.relatedTarget !== $('confirm-qty')) finishQty();
  };
  $('last-qty').onkeydown = event => {
    if (event.key === 'Enter') {
      event.preventDefault();
      finishQty();
      $('barcode').focus({preventScroll:true});
    }
  };
  $('confirm-qty').onmousedown = event => event.preventDefault();
  $('confirm-qty').onclick = () => {
    finishQty();
    $('barcode').focus({preventScroll:true});
  };
  $('confirm-qty').onblur = event => {
    if (event.relatedTarget !== $('last-qty')) finishQty();
  };
  for (const control of $('last-controls').querySelectorAll('[data-adjust]')) {
    control.onclick = () => {
      if (qtyEdit) {
        finishQty();
        $('last-qty').blur();
      }
      const line = lines.get(lastId);
      if (line) update(line,line.qty+Number(control.dataset.adjust));
    };
  }
  $('zone-chip').onclick = () => {
    if (!active || unknownScan || ending) return;
    finishQty();
    zoneOpen = true;
    refreshPause();
    $('scan-zone').value = active.zone || '';
    $('zone-overlay').hidden = false;
    $('scan-zone').focus();
  };
  $('zone-form').onsubmit = event => {
    event.preventDefault();
    closeZone(C.clean($('scan-zone').value));
  };
  $('clear-zone').onclick = () => closeZone('');
  $('cancel-zone').onclick = () => closeZone();
  $('search-master').onclick = () => showMasterSearch(true);
  $('back-to-choices').onclick = () => showMasterSearch(false);
  $('count-unknown').onclick = () => finishUnknown(true);
  $('cancel-unknown').onclick = $('cancel-search').onclick = () => finishUnknown();
  $('master-query').oninput = renderMasterResults;
  document.addEventListener('keydown',event => {
    if (!unknownScan && !zoneOpen) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      if (zoneOpen) closeZone();
      else finishUnknown();
    }
    if (event.key === 'Tab') {
      const pane = $(zoneOpen ? 'zone-dialog' : $('unknown-search').hidden ? 'unknown-choices' : 'unknown-search');
      const controls = [...pane.querySelectorAll('button,input')];
      const edge = event.shiftKey ? controls[0] : controls[controls.length-1];
      if (document.activeElement === edge || !pane.contains(document.activeElement)) {
        event.preventDefault();
        (event.shiftKey ? controls[controls.length-1] : controls[0]).focus();
      }
    }
  });
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
  $('rejected-backup').onclick = $('backup').onclick = () => download(JSON.stringify({device,deviceName:config.deviceName,lines:values(),sessions,masters:Object.fromEntries([...masters].map(([code,master]) => [code,master.items]))},null,2),
    'application/json',C.filename(summarySession() ? sessionName(summarySession()) : '本機備份','json'));
  $('clear-lines').onclick = async () => {
    if (!window.confirm('確定清除本機已上傳資料？')) return;
    try {
      for (const line of values()) {
        if (line.dirty || line.rejected || lines.get(line.id) !== line) continue;
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
  window.addEventListener('online',async () => { showQueue(); if (!ending) await syncNow(); if (view === 'start') storeChanged(); });
  window.addEventListener('offline',showQueue);
  window.InventoryApp = {handleScan,syncNow,getState:() => ({
    active:active && {...active},lines:values().map(line => ({...line})),device,view,
    lastFeedback,dialogOpen:!!unknownScan,scannerPaused:!!(qtyEdit || unknownScan || zoneOpen),
    pending:values().filter(line => line.dirty).length
  })};
  localReady.then(() => {
    $('ios-note').hidden = !ios && !/Line\//i.test(ua);
    storeOptions(summarySession() && summarySession().store);
    $('counter').value = active ? active.counter : S.get('counter','');
    $('zone').value = S.get('zone',active && active.zone || '');
    renderRecentZones();
    if (active) preferredMode = active.mode;
    const saved = active && sessions[active.code];
    if (saved && (saved.status === '已結束' || (config.url && saved.pending && !saved.status))) {
      closeSession(saved);
    }
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
