(function () {
  const messages = {unauthorized:'API 金鑰錯誤或尚未設定'};
  async function request(config, action, params = {}, post = false) {
    if (!config.url) throw new Error('請先設定雲端網址');
    const url = new URL(config.url);
    const data = {...params,action,key:config.key};
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(),20000);
    const options = {signal:controller.signal,redirect:'follow'};
    if (post) Object.assign(options,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify(data)});
    else for (const [key,value] of Object.entries(data)) url.searchParams.set(key,value);
    try {
      let response;
      try { response = await fetch(url,options); }
      catch (error) { throw Object.assign(new Error(error.name === 'AbortError' ? '連線逾時' : '無法連線至試算表'),{unavailable:true}); }
      if (!response.ok) throw Object.assign(new Error('雲端連線失敗（'+response.status+'）'),{unavailable:response.status >= 500});
      let result;
      try { result = await response.json(); }
      catch (_) { throw new Error('試算表回應格式錯誤'); }
      if (!result.ok) throw new Error(messages[result.error] || result.error || '雲端操作失敗');
      return result;
    } finally { clearTimeout(timer); }
  }
  window.InvApi = {request};
})();
