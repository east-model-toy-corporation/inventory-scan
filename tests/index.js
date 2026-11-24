// Node resolves an explicit tests/ argument to this directory entry point.
const {readdirSync} = require('node:fs');

for (const file of readdirSync(__dirname).filter(name => name.endsWith('.test.js')).sort()) {
  require('./'+file);
}
