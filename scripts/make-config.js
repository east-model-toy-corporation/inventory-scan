const {createHash,randomBytes} = require('node:crypto');
const {mkdirSync,readFileSync,writeFileSync} = require('node:fs');
const {resolve} = require('node:path');

const password = process.env.INVENTORY_ADMIN_PASSWORD;
if (!password) throw new Error('必須設定 INVENTORY_ADMIN_PASSWORD 環境變數');
const salt = randomBytes(16).toString('hex');
const adminHash = createHash('sha256').update(salt+password,'utf8').digest('hex');

const root = resolve(__dirname,'..');
const key = readFileSync(resolve(root,'secrets/api_key.txt'),'utf8').trim();
if (!key) throw new Error('secrets/api_key.txt 必須包含 API 金鑰');
const hash = createHash('sha256').update(key,'utf8').digest('hex');
mkdirSync(resolve(root,'deploy'),{recursive:true});
writeFileSync(resolve(root,'deploy/Config.gs'),[
  "var API_KEY_SHA256 = '"+hash+"';",
  "var ADMIN_PASSWORD_SALT = '"+salt+"';",
  "var ADMIN_PASSWORD_SHA256 = '"+adminHash+"';",
  ''
].join('\n'));
