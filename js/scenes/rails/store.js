// Saving and loading of Rails, through the class server and nothing else: module sources and the layout go to
// POST /api/saveScene as JSON { path, contents } (the server accepts only .js files under js/scenes, and does not make
// directories, so modules/ and data/ must exist), and are read back by fetching the files as text. Only two kinds of
// path are ever built, from a checked name; nothing typed by a user reaches a path. The fetch is injected: the scene
// passes the browser's, the tests a fake.
//
// One write is in flight per path. A save asked for while one is in flight replaces what is waiting, so the newest
// content wins and a quick typist does not queue a hundred writes. A write that threw or got a 5xx is tried once more;
// a 4xx (a refused path, a bad body) would be refused again, so it is not.
import { NAME, MAX_SOURCE } from './values.js';

const MODULES = 'js/scenes/rails/modules/', LAYOUT = 'js/scenes/rails/data/layout.js';
const PREFIX = 'export default ';
const MAX_LAYOUT = 65536;

const refuse = reason => ({ ok: false, reason });

export function createStore({ fetch }) {
   const stats = { ok: 0, fail: 0, last: null };
   const queues = new Map();        // path -> { busy, waiting: { contents, waiters } | null }
   let buster = 0;
   const store = { stats, problem: null, failed: false };

   // One attempt: { ok, status }. A thrown fetch is status 0.
   const post = async (path, contents) => {
      try {
         const res = await fetch('/api/saveScene', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                                                     body: JSON.stringify({ path, contents }) });
         return { ok: !!res.ok, status: res.status };
      } catch { return { ok: false, status: 0 }; }
   };

   const write = async (path, contents) => {
      let result = await post(path, contents);
      if (!result.ok && (result.status === 0 || result.status >= 500)) result = await post(path, contents);
      stats[result.ok ? 'ok' : 'fail']++;
      stats.last = { path, ok: result.ok, status: result.status };
      return result;
   };

   // Runs the write now if the path is idle, else replaces the one waiting. Every caller gets the result of the write
   // that carried the newest content.
   const save = (path, contents) => new Promise(resolve => {
      let queue = queues.get(path);
      if (!queue) queues.set(path, queue = { busy: false, waiting: null });
      if (queue.busy) {
         if (queue.waiting) { queue.waiting.contents = contents; queue.waiting.waiters.push(resolve); }
         else queue.waiting = { contents, waiters: [resolve] };
         return;
      }
      const run = async (text, waiters) => {
         queue.busy = true;
         const result = await write(path, text);
         queue.busy = false;
         for (const done of waiters) done(result);
         const next = queue.waiting;
         queue.waiting = null;
         if (next) run(next.contents, next.waiters);
      };
      run(contents, [resolve]);
   });

   // The file as text, or null when there is no such file (404); any other failure throws.
   const get = async path => {
      const res = await fetch(`/${path}?t=${Date.now()}-${++buster}`, { cache: 'no-store' });
      if (res && res.ok) return await res.text();
      if (res && res.status === 404) return null;
      throw new Error(`HTTP ${res ? res.status : 'none'}`);
   };

   store.saveModule = async (name, source) => {
      if (typeof name !== 'string' || !NAME.test(name)) return refuse('bad module name');
      if (typeof source !== 'string') return refuse('source must be text');
      if (source.length > MAX_SOURCE) return refuse(`source is over ${MAX_SOURCE} characters`);
      return save(`${MODULES}${name}.js`, source);
   };

   store.saveLayout = async layout => {
      if (layout === null || typeof layout !== 'object' || Array.isArray(layout)) return refuse('layout must be an object');
      let json;
      try { json = JSON.stringify(layout, null, 1); } catch { return refuse('layout is not JSON'); }
      if (typeof json !== 'string') return refuse('layout is not JSON');
      const text = `${PREFIX}${json};\n`;
      if (text.length > MAX_LAYOUT) return refuse(`layout is over ${MAX_LAYOUT} characters`);
      return save(LAYOUT, text);
   };

   // The source of a module, or null when there is no such file (or the server cannot be reached).
   store.loadModule = async name => {
      if (typeof name !== 'string' || !NAME.test(name)) return null;
      try { return await get(`${MODULES}${name}.js`); } catch { return null; }
   };

   // The layout object, or null: a missing, unreadable or malformed file starts empty, and `problem` says why. `failed` is true
   // when the file may exist but could not be read or understood (the server was not reached, or the file is bad): a caller
   // that would save over it must not start from nothing then. No file at all is not a failure.
   store.loadLayout = async () => {
      store.problem = null; store.failed = false;
      try {
         const text = await get(LAYOUT);
         if (text === null) { store.problem = 'no layout file'; return null; }
         const body = text.trim();
         if (!body.startsWith(PREFIX) || !body.endsWith(';')) throw new Error('not `export default <JSON>;`');
         const layout = JSON.parse(body.slice(PREFIX.length, -1));
         if (layout === null || typeof layout !== 'object' || Array.isArray(layout)) throw new Error('not an object');
         return layout;
      } catch (err) { store.failed = true; store.problem = `bad layout: ${err.message}`; return null; }
   };

   return store;
}
