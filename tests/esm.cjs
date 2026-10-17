// Loads browser ES modules in Node as data: URLs, rewriting relative imports
// so they resolve to the same cached URLs (and therefore the same instances).
const fs = require('node:fs');
const path = require('node:path');
const cache = {};
function url(file, replace = {}) {
   if (cache[file]) return cache[file];
   const source = fs.readFileSync(file, 'utf8').replace(/from '(\.[^']+)'/g, (match, relative) =>
      `from '${replace[relative] || url(path.resolve(path.dirname(file), relative), replace)}'`);
   return cache[file] = 'data:text/javascript;base64,' + Buffer.from(source).toString('base64');
}
module.exports = (relative, replace) => import(url(path.join(__dirname, '..', relative), replace));
