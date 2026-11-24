const {copyFileSync,mkdirSync} = require('node:fs');
const {resolve} = require('node:path');

const root = resolve(__dirname,'..');
mkdirSync(resolve(root,'deploy'),{recursive:true});
for (const file of ['Code.gs','appsscript.json']) {
  copyFileSync(resolve(root,'gas',file),resolve(root,'deploy',file));
}
