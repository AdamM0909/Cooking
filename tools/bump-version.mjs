// Sets one new version everywhere it must match: assets/lib.js, index.html (asset URLs) and sw.js.
// Usage: npm run bump           (date plus the next number for today)
//        npm run bump -- 2026.11.02-1
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { build } from './build-worker.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(join(root, f), 'utf8');
const write = (f, t) => writeFileSync(join(root, f), t);

const lib = read('assets/lib.js');
const current = /var VERSION = '([^']+)'/.exec(lib)[1];
const d = new Date(), today = `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
const [curDay, curN] = current.split('-');
const next = process.argv[2] || `${today}-${curDay === today ? Number(curN) + 1 : 1}`;
if (!/^[\w.-]+$/.test(next)) throw new Error('Version may only contain letters, numbers, dots and dashes.');

write('assets/lib.js', lib.replace(/var VERSION = '[^']+'/, `var VERSION = '${next}'`));
write('index.html', read('index.html').replace(/\?v=[\w.-]+/g, `?v=${next}`));
write('sw.js', read('sw.js').replace(/our-kitchen-[\w.-]+'/, `our-kitchen-${next}'`));
write('worker/recipe-reader.js', build());
console.log(`Version ${current} -> ${next}`);
