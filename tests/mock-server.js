const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const {createGas} = require('./gas-mock');
const root = path.join(__dirname,'..');
const apiPath = '/macros/s/TEST/exec';
const mime = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8',
  '.css':'text/css; charset=utf-8','.webmanifest':'application/manifest+json'};
function listen(server) {
  return new Promise((resolve,reject) => {
    server.once('error',reject);
    server.listen(0,'127.0.0.1',() => resolve('http://127.0.0.1:'+server.address().port));
  });
}
async function start() {
  let gas = createGas();
  let stats = {options:0,posts:0}, fail = false;
  const app = http.createServer((req,res) => {
    const url = new URL(req.url,'http://localhost');
    const item = url.pathname === '/' ? '/index.html' : url.pathname;
    if (!/^\/(?:index\.html|sw\.js|manifest\.webmanifest|(?:css|js|vendor)\/[\w.-]+)$/.test(item)) {
      res.writeHead(404).end(); return;
    }
    fs.readFile(path.join(root,item),(error,body) => {
      if (error) res.writeHead(404).end();
      else res.writeHead(200,{'Content-Type':mime[path.extname(item)],'Cache-Control':'no-cache'}).end(body);
    });
  });
  const api = http.createServer(async (req,res) => {
    const url = new URL(req.url,'http://localhost');
    const json = (data,code = 200) => res.writeHead(code,{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'}).end(JSON.stringify(data));
    if (req.method === 'OPTIONS') {
      stats.options++;
      res.writeHead(204,{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET,POST,OPTIONS',
        'Access-Control-Allow-Headers':req.headers['access-control-request-headers'] || 'content-type'}).end();
      return;
    }
    if (url.pathname === '/__stats') {
      const sheet = gas.spreadsheet.getSheetByName('刷讀明細');
      json({...stats,detailRows:sheet ? sheet.getLastRow()-1 : 0}); return;
    }
    if (url.pathname === '/__reset' && req.method === 'POST') {
      gas = createGas(); stats = {options:0,posts:0}; fail = false;
      json({ok:true}); return;
    }
    if (url.pathname === '/__fail') { fail = url.searchParams.get('on') === '1'; json({ok:true,fail}); return; }
    if (url.pathname !== apiPath) { json({ok:false},404); return; }
    if (req.method === 'POST') stats.posts++;
    if (fail) { json({ok:false,error:'模擬連線失敗'},500); return; }
    try {
      let output;
      if (req.method === 'GET') output = gas.context.doGet({parameter:Object.fromEntries(url.searchParams)});
      else if (req.method === 'POST') {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        output = gas.context.doPost({postData:{contents:Buffer.concat(chunks).toString('utf8'),type:req.headers['content-type']}});
      } else { json({ok:false},405); return; }
      json(JSON.parse(output.getContent()));
    } catch (error) { json({ok:false,error:error.message},500); }
  });
  const close = () => Promise.all([app,api].map(server => new Promise(resolve => {
    server.close(resolve);
    if (server.closeAllConnections) server.closeAllConnections();
  })));
  try {
    const [appUrl,apiOrigin] = await Promise.all([listen(app),listen(api)]);
    return {appUrl,apiUrl:apiOrigin+apiPath,close};
  } catch (error) { await close(); throw error; }
}
if (require.main === module) start().then(({appUrl,apiUrl}) => {
  console.log('前端 '+appUrl+'\n測試 API '+apiUrl);
}).catch(error => { console.error(error); process.exitCode = 1; });
module.exports = {start};
