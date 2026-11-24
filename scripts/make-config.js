const {createHash} = require('node:crypto');
const {mkdirSync,readFileSync,writeFileSync} = require('node:fs');
const {resolve} = require('node:path');

const root = resolve(__dirname,'..');
const key = readFileSync(resolve(root,'secrets/api_key.txt'),'utf8').trim();
if (!key) throw new Error('secrets/api_key.txt 必須包含 API 金鑰');
const hash = createHash('sha256').update(key,'utf8').digest('hex');
mkdirSync(resolve(root,'deploy'),{recursive:true});
writeFileSync(resolve(root,'deploy/Config.gs'),"var API_KEY_SHA256 = '"+hash+"';\n");
