(function () {
  const prefix = 'inventory:';
  function get(key, fallback) {
    try {
      const value = localStorage.getItem(prefix + key);
      return value === null ? fallback : JSON.parse(value);
    } catch (_) { return fallback; }
  }
  function set(key, value) {
    try { localStorage.setItem(prefix + key, JSON.stringify(value)); return true; }
    catch (_) { return false; }
  }
  let database;
  function open() {
    if (!database) database = new Promise((resolve,reject) => {
      const request = indexedDB.open('inventory-scan',2);
      request.onupgradeneeded = event => {
        if (event.oldVersion === 0) request.result.createObjectStore('lines',{keyPath:'id'});
        request.result.createObjectStore('masters',{keyPath:'code'});
      };
      request.onsuccess = () => {
        request.result.onversionchange = () => { request.result.close(); database = null; };
        resolve(request.result);
      };
      request.onerror = request.onblocked = () => reject(request.error || new Error('無法開啟本機資料庫'));
    });
    return database;
  }
  async function transaction(mode, work, collection = 'lines') {
    const db = await open();
    return new Promise((resolve,reject) => {
      const tx = db.transaction(collection,mode);
      const request = work(tx.objectStore(collection));
      tx.oncomplete = () => resolve(request && request.result);
      tx.onerror = tx.onabort = () => reject(tx.error || new Error('無法儲存本機資料'));
    });
  }
  let pending = Promise.resolve();
  function change(id, line) {
    const operation = pending.then(async () => {
      const fallback = get('lines',[]);
      const rows = fallback.filter(row => row.id !== id);
      try {
        await transaction('readwrite',store => line ? store.put(line) : store.delete(id));
        if (rows.length !== fallback.length) set('lines',rows);
      } catch (_) {
        rows.push(line || {id,removed:true});
        if (!set('lines',rows)) throw new Error('本機儲存空間不足或無法使用');
      }
    });
    pending = operation.catch(() => {});
    return operation;
  }
  async function load() {
    let rows = [];
    try { rows = await transaction('readonly',store => store.getAll()); }
    catch (_) { /* 使用本機備援資料 */ }
    const lines = new Map(rows.map(line => [line.id,line]));
    for (const line of get('lines',[])) {
      if (line.removed) lines.delete(line.id);
      else lines.set(line.id,line);
    }
    return [...lines.values()];
  }
  async function loadMasters() {
    let records = [];
    try { records = await transaction('readonly',store => store.getAll(),'masters'); }
    catch (_) { /* 使用本機備援資料 */ }
    return new Map([...records,...get('sessionMasters',[])].map(record => [record.code,record]));
  }
  async function putMaster(record) {
    const fallback = get('sessionMasters',[]);
    const others = fallback.filter(item => item.code !== record.code);
    try {
      await transaction('readwrite',store => store.put(record),'masters');
      if (others.length !== fallback.length) set('sessionMasters',others);
    } catch (_) {
      if (!set('sessionMasters',[...others,record])) throw new Error('無法儲存場次主檔');
    }
  }
  window.InvStorage = {get,set,load,loadMasters,putMaster,put:line => change(line.id,line),remove:id => change(id,null)};
})();
