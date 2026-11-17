// Rails checks without a browser: the values that travel on the bus (validation,
// freezing, migration, the dock rule) and the sandbox that compiles a module.
// Run: node tests/rails.test.cjs
const assert = require('node:assert/strict');
const load = require('./esm.cjs');

let passed = 0;
const check = async (name, fn) => { await fn(); passed++; console.log('ok -', name); };
const near = (a, b, e = 1e-6) => assert.ok(Math.abs(a - b) < e, `${a} vs ${b}`);

(async () => {
   const V = await load('js/scenes/rails/values.js');
   const S = await load('js/scenes/rails/sandbox.js');

   const nest = depth => { let v = 1; for (let i = 0; i < depth; i++) v = [v]; return v; };
   const sphere = { shape: 'sphere', p: [0, 1, 0], s: .1, color: '#ffb000' };
   const stubs = (extra = {}) => ({ input: () => ({}), output: () => ({}), state: d => d, draw: () => {},
                                    random: () => 0, log: () => {}, ...extra });
   const runs = (source, api) => { const c = S.compile('t', source); assert.ok(c.ok, c.error && c.error.message); return c.run(api || stubs()); };
   const failure = (source, api) => { try { runs(source, api); } catch (err) { return err; } assert.fail('expected a throw'); };

   await check('types: the list, and typeOk per type', () => {
      assert.deepEqual([...V.TYPES], ['any', 'num', 'bool', 'str', 'vec3', 'time']);
      assert.ok(V.typeOk('any', { a: 1 }) && V.typeOk('any', null));
      assert.ok(V.typeOk('num', 3) && !V.typeOk('num', '3') && !V.typeOk('num', NaN) && !V.typeOk('num', Infinity));
      assert.ok(V.typeOk('bool', false) && !V.typeOk('bool', 0));
      assert.ok(V.typeOk('str', '') && !V.typeOk('str', 5));
      assert.ok(V.typeOk('vec3', [1, 2, 3]));
      assert.ok(!V.typeOk('vec3', [1, 2]) && !V.typeOk('vec3', [1, 2, 3, 4]) && !V.typeOk('vec3', [1, 2, NaN]) && !V.typeOk('vec3', [1, 2, '3']));
      assert.ok(V.typeOk('time', { t: 1, dt: 1 / 60, n: 60 }));
      assert.ok(!V.typeOk('time', { t: 1, dt: 1 / 60 }) && !V.typeOk('time', { t: 1, dt: NaN, n: 2 }) && !V.typeOk('time', 3));
      assert.ok(!V.typeOk('nope', 1));
   });

   // The same results as the first implementation gave (recorded from it before values.js was sped up): the first problem
   // or 'ok' for validateValue and validState, and for freezeCopy a hash of the copy's JSON ('!' and the error's class when it
   // throws, '?' when the copy is not frozen or not plain).
   const trickyValues = () => {
      const cyc = { a: 1 }; cyc.self = cyc;
      const cycArr = [1]; cycArr.push(cycArr);
      const nest = d => { let v = 1; for (let i = 0; i < d; i++) v = [v]; return v; };
      const dag = (() => { let v = [1]; for (let i = 0; i < 6; i++) v = [v, v, v, v, v, v, v, v, v, v]; return v; })();
      const wide = Array.from({ length: 10001 }, (_, i) => i);
      const protoKey = JSON.parse('{"__proto__": {"x": 1}, "y": [1, {"__proto__": 2}]}');
      const getter = { get a() { throw new Error('boom'); } };
      const objs = Object.create(null); objs.k = [1, 2];
      class Foo { constructor() { this.a = 1; } }
      return [
         ['num', 1.5], ['nan', NaN], ['inf', [1, Infinity]], ['neg0', -0], ['undef', undefined], ['fn', () => 1], ['sym', Symbol('s')], ['bigint', 10n],
         ['null', null], ['true', true], ['false', false], ['empty str', ''], ['str 4094', 'x'.repeat(4094)], ['str 4095', 'x'.repeat(4095)],
         ['unicode 2-byte', 'é'.repeat(1500)], ['unicode 2-byte over', 'é'.repeat(2100)], ['cjk', '汉'.repeat(1300)], ['cjk over', '汉'.repeat(1400)],
         ['emoji', '😀'.repeat(1000)], ['emoji over', '😀'.repeat(1030)], ['lone high', '\ud800'.repeat(1400)], ['lone high then x', '\ud800x'.repeat(1000)],
         ['lone low', '\udc00'.repeat(1400)], ['key unicode', { '汉字': 1, 'é': [2] }],
         ['array', [1, 2, 3]], ['object', { a: 'x', b: [true, null] }], ['nested 6', nest(6)], ['nested 7', nest(7)], ['nested 20', nest(20)],
         ['bad deep', { a: { b: [1, { c: NaN }] } }], ['bad undef in array', [1, undefined]], ['bad fn deep', { a: [{ f() {} }] }],
         ['cycle obj', cyc], ['cycle arr', cycArr], ['dag', dag], ['wide', wide], ['wide small', Array.from({ length: 900 }, () => 'abcdef')],
         ['date', new Date(0)], ['map', new Map()], ['class', new Foo()], ['nested class', { a: [new Foo()] }], ['null proto', objs],
         ['proto key', protoKey], ['getter', getter], ['many keys', Object.fromEntries(Array.from({ length: 600 }, (_, i) => ['k' + i, i]))],
         ['big state', { s: 'y'.repeat(16300) }], ['big state over', { s: 'y'.repeat(16390) }], ['array of strs', Array.from({ length: 300 }, () => 'hello wor')],
         ['proxy throw', new Proxy({}, { ownKeys() { throw new Error('nope'); } })],
         ['sparse', [1, , 3]], ['array with prop', Object.assign([1], { x: 2 })], ['neg num path', { 'a b': [{ 'c.d': undefined }] }],
      ];
   };
   const TRICKY = [
      ["num","ok","state must be an object","aa8f289ebe"],
      ["nan","value is not a finite number","state must be an object","2be88ca424"],
      ["inf","value[1] is not a finite number","state must be an object","b3096bbb3c"],
      ["neg0","ok","state must be an object","b6589fc6ab"],
      ["undef","value is undefined, which is not JSON","state must be an object","da39a3ee5e"],
      ["fn","value is function, which is not JSON","state must be an object","da39a3ee5e"],
      ["sym","value is symbol, which is not JSON","state must be an object","da39a3ee5e"],
      ["bigint","value is bigint, which is not JSON","state must be an object","e7e3b441f1"],
      ["null","ok","state must be an object","2be88ca424"],
      ["true","ok","state must be an object","5ffe533b83"],
      ["false","ok","state must be an object","7cb6efb98b"],
      ["empty str","ok","state must be an object","dd29ecf524"],
      ["str 4094","ok","state must be an object","49539eedce"],
      ["str 4095","value is at least 4097 bytes of JSON, over the limit of 4096","state must be an object","d4ad4a8849"],
      ["unicode 2-byte","ok","state must be an object","7d566cad0b"],
      ["unicode 2-byte over","value is at least 4202 bytes of JSON, over the limit of 4096","state must be an object","def3175efe"],
      ["cjk","ok","state must be an object","62a6881f16"],
      ["cjk over","value is at least 4202 bytes of JSON, over the limit of 4096","state must be an object","2dc40dbbc8"],
      ["emoji","ok","state must be an object","5ab37ac7e3"],
      ["emoji over","value is at least 4122 bytes of JSON, over the limit of 4096","state must be an object","6a0cc9c14f"],
      ["lone high","value is at least 4202 bytes of JSON, over the limit of 4096","state must be an object","d7856fbaaf"],
      ["lone high then x","value is 7002 bytes of JSON, over the limit of 4096","state must be an object","a3bbdd43f4"],
      ["lone low","value is at least 4202 bytes of JSON, over the limit of 4096","state must be an object","407d5e9c97"],
      ["key unicode","ok","ok","9dce0b306b"],
      ["array","ok","state must be an object","9ef50cc82a"],
      ["object","ok","ok","a534b54ccc"],
      ["nested 6","ok","state must be an object","3989b24d4d"],
      ["nested 7","value[0][0][0][0][0][0] is nested deeper than 6 levels","state must be an object","2acd8dc57b"],
      ["nested 20","value[0][0][0][0][0][0] is nested deeper than 6 levels","state must be an object","5f115d5fa5"],
      ["bad deep","value.a.b[1].c is not a finite number","state.a.b[1].c is not a finite number","75cff388e8"],
      ["bad undef in array","value[1] is undefined, which is not JSON","state must be an object","b3096bbb3c"],
      ["bad fn deep","value.a[0].f is function, which is not JSON","state.a[0].f is function, which is not JSON","0c5440feb6"],
      ["cycle obj","value.self.self.self.self.self.self is nested deeper than 6 levels","state.self.self.self.self.self.self is nested deeper than 6 levels","!RangeError"],
      ["cycle arr","value[1][1][1][1][1][1] is nested deeper than 6 levels","state must be an object","!RangeError"],
      ["dag","value[0][0][0][0][0][0] is nested deeper than 6 levels","state must be an object","44922a5a26"],
      ["wide","value has 10001 items, over the node limit of 10000","state must be an object","e6f26f447b"],
      ["wide small","value is at least 8101 bytes of JSON, over the limit of 4096","state must be an object","e82dc25740"],
      ["date","value is not a plain object","state must be an object","bf21a9e8fb"],
      ["map","value is not a plain object","state must be an object","bf21a9e8fb"],
      ["class","value is not a plain object","state must be an object","9f89c740ce"],
      ["nested class","value.a[0] is not a plain object","state.a[0] is not a plain object","5696be40b7"],
      ["null proto","ok","ok","d67db47fc8"],
      ["proto key","ok","ok","297fcc359d"],
      ["getter","value could not be read: boom","state could not be read: boom","!Error"],
      ["many keys","value is at least 5291 bytes of JSON, over the limit of 4096","ok","5749bdd614"],
      ["big state","value is at least 16308 bytes of JSON, over the limit of 4096","ok","35ebac2fe8"],
      ["big state over","value is at least 16398 bytes of JSON, over the limit of 4096","state is at least 16398 bytes of JSON, over the limit of 16384","525041508f"],
      ["array of strs","ok","state must be an object","6b04769ebe"],
      ["proxy throw","value could not be read: nope","state could not be read: nope","!Error"],
      ["sparse","value[1] is undefined, which is not JSON","state must be an object","9720c7cb8c"],
      ["array with prop","ok","state must be an object","f629ae44b7"],
      ["neg num path","value.a b[0].c.d is undefined, which is not JSON","state.a b[0].c.d is undefined, which is not JSON","cee6e7b8e6"]
   ];
   await check('values: validateValue, validState and freezeCopy keep their results on cycles, NaN, depth, width, __proto__ keys and unicode', () => {
      const crypto = require('node:crypto');
      const cases = trickyValues();
      assert.equal(cases.length, TRICKY.length);
      cases.forEach(([label, v], i) => {
         const [want, value, state, copy] = TRICKY[i];
         assert.equal(label, want);
         const say = r => r.ok ? 'ok' : r.error;
         assert.equal(say(V.validateValue(v)), value, label + ': validateValue');
         assert.equal(say(V.validState(v)), state, label + ': validState');
         let got;
         try {
            const c = V.freezeCopy(v);
            let json; try { json = JSON.stringify(c); } catch (err) { json = 'ERR ' + err.message; }
            const plain = c === null || typeof c !== 'object' || Array.isArray(c) || Object.getPrototypeOf(c) === Object.prototype;
            got = (plain && (c === null || typeof c !== 'object' || Object.isFrozen(c)) ? '' : '?') + crypto.createHash('sha1').update(json || '').digest('hex').slice(0, 10);
         } catch (err) { got = '!' + err.constructor.name; }
         assert.equal(got, copy, label + ': freezeCopy');
      });
   });

   await check('validateValue accepts JSON and rejects everything else', () => {
      assert.ok(V.validateValue([1, 2, 3]).ok);
      assert.ok(V.validateValue({ a: 'x' }).ok);
      assert.ok(V.validateValue(null).ok && V.validateValue(true).ok && V.validateValue('').ok);
      for (const bad of [NaN, Infinity, -Infinity, undefined, () => 1, [1, undefined], { a: [NaN] }, Symbol('s'), 10n, new Date(0), new Map()]) {
         const r = V.validateValue(bad);
         assert.equal(r.ok, false, String(bad));
         assert.equal(typeof r.error, 'string');
      }
      assert.ok(V.validateValue(nest(6)).ok);
      assert.equal(V.validateValue(nest(7)).ok, false);
      assert.equal(V.validateValue('x'.repeat(5000)).ok, false);
      assert.ok(V.validateValue('x'.repeat(4094)).ok);          // 4096 bytes of JSON with the quotes
      assert.equal(V.validateValue('x'.repeat(4095)).ok, false);
      assert.equal(V.validateValue('é'.repeat(2048)).ok, false);  // bytes, not characters
      const loop = []; loop.push(loop);
      assert.equal(V.validateValue(loop).ok, false);
   });

   await check('freezeCopy: deep, frozen, not the same object', () => {
      const src = { a: [1, { b: 2 }], c: 'x' };
      const out = V.freezeCopy(src);
      assert.notEqual(out, src); assert.notEqual(out.a, src.a); assert.notEqual(out.a[1], src.a[1]);
      assert.deepEqual(out, src);
      assert.ok(Object.isFrozen(out) && Object.isFrozen(out.a) && Object.isFrozen(out.a[1]));
      src.a[1].b = 9;
      assert.equal(out.a[1].b, 2);                               // a later change of the original is invisible
      assert.equal(V.freezeCopy(5), 5);
      const odd = V.freezeCopy(JSON.parse('{"__proto__": {"x": 1}, "y": 2}'));
      assert.equal(odd.y, 2); assert.equal(({}).x, undefined);
   });

   await check('validDraw: shapes, limits and colours', () => {
      assert.ok(V.validDraw([]).ok);
      assert.ok(V.validDraw([sphere]).ok);
      assert.ok(V.validDraw([{ shape: 'box', p: [0, 0, 0], s: [.1, .2, .3], color: '#fff' }]).ok);
      assert.ok(V.validDraw([{ shape: 'line', p: [0, 0, 0], to: [1, 1, 1], s: .01, color: '#00ff00' }]).ok);
      assert.ok(V.validDraw([{ shape: 'text', p: [0, 0, 0], s: .05, color: '#abc', text: 'hi' }]).ok);
      assert.ok(V.validDraw(Array.from({ length: 128 }, () => sphere)).ok);
      assert.equal(V.validDraw(Array.from({ length: 129 }, () => sphere)).ok, false);
      assert.equal(V.validDraw([{ ...sphere, shape: 'cone' }]).ok, false);
      assert.equal(V.validDraw([{ ...sphere, color: 'red' }]).ok, false);
      assert.equal(V.validDraw([{ ...sphere, color: '#ffff' }]).ok, false);
      assert.equal(V.validDraw([{ ...sphere, p: [0, NaN, 0] }]).ok, false);
      assert.equal(V.validDraw([{ ...sphere, p: [0, 0] }]).ok, false);
      assert.equal(V.validDraw([{ ...sphere, s: Infinity }]).ok, false);
      assert.equal(V.validDraw([{ shape: 'line', p: [0, 0, 0], s: .01, color: '#000' }]).ok, false);      // no `to`
      assert.equal(V.validDraw([{ shape: 'text', p: [0, 0, 0], s: .05, color: '#000' }]).ok, false);      // no text
      assert.equal(V.validDraw({ shape: 'sphere' }).ok, false);
      assert.equal(V.validDraw([null]).ok, false);
      assert.equal(typeof V.validDraw([{ ...sphere, shape: 'cone' }]).error, 'string');
   });

   await check('validState: JSON object, up to 16 KB', () => {
      assert.ok(V.validState({ p: [0, 0, 0], n: 1 }).ok);
      assert.ok(V.validState({}).ok);
      assert.equal(V.validState([1]).ok, false);
      assert.equal(V.validState(null).ok, false);
      assert.equal(V.validState({ a: NaN }).ok, false);
      assert.equal(V.validState({ f: () => 1 }).ok, false);
      assert.ok(V.validState({ a: 'x'.repeat(16000) }).ok);
      assert.equal(V.validState({ a: 'x'.repeat(17000) }).ok, false);
      assert.equal(V.validState({ a: nest(7) }).ok, false);
   });

   await check('migrate keeps same-type keys, defaults the rest, drops removed keys', () => {
      assert.deepEqual(V.migrate({ a: 1, b: 'x', c: [1] }, { a: 0, b: 0, d: true }), { a: 1, b: 0, d: true });
      assert.deepEqual(V.migrate({ l: [1], o: { x: 1 }, n: null }, { l: {}, o: [], n: 5 }), { l: {}, o: [], n: 5 });   // arrays, objects and null differ
      assert.deepEqual(V.migrate({ l: [1, 2], o: { x: 1 } }, { l: [], o: {} }), { l: [1, 2], o: { x: 1 } });
      assert.deepEqual(V.migrate(null, { a: 1 }), { a: 1 });
      const defaults = { p: [0, 0, 0] };
      const out = V.migrate({}, defaults);
      assert.notEqual(out.p, defaults.p);                        // defaults are copied, never shared
      const old = { p: [1, 2, 3] };
      assert.notEqual(V.migrate(old, defaults).p, old.p);
      assert.ok(!Object.isFrozen(V.migrate({ a: 1 }, { a: 1 })));
   });

   await check('compatible is the one dock rule, with reasons', () => {
      const ok = (port, rail) => V.compatible(port, rail);
      assert.deepEqual(ok({ dir: 'in', kind: 'state', type: 'num' }, { kind: 'state', type: 'num' }), { ok: true });
      assert.ok(ok({ dir: 'out', kind: 'event', type: 'any' }, { kind: 'event', type: 'vec3' }).ok);
      assert.ok(ok({ dir: 'in', kind: 'state', type: 'vec3' }, { kind: 'state', type: 'any' }).ok);
      const kind = ok({ dir: 'in', kind: 'event', type: 'num' }, { kind: 'state', type: 'num' });
      assert.equal(kind.ok, false); assert.match(kind.reason, /event/); assert.match(kind.reason, /state/);
      const type = ok({ dir: 'in', kind: 'state', type: 'num' }, { kind: 'state', type: 'str' });
      assert.equal(type.ok, false); assert.match(type.reason, /num/); assert.match(type.reason, /str/);
      assert.equal(ok({ dir: 'sideways', kind: 'state', type: 'num' }, { kind: 'state', type: 'num' }).ok, false);
      assert.equal(ok({ dir: 'in', kind: 'state', type: 'nope' }, { kind: 'state', type: 'num' }).ok, false);
   });

   await check('makeRng repeats, and its state round-trips mid-sequence', () => {
      const a = S.makeRng(7), b = S.makeRng(7);
      const xs = Array.from({ length: 5 }, () => a.random());
      assert.deepEqual(xs, Array.from({ length: 5 }, () => b.random()));
      assert.ok(xs.every(x => x >= 0 && x < 1));
      assert.notDeepEqual(xs, Array.from({ length: 5 }, ((r) => () => r.random())(S.makeRng(8))));
      const r = S.makeRng(42);
      r.random(); r.random();
      const saved = r.state;
      assert.ok(Number.isInteger(saved) && saved >= 0 && saved < 2 ** 32);
      const tail = [r.random(), r.random(), r.random()];
      const q = S.makeRng(999);
      q.state = saved;
      assert.deepEqual([q.random(), q.random(), q.random()], tail);
      r.state = saved;
      assert.deepEqual([r.random(), r.random(), r.random()], tail);
   });

   await check('hashSeed is a stable uint32 per (seed, id)', () => {
      const h = S.hashSeed(1, 'ball');
      assert.ok(Number.isInteger(h) && h >= 0 && h < 2 ** 32);
      assert.equal(h, S.hashSeed(1, 'ball'));
      assert.notEqual(h, S.hashSeed(1, 'flowers'));
      assert.notEqual(h, S.hashSeed(2, 'ball'));
   });

   await check('compile: the API arrives as parameters and the globals are shadowed', () => {
      assert.deepEqual([...S.PARAMS.slice(0, 6)], ['input', 'output', 'state', 'draw', 'random', 'log']);
      for (const g of ['window', 'document', 'globalThis', 'self', 'fetch', 'XMLHttpRequest', 'WebSocket', 'Worker', 'localStorage',
                       'navigator', 'server', 'setTimeout', 'setInterval', 'requestAnimationFrame', 'queueMicrotask', 'Promise'])
         assert.ok(S.PARAMS.includes(g), g);
      const seen = [];
      runs('log(typeof window, typeof document, typeof globalThis, typeof fetch, typeof setTimeout, typeof Promise, typeof server);',
           stubs({ log: (...a) => seen.push(...a) }));
      assert.deepEqual(seen, Array(7).fill('undefined'));
   });

   await check('compile: setup sees the real API values, and the source cannot redeclare them', () => {
      const calls = [];
      const api = stubs({ input: (...a) => (calls.push(['input', ...a]), { value: 1 }), state: d => ({ ...d, extra: 1 }),
                          output: (...a) => (calls.push(['output', ...a]), {}) });
      const c = S.compile('ball', "const t = input('time', 'state', 'time'); const o = output('x', 'event', 'num'); const s = state({ n: 1 }); log(s.extra + t.value);");
      assert.ok(c.ok);
      const logged = [];
      c.run({ ...api, log: x => logged.push(x) });
      assert.deepEqual(calls, [['input', 'time', 'state', 'time'], ['output', 'x', 'event', 'num']]);
      assert.deepEqual(logged, [2]);
      const dup = S.compile('dup', "const log = 1;");
      assert.equal(dup.ok, false);                               // a parameter name cannot be redeclared at the top level
   });

   await check('sandbox: Date, Math.random and performance throw teaching errors', () => {
      assert.match(failure('Date.now()').message, /time input/);
      assert.match(failure('new Date()').message, /time input/);
      assert.match(failure('performance.now()').message, /time input/);
      assert.match(failure('Math.random()').message, /random\(\)/);
      assert.equal(runs('return Math.max(1, 5) + Math.floor(2.5) + Math.PI * 0;'), 7);   // the rest of Math still works
      assert.equal(runs('return Object.isFrozen(Math) && Object.isFrozen(Date) && Object.isFrozen(performance);'), true);
      assert.equal(runs('return Math !== undefined && Math.sin(0);'), 0);
      assert.equal(Math.random() >= 0, true);                    // the real Math is untouched
      assert.equal(typeof Date.now(), 'number');
      assert.match(failure("input('x')", stubs({ input: () => { throw new Error('port x'); } })).message, /port x/);
   });

   await check('sandbox: window is not reachable by name', () => {
      assert.equal(failure('window.x').constructor, TypeError);  // undefined.x
      assert.equal(failure('fetch("/")').constructor, TypeError);
      assert.equal(runs('return typeof navigator;'), 'undefined');
   });

   await check('errors: a throw on source line 3 reports line 3, a syntax error reports ok:false and line null', () => {
      const err = failure('const a = 1;\nconst b = 2;\nthrow new Error("boom");');
      assert.equal(err.message, 'boom');
      const pos = S.lineOf(err, 't');
      assert.equal(pos.line, 3);
      assert.ok(pos.col >= 1);
      assert.deepEqual(S.toError('setup', err, 't'), { phase: 'setup', message: 'boom', line: 3, col: pos.col });
      assert.equal(S.lineOf(failure('throw new Error("one");'), 't').line, 1);
      assert.equal(S.lineOf(failure('\n\n\n\nnull.x;'), 't').line, 5);
      assert.equal(S.lineOf(err, 'other'), null);               // no frame of that module in the stack
      assert.equal(S.lineOf(new Error('x'), 't'), null);
      assert.equal(S.lineOf(null, 't'), null);
      assert.equal(S.lineOf('text', 't'), null);
      const bad = S.compile('t', 'const = ;');
      assert.equal(bad.ok, false);
      assert.equal(bad.run, undefined);
      assert.equal(bad.error.phase, 'compile');
      assert.equal(bad.error.line, null);
      assert.equal(typeof bad.error.message, 'string');
      assert.ok(bad.error.message.length > 0);
      assert.deepEqual(Object.keys(bad.error).sort(), ['col', 'line', 'message', 'phase']);
   });

   await check('errors: a handler registered at setup throws later and is located by line', () => {
      let handler = null;
      const c2 = S.compile('h', "const i = input('time', 'state', 'time');\ni.on(() => {\n   throw new Error('late');\n});");
      c2.run(stubs({ input: () => ({ on: fn => { handler = fn; } }) }));
      let err = null;
      try { handler(); } catch (e) { err = e; }
      const e = S.toError('handler', err, 'h');
      assert.equal(e.line, 3); assert.equal(e.phase, 'handler'); assert.equal(e.message, 'late');
   });

   await check('errors: toError handles a compile failure and odd throw values', () => {
      const e = S.toError('compile', new SyntaxError('Unexpected token'), 't');
      assert.deepEqual(e, { phase: 'compile', message: 'Unexpected token', line: null, col: null });
      assert.deepEqual(S.toError('handler', 'plain', 't'), { phase: 'handler', message: 'plain', line: null, col: null });
   });

   // ---- values: what the bus depends on (names, copies, bounds) ----

   await check('validateValue: a shared-reference DAG cannot blow up the walk', () => {
      let v = ['x'];
      for (let i = 0; i < 5; i++) v = Array.from({ length: 100 }, () => v);   // 100^5 paths, 6 levels deep
      const t0 = Date.now();
      const r = V.validateValue(v);
      assert.equal(r.ok, false);
      assert.equal(typeof r.error, 'string');
      assert.ok(Date.now() - t0 < 1000, 'returned quickly');
      assert.equal(V.validState({ a: v }).ok, false);
      const wide = { list: Array.from({ length: 12000 }, () => 0) };
      assert.equal(V.validateValue(wide).ok, false);
      assert.ok(V.validateValue({ a: [1, 2, { b: [3] }], s: 'ok' }).ok);
   });

   await check('validateValue: getters and Proxies that throw give a result, not a throw', () => {
      const getter = { get a() { throw new Error('boom'); } };
      const r1 = V.validateValue(getter);
      assert.equal(r1.ok, false); assert.match(r1.error, /boom|read/);
      const trap = new Proxy({}, { getPrototypeOf() { throw new Error('trap'); }, ownKeys() { throw new Error('keys'); } });
      assert.equal(V.validateValue(trap).ok, false);
      const lying = new Proxy([], { get() { throw new Error('get'); } });
      assert.equal(V.validateValue({ x: lying }).ok, false);
      assert.equal(V.validState(getter).ok, false);
   });

   await check('sandbox: crypto is undefined and console forwards to log', () => {
      assert.ok(S.PARAMS.includes('crypto') && S.PARAMS.includes('console'));
      const lines = [];
      const api = stubs({ log: t => lines.push(t) });
      const out = runs("console.log('a', 1, {x: 1}); console.info('i'); console.warn('w'); console.error('e'); console.debug('d'); console.trace('t'); return typeof crypto;", api);
      assert.equal(out, 'undefined');
      assert.deepEqual(lines, ['a 1 {"x":1}', 'i', 'w', 'e', 'd', 't']);
      assert.equal(runs('return Object.isFrozen(console);'), true);
      assert.equal(runs('return typeof console.table;'), 'undefined');
   });

   await check('sandbox: the fake Date has a frozen prototype', () => {
      assert.equal(runs('return Object.isFrozen(Date) && Object.isFrozen(Date.prototype);'), true);
      const err = failure('Date.prototype.getTime = () => 1;');
      assert.ok(err instanceof TypeError);
      assert.equal(Object.isFrozen(Date.prototype), false);   // the real Date is untouched
   });

   // ---- the bus ----

   const B = await load('js/scenes/rails/bus.js');
   // The manual bus: rails and docks by hand. addModule docks the module's `time` input to the clock rail at once, which is what the
   // tests of the delivery rules need to get ticks (the wired bus binds `time` by name).
   const bus0 = (opts = {}) => {
      const bus = new B.Bus({ auto: false, ...opts }), add = bus.addModule.bind(bus);
      if (!bus.auto) {
         bus.addModule = (id, source) => {
            const r = add(id, source), time = r.ok && bus.modules.get(id).ports.find(p => p.name === 'time' && p.dir === 'in' && p.type === 'time');
            if (time) bus._applyDock(time, 'clock');
            return r;
         };
      }
      return bus;
   };
   // What the user built, as a layout: the rails, the sources and the docks (a bus keeps no layout of its own).
   const layoutOf = bus => ({
      rails: Object.fromEntries([...bus.rails].filter(([id]) => !bus.builtins.has(id)).map(([id, r]) => [id, { kind: r.kind, type: r.type }])),
      modules: Object.fromEntries([...bus.modules].map(([id, m]) => [id, m.source])),
      docks: [...bus._ports.values()].filter(p => p.rail).map(p => [p.owner, p.name, p.rail]).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0)),
      uses: { ...bus.uses }, unplugged: [...bus.unplugged].sort() });
   const step = (bus, k = 1) => { for (let i = 0; i < k; i++) bus.step(); };
   const logOps = bus => { const log = []; bus.onOp(o => log.push(o)); return log; };
   const ok = r => { assert.equal(r.ok, true, r.reason || (r.error && r.error.message)); return r; };
   // A module that records every delivery as [value, retained, by] in its state.
   const SUB = (kind = 'state', type = 'any', port = 'in') =>
      `const i = input('${port}', '${kind}', '${type}'); const S = state({ seen: [] });\n` +
      `i.on((v, m) => { S.seen.push([v, m.retained, m.by]); });`;
   const seen = (bus, id) => bus.modules.get(id).state.seen;
   const vecRail = (bus, id = 'target') => ok(bus.addRail({ id, kind: 'state', type: 'vec3' }));
   const vecDev = (bus, id) => bus.addDevice({ id, outputs: { p: { kind: 'state', type: 'vec3' } } });

   await check('bus: exports and a fresh bus has the clock device and rail', () => {
      assert.equal(B.DT, 1 / 60); assert.equal(B.MAX_PASSES, 8); assert.equal(B.BUDGET, 2000);
      const bus = bus0({ seed: 3 });
      const clock = bus.rails.get('clock');
      assert.equal(clock.kind, 'state'); assert.equal(clock.type, 'time'); assert.equal(clock.value, undefined);
      assert.equal(bus.n, 0); assert.equal(bus.t, 0); assert.equal(bus.paused, false);
      const dev = bus.devices.get('clock');
      assert.equal(dev.id, 'clock'); assert.equal(dev.ports[0].name, 'time'); assert.equal(dev.ports[0].rail, 'clock');
      assert.deepEqual(bus.queue, []);
      assert.equal(typeof bus.rev, 'number');
   });

   await check('time: t === n * DT, the clock publishes {t, dt, n} last', () => {
      const bus = bus0();
      step(bus, 7);
      assert.equal(bus.n, 7); assert.equal(bus.t, 7 * B.DT);
      assert.deepEqual({ ...bus.rails.get('clock').value }, { t: 7 * B.DT, dt: B.DT, n: 7 });
      assert.equal(bus.rails.get('clock').by, 'dev:clock.time');
      assert.equal(Object.isFrozen(bus.rails.get('clock').value), true);
      const ticks = [];
      bus.onStep(s => ticks.push(s));
      step(bus, 2);
      assert.deepEqual(ticks, [{ n: 8, t: 8 * B.DT }, { n: 9, t: 9 * B.DT }]);
   });

   await check('state rail: structure calls queue, then a late dock receives the retained value', () => {
      const bus = bus0();
      const d = vecDev(bus, 'gaze');
      vecRail(bus);
      ok(bus.dock('dev:gaze', 'p', 'target'));
      assert.equal(bus.rails.has('target'), false, 'nothing applied before a step');
      assert.equal(bus.queue.length, 2);
      d.set('p', [1, 2, 3]);
      step(bus);
      assert.equal(bus.queue.length, 0);
      const r = bus.rails.get('target');
      assert.deepEqual([...r.value], [1, 2, 3]); assert.equal(r.by, 'dev:gaze.p'); assert.equal(r.seq, 1);
      assert.equal(r.stale, false); assert.equal(r.contested, false);
      ok(bus.addModule('sub', SUB('state', 'vec3', 'target')));
      ok(bus.dock('mod:sub', 'target', 'target'));
      step(bus);
      assert.deepEqual(seen(bus, 'sub').map(([v, re, by]) => [[...v], re, by]), [[[1, 2, 3], true, 'dev:gaze.p']]);
      const handle = bus.modules.get('sub');
      assert.equal(handle.calls, 1);
      step(bus);
      assert.equal(seen(bus, 'sub').length, 1, 'no new value, no new call');
   });

   await check('state rail: undocking the publisher keeps the value, stale until the next publish', () => {
      const bus = bus0();
      const d = vecDev(bus, 'a'); vecRail(bus);
      bus.dock('dev:a', 'p', 'target'); d.set('p', [1, 1, 1]); step(bus);
      ok(bus.undock('dev:a', 'p'));
      step(bus);
      const r = bus.rails.get('target');
      assert.deepEqual([...r.value], [1, 1, 1]); assert.equal(r.stale, true);
      assert.equal(bus.devices.get('a').ports[0].rail, null);
      d.set('p', [9, 9, 9]); step(bus);
      assert.deepEqual([...r.value], [1, 1, 1], 'an undocked device cannot publish');
      bus.dock('dev:a', 'p', 'target'); step(bus);
      assert.deepEqual([...r.value], [9, 9, 9], 'docking an output with a value publishes it');
      assert.equal(r.stale, false);
   });

   await check('state rail: two publishers in one step, last wins and the rail is contested', () => {
      const bus = bus0();
      const a = vecDev(bus, 'a'), b = vecDev(bus, 'b'); vecRail(bus);
      ok(bus.addModule('sub', SUB('state', 'vec3', 'target')));
      bus.dock('dev:a', 'p', 'target'); bus.dock('dev:b', 'p', 'target'); bus.dock('mod:sub', 'target', 'target');
      step(bus);
      a.set('p', [1, 0, 0]); b.set('p', [2, 0, 0]); step(bus);
      const r = bus.rails.get('target');
      assert.deepEqual([...r.value], [2, 0, 0]); assert.equal(r.by, 'dev:b.p'); assert.equal(r.contested, true);
      assert.deepEqual([...r.writers].sort(), ['dev:a.p', 'dev:b.p']);
      assert.equal(seen(bus, 'sub').length, 1, 'one delivery for the pass');
      b.set('p', [3, 0, 0]); step(bus);
      assert.equal(r.contested, false); assert.deepEqual([...r.writers], ['dev:b.p']);
   });

   await check('state rail: publishes within a pass coalesce, the subscriber is called once', () => {
      const bus = bus0();
      ok(bus.addModule('pub', "const t = input('time', 'state', 'time'); const o = output('o', 'state', 'num');\nt.on(() => { o.set(1); o.set(2); o.set(3); });"));
      ok(bus.addModule('sub', SUB('state', 'num')));
      ok(bus.addRail({ id: 'r', kind: 'state', type: 'num' }));
      bus.dock('mod:pub', 'o', 'r'); bus.dock('mod:sub', 'in', 'r');
      step(bus, 2);
      assert.deepEqual(seen(bus, 'sub').map(s => s[0]), [3, 3]);
      assert.equal(bus.modules.get('sub').calls, 2);
      assert.equal(bus.rails.get('r').seq, 2);
   });

   await check('event rail: ordered, exactly once, nothing retained, a late dock gets nothing', () => {
      const bus = bus0();
      const d = bus.addDevice({ id: 'k', outputs: { e: { kind: 'event', type: 'num' } } });
      bus.addRail({ id: 'ev', kind: 'event', type: 'num' });
      ok(bus.addModule('one', SUB('event', 'num'))); ok(bus.addModule('two', SUB('event', 'num')));
      bus.dock('dev:k', 'e', 'ev'); bus.dock('mod:one', 'in', 'ev'); bus.dock('mod:two', 'in', 'ev');
      d.emit('e', 1); d.emit('e', 2); d.emit('e', 3);
      step(bus);
      for (const id of ['one', 'two']) assert.deepEqual(seen(bus, id).map(s => [s[0], s[1]]), [[1, false], [2, false], [3, false]]);
      const r = bus.rails.get('ev');
      assert.equal(r.value, undefined); assert.equal(r.seq, 3); assert.deepEqual(r.tail.map(m => m.v), [1, 2, 3]);
      step(bus, 3);
      assert.equal(seen(bus, 'one').length, 3, 'exactly once');
      ok(bus.addModule('late', SUB('event', 'num'))); bus.dock('mod:late', 'in', 'ev'); step(bus, 2);
      assert.equal(seen(bus, 'late').length, 0);
      d.emit('e', 4); step(bus);
      assert.deepEqual(seen(bus, 'late').map(s => s[0]), [4]);
   });

   await check('rails: the tail keeps the last 32 messages as {seq, t, v, by}', () => {
      const bus = bus0();
      const d = bus.addDevice({ id: 'k', outputs: { e: { kind: 'event', type: 'num' } } });
      bus.addRail({ id: 'ev', kind: 'event', type: 'num' }); bus.dock('dev:k', 'e', 'ev');
      for (let i = 1; i <= 40; i++) d.emit('e', i);
      step(bus);
      const tail = bus.rails.get('ev').tail;
      assert.equal(tail.length, 32); assert.equal(tail[0].v, 9); assert.equal(tail[31].v, 40);
      assert.deepEqual(Object.keys(tail[31]).sort(), ['by', 'seq', 't', 'v']);
      assert.equal(tail[31].seq, 40); assert.equal(tail[31].t, B.DT);
   });

   await check('dock refusals carry reasons and queue nothing', () => {
      const bus = bus0();
      vecRail(bus); bus.addRail({ id: 'ev', kind: 'event' }); vecDev(bus, 'g');
      ok(bus.addModule('m', "input('n', 'state', 'num'); input('e', 'event', 'any'); input('a', 'state', 'any'); output('o', 'state', 'vec3');"));
      step(bus);
      const refuse = (r, re) => { assert.equal(r.ok, false); assert.match(r.reason, re); };
      refuse(bus.canDock('mod:m', 'n', 'target'), /type mismatch/);
      refuse(bus.canDock('mod:m', 'n', 'ev'), /kind mismatch/);
      refuse(bus.canDock('mod:m', 'n', 'nope'), /rail/);
      refuse(bus.canDock('mod:m', 'zz', 'target'), /port/);
      refuse(bus.canDock('mod:ghost', 'n', 'target'), /module|owner/);
      refuse(bus.canDock('dev:ghost', 'p', 'target'), /device|owner/);
      refuse(bus.dock('mod:m', 'e', 'target'), /kind mismatch/);
      refuse(bus.undock('mod:m', 'n'), /not docked/);
      refuse(bus.undock('mod:m', 'zz'), /port/);
      assert.ok(bus.canDock('mod:m', 'a', 'target').ok);
      assert.ok(bus.canDock('mod:m', 'o', 'target').ok);
      assert.ok(bus.canDock('dev:g', 'p', 'target').ok);
      assert.deepEqual(bus.queue, []);
   });

   await check('docking an output that has a value publishes it', () => {
      const bus = bus0();
      vecRail(bus);
      ok(bus.addModule('pub', "const o = output('o', 'state', 'vec3'); o.set([4, 5, 6]);"));
      assert.deepEqual([...bus.modules.get('pub').ports[0].value], [4, 5, 6]);
      ok(bus.addModule('sub', SUB('state', 'vec3')));
      bus.dock('mod:sub', 'in', 'target'); step(bus);
      assert.equal(seen(bus, 'sub').length, 0, 'the rail has no value yet');
      bus.dock('mod:pub', 'o', 'target'); step(bus);
      assert.deepEqual([...bus.rails.get('target').value], [4, 5, 6]);
      assert.equal(bus.rails.get('target').by, 'mod:pub.o');
      assert.deepEqual(seen(bus, 'sub').map(s => [[...s[0]], s[1]]), [[[4, 5, 6], false]]);
   });

   await check('re-docking a docked port moves it, logged as undock then dock', () => {
      const bus = bus0();
      const log = logOps(bus);
      bus.addRail({ id: 'r1', kind: 'event' }); bus.addRail({ id: 'r2', kind: 'event' });
      const d = bus.addDevice({ id: 'k', outputs: { e: { kind: 'event', type: 'any' } } });
      ok(bus.addModule('sub', SUB('event')));
      bus.dock('dev:k', 'e', 'r1'); bus.dock('mod:sub', 'in', 'r1'); step(bus);
      log.length = 0;
      ok(bus.dock('mod:sub', 'in', 'r2')); step(bus);
      assert.deepEqual(log.filter(o => o.k !== 'pub'), [{ k: 'undock', n: 2, owner: 'mod:sub', port: 'in', rail: 'r1', reason: 'moved' },
                             { k: 'dock', n: 2, owner: 'mod:sub', port: 'in', rail: 'r2' }]);
      assert.equal(bus.modules.get('sub').ports[0].rail, 'r2');
      d.emit('e', 'x'); step(bus);
      assert.equal(seen(bus, 'sub').length, 0);
      ok(bus.dock('mod:sub', 'in', 'r2')); assert.equal(bus.queue.length, 0, 'same rail is a no-op');
   });

   await check('paused: ops wait for resume and apply in call order', () => {
      const bus = bus0();
      ok(bus.addModule('sub', SUB('event')));
      const log = logOps(bus);
      bus.pause();
      assert.equal(bus.paused, true);
      ok(bus.addRail({ id: 'r', kind: 'event' }));
      ok(bus.dock('mod:sub', 'in', 'r'));
      ok(bus.undock('mod:sub', 'in'));
      ok(bus.dock('mod:sub', 'in', 'r'));
      step(bus, 3);
      assert.equal(bus.n, 0); assert.equal(bus.queue.length, 4); assert.equal(bus.rails.has('r'), false);
      assert.equal(log.length, 0);
      bus.resume();
      assert.equal(bus.paused, false);
      step(bus);
      assert.equal(bus.n, 1); assert.equal(bus.queue.length, 0); assert.ok(bus.rails.has('r'));
      assert.deepEqual(log.filter(o => o.k !== 'pub').map(o => [o.k, o.n]), [['dock', 1], ['undock', 1], ['dock', 1]]);
      assert.equal(bus.modules.get('sub').ports[0].rail, 'r');
   });

   await check('cycles: a module feeding its own input runs 8 hops a step and carries the rest', () => {
      const bus = bus0();
      const log = logOps(bus);
      const d = bus.addDevice({ id: 'k', outputs: { e: { kind: 'event', type: 'num' } } });
      ok(bus.addModule('loop', "const a = input('in', 'event', 'num'); const o = output('out', 'event', 'num');\na.on(v => { o.emit(v + 1); });"));
      bus.addRail({ id: 'r', kind: 'event', type: 'num' });
      bus.dock('dev:k', 'e', 'r'); bus.dock('mod:loop', 'in', 'r'); bus.dock('mod:loop', 'out', 'r');
      d.emit('e', 0);
      step(bus);
      assert.equal(bus.modules.get('loop').calls, B.MAX_PASSES);
      assert.equal(bus.rails.get('r').seq, B.MAX_PASSES);
      assert.deepEqual(log.filter(o => o.k === 'pub' && o.rail === 'r').map(o => [o.p, o.v]), [0, 1, 2, 3, 4, 5, 6, 7].map(i => [i, i]));
      log.length = 0;
      step(bus);
      const pubs = log.filter(o => o.k === 'pub' && o.rail === 'r');
      assert.deepEqual(pubs.map(o => [o.p, o.v]), [0, 1, 2, 3, 4, 5, 6, 7].map(i => [i, i + 8]), 'the carried message is pass 0 of the next step');
      assert.equal(bus.modules.get('loop').calls, 2 * B.MAX_PASSES);
   });

   await check('delivery order: devices in registration order, then the clock, last', () => {
      const bus = bus0();
      const log = logOps(bus);
      const a = bus.addDevice({ id: 'a', outputs: { x: { kind: 'event', type: 'any' } } });
      const b = bus.addDevice({ id: 'b', outputs: { x: { kind: 'event', type: 'any' } } });
      bus.addRail({ id: 'ra', kind: 'event' }); bus.addRail({ id: 'rb', kind: 'event' });
      bus.dock('dev:a', 'x', 'ra'); bus.dock('dev:b', 'x', 'rb');
      ok(bus.addModule('obs', "const t = input('time', 'state', 'time'); const x = input('x', 'event', 'any'); const y = input('y', 'event', 'any'); const S = state({ order: [] });\nt.on(() => S.order.push('time')); x.on(() => S.order.push('x')); y.on(() => S.order.push('y'));"));
      bus.dock('mod:obs', 'x', 'ra'); bus.dock('mod:obs', 'y', 'rb');
      step(bus);
      log.length = 0; bus.modules.get('obs').state.order.length = 0;
      b.emit('x', 1); a.emit('x', 2); step(bus);
      assert.deepEqual(bus.modules.get('obs').state.order, ['x', 'y', 'time']);
      assert.deepEqual(log.filter(o => o.k === 'pub').map(o => o.by), ['dev:a.x', 'dev:b.x', 'dev:clock.time']);
      assert.ok(log.filter(o => o.k === 'pub').every(o => o.p === 0 && o.n === 2));
   });

   await check('ops: only the four shapes, pub carries n, p, rail, v, by', () => {
      const bus = bus0();
      const log = logOps(bus);
      const d = vecDev(bus, 'g'); vecRail(bus);
      bus.dock('dev:g', 'p', 'target'); d.set('p', [1, 2, 3]); step(bus); bus.undock('dev:g', 'p'); step(bus);
      const pub = log.find(o => o.k === 'pub' && o.rail === 'target');
      assert.deepEqual(Object.keys(pub).sort(), ['by', 'k', 'n', 'p', 'rail', 'v']);
      assert.deepEqual({ ...pub, v: [...pub.v] }, { k: 'pub', n: 1, p: 0, rail: 'target', v: [1, 2, 3], by: 'dev:g.p' });
      assert.deepEqual(log.find(o => o.k === 'dock'), { k: 'dock', n: 1, owner: 'dev:g', port: 'p', rail: 'target' });
      assert.deepEqual(log.find(o => o.k === 'undock'), { k: 'undock', n: 2, owner: 'dev:g', port: 'p', rail: 'target' });
      assert.ok(log.every(o => ['pub', 'dock', 'undock'].includes(o.k)));
   });

   await check('swapping the publisher of a rail leaves the subscriber untouched and it follows the new one', () => {
      const bus = bus0();
      const a = vecDev(bus, 'a'), b = vecDev(bus, 'b'); vecRail(bus);
      ok(bus.addModule('ball', "const t = input('target', 'state', 'vec3'); const S = state({ count: 0, last: null });\nt.on(v => { S.count++; S.last = v; });"));
      bus.dock('dev:a', 'p', 'target'); bus.dock('mod:ball', 'target', 'target');
      a.set('p', [1, 0, 0]); step(bus);
      const S = bus.modules.get('ball').state;
      assert.equal(S.count, 1);
      ok(bus.undock('dev:a', 'p')); step(bus);
      assert.equal(bus.rails.get('target').stale, true);
      assert.equal(S.count, 1); assert.deepEqual([...bus.modules.get('ball').ports[0].value], [1, 0, 0]);
      ok(bus.dock('dev:b', 'p', 'target')); b.set('p', [0, 7, 0]); a.set('p', [5, 5, 5]); step(bus);
      assert.equal(bus.modules.get('ball').state, S, 'the same state object');
      assert.equal(S.count, 2); assert.deepEqual([...S.last], [0, 7, 0]);
      assert.equal(bus.rails.get('target').by, 'dev:b.p'); assert.equal(bus.rails.get('target').stale, false);
      assert.equal(bus.modules.get('ball').ports[0].rail, 'target');
   });

   await check('devices: set and emit validate kind, name and value', () => {
      const bus = bus0();
      const d = bus.addDevice({ id: 'g', outputs: { s: { kind: 'state', type: 'num' }, e: { kind: 'event', type: 'num' } } });
      assert.throws(() => d.emit('s', 1), /state/);
      assert.throws(() => d.set('e', 1), /event/);
      assert.throws(() => d.set('zz', 1), /zz/);
      assert.throws(() => d.set('s', 'x'), /num/);
      assert.throws(() => d.set('s', NaN));
      assert.throws(() => bus.addDevice({ id: 'g', outputs: {} }), /exists|already/);
      assert.throws(() => bus.addDevice({ id: 'Bad Name', outputs: {} }));
      d.set('s', 1);
      assert.equal(bus.devices.get('g').ports.find(p => p.name === 's').value, 1);
   });

   await check('modules: addModule runs setup, registers ports, state, draw, log, random', () => {
      const bus = bus0({ seed: 5 });
      const src = "const t = input('time', 'state', 'time'); const x = input('x', 'event', 'vec3'); const o = output('o', 'state', 'num');\n" +
                  "const S = state({ n: 0, p: [0, 1] }); draw([{ shape: 'sphere', p: [0, 1, 0], s: .1, color: '#ffb000' }]); log('hello'); console.log('two');\n" +
                  "S.r = random(); t.on(() => { S.n++; });";
      const r = bus.addModule('m', src);
      assert.deepEqual(Object.keys(r), ['ok']); assert.equal(r.ok, true);
      const m = bus.modules.get('m');
      assert.equal(m.id, 'm'); assert.equal(m.source, src); assert.equal(m.calls, 0); assert.equal(m.error, null);
      assert.deepEqual(m.ports.map(p => [p.name, p.dir, p.kind, p.type, p.rail]),
                       [['time', 'in', 'state', 'time', 'clock'], ['x', 'in', 'event', 'vec3', null], ['o', 'out', 'state', 'num', null]]);
      assert.deepEqual(m.logs, ['hello', 'two']);
      assert.equal(m.draw.length, 1); assert.equal(m.draw[0].shape, 'sphere'); assert.equal(Object.isFrozen(m.draw), true);
      assert.equal(m.state.n, 0); assert.deepEqual(m.state.p, [0, 1]);
      const twin = bus0({ seed: 5 }); twin.addModule('m', src);
      assert.equal(twin.modules.get('m').state.r, m.state.r, 'same seed and id, same random()');
      const other = bus0({ seed: 6 }); other.addModule('m', src);
      assert.notEqual(other.modules.get('m').state.r, m.state.r);
      step(bus, 3);
      assert.equal(m.ports[0].rail, 'clock'); assert.equal(m.state.n, 3); assert.equal(m.calls, 3);
      assert.deepEqual({ ...m.ports[0].value }, { t: 3 * B.DT, dt: B.DT, n: 3 });
   });

   await check('modules: logs keep the last 50 lines', () => {
      const bus = bus0();
      ok(bus.addModule('m', "for (let i = 0; i < 60; i++) log('line ' + i);"));
      const logs = bus.modules.get('m').logs;
      assert.equal(logs.length, 50); assert.equal(logs[0], 'line 10'); assert.equal(logs[49], 'line 59');
   });

   await check('modules: failures return {ok:false, error} and register nothing', () => {
      const bus = bus0();
      const bad = bus.addModule('a', 'const = ;');
      assert.equal(bad.ok, false); assert.equal(bad.error.phase, 'compile');
      const thrown = bus.addModule('b', "const x = 1;\nlog('hi');\nthrow new Error('nope');");
      assert.equal(thrown.ok, false); assert.equal(thrown.error.phase, 'setup'); assert.equal(thrown.error.line, 3); assert.equal(thrown.error.message, 'nope');
      assert.equal(bus.addModule('c', "input('time', 'state', 'nothing');").ok, false);
      assert.equal(bus.addModule('d', "input('x', 'sideways', 'num');").ok, false);
      assert.equal(bus.addModule('e', "input('x', 'state', 'num'); output('x', 'state', 'num');").ok, false, 'duplicate port name');
      assert.equal(bus.addModule('f', "state({ f: () => 1 });").ok, false);
      assert.equal(bus.addModule('g', "draw([{ shape: 'cone' }]);").ok, false);
      assert.equal(bus.addModule('h', "input('Bad', 'state', 'num');").ok, false);
      assert.equal(bus.addModule('i', "setTimeout(() => 1, 1);").ok, false);
      for (const id of 'abcdefghi') assert.equal(bus.modules.has(id), false, id);
      assert.equal(bus.addModule('Bad Id', '').ok, false);
      assert.equal(bus.addModule('big', 'x'.repeat(70000)).ok, false);
      ok(bus.addModule('twice', ''));
      assert.equal(bus.addModule('twice', '').ok, false);
   });

   await check('modules: ports are declared during setup only', () => {
      const bus = bus0();
      const src = "const t = input('time', 'state', 'time'); const S = state({ msg: '' });\nt.on(() => { try { input('late', 'state', 'num'); } catch (e) { S.msg = e.message; } });";
      ok(bus.addModule('m', src)); step(bus);
      assert.match(bus.modules.get('m').state.msg, /setup|top level/);
      assert.equal(bus.modules.get('m').ports.length, 1);
   });

   await check('ports: set on an event output and emit on a state output throw clear errors', () => {
      const bus = bus0();
      ok(bus.addModule('m', "const s = output('s', 'state', 'num'); const e = output('e', 'event', 'num'); const S = state({ a: '', b: '', c: '', d: '' });\n" +
         "try { e.set(1); } catch (x) { S.a = x.message; } try { s.emit(1); } catch (x) { S.b = x.message; }\n" +
         "try { s.set(NaN); } catch (x) { S.c = x.message; } try { s.set('x'); } catch (x) { S.d = x.message; }"));
      const S = bus.modules.get('m').state;
      assert.match(S.a, /event/); assert.match(S.a, /emit/); assert.match(S.b, /state/); assert.match(S.b, /set/);
      assert.match(S.c, /finite|number/); assert.match(S.d, /num/);
   });

   await check('ports: input handles carry value, docked and on(fn)', () => {
      const bus = bus0();
      const d = vecDev(bus, 'g'); vecRail(bus);
      ok(bus.addModule('m', "const i = input('target', 'state', 'vec3'); const S = state({ docked: [], vals: [] });\n" +
         "const t = input('time', 'state', 'time'); t.on(() => { S.docked.push(i.docked); S.vals.push(i.value === undefined ? null : [...i.value]); });"));
      step(bus);
      bus.dock('dev:g', 'p', 'target'); bus.dock('mod:m', 'target', 'target'); d.set('p', [1, 2, 3]); step(bus);
      bus.undock('mod:m', 'target'); step(bus);
      const S = bus.modules.get('m').state;
      assert.deepEqual(S.docked, [false, true, false]);
      assert.deepEqual(S.vals, [null, [1, 2, 3], null]);
   });

   await check('published values are validated, copied and frozen', () => {
      const bus = bus0();
      const d = bus.addDevice({ id: 'd', outputs: { o: { kind: 'state', type: 'any' } } });
      bus.addRail({ id: 'r', kind: 'state', type: 'any' }); bus.dock('dev:d', 'o', 'r');
      const v = { a: [1, 2], b: 'x' };
      d.set('o', v); step(bus);
      v.a.push(3);
      const got = bus.rails.get('r').value;
      assert.deepEqual(got, { a: [1, 2], b: 'x' }); assert.notEqual(got, v);
      assert.ok(Object.isFrozen(got) && Object.isFrozen(got.a));
      assert.throws(() => d.set('o', { deep: nest(8) }));
      assert.throws(() => d.set('o', 'x'.repeat(5000)));
   });

   await check('errors: a throwing handler is recorded, quarantines the module, and others keep running', () => {
      const bus = bus0();
      ok(bus.addModule('bad', "const t = input('time', 'state', 'time');\nt.on(() => {\n   throw new Error('oops');\n});"));
      ok(bus.addModule('good', "const t = input('time', 'state', 'time'); const S = state({ n: 0 }); t.on(() => { S.n++; });"));
      assert.doesNotThrow(() => step(bus, 2));
      const m = bus.modules.get('bad');
      assert.equal(m.error.phase, 'handler'); assert.equal(m.error.message, 'oops'); assert.equal(m.error.line, 3);
      assert.equal(bus.modules.get('good').state.n, 2); assert.equal(bus.modules.get('good').error, null);
      assert.equal(bus.modules.get('bad').calls, 1, 'quarantined after the first throw'); assert.equal(m.status, 'quarantined');
   });

   await check('errors: a bad publish from a handler is a publish error', () => {
      const bus = bus0();
      ok(bus.addModule('bad', "const t = input('time', 'state', 'time'); const o = output('o', 'state', 'num');\nt.on(() => {\n   o.set(NaN);\n});"));
      step(bus);
      const e = bus.modules.get('bad').error;
      assert.equal(e.phase, 'publish'); assert.equal(e.line, 3);
   });

   await check('budget: more than 2000 handler calls from one module in a step is recorded and stopped', () => {
      const bus = bus0();
      const d = bus.addDevice({ id: 'k', outputs: { e: { kind: 'event', type: 'num' } } });
      ok(bus.addModule('boom', "const a = input('in', 'event', 'num'); const o = output('out', 'event', 'num');\na.on(v => { o.emit(v); o.emit(v); o.emit(v); });"));
      ok(bus.addModule('calm', "const t = input('time', 'state', 'time'); const S = state({ n: 0 }); t.on(() => { S.n++; });"));
      bus.addRail({ id: 'r', kind: 'event', type: 'num' });
      bus.dock('dev:k', 'e', 'r'); bus.dock('mod:boom', 'in', 'r'); bus.dock('mod:boom', 'out', 'r');
      d.emit('e', 1);
      assert.doesNotThrow(() => step(bus));
      assert.equal(bus.modules.get('boom').calls, B.BUDGET);
      assert.match(bus.modules.get('boom').error.message, /runaway/);
      assert.equal(bus.modules.get('calm').state.n, 1);
   });

   await check('rails: addRail and removeRail validate at once and apply at the next step', () => {
      const bus = bus0();
      const refuse = (r, re) => { assert.equal(r.ok, false); assert.match(r.reason, re); };
      refuse(bus.addRail({ id: 'Bad', kind: 'state' }), /name/);
      refuse(bus.addRail({ id: 'r', kind: 'sideways' }), /kind/);
      refuse(bus.addRail({ id: 'r', kind: 'state', type: 'quat' }), /type/);
      refuse(bus.addRail({ id: 'clock', kind: 'state' }), /exists|already/);
      ok(bus.addRail({ id: 'r', kind: 'state' }));
      refuse(bus.addRail({ id: 'r', kind: 'state' }), /exists|already/);
      assert.equal(bus.rails.has('r'), false);
      step(bus);
      assert.equal(bus.rails.get('r').type, 'any');
      refuse(bus.removeRail('zz'), /rail/); refuse(bus.removeRail('clock'), /clock/);
      assert.equal(bus.queue.length, 0);
   });

   await check('rails: remove drops docks with a logged reason', () => {
      const bus = bus0();
      const log = logOps(bus);
      const d = bus.addDevice({ id: 'g', outputs: { o: { kind: 'state', type: 'num' } } });
      ok(bus.addModule('sub', SUB('state', 'num'))); bus.addRail({ id: 'r', kind: 'state', type: 'num' });
      bus.dock('dev:g', 'o', 'r'); bus.dock('mod:sub', 'in', 'r'); d.set('o', 5); step(bus);
      d.set('o', 6); step(bus);
      assert.deepEqual(seen(bus, 'sub').map(s => s[0]), [5, 6]);
      // remove: docks go, with a reason
      log.length = 0;
      ok(bus.removeRail('r')); step(bus);
      assert.equal(bus.rails.has('r'), false);
      assert.deepEqual(log.filter(o => o.k !== 'pub').map(o => [o.k, o.owner, o.reason]), [['undock', 'dev:g', 'rail removed'], ['undock', 'mod:sub', 'rail removed']]);
      assert.equal(bus.modules.get('sub').ports[0].rail, null);
      assert.doesNotThrow(() => step(bus, 2));
   });

   await check('rails: a structure change bumps rev, a quiet step does not', () => {
      const bus = bus0();
      const r0 = bus.rev;
      bus.addRail({ id: 'r', kind: 'event' });
      assert.equal(bus.rev, r0, 'queued is not applied');
      step(bus);
      assert.ok(bus.rev > r0);
      const r1 = bus.rev;
      step(bus, 3);
      assert.equal(bus.rev, r1);
   });

   await check('retained: a stale retained value is never delivered after a newer one (publisher docked with an old set())', () => {
      const bus = bus0();
      const d = bus.addDevice({ id: 'a', outputs: { o: { kind: 'state', type: 'num' } } });
      bus.addRail({ id: 'r', kind: 'state', type: 'num' });
      ok(bus.addModule('pub', "const o = output('o', 'state', 'num'); o.set(2);"));
      ok(bus.addModule('sub', SUB('state', 'num')));
      bus.dock('dev:a', 'o', 'r'); d.set('o', 1); step(bus);        // the rail holds 1
      bus.dock('mod:pub', 'o', 'r'); bus.dock('mod:sub', 'in', 'r'); step(bus);   // pub's old value 2, and a late subscriber
      const got = seen(bus, 'sub').map(s => [s[0], s[1]]);
      assert.deepEqual(got.map(g => g[0]), [2], JSON.stringify(got));
      assert.equal(bus.modules.get('sub').ports[0].value, 2);
      assert.equal(bus.rails.get('r').value, 2);
   });

   await check('retained: a carried message delivered before the dock-generated retained one wins', () => {
      const bus = bus0();
      const d = bus.addDevice({ id: 'k', outputs: { e: { kind: 'event', type: 'num' } } });
      ok(bus.addModule('loop', "const a = input('in', 'event', 'num'); const o = output('out', 'event', 'num');\na.on(v => { o.emit(v + 1); });"));
      ok(bus.addModule('pub', "const o = output('o', 'state', 'num'); const a = input('go', 'event', 'num');\na.on(v => { o.set(v); });"));
      ok(bus.addModule('sub', SUB('state', 'num')));
      for (const r of ['ev', 'st']) bus.addRail({ id: r, kind: r === 'ev' ? 'event' : 'state', type: 'num' });
      bus.dock('dev:k', 'e', 'ev'); bus.dock('mod:loop', 'in', 'ev'); bus.dock('mod:loop', 'out', 'ev');
      bus.dock('mod:pub', 'go', 'ev'); bus.dock('mod:pub', 'o', 'st');
      d.emit('e', 0); step(bus);                      // the state rail gets 0..7 over the passes; 8 is carried
      step(bus);                                       // 8..15 in pass 0..7: the state rail follows
      const rail = bus.rails.get('st');
      bus.dock('mod:sub', 'in', 'st');
      step(bus);
      const vals = seen(bus, 'sub').map(s => s[0]);
      assert.deepEqual(vals, [...vals].sort((x, y) => x - y), 'never goes backwards: ' + vals);
      assert.equal(bus.modules.get('sub').ports[0].value, rail.value);
   });

   await check('retained: undock, dock, undock, dock in one step delivers the retained value once', () => {
      const bus = bus0();
      const d = bus.addDevice({ id: 'a', outputs: { o: { kind: 'state', type: 'num' } } });
      bus.addRail({ id: 'r', kind: 'state', type: 'num' }); ok(bus.addModule('sub', SUB('state', 'num')));
      bus.dock('dev:a', 'o', 'r'); d.set('o', 7); step(bus);
      bus.dock('mod:sub', 'in', 'r'); step(bus);
      assert.equal(seen(bus, 'sub').length, 1);
      for (const f of ['undock', 'dock', 'undock', 'dock']) f === 'dock' ? ok(bus.dock('mod:sub', 'in', 'r')) : ok(bus.undock('mod:sub', 'in'));
      step(bus);
      assert.deepEqual(seen(bus, 'sub').map(s => [s[0], s[1]]), [[7, true], [7, true]]);
   });

   await check('paused: device set and emit are ignored, so nothing bursts on resume', () => {
      const bus = bus0();
      const d = bus.addDevice({ id: 'k', outputs: { e: { kind: 'event', type: 'num' }, s: { kind: 'state', type: 'num' } } });
      bus.addRail({ id: 'ev', kind: 'event', type: 'num' }); bus.addRail({ id: 'st', kind: 'state', type: 'num' });
      ok(bus.addModule('ev', SUB('event', 'num'))); ok(bus.addModule('st', SUB('state', 'num')));
      bus.dock('dev:k', 'e', 'ev'); bus.dock('dev:k', 's', 'st'); bus.dock('mod:ev', 'in', 'ev'); bus.dock('mod:st', 'in', 'st');
      d.set('s', 1); step(bus);
      bus.pause();
      for (let i = 0; i < 100; i++) d.emit('e', i);
      d.set('s', 99);
      bus.resume(); step(bus);
      assert.equal(seen(bus, 'ev').length, 0);
      assert.deepEqual(seen(bus, 'st').map(s => s[0]), [1]);
      assert.equal(bus.rails.get('st').value, 1);
      d.emit('e', 5); step(bus);
      assert.deepEqual(seen(bus, 'ev').map(s => s[0]), [5]);
   });

   await check('bus: reading the model never mutates it', () => {
      const bus = bus0();
      vecRail(bus); step(bus);
      const before = JSON.stringify([...bus.rails.values()]);
      for (let i = 0; i < 3; i++) { void [...bus.rails.values()], [...bus.modules.values()], [...bus.devices.values()]; }
      assert.equal(JSON.stringify([...bus.rails.values()]), before);
   });

   // ---- lifecycle, quarantine, versions, persistence, demo modules ----

   const fs = require('node:fs');
   const T = await load('js/scenes/rails/templates.js');
   const PAUSED = 'paused: Mod+Shift+Enter continues from here, Mod+P returns to now';
   const demoRaw = name => fs.readFileSync(`js/scenes/rails/modules/${name}.js`, 'utf8');
   const mod = (bus, id) => bus.modules.get(id);
   const COUNTER = "const time = input('time', 'state', 'time'); const S = state({ n: 0 }); time.on(() => { S.n++; });";
   const THROWER = "const time = input('time', 'state', 'time'); const out = output('out', 'state', 'num');\n" +
                   "const S = state({ n: 0, items: [] });\n" +
                   "time.on(({ n }) => { S.n++; S.items.push(n); if (n === 3) throw new Error('boom'); out.set(S.n); });";
   const FIXED = THROWER.replace("throw new Error('boom')", 'S.fixed = 1');
   const quarantined = () => {
      const bus = bus0();
      ok(bus.addModule('bad', THROWER)); ok(bus.addModule('good', COUNTER));
      ok(bus.addRail({ id: 'o', kind: 'state', type: 'num' })); ok(bus.dock('mod:bad', 'out', 'o'));
      return bus;
   };

   await check('quarantine: a throwing handler stops, its state is the checkpoint, its outputs are stale, others continue', () => {
      const bus = quarantined(); const log = logOps(bus);
      step(bus, 2);
      assert.deepEqual(mod(bus, 'bad').state, { n: 2, items: [1, 2] });
      assert.equal(bus.rails.get('o').value, 2); assert.equal(bus.rails.get('o').stale, false);
      const rev = mod(bus, 'bad').rev;
      step(bus);                                           // n = 3: the handler mutates the state, then throws
      const m = mod(bus, 'bad');
      assert.equal(m.status, 'quarantined');
      assert.equal(m.error.phase, 'handler'); assert.equal(m.error.message, 'boom'); assert.equal(m.error.line, 3);
      assert.deepEqual(m.state, { n: 2, items: [1, 2] }, 'rolled back to the checkpoint taken before the handler');
      assert.equal(bus.rails.get('o').value, 2, 'the output keeps its value'); assert.equal(bus.rails.get('o').stale, true);
      assert.ok(m.rev > rev, 'status and error bump rev');
      assert.equal(mod(bus, 'good').state.n, 3);
      const calls = m.calls;
      step(bus, 5);
      assert.equal(m.calls, calls, 'no more handlers'); assert.deepEqual(m.state, { n: 2, items: [1, 2] });
      assert.equal(mod(bus, 'good').state.n, 8, 'others never stop');
      assert.equal(m.ports.find(p => p.name === 'out').rail, 'o'); assert.equal(m.ports.find(p => p.name === 'time').rail, 'clock');
      const q = log.filter(o => o.k === 'quarantine');
      assert.equal(q.length, 1); assert.equal(q[0].n, 3); assert.equal(q[0].mod, 'bad'); assert.equal(q[0].error.message, 'boom');
      assert.deepEqual(Object.keys(q[0]).sort(), ['error', 'k', 'mod', 'n']);
   });

   await check('quarantine: what a module published before it threw is delivered, but its rail stays stale', () => {
      const bus = bus0();
      ok(bus.addRail({ id: 'o', kind: 'state', type: 'num' }));
      ok(bus.addModule('p', "const t = input('time', 'state', 'time'); const o = output('o', 'state', 'num');\nt.on(() => { o.set(5); throw new Error('after publish'); });"));
      ok(bus.addModule('sub', SUB('state', 'num'))); ok(bus.dock('mod:p', 'o', 'o')); ok(bus.dock('mod:sub', 'in', 'o'));
      step(bus);
      assert.equal(bus.rails.get('o').value, 5); assert.equal(bus.rails.get('o').stale, true);
      assert.equal(mod(bus, 'p').status, 'quarantined'); assert.deepEqual(seen(bus, 'sub').map(x => x[0]), [5]);
   });

   await check('quarantine: a quarantined module drops its inbox, and a stale rail recovers when someone else publishes', () => {
      const bus = quarantined();
      ok(bus.addModule('sub', SUB('state', 'num'))); ok(bus.dock('mod:sub', 'in', 'o'));
      const d = bus.addDevice({ id: 'k', outputs: { v: { kind: 'state', type: 'num' } } });
      step(bus, 3);
      assert.equal(bus.rails.get('o').stale, true);
      ok(bus.dock('dev:k', 'v', 'o')); d.set('v', 9); step(bus);
      assert.equal(bus.rails.get('o').stale, false); assert.equal(bus.rails.get('o').value, 9);
      const before = mod(bus, 'bad').calls;
      step(bus, 3); assert.equal(mod(bus, 'bad').calls, before);
   });

   await check('quarantine: a fixed reload recovers, the state migrated from the checkpoint', () => {
      const bus = quarantined(); step(bus, 3);
      assert.equal(mod(bus, 'bad').status, 'quarantined');
      const r = ok(bus.reload('bad', FIXED));
      assert.equal(r.ok, true);
      assert.equal(mod(bus, 'bad').status, 'quarantined', 'swapped in at the start of the next step');
      assert.equal(mod(bus, 'bad').ver, 1);
      step(bus);                                           // n = 4
      const m = mod(bus, 'bad');
      assert.equal(m.status, 'ok'); assert.equal(m.error, null); assert.equal(m.ver, 2); assert.equal(m.source, FIXED);
      assert.deepEqual(m.state, { n: 3, items: [1, 2, 4] }, 'the checkpoint state, then one tick: no double tick of the clock');
      assert.equal(bus.rails.get('o').value, 3); assert.equal(bus.rails.get('o').stale, false);
      step(bus, 2); assert.equal(m.state.n, 5);
   });

   await check('reload: a syntax error keeps the old version running and sets editError', () => {
      const bus = bus0();
      ok(bus.addModule('c', COUNTER)); step(bus, 2);
      const m = mod(bus, 'c'); const rev = m.rev;
      const r = bus.reload('c', 'const = ;');
      assert.equal(r.ok, false); assert.equal(r.error.phase, 'compile');
      assert.equal(m.editError.phase, 'compile'); assert.equal(m.editError.message, r.error.message);
      assert.ok(m.rev > rev);
      assert.equal(m.source, COUNTER); assert.equal(m.ver, 1); assert.equal(bus.queue.length, 0, 'nothing is queued: no swap');
      step(bus, 2); assert.equal(m.state.n, 4); assert.equal(m.status, 'ok');
      const s = bus.reload('c', "throw new Error('setup boom');");
      assert.equal(s.ok, false); assert.equal(s.error.phase, 'setup'); assert.equal(m.editError.message, 'setup boom');
      assert.equal(m.editError.line, 1);
      ok(bus.reload('c', COUNTER + '\n// edit')); assert.equal(m.editError, null, 'a good reload clears it');
      step(bus); assert.equal(m.ver, 2); assert.equal(m.state.n, 5);
   });

   await check('reload: the trial is real (setup errors, bad ports) but touches nothing: state, rng, ports, ranks', () => {
      const bus = bus0();
      ok(bus.addModule('c', "const time = input('time', 'state', 'time'); const S = state({ n: 0, r: 0 });\ntime.on(() => { S.n++; S.r = random(); });"));
      step(bus, 2);
      const m = mod(bus, 'c'); const rng = bus._rngs.get('c').state; const ranks = bus._rank.size; const ports = m.ports;
      ok(bus.reload('c', "const time = input('time', 'state', 'time'); const S = state({ n: 0, r: 0 }); random(); random(); output('x', 'state', 'num');\ntime.on(() => { S.n++; S.r = random(); });"));
      assert.equal(bus._rngs.get('c').state, rng, 'the trial drew from a throwaway generator');
      assert.equal(bus._rank.size, ranks, 'ports are ranked only when they are swapped in'); assert.equal(m.ports, ports);
      const before = bus._rank.size;
      assert.equal(bus.reload('c', "input('a', 'state', 'any'); input('a', 'state', 'any');").ok, false);
      assert.equal(bus.addModule('late', "output('p', 'state', 'any'); throw new Error('x');").ok, false);
      assert.equal(bus._rank.size, before, 'a failed setup allocates no rank'); assert.equal(bus.modules.has('late'), false);
   });

   await check('versions: the last 10 good sources, revert restores the previous one', () => {
      const bus = bus0();
      const src = i => COUNTER + `\n// v${i}`;
      ok(bus.addModule('c', src(1)));
      assert.equal(bus.revert('c').ok, false, 'nothing before the first version');
      for (let i = 2; i <= 13; i++) { ok(bus.reload('c', src(i))); step(bus); }
      const vs = bus.versions('c');
      assert.equal(vs.length, 10); assert.equal(vs[9].source, src(13)); assert.equal(vs[0].source, src(4));
      assert.deepEqual(vs.map(v => v.ver), [4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
      assert.equal(bus.reload('c', '!!!').ok, false);          // a bad source is never kept
      assert.equal(bus.versions('c').length, 10);
      ok(bus.revert('c')); assert.equal(mod(bus, 'c').source, src(13), 'applied at the next step');
      step(bus);
      assert.equal(mod(bus, 'c').source, src(12)); assert.equal(mod(bus, 'c').ver, 14);
      assert.equal(mod(bus, 'c').editError, null);
      assert.equal(bus.versions('c').length, 9); assert.equal(bus.versions('c')[8].source, src(12));
      ok(bus.revert('c')); step(bus); assert.equal(mod(bus, 'c').source, src(11));
   });

   await check('versions: revert recovers a quarantined module', () => {
      const bus = bus0();
      ok(bus.addModule('bad', "const time = input('time', 'state', 'time'); const S = state({ n: 0 });\ntime.on(() => { S.n++; });"));
      step(bus, 2);
      ok(bus.reload('bad', "const time = input('time', 'state', 'time'); const S = state({ n: 0 });\ntime.on(() => { S.n++; null.x; });"));
      step(bus);
      assert.equal(mod(bus, 'bad').status, 'quarantined'); assert.equal(mod(bus, 'bad').state.n, 2);
      ok(bus.revert('bad')); step(bus);
      assert.equal(mod(bus, 'bad').status, 'ok'); assert.equal(mod(bus, 'bad').error, null);
      assert.equal(mod(bus, 'bad').state.n, 3);
   });

   const PORTS = (a, b) => `const time = input('time', 'state', 'time'); const a = input('${a[0]}', '${a[1]}', 'num'); const b = input('${b[0]}', '${b[1]}', 'num');\n` +
                           "const c = output('c', 'state', 'num'); const S = state({ n: 0 }); time.on(() => { S.n++; });";
   await check('reload: a renamed port or a changed kind drops that dock, keeps the others, never throws', () => {
      const bus = bus0(); const log = logOps(bus);
      for (const id of ['ra', 'rb', 'rc']) ok(bus.addRail({ id, kind: 'state', type: 'num' }));
      ok(bus.addRail({ id: 're', kind: 'event', type: 'num' }));
      ok(bus.addModule('m', PORTS(['a', 'state'], ['b', 'state'])));
      ok(bus.dock('mod:m', 'a', 'ra')); ok(bus.dock('mod:m', 'b', 'rb')); ok(bus.dock('mod:m', 'c', 'rc')); step(bus, 2);
      ok(bus.reload('m', PORTS(['a2', 'state'], ['b', 'event'])));
      log.length = 0; step(bus);
      const m = mod(bus, 'm'); const dock = n => m.ports.find(p => p.name === n).rail;
      assert.equal(dock('a2'), null); assert.equal(dock('b'), null); assert.equal(dock('c'), 'rc'); assert.equal(dock('time'), 'clock');
      const undocks = log.filter(o => o.k === 'undock');
      assert.deepEqual(undocks.map(o => [o.port, o.rail, o.reason]).sort(), [['a', 'ra', 'orphaned'], ['b', 'rb', 'orphaned']]);
      assert.equal(log.filter(o => o.k === 'reload').length, 1); assert.deepEqual(log.find(o => o.k === 'reload'), { k: 'reload', n: bus.n, mod: 'm', ver: 2, source: PORTS(['a2', 'state'], ['b', 'event']) });
      assert.equal(bus.notices.length, 0, 'a manual bus says nothing about a dropped dock');
      assert.equal(m.status, 'ok'); assert.equal(m.state.n, 3);
      assert.equal(bus.rails.get('rc').stale, false);
      ok(bus.dock('mod:m', 'b', 're'));                      // the changed-kind port docks to a rail of the new kind
      step(bus, 2);
      for (let i = 0; i < 12; i++) { ok(bus.reload('m', PORTS(['a', 'state'], ['b', 'event']))); step(bus); ok(bus.dock('mod:m', 'a', 'ra')); ok(bus.reload('m', PORTS(['a2', 'state'], ['b', 'event']))); step(bus); }
      assert.equal(bus.notices.length, 0);
   });

   await check('notices: the last 8 are kept, numbered upwards', async () => {
      const LC = await load('js/scenes/rails/lifecycle.js'), bus = bus0();
      for (let i = 0; i < 12; i++) LC.notice(bus, `n${i}`);
      assert.equal(bus.notices.length, 8, 'the last 8 are kept');
      assert.deepEqual(bus.notices.map(x => x.text), ['n4', 'n5', 'n6', 'n7', 'n8', 'n9', 'n10', 'n11']);
      assert.ok(bus.notices.every((x, i, all) => typeof x.id === 'number' && x.n === bus.n && (i === 0 || x.id > all[i - 1].id)));
   });

   await check('reload: matching ports keep their docks and an output keeps its value; the retained value is handed to a docked input', () => {
      const bus = bus0();
      const d = bus.addDevice({ id: 'g', outputs: { v: { kind: 'state', type: 'num' } } });
      ok(bus.addRail({ id: 'r', kind: 'state', type: 'num' })); ok(bus.addRail({ id: 'o', kind: 'state', type: 'num' }));
      const SRC = tag => `const v = input('v', 'state', 'num'); const o = output('o', 'state', 'num'); const S = state({ got: [] });\nv.on((x, m) => { S.got.push([x, m.retained]); o.set(x * 2); }); // ${tag}`;
      ok(bus.addModule('m', SRC('a'))); ok(bus.dock('dev:g', 'v', 'r')); ok(bus.dock('mod:m', 'v', 'r')); ok(bus.dock('mod:m', 'o', 'o'));
      d.set('v', 4); step(bus, 2);
      ok(bus.reload('m', SRC('b'))); step(bus);
      const m = mod(bus, 'm');
      assert.deepEqual(m.state.got, [[4, false], [4, true]], 'the new version is handed the retained value');
      assert.equal(m.ports.find(p => p.name === 'v').value, 4);
      assert.equal(m.ports.find(p => p.name === 'o').value, 8); assert.equal(bus.rails.get('o').stale, false);
      assert.equal(bus.rails.get('r').by, 'dev:g.v');
   });

   await check('reload: resetState takes the defaults; module order, and so delivery order, survives a reload', () => {
      const bus = bus0();
      const d = bus.addDevice({ id: 'e', outputs: { x: { kind: 'event', type: 'num' } } });
      ok(bus.addRail({ id: 'ev', kind: 'event', type: 'num' })); ok(bus.dock('dev:e', 'x', 'ev'));
      const ORDER = tag => `const i = input('x', 'event', 'num'); const o = output('seen', 'event', 'num'); i.on(v => { o.emit(${tag}); }); // ${tag}\n`;
      ok(bus.addRail({ id: 'out', kind: 'event', type: 'num' }));
      ok(bus.addModule('first', ORDER(1))); ok(bus.addModule('second', ORDER(2)));
      for (const id of ['first', 'second']) { ok(bus.dock(`mod:${id}`, 'x', 'ev')); ok(bus.dock(`mod:${id}`, 'seen', 'out')); }
      ok(bus.reload('first', ORDER(1) + ' ')); step(bus);
      d.emit('x', 0); step(bus);
      assert.deepEqual(bus.rails.get('out').tail.map(t => t.v), [1, 2], 'first is still called before second');
      const c = bus0(); ok(c.addModule('c', "const S = state({ n: 5, keep: 1 });")); mod(c, 'c').state.n = 9; mod(c, 'c').state.keep = 7;
      ok(c.reload('c', "const S = state({ n: 5, keep: 1 });")); c.step(); assert.deepEqual(mod(c, 'c').state, { n: 9, keep: 7 });
      ok(c.reload('c', "const S = state({ n: 5, keep: 1 });", { resetState: true })); c.step(); assert.deepEqual(mod(c, 'c').state, { n: 5, keep: 1 });
      ok(c.reload('c', "const S = state({ n: 'x', other: 2 });")); c.step(); assert.deepEqual(mod(c, 'c').state, { n: 'x', other: 2 }, 'retyped and new keys take defaults');
   });

   await check('quarantine: Date.now() in a handler quarantines with the teaching message', () => {
      const bus = bus0();
      ok(bus.addModule('d', "const time = input('time', 'state', 'time');\ntime.on(() => { Date.now(); });"));
      assert.equal(mod(bus, 'd').status, 'ok'); step(bus);
      assert.equal(mod(bus, 'd').status, 'quarantined');
      assert.match(mod(bus, 'd').error.message, /time input/); assert.equal(mod(bus, 'd').error.line, 2);
      ok(bus.addModule('r', "const time = input('time', 'state', 'time');\ntime.on(() => { Math.random(); });")); step(bus);
      assert.match(mod(bus, 'r').error.message, /random\(\)/);
   });

   await check('quarantine: a bad publish in a handler quarantines with phase publish', () => {
      const bus = bus0();
      ok(bus.addModule('b', "const time = input('time', 'state', 'time'); const o = output('o', 'state', 'num');\ntime.on(({ n }) => { o.set(n < 2 ? n : NaN); });"));
      ok(bus.addModule('g', COUNTER));
      step(bus, 2);
      assert.equal(mod(bus, 'b').status, 'quarantined'); assert.equal(mod(bus, 'b').error.phase, 'publish');
      assert.equal(mod(bus, 'g').state.n, 2);
   });

   await check('quarantine: runaway publishers and runaway receivers are quarantined while others step', () => {
      const bus = bus0();
      ok(bus.addRail({ id: 'loop', kind: 'event', type: 'num' }));
      // each message sent makes ten more, so the passes grow 1, 10, 100, 1000 and then break the 2000 budget
      ok(bus.addModule('amp', "const time = input('time', 'state', 'time'); const i = input('in', 'event', 'num'); const o = output('out', 'event', 'num');\n" +
                              "time.on(() => { o.emit(1); }); i.on(() => { for (let k = 0; k < 10; k++) o.emit(1); });"));
      ok(bus.addModule('good', COUNTER));
      ok(bus.dock('mod:amp', 'in', 'loop')); ok(bus.dock('mod:amp', 'out', 'loop'));
      step(bus);
      const m = mod(bus, 'amp');
      assert.equal(m.status, 'quarantined'); assert.match(m.error.message, /runaway/);
      assert.equal(mod(bus, 'good').state.n, 1, 'the others kept stepping');
      const calls = m.calls; step(bus, 3); assert.equal(m.calls, calls); assert.equal(mod(bus, 'good').state.n, 4);
      // a receiver that is sent more than 2000 messages in one step is the runaway, not the three publishers
      const b2 = bus0();
      ok(b2.addRail({ id: 'flood', kind: 'event', type: 'num' }));
      const PUB = "const time = input('time', 'state', 'time'); const o = output('o', 'event', 'num');\ntime.on(() => { for (let k = 0; k < 900; k++) o.emit(k); });";
      for (const id of ['p1', 'p2', 'p3']) { ok(b2.addModule(id, PUB)); ok(b2.dock(`mod:${id}`, 'o', 'flood')); }
      ok(b2.addModule('sink', "const i = input('e', 'event', 'num'); const S = state({ n: 0 }); i.on(() => { S.n++; });")); ok(b2.dock('mod:sink', 'e', 'flood'));
      step(b2);
      assert.equal(mod(b2, 'sink').status, 'quarantined'); assert.match(mod(b2, 'sink').error.message, /runaway handler/);
      assert.equal(mod(b2, 'sink').state.n, 0, 'state restored to the checkpoint'); assert.equal(mod(b2, 'sink').calls, 2000);
      assert.deepEqual(['p1', 'p2', 'p3'].map(id => mod(b2, id).status), ['ok', 'ok', 'ok']);
   });

   await check('random: two buses with the same seed give the same sequence, per module, and another seed differs', () => {
      const RAND = "const time = input('time', 'state', 'time'); const S = state({ r: [] });\ntime.on(() => { S.r.push(random()); });";
      const run = (seed, id = 'm') => { const bus = bus0({ seed }); ok(bus.addModule(id, RAND)); step(bus, 5); return mod(bus, id).state.r; };
      assert.deepEqual(run(7), run(7)); assert.notDeepEqual(run(7), run(8)); assert.notDeepEqual(run(7), run(7, 'n'));
      assert.ok(run(7).every(x => x >= 0 && x < 1));
   });

   await check('paused: addModule, reload, revert and commit are refused with the reason; stage and removal queue', () => {
      const bus = bus0();
      ok(bus.addModule('c', COUNTER)); ok(bus.reload('c', COUNTER + '\n//2')); step(bus);
      bus.pause();
      for (const r of [bus.addModule('n', COUNTER), bus.reload('c', COUNTER), bus.revert('c'), bus.commit('c')]) {
         assert.equal(r.ok, false); assert.equal(r.reason, PAUSED);
      }
      assert.equal(bus.modules.has('n'), false); assert.equal(mod(bus, 'c').ver, 2);
      const s = bus.stage('c', COUNTER + '\n//3'); assert.equal(s.ok, true, 'staging is compile only and is allowed');
      assert.equal(bus.commit('c').reason, PAUSED);
      bus.resume();
      ok(bus.commit('c')); step(bus); assert.equal(mod(bus, 'c').ver, 3); assert.equal(mod(bus, 'c').source, COUNTER + '\n//3');
   });

   await check('stage and commit: stage keeps a compiled candidate, commit is a reload with it', () => {
      const bus = bus0();
      ok(bus.addModule('c', COUNTER));
      assert.equal(bus.commit('c').ok, false, 'nothing staged');
      const bad = bus.stage('c', 'const = ;'); assert.equal(bad.ok, false); assert.equal(bad.error.phase, 'compile');
      assert.equal(mod(bus, 'c').editError.phase, 'compile'); assert.equal(bus.commit('c').ok, false);
      ok(bus.stage('c', COUNTER + '\n// staged')); assert.equal(mod(bus, 'c').editError, null);
      assert.equal(mod(bus, 'c').source, COUNTER); assert.equal(bus.queue.length, 0);
      ok(bus.commit('c')); assert.equal(mod(bus, 'c').source, COUNTER, 'swapped in at the next step');
      step(bus); assert.equal(mod(bus, 'c').source, COUNTER + '\n// staged'); assert.equal(mod(bus, 'c').ver, 2);
      assert.equal(bus.commit('c').ok, false, 'a candidate is committed once');
      assert.equal(bus.stage('nope', COUNTER).ok, false);
   });

   await check('modules: removeModule and renameModule are queued, validated, and carry docks', () => {
      const bus = bus0();
      ok(bus.addRail({ id: 'o', kind: 'state', type: 'num' })); ok(bus.addModule('a', THROWER)); ok(bus.addModule('b', COUNTER));
      ok(bus.dock('mod:a', 'out', 'o')); step(bus, 2);
      assert.equal(bus.renameModule('a', 'b').ok, false); assert.equal(bus.renameModule('a', 'Bad').ok, false);
      assert.equal(bus.renameModule('zz', 'x').ok, false); assert.equal(bus.removeModule('zz').ok, false);
      const log = logOps(bus);
      ok(bus.renameModule('a', 'alpha')); assert.ok(mod(bus, 'a'), 'applied at the next step');
      step(bus);
      assert.equal(mod(bus, 'a'), undefined); const m = mod(bus, 'alpha');
      assert.equal(m.id, 'alpha'); assert.equal(m.ports.find(p => p.name === 'out').owner, 'mod:alpha');
      assert.equal(bus.rails.get('o').by, 'mod:alpha.out');
      assert.equal(m.ports.find(p => p.name === 'out').rail, 'o');
      assert.equal(m.status, 'quarantined', 'the handler threw in the step that renamed it');
      assert.equal(m.error.line, 3, 'the line is still found after a rename'); assert.deepEqual(m.state, { n: 2, items: [1, 2] });
      ok(bus.removeModule('alpha')); step(bus);
      assert.equal(bus.modules.has('alpha'), false); assert.equal(bus.rails.get('o').stale, true);
      assert.equal(bus._ports.has('mod:alpha.out'), false); assert.equal(bus._docked.get('o').size, 0);
      assert.ok(log.some(o => o.k === 'undock' && o.owner === 'mod:alpha' && o.port === 'out'));
      ok(bus.addModule('alpha', COUNTER)); step(bus);         // the name is free again
   });

   await check('rev: grows with ver, status, error, editError, ports, draw and logs, and not with calls', () => {
      const bus = bus0();
      ok(bus.addModule('m', "const time = input('time', 'state', 'time'); const S = state({ k: 0 });\ntime.on(({ n }) => { S.k++; draw([{ shape: 'sphere', p: [n < 3 ? 0 : .1, 0, 0], s: .01, color: '#fff' }]); if (n === 2) log('two'); if (n === 5) throw new Error('x'); });"));
      const m = mod(bus, 'm'); const seq = [];
      for (let i = 0; i < 6; i++) { const r = m.rev, c = m.calls; step(bus); seq.push([m.rev - r, m.calls - c]); }
      assert.ok(seq[0][0] > 0, 'the first draw'); assert.equal(seq[1][0] > 0, true, 'a log line');
      assert.equal(seq[2][0] > 0, true, 'a changed draw'); assert.equal(seq[3][0], 0, 'an unchanged draw'); assert.equal(seq[3][1], 1, 'calls do not count');
      assert.ok(seq[4][0] > 0, 'quarantine: status and error');
      const r1 = m.rev; bus.reload('m', 'const = ;'); assert.ok(m.rev > r1, 'editError');
      const r2 = m.rev; ok(bus.reload('m', "const o = output('x', 'state', 'any');")); assert.equal(m.rev, r2 + 1, 'a queued reload changes nothing yet but clears the editError'); assert.equal(m.editError, null); assert.equal(m.ports.length, 1);
      step(bus); assert.ok(m.rev > r2, 'ver and ports');
   });

   await check('ruling 6: on() outside setup throws; a handler that calls it is quarantined', () => {
      const bus = bus0();
      ok(bus.addModule('m', "const time = input('time', 'state', 'time');\ntime.on(() => { time.on(() => {}); });"));
      step(bus);
      assert.equal(mod(bus, 'm').status, 'quarantined'); assert.match(mod(bus, 'm').error.message, /on\(\).*setup|top level/);
   });

   await check('ruling 6: an input named time must be state and time', () => {
      for (const [kind, type] of [['event', 'time'], ['state', 'num'], ['state', 'any']]) {
         const bus = bus0(); const r = bus.addModule('t', `input('time', '${kind}', '${type}');`);
         assert.equal(r.ok, false, `${kind}/${type}`); assert.equal(r.error.phase, 'setup'); assert.match(r.error.message, /time/);
      }
      const bus = bus0(); ok(bus.addModule('t', COUNTER));
      assert.equal(bus.reload('t', "input('time', 'event', 'time');").ok, false);
      ok(bus.addModule('ok', "output('time', 'state', 'num'); input('time2', 'state', 'any');"));
   });

   await check('ruling 6: a throwing onOp or onStep hook cannot abort a step', () => {
      const bus = bus0(); let ops = 0, steps = 0;
      bus.onOp(() => { ops++; throw new Error('op hook'); }); bus.onStep(() => { steps++; throw new Error('step hook'); });
      const seenOps = logOps(bus), seenSteps = []; bus.onStep(s => seenSteps.push(s.n));
      ok(bus.addModule('c', COUNTER)); ok(bus.addRail({ id: 'r', kind: 'state', type: 'num' }));
      step(bus, 3);
      assert.equal(bus.n, 3); assert.equal(mod(bus, 'c').state.n, 3); assert.ok(ops > 0);
      assert.equal(steps, 3); assert.deepEqual(seenSteps, [1, 2, 3], 'the hooks after a throwing one still run');
      assert.ok(seenOps.length > 0);
   });

   await check('layout: layout() and restore() round-trip', () => {
      const gaze = { id: 'gaze', outputs: { hit: { kind: 'state', type: 'vec3' } } };
      const bus = bus0({ seed: 5 }); bus.addDevice(gaze);
      ok(bus.addRail({ id: 'target', kind: 'state', type: 'vec3' })); ok(bus.addRail({ id: 'planted', kind: 'event', type: 'num' }));
      for (const n of ['oscillator', 'ball', 'flowers']) ok(bus.addModule(n, demoRaw(n)));
      ok(bus.dock('mod:oscillator', 'target', 'target')); ok(bus.dock('mod:ball', 'target', 'target')); ok(bus.dock('mod:flowers', 'target', 'target'));
      ok(bus.dock('mod:flowers', 'planted', 'planted')); ok(bus.dock('dev:gaze', 'hit', 'target'));
      step(bus, 30);
      const layout = layoutOf(bus);
      assert.deepEqual(Object.keys(layout).sort(), ['docks', 'modules', 'rails', 'unplugged', 'uses']);
      assert.deepEqual(layout.rails, { target: { kind: 'state', type: 'vec3' }, planted: { kind: 'event', type: 'num' } });
      assert.deepEqual(Object.keys(layout.modules), ['oscillator', 'ball', 'flowers']); assert.equal(layout.modules.ball, demoRaw('ball'));
      assert.ok(layout.docks.every(d => d.length === 3 && d.every(x => typeof x === 'string')));
      assert.ok(layout.docks.some(d => d.join() === 'mod:ball,target,target')); assert.ok(layout.docks.some(d => d.join() === 'mod:ball,time,clock'));
      const copy = JSON.parse(JSON.stringify(layout));
      const b2 = bus0({ seed: 5 }); b2.addDevice(gaze);
      const r = b2.restore(copy); assert.equal(r.ok, true, JSON.stringify(r));
      assert.deepEqual(layoutOf(b2), layout);
      step(b2, 90);
      assert.ok(mod(b2, 'ball').state.p[0] !== 0 || mod(b2, 'ball').state.p[2] !== 0, 'the restored world runs');
      assert.equal(bus0().restore({ rails: {}, modules: {}, docks: [] }).ok, true);
      assert.equal(b2.restore(layout).ok, false, 'restore needs a fresh bus');
      const b3 = bus0(); b3.addDevice(gaze);
      const bad = b3.restore({ rails: { x: { kind: 'state', type: 'num' } }, modules: { broken: 'const = ;', c: COUNTER }, docks: [['mod:c', 'time', 'clock'], ['mod:broken', 'time', 'clock'], ['mod:c', 'nope', 'x']] });
      assert.equal(bad.ok, false); assert.ok(bad.errors.length >= 2); assert.ok(b3.modules.has('c') && !b3.modules.has('broken'));
      assert.equal(mod(b3, 'c').ports[0].rail, 'clock');
   });

   await check('layout: an undocked time input stays undocked across restore', () => {
      const bus = bus0(); ok(bus.addModule('c', COUNTER)); step(bus); ok(bus.undock('mod:c', 'time')); step(bus);
      const b2 = bus0(); ok(b2.restore(layoutOf(bus))); step(b2, 3);
      assert.equal(mod(b2, 'c').state.n, 0); assert.equal(mod(b2, 'c').ports[0].rail, null);
   });

   const world = () => {
      const bus = bus0({ seed: 11 });
      const dev = bus.addDevice({ id: 'gaze', outputs: { hit: { kind: 'state', type: 'vec3' } } });
      ok(bus.addRail({ id: 'target', kind: 'state', type: 'vec3' })); ok(bus.addRail({ id: 'planted', kind: 'event', type: 'num' }));
      for (const n of ['oscillator', 'ball', 'flowers', 'constant']) ok(bus.addModule(n, demoRaw(n)));
      for (const n of ['oscillator', 'ball', 'flowers']) ok(bus.dock(`mod:${n}`, 'target', 'target'));
      ok(bus.dock('mod:flowers', 'planted', 'planted'));
      ok(bus.addModule('count', "const e = input('p', 'event', 'num'); const S = state({ n: 0 }); e.on(v => { S.n = v; });")); ok(bus.dock('mod:count', 'p', 'planted'));
      return { bus, dev };
   };
   const drive = (w, from, to) => { for (let i = from; i < to; i++) { if (i % 7 === 0) w.dev.set('hit', [Math.sin(i) * .1, 0, Math.cos(i) * .1]); w.bus.step(); } };

   await check('snapshot: shape, and restoreSnapshot into a fresh bus mid-run gives the same next 100 steps', () => {
      const a = world();
      ok(a.bus.dock('dev:gaze', 'hit', 'target'));
      drive(a, 0, 97);
      ok(a.bus.undock('mod:oscillator', 'target')); ok(a.bus.undock('mod:count', 'p')); a.bus.step();   // docks dropped before the snapshot
      const snap = a.bus.snapshot(); const layout = layoutOf(a.bus);
      assert.deepEqual(Object.keys(snap).sort(), ['devices', 'docks', 'modules', 'n', 'rails', 't', 'unplugged', 'uses']);
      assert.equal(snap.n, a.bus.n); assert.equal(snap.t, a.bus.n * B.DT);
      assert.deepEqual(Object.keys(snap.rails.target).sort(), ['by', 'contested', 'kind', 'seq', 'stale', 'type', 'value', 'writers']);
      assert.deepEqual(Object.keys(snap.modules.ball).sort(), ['draw', 'rng', 'state', 'status', 'ver']);
      assert.deepEqual(Object.keys(snap.modules.constant).sort(), ['draw', 'outs', 'rng', 'state', 'status', 'ver'], 'a module whose output has a value keeps it');
      assert.equal(snap.modules.flowers.rng, a.bus._rngs.get('flowers').state); assert.equal(snap.modules.ball.status, 'ok');
      assert.ok(snap.docks.some(d => d.join() === 'dev:clock,time,clock'));
      assert.deepEqual(snap.rails.clock.value, a.bus.rails.get('clock').value);
      assert.ok(snap.rails.target.seq > 50 && snap.modules.flowers.state.flowers.length > 0);
      assert.notEqual(snap.modules.flowers.state, a.bus.modules.get('flowers').state, 'a copy, not the live object');
      const wire = JSON.parse(JSON.stringify(snap));
      const b = { bus: bus0({ seed: 11 }) };
      b.dev = b.bus.addDevice({ id: 'gaze', outputs: { hit: { kind: 'state', type: 'vec3' } } });
      const r = b.bus.restoreSnapshot(wire, layout); assert.equal(r.ok, true, JSON.stringify(r));
      assert.deepEqual(b.bus.snapshot(), snap, 'the restored bus is the snapshot');
      drive(a, 98, 198); drive(b, 98, 198);
      assert.deepEqual(JSON.parse(JSON.stringify(b.bus.snapshot())), JSON.parse(JSON.stringify(a.bus.snapshot())));
      for (const id of ['ball', 'flowers', 'count']) {
         assert.deepEqual(mod(b.bus, id).state, mod(a.bus, id).state, id);
         assert.deepEqual(mod(b.bus, id).draw, mod(a.bus, id).draw, id);
      }
      assert.equal(mod(a.bus, 'count').state.n > 0, true);
      assert.equal(a.bus.restoreSnapshot(snap, layout).ok, false, 'needs a fresh bus');
   });

   await check('snapshot: set and emit during the setup of a restore are ignored; quarantine and ver are restored', () => {
      const SETUP = "const t = input('time', 'state', 'time'); const o = output('o', 'state', 'num'); const e = output('e', 'event', 'num');\nconst S = state({ n: 1 }); o.set(99); e.emit(1);\nt.on(() => { S.n++; null.x; });";
      const a = bus0();
      ok(a.addRail({ id: 'r', kind: 'state', type: 'num' })); ok(a.addRail({ id: 'ev', kind: 'event', type: 'num' }));
      ok(a.addModule('m', SETUP)); assert.equal(mod(a, 'm').ports.find(p => p.name === 'o').value, 99, 'an ordinary setup keeps a set value');
      ok(a.dock('mod:m', 'o', 'r')); ok(a.dock('mod:m', 'e', 'ev')); step(a, 2);
      assert.equal(a.rails.get('r').value, 99); assert.equal(a.rails.get('ev').seq, 0, 'an emit during setup had no rail to go to');
      ok(a.reload('m', SETUP + '\n')); step(a);
      const snap = JSON.parse(JSON.stringify(a.snapshot())); assert.equal(snap.modules.m.status, 'quarantined'); assert.equal(snap.modules.m.ver, 2);
      snap.rails.r.value = 5;                                // the snapshot, not the setup, says what the rail holds
      const b = bus0(); const log = logOps(b);
      ok(b.restoreSnapshot(snap, layoutOf(a)));
      step(b, 3);
      assert.equal(b.rails.get('r').value, 5); assert.equal(b.rails.get('r').seq, snap.rails.r.seq); assert.equal(b.rails.get('ev').seq, 0);
      assert.equal(mod(b, 'm').ports.find(p => p.name === 'o').value, 5);
      assert.equal(mod(b, 'm').status, 'quarantined'); assert.equal(mod(b, 'm').ver, 2); assert.equal(b.n, snap.n + 3);
      assert.deepEqual(mod(b, 'm').state, snap.modules.m.state);
      assert.equal(mod(b, 'm').calls, 0);
      assert.equal(log.filter(o => o.k === 'pub' && o.rail !== 'clock').length, 0);
      const c = bus0(); const missing = c.restoreSnapshot(snap, { rails: {}, modules: {}, docks: [] });
      assert.equal(missing.ok, false); assert.ok(missing.errors.length > 0);
   });

   await check('demo modules: all four compile and run; ball follows the oscillator; flowers emit planted', () => {
      const { bus } = world();
      for (const n of ['oscillator', 'ball', 'flowers', 'constant']) { assert.equal(mod(bus, n).status, 'ok'); assert.equal(mod(bus, n).error, null); }
      const planted = []; bus.onOp(o => { if (o.k === 'pub' && o.rail === 'planted') planted.push(o.v); });
      // The demo modules are files the user edits from the headset (the speed has been changed there), so this checks how they
      // behave, not their numbers: the phase grows evenly with time and the target follows it.
      step(bus, 75);
      const half = mod(bus, 'oscillator').state.phase;
      step(bus, 75);
      const osc = mod(bus, 'oscillator').state, ball = mod(bus, 'ball').state, tgt = bus.rails.get('target').value;
      assert.equal(tgt.length, 3);
      assert.ok(Math.abs(tgt[0]) <= .15 + 1e-9 && tgt[1] === 0 && Math.abs(tgt[2]) <= .12 + 1e-9, 'inside the mat');
      assert.ok(half > 0, 'the phase grows'); near(osc.phase, 2 * half);
      near(tgt[0], Math.sin(osc.phase) * .15); near(tgt[2], Math.cos(osc.phase * .7) * .12);
      assert.ok(Math.hypot(ball.p[0] - tgt[0], ball.p[2] - tgt[2]) < .06, 'the ball is close to the target');
      assert.ok(Math.abs(ball.p[0]) > .001, 'and has moved'); near(ball.p[1], .015);
      const draw = mod(bus, 'ball').draw; assert.equal(draw.length, 1);
      assert.equal(draw[0].shape, 'sphere'); assert.equal(draw[0].s, .015); assert.match(draw[0].color, /^#[0-9a-f]{3,6}$/i, 'a colour (the demo changes it)');
      assert.ok(planted.length >= 2 && planted.length <= 25, `flowers planted while the target moves, a few a second: ${planted.length}`);
      assert.deepEqual(planted, planted.map((_, i) => i + 1), 'planted counts up');
      const fl = mod(bus, 'flowers'); assert.ok(fl.state.flowers.length >= 4 && fl.state.flowers.length <= 40);
      assert.ok(fl.draw.length === fl.state.flowers.length && fl.draw.every(s => s.shape === 'sphere' && s.s <= .02 + 1e-9));
      assert.ok(fl.state.flowers.every(f => ['#ff66aa', '#ffdd55', '#99ccff'].includes(f.c)));
      assert.equal(mod(bus, 'count').state.n, planted.length);
      step(bus, 60 * 40);
      assert.equal(fl.state.flowers.length, 40, 'at most 40 are kept'); assert.equal(mod(bus, 'flowers').status, 'ok');
   });

   await check('demo modules: the constant publishes [0,0,0] once; the oscillator can be swapped for it', () => {
      const bus = bus0();
      ok(bus.addRail({ id: 'target', kind: 'state', type: 'vec3' }));
      ok(bus.addModule('constant', demoRaw('constant'))); ok(bus.addModule('ball', demoRaw('ball')));
      ok(bus.dock('mod:constant', 'center', 'target')); ok(bus.dock('mod:ball', 'target', 'target'));
      step(bus, 3);
      assert.deepEqual([...bus.rails.get('target').value], [0, 0, 0]); assert.equal(bus.rails.get('target').seq, 1, 'set once');
      assert.deepEqual(mod(bus, 'ball').state.p, [0, .015, 0]);
      ok(bus.addModule('oscillator', demoRaw('oscillator'))); ok(bus.dock('mod:oscillator', 'target', 'target')); step(bus, 30);
      assert.ok(bus.rails.get('target').seq > 20 && bus.rails.get('target').by === 'mod:oscillator.target');
   });

   await check('templates: skeleton(name) compiles, runs, and has a time input, a state output named after the card and a draw', () => {
      const src = T.skeleton('my_mod');
      assert.equal(typeof src, 'string'); assert.match(src, /my_mod/); assert.match(src, /\/\//);
      assert.match(src, /input\('time', 'state', 'time'\)/); assert.match(src, /output\('my_mod', 'state', 'num'\)/); assert.match(src, /draw\(/);
      const bus = bus0(); ok(bus.addModule('my_mod', src)); step(bus, 3);
      const m = mod(bus, 'my_mod'); assert.equal(m.status, 'ok');
      assert.deepEqual(m.ports.map(p => [p.name, p.dir, p.kind]), [['time', 'in', 'state'], ['my_mod', 'out', 'state']]);
      assert.ok(m.draw.length >= 1 && m.calls === 3);
      assert.notEqual(T.skeleton('other'), src);
      assert.doesNotThrow(() => T.skeleton('weird\nname*/'));
      // two new cards publish two variables: neither contests the other
      const two = new B.Bus(); ok(two.addModule('one', T.skeleton('one'))); ok(two.addModule('two', T.skeleton('two'))); step(two, 3);
      assert.ok(two.rails.has('one') && two.rails.has('two') && !two.rails.has('out'));
      assert.equal(two.rails.get('one').contested, false); assert.equal(two.rails.get('two').contested, false);
   });

   // ---- layouts taken mid-run, quarantine of bad state, recovery by reload or revert, the first time call ----

   await check('a layout taken right after addModule keeps the time dock, so a restored module ticks', () => {
      const bus = bus0(); ok(bus.addModule('c', COUNTER));
      const layout = layoutOf(bus);
      assert.ok(layout.docks.some(d => d.join() === 'mod:c,time,clock'));
      const b2 = bus0(); ok(b2.restore(layout));
      step(bus, 3); step(b2, 3);
      assert.equal(mod(bus, 'c').state.n, 3); assert.equal(mod(b2, 'c').state.n, 3);
   });

   const BADSTATE = body => "const time = input('time', 'state', 'time'); const S = state({ n: 0, o: {} });\n" +
                            `time.on(({ n }) => { S.n++; if (n === 2) { ${body} } });`;
   await check('a cyclic state quarantines, rolls back to the checkpoint, and snapshot() succeeds', () => {
      const bus = bus0(); ok(bus.addModule('c', BADSTATE('S.o.self = S.o;'))); ok(bus.addModule('good', COUNTER));
      step(bus);
      assert.deepEqual(mod(bus, 'c').state, { n: 1, o: {} });
      step(bus);
      const m = mod(bus, 'c');
      assert.equal(m.status, 'quarantined'); assert.match(m.error.message, /state/); assert.equal(m.error.phase, 'handler');
      assert.deepEqual(m.state, { n: 1, o: {} }, 'rolled back to the last valid checkpoint');
      let snap; assert.doesNotThrow(() => { snap = bus.snapshot(); });
      assert.deepEqual(snap.modules.c.state, { n: 1, o: {} }); assert.equal(snap.modules.c.status, 'quarantined');
      step(bus, 3); assert.equal(mod(bus, 'good').state.n, 5, 'others continue');
      assert.doesNotThrow(() => JSON.stringify(bus.snapshot()));
   });

   await check('NaN or a state over 16 KB quarantines with a clear message', () => {
      for (const [body, rx] of [['S.n = NaN;', /not a finite number/], ["S.o.big = 'x'.repeat(20000);", /16384|bytes/]]) {
         const bus = bus0(); ok(bus.addModule('c', BADSTATE(body))); step(bus, 2);
         const m = mod(bus, 'c');
         assert.equal(m.status, 'quarantined', body); assert.match(m.error.message, rx);
         assert.deepEqual(m.state, { n: 1, o: {} }); assert.doesNotThrow(() => bus.snapshot());
         ok(bus.reload('c', BADSTATE('void 0;'))); step(bus);
         assert.equal(m.status, 'ok'); assert.equal(m.state.n, 2, 'recovers from the checkpoint');
      }
   });

   await check('a setup that leaves an invalid state is a setup error, and a state mutated outside any checkpoint cannot break snapshot()', () => {
      const bus = bus0();
      const r = bus.addModule('c', "const S = state({ o: {} }); S.o.self = S.o;");
      assert.equal(r.ok, false); assert.equal(r.error.phase, 'setup'); assert.match(r.error.message, /state/);
      ok(bus.addModule('d', "const S = state({ a: 1 });")); mod(bus, 'd').state.loop = mod(bus, 'd').state;   // a host or test poking at it
      assert.doesNotThrow(() => bus.snapshot());
   });

   await check('a rail is live again when its publisher recovers by reload or revert', () => {
      const bus = quarantined(); step(bus, 3);
      assert.equal(bus.rails.get('o').stale, true);
      ok(bus.reload('bad', "const time = input('time', 'state', 'time'); const out = output('out', 'state', 'num'); const S = state({ n: 0, items: [] });"));
      step(bus);
      assert.equal(mod(bus, 'bad').status, 'ok'); assert.equal(bus.rails.get('o').stale, false, 'live without a new publish');
      assert.equal(bus.rails.get('o').value, 2);
      const b2 = bus0();
      ok(b2.addRail({ id: 'o', kind: 'state', type: 'num' }));
      ok(b2.addModule('m', "const time = input('time', 'state', 'time'); const o = output('o', 'state', 'num');\ntime.on(({ n }) => { if (n === 2) null.x; if (n < 2) o.set(n); });"));
      ok(b2.dock('mod:m', 'o', 'o')); step(b2, 2);
      assert.equal(b2.rails.get('o').stale, true);
      ok(b2.reload('m', "const time = input('time', 'state', 'time'); const o = output('o', 'state', 'num');")); step(b2);
      ok(b2.reload('m', "const time = input('time', 'state', 'time'); const o = output('o', 'state', 'num');\ntime.on(() => { null.x; });")); step(b2);
      assert.equal(b2.rails.get('o').stale, true, 'quarantined again');
      ok(b2.revert('m')); step(b2);
      assert.equal(mod(b2, 'm').status, 'ok'); assert.equal(b2.rails.get('o').stale, false);
      const b3 = bus0(); ok(b3.addRail({ id: 'o', kind: 'state', type: 'num' }));       // an undocked publisher stays stale
      const d = b3.addDevice({ id: 'k', outputs: { v: { kind: 'state', type: 'num' } } }); ok(b3.dock('dev:k', 'v', 'o')); d.set('v', 1); step(b3);
      ok(b3.undock('dev:k', 'v')); ok(b3.addModule('m', "output('x', 'state', 'num');")); step(b3);
      ok(b3.reload('m', "output('x', 'state', 'num');")); step(b3);
      assert.equal(b3.rails.get('o').stale, true);
   });

   await check('a module added or reloaded mid-run sees exactly one time call in its first step', () => {
      const bus = bus0(); step(bus, 5);
      const SRC = "const time = input('time', 'state', 'time'); const S = state({ got: [] }); time.on(({ n }) => { S.got.push(n); });";
      ok(bus.addModule('late', SRC)); step(bus);
      assert.deepEqual(mod(bus, 'late').state.got, [6]);
      ok(bus.reload('late', SRC + '\n')); step(bus);
      assert.deepEqual(mod(bus, 'late').state.got, [6, 7]);
      ok(bus.undock('mod:late', 'time')); step(bus); ok(bus.dock('mod:late', 'time', 'clock')); step(bus);
      assert.deepEqual(mod(bus, 'late').state.got, [6, 7, 9], 'a dock to the clock is not handed a retained tick either');
   });

   // ---- the recorder and the tape scrub ----

   const R = await load('js/scenes/rails/recorder.js');
   const P = await load('js/scenes/rails/replay.js');
   const R2 = await load('js/scenes/rails/runtime.js');
   // A bus with a state rail `s` (a device sets it to n each step) and an event rail `e` (a device emits n each step).
   const taped = (opts, { state = true, event = true } = {}) => {
      const bus = bus0();
      const dev = bus.addDevice({ id: 'd', outputs: { s: { kind: 'state', type: 'num' }, e: { kind: 'event', type: 'num' } } });
      ok(bus.addRail({ id: 's', kind: 'state', type: 'num' })); ok(bus.addRail({ id: 'e', kind: 'event', type: 'num' }));
      ok(bus.dock('dev:d', 's', 's')); ok(bus.dock('dev:d', 'e', 'e'));
      const rec = new R.Recorder(bus, opts);
      const run = k => { for (let i = 0; i < k; i++) { if (state) dev.set('s', bus.n + 1); if (event) dev.emit('e', bus.n + 1); bus.step(); } };
      return { bus, rec, run, dev };
   };
   const pubCount = rec => rec.opsBetween(-1, 1e9).filter(o => o.k === 'pub').length;

   await check('recorder: an empty tape answers without throwing', () => {
      const bus = bus0(), rec = new R.Recorder(bus);
      assert.deepEqual(rec.range(), { t0: 0, t1: 0, frames: 0, ops: 0, dropped: 0, capped: 0 });
      assert.deepEqual(rec.segments, []); assert.deepEqual(rec.opsBetween(0, 10), []);
      assert.deepEqual(P.railsAt(rec, 1), {});
      assert.deepEqual(P.density(rec), new Array(60).fill(0));
      assert.deepEqual(P.density(rec, 0), []); assert.deepEqual(P.density(rec, -3), []);
      assert.equal(P.density(rec, 5).length, 5);
   });

   await check('recorder: segments are one second of frames, each starting from a snapshot taken before its first step', () => {
      const { bus, rec, run } = taped();
      run(150);
      assert.equal(rec.segments.length, 3);
      assert.deepEqual(rec.segments.map(s => s.frames.length), [60, 60, 30]);
      assert.deepEqual(rec.segments.map(s => s.snap.n), [0, 60, 120], 'a snapshot is the world after the step before the first frame');
      for (const s of rec.segments) {
         assert.equal(s.frames[0].n, s.snap.n + 1); assert.ok(s.frames.every(f => f.n > s.snap.n), 'every frame is after its snapshot');
         assert.ok(s.snap.rails.clock);
         if (s.snap.n > 0) assert.ok(s.snap.rails.s && s.snap.rails.e, 'later snapshots know the rails');
      }
      const all = rec.segments.flatMap(s => s.frames);
      assert.deepEqual(all.map(f => f.n), Array.from({ length: 150 }, (_, i) => i + 1));
      near(all[149].t, 150 / 60); assert.equal(all[149].t, all[149].n * B.DT);
      assert.deepEqual(Object.keys(rec.segments[0].born).sort(), ['e', 's'], 'rails created after the snapshot are found by their first delivery');
      assert.equal(rec.segments[1].snap.rails.s.value, 60, 'the snapshot holds the rail value after step 60');
      const r = rec.range();
      assert.equal(r.frames, 150); assert.equal(r.t0, 0); near(r.t1, 2.5); assert.equal(r.dropped, 0);
   });

   await check('recorder: ops are stored by reference, in delivery order, one pub per delivered message', () => {
      const { bus, rec, dev } = taped();
      const log = logOps(bus);
      dev.set('s', 1); dev.emit('e', 10); dev.emit('e', 11); bus.step();
      const frame = rec.segments[0].frames[0];
      assert.equal(frame.n, 1);
      assert.ok(log.length >= 4 && log.every(o => frame.ops.includes(o)), 'the very objects the bus logged');
      assert.deepEqual(frame.ops.filter(o => o.k === 'pub' && o.rail === 'e').map(o => o.v), [10, 11]);
      assert.equal(frame.ops.filter(o => o.k === 'pub' && o.rail === 'clock').length, 1);
      assert.deepEqual(frame.ops.filter(o => o.k === 'dock').map(o => o.rail), ['s', 'e'], 'in-step structure ops are in the frame too');
   });

   await check('recorder: the window never exceeds 30 s and starts on a segment snapshot (31 s run)', () => {
      const { bus, rec, run } = taped();
      run(1860);
      const r = rec.range();
      assert.ok(r.t1 - r.t0 <= 30 + 1e-9, `window ${r.t1 - r.t0}`);
      assert.ok(r.t1 - r.t0 >= 29, 'at least 29 s are kept');
      assert.equal(rec.segments.length, 30);
      assert.equal(rec.segments[0].snap.n, 60, 'the first second was dropped whole');
      assert.equal(rec.segments[0].frames[0].n, 61, 'the oldest frame follows its snapshot');
      assert.equal(r.t0, rec.segments[0].snap.t); near(r.t1, 31);
      assert.ok(r.dropped >= 1, 'the first second aged out'); assert.equal(r.capped, 0, 'the cap did not');
      run(61);
      const r2 = rec.range();
      assert.ok(r2.t1 - r2.t0 <= 30 + 1e-9 && rec.segments.every(s => s.frames.length <= 60));
      assert.equal(rec.segments[0].frames[0].n, rec.segments[0].snap.n + 1);
      assert.equal(rec.opCount, pubCount(rec) + rec.opsBetween(-1, 1e9).filter(o => o.k !== 'pub').length, 'the op count matches what is kept');
      const rec5 = new R.Recorder(bus, { window: 5 }); for (let i = 0; i < 600; i++) bus.step();
      assert.ok(rec5.range().t1 - rec5.range().t0 <= 5 + 1e-9, 'a custom window');
   });

   await check('recorder: the op cap shrinks the window by whole segments and counts them in dropped', () => {
      const { bus, rec, run } = taped({ maxOps: 500 });
      run(600);                                              // 3 pubs a step (clock, s, e): 180 a second, so about 2.7 s fit
      const r = rec.range();
      assert.ok(r.dropped > 0 && r.capped > 0 && r.dropped >= r.capped, 'segments were dropped by the cap');
      assert.ok(r.ops <= 500 && rec.opCount === r.ops, `ops ${r.ops}`);
      assert.ok(r.t1 - r.t0 < 5 && r.t1 - r.t0 > 1, `the window shrank to ${r.t1 - r.t0}`);
      assert.equal(rec.segments[0].frames[0].n, rec.segments[0].snap.n + 1);
      const { rec: big, run: runBig } = taped(); runBig(600);
      assert.equal(big.range().dropped, 0); assert.equal(big.range().capped, 0); assert.equal(big.maxOps, 100000);
      const tiny = taped({ maxOps: 1 }); tiny.run(130);      // never drops the newest segment, never throws
      assert.ok(tiny.rec.segments.length >= 1 && tiny.rec.range().frames > 0);
   });

   await check('railsAt: a state rail gives the last delivered value at or before t, across segment boundaries', () => {
      const { rec, run } = taped();
      run(200);
      for (const n of [1, 5, 59, 60, 61, 100, 120, 121, 200]) {
         const at = P.railsAt(rec, n * B.DT);
         assert.equal(at.s.value, n, `value at n=${n}`);
         assert.equal(at.s.kind, 'state'); assert.equal(at.s.type, 'num');
         assert.equal(at.s.by, 'dev:d.s'); assert.equal(at.s.seq, n);
         assert.deepEqual(at.clock.value, { t: n * B.DT, dt: B.DT, n }, 'the clock too');
      }
      assert.equal(P.railsAt(rec, 100.5 * B.DT).s.value, 100, 'between frames: the earlier one');
      assert.equal(P.railsAt(rec, 999).s.value, 200, 'after the end clamps to the end');
      assert.equal(P.railsAt(rec, 0).s, undefined, 'at the window start this rail did not exist in the snapshot and had delivered nothing');
      assert.equal(P.railsAt(rec, -5).clock.value, undefined, 'before the window clamps to its start');
   });

   await check('railsAt: rails with no value yet are undefined, and a state value is kept until the next delivery', () => {
      const bus = bus0();
      ok(bus.addRail({ id: 'q', kind: 'state', type: 'num' }));
      const d = bus.addDevice({ id: 'x', outputs: { v: { kind: 'state', type: 'num' } } }); ok(bus.dock('dev:x', 'v', 'q'));
      step(bus);                                              // the rail exists before the tape starts
      const rec = new R.Recorder(bus);
      step(bus, 10); d.set('v', 7); step(bus, 10); d.set('v', 8); step(bus, 10);
      assert.equal(P.railsAt(rec, 5 * B.DT).q.value, undefined);
      assert.equal(P.railsAt(rec, 5 * B.DT).q.seq, 0);
      assert.equal(P.railsAt(rec, 12 * B.DT).q.value, 7);
      assert.equal(P.railsAt(rec, 21 * B.DT).q.value, 7, 'kept through quiet frames');
      assert.equal(P.railsAt(rec, 22 * B.DT).q.value, 8);
      assert.deepEqual(P.railsAt(rec, 22 * B.DT).q.recent, [], 'a state rail has no recent list');
   });

   await check('railsAt: an event rail gives its latest 8 messages at or before t, within the window', () => {
      const { rec, run } = taped();
      run(200);
      const at = P.railsAt(rec, 100 * B.DT);
      assert.deepEqual(at.e.recent.map(m => m.v), [93, 94, 95, 96, 97, 98, 99, 100]);
      assert.deepEqual(at.e.recent[7], { t: 100 * B.DT, v: 100, by: 'dev:d.e' });
      assert.equal(at.e.value, undefined, 'an event rail retains nothing'); assert.equal(at.e.seq, 100);
      assert.deepEqual(P.railsAt(rec, 63 * B.DT).e.recent.map(m => m.v), [56, 57, 58, 59, 60, 61, 62, 63], 'across a segment boundary');
      assert.deepEqual(P.railsAt(rec, 3 * B.DT).e.recent.map(m => m.v), [1, 2, 3], 'fewer than 8 near the start');
      assert.equal(P.railsAt(rec, 0).e, undefined);
      assert.deepEqual(P.railsAt(rec, 1000).e.recent.map(m => m.v), [193, 194, 195, 196, 197, 198, 199, 200]);
      const { rec: old, run: runOld } = taped(); runOld(1860);
      const first = P.railsAt(old, old.range().t0 + B.DT).e.recent;
      assert.deepEqual(first.map(m => m.v), [61], 'messages before the window are not invented');
      assert.equal(P.railsAt(old, old.range().t0 + 3 * B.DT).e.seq, 63, 'seq is as logged: 60 from the snapshot plus 3');
   });

   await check('railsAt: several event messages in one frame keep their order; a rail added later comes with its kind', () => {
      const bus = bus0();
      ok(bus.addRail({ id: 'e', kind: 'event', type: 'any' }));
      const d = bus.addDevice({ id: 'x', outputs: { v: { kind: 'event', type: 'any' } } }); ok(bus.dock('dev:x', 'v', 'e'));
      const rec = new R.Recorder(bus);
      step(bus); d.emit('v', 'a'); d.emit('v', 'b'); d.emit('v', 'c'); step(bus);
      assert.deepEqual(P.railsAt(rec, 2 * B.DT).e.recent.map(m => m.v), ['a', 'b', 'c']);
      ok(bus.addRail({ id: 'f', kind: 'event', type: 'any' }));
      const d2 = bus.addDevice({ id: 'y', outputs: { v: { kind: 'event', type: 'any' } } }); ok(bus.dock('dev:y', 'v', 'f'));
      step(bus); d2.emit('v', 'd'); step(bus);
      const at = P.railsAt(rec, 4 * B.DT);
      assert.deepEqual(Object.keys(at).sort(), ['clock', 'e', 'f']);
      assert.deepEqual(at.e.recent.map(m => m.v), ['a', 'b', 'c']);
      assert.deepEqual(at.f.recent.map(m => m.v), ['d'], 'a rail the snapshot did not know comes with its kind');
      assert.equal(at.f.kind, 'event');
   });

   await check('density: bins sum to the deliveries in the window, and follow the traffic', () => {
      const { rec, run } = taped();
      run(300);
      const d = P.density(rec);
      assert.equal(d.length, 60);
      assert.equal(d.reduce((a, b) => a + b, 0), pubCount(rec));
      assert.equal(pubCount(rec), 300 * 3, 'clock + s + e each step');
      assert.ok(d.every(c => c === 15), `even traffic: ${d}`);
      assert.equal(P.density(rec, 10).length, 10);
      assert.equal(P.density(rec, 10).reduce((a, b) => a + b, 0), 900);
      assert.deepEqual(P.density(rec, 1), [900]);
      const { rec: old, run: runOld } = taped(); runOld(1860);
      assert.equal(P.density(old).reduce((a, b) => a + b, 0), pubCount(old), 'only what is still kept');
      const q = taped({}, { state: false, event: false }); q.run(60);      // a quiet tape: only the clock
      assert.equal(P.density(q.rec).reduce((a, b) => a + b, 0), 60);
      const burst = taped({}, { state: false, event: false });             // a burst in the second half
      burst.run(60); for (let i = 0; i < 60; i++) { for (let k = 0; k < 4; k++) burst.dev.emit('e', k); burst.bus.step(); }
      const bd = P.density(burst.rec, 2);
      assert.deepEqual(bd, [60, 300], 'the quiet second, then the burst (a frame on a bin edge belongs to the bin below)');
   });

   await check('density: kept while the tape is unchanged, scanned again after a step, and a caller cannot change what is kept', () => {
      const { rec, run } = taped();
      run(120);
      const first = P.density(rec, 10), want = [...first];
      first[0] = 12345;
      assert.deepEqual(P.density(rec, 10), want, 'the copy that was changed is not the one that is kept');
      const before = P.density(rec, 10).reduce((a, b) => a + b, 0);
      assert.equal(P.density(rec, 5).length, 5, 'another number of bins is its own answer');
      run(60);
      assert.equal(P.density(rec, 10).reduce((a, b) => a + b, 0), before + 60 * 3, 'a step makes it scan again');
   });

   await check('pause: nothing is recorded while paused, and resume continues n without a gap', () => {
      const { bus, rec, run } = taped();
      run(10);
      const before = rec.range(), opsBefore = rec.opsBetween(-1, 1e9).length;
      bus.pause();
      for (let i = 0; i < 5; i++) assert.equal(bus.step(), false);
      assert.deepEqual(rec.range(), before); assert.equal(rec.opsBetween(-1, 1e9).length, opsBefore);
      assert.equal(bus.n, 10);
      bus.resume(); run(5);
      const ns = rec.segments.flatMap(s => s.frames.map(f => f.n));
      assert.deepEqual(ns, Array.from({ length: 15 }, (_, i) => i + 1), 'no gap, no repeat');
      assert.equal(P.railsAt(rec, 15 * B.DT).s.value, 15);
      assert.equal(bus.hookError, null);
   });

   await check('recorder: an op before the first step is in the snapshot and in no frame', () => {
      const bus = bus0(), rec = new R.Recorder(bus);
      ok(bus.addRail({ id: 'r', kind: 'state', type: 'any' }));
      ok(bus.addModule('early', "const t = input('time', 'state', 'time');"));    // before any step
      assert.equal(bus.hookError, null);
      assert.equal(rec.segments.length, 0, 'no frame is made for it');
      step(bus, 3);
      const seg = rec.segments[0];
      assert.ok(seg.snap.modules.early, 'the snapshot has the module');
      assert.ok(seg.snap.docks.some(d => d.join() === 'mod:early,time,clock'), 'and its dock');
      assert.deepEqual(seg.frames.map(f => f.n), [1, 2, 3]);
      assert.ok(!rec.opsBetween(-1, 1e9).some(o => o.k === 'dock' && o.owner === 'mod:early'), 'in no frame');
   });

   await check('recorder: an op logged between steps joins the last frame and never throws', () => {
      const bus = bus0(), rec = new R.Recorder(bus);
      step(bus, 5);
      ok(bus.addModule('m', "const t = input('time', 'state', 'time');"));        // between steps 5 and 6
      assert.equal(bus.hookError, null);
      const docks = rec.opsBetween(5 * B.DT, 5 * B.DT).filter(o => o.k === 'dock' && o.owner === 'mod:m');
      assert.equal(docks.length, 1, 'in the frame of step 5'); assert.equal(docks[0].n, 5);
      assert.deepEqual(rec.segments[0].frames.map(f => f.n), [1, 2, 3, 4, 5]);
      step(bus);
      assert.equal(rec.segments[0].frames[5].n, 6);
      assert.equal(P.railsAt(rec, 6 * B.DT).clock.value.n, 6);
   });

   await check('recorder: an op between steps at a segment boundary stays in the old segment and the new snapshot includes it', () => {
      const { bus, rec, run } = taped();
      run(60);                                                // a full segment; the next snapshot is waiting
      ok(bus.addModule('late', "const t = input('time', 'state', 'time');"));
      assert.equal(bus.hookError, null);
      const first = rec.segments[0];
      assert.ok(first.frames[59].ops.some(o => o.k === 'dock' && o.owner === 'mod:late'), 'attached to the last frame (n=60)');
      ok(bus.addModule('quiet', "output('x', 'state', 'num');"));       // logs no op at all
      run(1);
      assert.equal(rec.segments.length, 2);
      assert.ok(rec.segments[1].snap.modules.quiet, 'a change that logged no op is in the next snapshot too');
      assert.ok(rec.segments[1].snap.modules.late, 'the next segment starts from a world that has the module');
      assert.equal(rec.segments[1].snap.n, 60); assert.equal(rec.segments[1].frames[0].n, 61);
      assert.equal(rec.segments[1].frames[0].ops.filter(o => o.k === 'dock' && o.owner === 'mod:late').length, 0, 'not twice');
      // a reload and a quarantine are kept as well
      ok(bus.reload('late', "const t = input('time', 'state', 'time'); t.on(() => { null.x; });")); run(2);
      const ks = rec.opsBetween(-1, 1e9).map(o => o.k);
      assert.ok(ks.includes('reload') && ks.includes('quarantine'));
   });

   await check('recorder: after a restore the tape matches the live rails at every step and counts nothing twice', () => {
      const SRC = "const t = input('time', 'state', 'time'); const o = output('o', 'state', 'num'); t.on(({ n }) => { o.set(n); });";
      const a = bus0({ seed: 2 });
      ok(a.addRail({ id: 'o', kind: 'state', type: 'num' })); ok(a.addModule('p', SRC)); ok(a.dock('mod:p', 'o', 'o'));
      step(a, 12);
      const snap = JSON.parse(JSON.stringify(a.snapshot())), layout = JSON.parse(JSON.stringify(layoutOf(a)));
      const b = bus0({ seed: 2 }), rec = new R.Recorder(b);
      assert.equal(b.restoreSnapshot(snap, layout).ok, true);
      assert.equal(b.n, 12);
      for (let i = 0; i < 70; i++) {                                    // crosses a segment boundary
         b.step();
         const at = P.railsAt(rec, b.t);
         for (const id of ['clock', 'o']) {
            const live = b.rails.get(id);
            assert.deepEqual([at[id].value, at[id].by, at[id].seq, at[id].stale], [live.value, live.by, live.seq, live.stale], `${id} at n=${b.n}`);
         }
      }
      assert.equal(rec.segments[0].snap.n, 12);
      assert.equal(rec.segments[0].frames[0].n, 13, 'the first frame follows the snapshot');
      assert.ok(rec.segments.every(s => s.frames.every(f => f.n > s.snap.n)));
      assert.equal(P.railsAt(rec, 13 * B.DT).clock.seq, 13);
   });

   await check('railsAt: stale follows undock and quarantine, and a delivery clears it', () => {
      const bus = bus0();
      ok(bus.addRail({ id: 'o', kind: 'state', type: 'num' }));
      ok(bus.addModule('p', "const t = input('time', 'state', 'time'); const o = output('o', 'state', 'num'); t.on(({ n }) => { o.set(n); });"));
      ok(bus.dock('mod:p', 'o', 'o'));
      step(bus, 10);
      const rec = new R.Recorder(bus);
      step(bus, 5);                                                      // n = 11..15
      ok(bus.undock('mod:p', 'o')); step(bus, 3);                         // undocked in step 16
      assert.equal(bus.rails.get('o').stale, true, 'the live bus: stale');
      ok(bus.dock('mod:p', 'o', 'o')); step(bus, 4);                      // docked in step 19, which delivers its value again
      const at = n => P.railsAt(rec, n * B.DT).o;
      assert.equal(at(15).stale, false); assert.equal(at(15).value, 15);
      assert.equal(at(16).stale, true, 'the undock made it stale in its own step');
      assert.equal(at(18).stale, true); assert.equal(at(18).value, 15, 'the value is kept');
      assert.equal(at(19).stale, false, 'a later delivery clears it');
      assert.equal(at(22).stale, bus.rails.get('o').stale);
      // quarantine
      const b2 = bus0();
      ok(b2.addRail({ id: 'o', kind: 'state', type: 'num' }));
      ok(b2.addModule('bad', "const t = input('time', 'state', 'time'); const o = output('o', 'state', 'num'); t.on(({ n }) => { if (n === 3) null.x; o.set(n); });"));
      ok(b2.dock('mod:bad', 'o', 'o'));
      step(b2, 1); const r2 = new R.Recorder(b2); step(b2, 4);
      assert.equal(P.railsAt(r2, 2 * B.DT).o.stale, false);
      assert.equal(P.railsAt(r2, 3 * B.DT).o.stale, true, 'the publisher was quarantined in step 3');
      assert.equal(P.railsAt(r2, 5 * B.DT).o.stale, b2.rails.get('o').stale);
      ok(b2.reload('bad', "const t = input('time', 'state', 'time'); const o = output('o', 'state', 'num'); t.on(({ n }) => { o.set(n); });")); step(b2, 2);
      assert.equal(P.railsAt(r2, 7 * B.DT).o.stale, false);
      assert.equal(P.railsAt(r2, 7 * B.DT).o.stale, b2.rails.get('o').stale);
   });

   await check('bus.onBeforeStep: runs before n grows and before the queue, not while paused, a throw cannot abort, removable', () => {
      const bus = bus0(), seen = [];
      const off = bus.onBeforeStep(({ n }) => { seen.push([n, bus.n, bus.queue.length]); });
      ok(bus.addRail({ id: 'r', kind: 'state', type: 'any' }));
      step(bus, 2);
      assert.deepEqual(seen, [[0, 0, 1], [1, 1, 0]], 'n is the previous step, the queue is not applied yet');
      bus.pause(); bus.step(); assert.equal(seen.length, 2, 'not while paused'); bus.resume();
      bus.onBeforeStep(() => { throw new Error('boom'); });
      assert.equal(bus.step(), true); assert.equal(bus.n, 3); assert.equal(bus.hookError.message, 'boom');
      off(); step(bus); assert.equal(seen.length, 3, 'removed: no new entry');
   });

   await check('recorder: opens segments beside another before-step listener, and dispose leaves a plain bus', () => {
      const { bus, rec, run } = taped();
      let other = 0; bus.onBeforeStep(() => { other++; });
      run(130);
      assert.equal(other, 130); assert.equal(rec.segments.length, 3);
      assert.deepEqual(rec.segments.map(s => s.snap.n), [0, 60, 120]);
      const own = Object.prototype.hasOwnProperty.call(bus, 'step');
      assert.equal(own, false, 'the bus step is untouched');
      const hooks = bus._hooks.before.length;
      rec.dispose();
      assert.equal(bus._hooks.before.length, hooks - 1, 'dispose unhooks');
      assert.equal(bus._hooks.op.length, 0); assert.equal(bus._hooks.step.length, 0);
      run(70);
      assert.equal(other, 200); assert.equal(rec.range().frames, 130, 'nothing more is recorded');
      assert.equal(rec.segments.length, 3);
      assert.equal(bus.hookError, null);
   });

   await check('recorder: dispose stops recording and keeps what was recorded', () => {
      const { bus, rec, run } = taped();
      run(10); rec.dispose(); run(10);
      assert.equal(rec.range().frames, 10); assert.equal(bus.n, 20);
      assert.equal(P.railsAt(rec, 10 * B.DT).s.value, 10);
   });

   await check('recorder: attached to a bus that has already run, it starts from the world as it is', () => {
      const bus = bus0(); const d = bus.addDevice({ id: 'x', outputs: { v: { kind: 'state', type: 'num' } } });
      ok(bus.addRail({ id: 'q', kind: 'state', type: 'num' })); ok(bus.dock('dev:x', 'v', 'q'));
      d.set('v', 3); step(bus, 100);
      const rec = new R.Recorder(bus);
      step(bus, 10);
      const r = rec.range();
      near(r.t0, 100 * B.DT); assert.equal(r.frames, 10);
      assert.equal(rec.segments[0].snap.rails.q.value, 3);
      assert.equal(P.railsAt(rec, 105 * B.DT).q.value, 3);
   });

   // ---- the demo: the modules in modules/ and the layout in data/layout.js ----
   const path = require('node:path');
   const root = path.join(__dirname, '..', 'js', 'scenes', 'rails');
   const moduleNames = fs.readdirSync(path.join(root, 'modules')).filter(f => f.endsWith('.js')).map(f => f.slice(0, -3)).sort();

   await check('demo: every module in modules/ compiles and sets up in a Bus', () => {
      assert.deepEqual(moduleNames, ['ball', 'constant', 'flowers', 'oscillator']);
      for (const name of moduleNames) {
         const bus = bus0();
         ok(bus.addModule(name, demoRaw(name)));
         const m = bus.modules.get(name);
         assert.equal(m.status, 'ok', name);
         assert.ok(m.ports.length >= 2, `${name} declares ports`);
         step(bus, 3);
         assert.equal(bus.modules.get(name).status, 'ok', `${name} survives a few steps`);
      }
   });

   await check('demo: layout.js loads with no errors or notices, and the ball follows the oscillator', async () => {
      const text = fs.readFileSync(path.join(root, 'data', 'layout.js'), 'utf8');
      assert.ok(text.startsWith('export default ') && text.trimEnd().endsWith(';'));
      const Sto = await load('js/scenes/rails/store.js');
      const store = Sto.createStore({ fetch: async url => ({ ok: true, text: async () => text }) });
      const layout = await store.loadLayout();
      assert.equal(store.problem, null);
      assert.deepEqual(Object.keys(layout.cards), ['oscillator', 'ball', 'flowers', 'constant']);
      assert.deepEqual(Object.values(layout.cards).map(c => c.slot), [0, 1, 2, 3]);
      assert.deepEqual(Object.keys(layout).sort(), ['cards', 'unplugged', 'uses']);
      assert.ok(layout.uses && typeof layout.uses === 'object' && Array.isArray(layout.unplugged));

      // The saved wiring is whatever the last headset session left (the scene saves it), so the run below starts from none.
      const sources = {}; for (const n of moduleNames) sources[n] = demoRaw(n);
      const rt = new R2.Runtime();
      const r = rt.load({ layout: { ...layout, uses: {}, unplugged: [] }, sources });
      assert.deepEqual(r.errors, []); assert.equal(r.ok, true);
      assert.deepEqual([...rt.bus.rails.keys()].sort(), ['center', 'gaze_hit', 'gaze_on', 'planted', 'pointer_down', 'pointer_pos', 'target', 'time']);
      assert.equal(rt.notices.length, 0, JSON.stringify(rt.notices));
      for (let i = 0; i < 60; i++) rt.step();
      const at = () => rt.bus.modules.get('ball').draw[0].p.slice();
      const a = at(); for (let i = 0; i < 60; i++) rt.step(); const b = at();
      assert.ok(Math.hypot(b[0] - a[0], b[2] - a[2]) > .005, `the ball moves: ${a} -> ${b}`);
      assert.equal(rt.bus.modules.get('ball').draw.length, 1);
      for (const [id, m] of rt.bus.modules) assert.equal(m.status, 'ok', id);
      const flowers = rt.bus.modules.get('flowers');
      assert.ok(flowers.draw.length >= 1, 'flowers are planted at the target');
      assert.ok(rt.bus.rails.get('planted').seq > 0, 'planted announces each flower');
      assert.equal(rt.bus.rails.get('target').writers.length, 1, 'only the oscillator publishes target');
      // What the app would save for this runtime is this file (with the wiring it was started with), so a first save changes nothing.
      assert.deepEqual(rt.layoutFile(), { ...layout, uses: {}, unplugged: [] });
      assert.equal(rt.notices.length, 0);
   });

   const demoRuntime = async () => {
      const text = fs.readFileSync(path.join(root, 'data', 'layout.js'), 'utf8');
      const layout = JSON.parse(text.trim().slice('export default '.length, -1));
      const sources = {}; for (const n of moduleNames) sources[n] = demoRaw(n);
      const rt = new R2.Runtime(); rt.load({ layout: { ...layout, uses: {}, unplugged: [] }, sources });   // the saved wiring is the last session's
      return rt;
   };

   await check('flowers: plant while the target moves, and stop when it does not (unplugged, or the gaze left the mat)', async () => {
      const rt = await demoRuntime();
      const count = () => rt.bus.modules.get('flowers').state.count;
      for (let i = 0; i < 240; i++) rt.step();
      assert.ok(count() >= 6, `the oscillator keeps planting: ${count()}`);
      assert.equal(rt.bus.rails.get('planted').seq, count());
      assert.equal(rt.handle({ id: 1, op: 'plug', module: 'oscillator', on: false }).ok, true);
      for (let i = 0; i < 40; i++) rt.step();
      const before = count();
      for (let i = 0; i < 300; i++) rt.step();
      assert.equal(count(), before, 'a target that no longer moves plants nothing');
      assert.equal(rt.bus.modules.get('ball').draw.length, 1);
      assert.equal(rt.bus.modules.get('flowers').status, 'ok');
   });

   await check('runtime: a snapshot carries `playing`, a geometry command moves cards, a renamed module keeps its slot, and the name constructor is refused', async () => {
      const rt = await demoRuntime();
      for (let i = 0; i < 90; i++) rt.step();
      assert.equal(rt.snapshot().playing, false);
      assert.equal(rt.handle({ id: 1, op: 'pause' }).ok, true); assert.equal(rt.handle({ id: 2, op: 'seek', t: 0.5 }).ok, true);
      assert.equal(rt.handle({ id: 3, op: 'play' }).ok, true); assert.equal(rt.snapshot().playing, true);
      for (let i = 0; i < 2000 && rt.playing; i++) rt.step();
      assert.equal(rt.snapshot().playing, false, 'play ends at the window end');
      assert.equal(rt.handle({ id: 4, op: 'play' }).ok, true); rt.handle({ id: 5, op: 'seek', t: 0.2 });
      assert.equal(rt.snapshot().playing, false, 'a seek stops it');
      rt.handle({ id: 6, op: 'resume' });
      assert.deepEqual(rt.handle({ id: 8, op: 'geometry', cards: { ball: { slot: 4 } } }), { cmd: 8, ok: true });
      assert.equal(rt.geometry.cards.ball.slot, 4); assert.deepEqual(Object.keys(rt.geometry), ['cards']);
      for (const n of [1, 2]) assert.ok(Object.hasOwn(rt.geometry.cards, 'ball'), String(n));
      assert.equal(rt.handle({ id: 9, op: 'rmModule', module: 'constant' }).ok, true);
      const refused = rt.handle({ id: 10, op: 'addModule', module: 'constructor' });
      assert.equal(refused.ok, false); assert.match(refused.reason, /bad module name 'constructor': use a-z/);
      assert.equal(Object.hasOwn(rt.geometry.cards, 'constructor'), false);
      assert.equal(rt.handle({ id: 14, op: 'addModule', module: 'newbie' }).ok, true);
      const slot = rt.geometry.cards.newbie.slot;
      assert.ok(Number.isInteger(slot), 'the new card has a slot of its own');
      assert.equal(rt.layoutFile().cards.newbie.slot, slot);
      assert.equal(rt.handle({ id: 15, op: 'renameModule', module: 'newbie', to: 'constructor' }).ok, false);
      assert.equal(rt.handle({ id: 11, op: 'renameModule', module: 'newbie', to: 'zed' }).ok, true);
      rt.step(); assert.equal(rt.layoutFile().cards.zed.slot, slot);
   });

   await check('runtime: the last device value that came while paused is set when the run resumes', async () => {
      const rt = await demoRuntime();
      rt.handle({ id: 1, op: 'plug', module: 'oscillator', on: false });
      for (let i = 0; i < 30; i++) rt.step();
      rt.handle({ id: 3, op: 'pause' });
      assert.equal(rt.setDevice('gaze', 'hit', [0.1, 0, 0.1]).ok, false); assert.equal(rt.setDevice('gaze', 'hit', [0.05, 0, -0.05]).ok, false);
      assert.equal(rt.setDevice('nope', 'hit', [0, 0, 0]).reason, "no device 'nope'");
      rt.handle({ id: 4, op: 'resume' });
      for (let i = 0; i < 3; i++) rt.step();
      assert.deepEqual(rt.bus.rails.get('gaze_hit').value, [0.05, 0, -0.05], 'the newest value, as if it had come at the resume');
      rt.handle({ id: 5, op: 'pause' }); rt.handle({ id: 6, op: 'resume' }); rt.step();
      assert.deepEqual(rt.bus.rails.get('gaze_hit').value, [0.05, 0, -0.05], 'and only once');
   });

   // ---- the replay world: every module run again over the tape up to a past time, so that the drawn scene is the past exactly ----

   // What the live bus drew and held at every step: for each module its draw list, state and status, for each rail its value and count.
   const record = bus => {
      const log = new Map();
      bus.onStep(({ n }) => {
         const mods = {}, rails = {};
         for (const [id, m] of bus.modules) mods[id] = [JSON.stringify(m.draw), JSON.stringify(m.state), m.status];
         for (const [id, r] of bus.rails) rails[id] = [JSON.stringify(r.value === undefined ? null : r.value), r.seq];
         log.set(n, { mods, rails });
      });
      return log;
   };
   // Moves the replay to step n and compares everything with what the live bus had at that step.
   const sameAt = (rp, log, n, label = '') => {
      assert.ok(rp.at(n * B.DT), `${label} step ${n}: ${rp.problem}`);
      assert.equal(rp.bus.n, n);
      const want = log.get(n);
      for (const [id, [draw, state, status]] of Object.entries(want.mods)) {
         const m = rp.bus.modules.get(id);
         assert.ok(m, `${label} step ${n}: ${id} is in the replay`);
         assert.equal(JSON.stringify(m.draw), draw, `${label} step ${n}: ${id} draws`);
         assert.equal(JSON.stringify(m.state), state, `${label} step ${n}: ${id} state`);
         assert.equal(m.status, status, `${label} step ${n}: ${id} status`);
      }
      for (const [id, [value, seq]] of Object.entries(want.rails)) {
         const r = rp.bus.rails.get(id);
         assert.ok(r, `${label} step ${n}: rail ${id}`);
         assert.equal(JSON.stringify(r.value === undefined ? null : r.value), value, `${label} step ${n}: rail ${id} value`);
         assert.equal(r.seq, seq, `${label} step ${n}: rail ${id} count`);
      }
   };
   // The steps an at() ran: from where it was when that is the same world, else from the snapshot of the segment it started in.
   const stepsOf = (rp, before, was, n) => (rp.bus === before ? n - was : n - rp.recorder.segments[rp.recorder.segmentIndexAt(n * B.DT)].snap.n);

   const REPLAYED = ['oscillator', 'ball', 'flowers'];
   // The three demo modules and a scripted gaze device: a dock and an undock of the gaze before the ball is reloaded 10 s in
   // (step 600), then the ball's own target dock undocked and docked again, and the gaze undocked, after it. Left paused at the end
   // with what the live modules drew and held at every step.
   const replayWorld = ({ steps = 1500, reloadAt = 600, window = 30 } = {}) => {
      const bus = bus0({ seed: 3 }), rec = new R.Recorder(bus, { window }), gaze = bus.addDevice({ id: 'gaze', outputs: { hit: { kind: 'state', type: 'vec3' } } });
      ok(bus.addRail({ id: 'target', kind: 'state', type: 'vec3' })); ok(bus.addRail({ id: 'planted', kind: 'event', type: 'num' }));
      for (const n of REPLAYED) ok(bus.addModule(n, demoRaw(n)));
      for (const [o, p, r] of [['oscillator', 'target', 'target'], ['ball', 'target', 'target'], ['flowers', 'target', 'target'], ['flowers', 'planted', 'planted']]) ok(bus.dock(`mod:${o}`, p, r));
      const log = record(bus);
      for (let i = 0; i < steps; i++) {
         if (i % 7 === 0) gaze.set('hit', [Math.sin(i / 50) * .1, 0, Math.cos(i / 40) * .1]);
         if (i === 300) ok(bus.dock('dev:gaze', 'hit', 'target'));
         if (i === 420) ok(bus.undock('dev:gaze', 'hit'));
         if (i === 450) ok(bus.undock('mod:ball', 'target'));
         if (i === 500) ok(bus.dock('mod:ball', 'target', 'target'));
         if (i === reloadAt) ok(bus.reload('ball', `${demoRaw('ball')}\n// reloaded\n`));
         if (i === 900) ok(bus.undock('mod:ball', 'target'));
         if (i === 960) ok(bus.dock('mod:ball', 'target', 'target'));
         bus.step();
      }
      bus.pause();
      return { bus, rec, log };
   };
   const tw = replayWorld();

   await check('replay: the demo modules, with a gaze that docks and undocks, a dock and an undock of a module and a reload, are what they were at every step (draw, state, rails)', () => {
      const rp = new P.Replay(tw.rec);
      let compared = 0;
      for (let n = 1; n <= 1500; n++) { sameAt(rp, tw.log, n, 'forward'); compared++; }
      assert.equal(compared, 1500); assert.equal(rp.problem, null);
      assert.ok(tw.log.get(1500).mods.ball[0].length > 10, 'the ball draws something');
   });

   await check('replay: a seek backwards starts again from the segment snapshot and is exact; no seek runs more than one segment (60 steps)', () => {
      const rp = new P.Replay(tw.rec);
      const order = [];
      for (let k = 0; k < 400; k++) order.push(1 + ((k * 389 + 17) % 1500));         // a scatter over the window
      for (let n = 1500; n >= 1; n -= 13) order.push(n);                             // and a walk backwards
      for (const n of order) {
         const before = rp.bus, was = before ? before.n : -1;
         sameAt(rp, tw.log, n, 'seek');
         assert.ok(stepsOf(rp, before, was, n) <= 60, `step ${n} ran ${stepsOf(rp, before, was, n)} steps`);
      }
      // a short move forward is not a restart: the same world goes on
      const w = rp.bus; sameAt(rp, tw.log, 900); const keep = rp.bus; sameAt(rp, tw.log, 905); assert.equal(rp.bus, keep, 'five steps on are five steps');
      sameAt(rp, tw.log, 1); assert.notEqual(rp.bus, keep, 'backwards is a new world'); assert.ok(w);
   });

   await check('replay: the first step of the window is the snapshot itself, t is clamped by the caller, and the tape and the live bus are not touched', () => {
      const before = JSON.stringify([tw.bus.snapshot(), layoutOf(tw.bus), tw.rec.range(), tw.rec.segments.map(s => s.frames.length), [...tw.bus.modules.values()].map(m => [m.id, m.ver, m.rev, m.status, m.calls, m.draw])]);
      const queue = tw.bus.queue.length, n = tw.bus.n;
      const rp = new P.Replay(tw.rec);
      for (const t of [0, 5, 25, 12.5, 0, 24.99]) assert.ok(rp.at(t));
      const after = JSON.stringify([tw.bus.snapshot(), layoutOf(tw.bus), tw.rec.range(), tw.rec.segments.map(s => s.frames.length), [...tw.bus.modules.values()].map(m => [m.id, m.ver, m.rev, m.status, m.calls, m.draw])]);
      assert.equal(after, before); assert.equal(tw.bus.queue.length, queue); assert.equal(tw.bus.n, n); assert.equal(tw.bus.hookError, null);
      rp.at(0); assert.equal(rp.bus.n, 0, 'the window starts at the first snapshot');
      assert.equal(new P.Replay(new R.Recorder(bus0())).at(0), false, 'an empty tape has no past');
   });

   await check('replay: a module that feeds itself replays exactly, also from a window that starts in the middle of its run (the messages in flight are on the tape)', () => {
      const SELF = `const time = input('time', 'state', 'time'); const echo = input('echo', 'event', 'num'); const out = output('out', 'event', 'num');
         const S = state({ seen: 0 });
         time.on(({ n }) => { if (n === 5) out.emit(0); });
         echo.on(v => { S.seen++; out.emit(v + 1); draw([{ shape: 'sphere', p: [0, 0, 0], s: 0.001 * (S.seen % 50), color: '#fff' }]); });`;
      const b = bus0(), rec = new R.Recorder(b, { window: 1 });
      ok(b.addRail({ id: 'loop', kind: 'event', type: 'num' })); ok(b.addModule('self', SELF));
      ok(b.dock('mod:self', 'out', 'loop')); ok(b.dock('mod:self', 'echo', 'loop'));
      const log = record(b);
      step(b, 200); b.pause();
      assert.ok(rec.range().t0 > 1, 'the window starts well into the run');
      assert.ok(b.modules.get('self').state.seen > 1000, 'it hops 8 times a step: ' + b.modules.get('self').state.seen);
      assert.ok(rec.segments[0].inbox.length > 0, 'a message was in flight at the start of the window: ' + JSON.stringify(rec.segments[0].inbox));
      const rp = new P.Replay(rec), from = rec.segments[0].snap.n;
      for (let n = from + 1; n <= 200; n++) sameAt(rp, log, n, 'loop');
      for (let n = 200; n > from; n -= 7) sameAt(rp, log, n, 'loop back');
      // without the messages in flight the loop starts silent: that is what the tape's `inbox` is for
      const saved = rec.segments[0].inbox; rec.segments[0].inbox = [];
      const bare = new P.Replay(rec); bare.at(150 * B.DT);
      assert.notEqual(JSON.stringify(bare.bus.modules.get('self').state), log.get(150).mods.self[1], 'the loop is not the same without it');
      rec.segments[0].inbox = saved;
   });

   await check('replay: the clock and other publishers come at their pass: a module that reads two rails sees them in the live order', () => {
      // `late` is fed by `a` (pass 1, from the clock) and also hears `b` (pass 2, from `a`'s output); it keeps the order it saw.
      const A1 = "const t = input('time', 'state', 'time'); const x = output('x', 'state', 'num'); t.on(({ n }) => { x.set(n); });";
      const Bm = "const x = input('x', 'state', 'num'); const y = output('y', 'state', 'num'); x.on(v => { y.set(v * 2); });";
      const L = "const x = input('x', 'state', 'num'); const y = input('y', 'state', 'num'); const o = output('o', 'state', 'str'); const S = state({ log: '' });\n" +
         "x.on(v => { S.log = S.log.slice(-60) + 'x' + v + ' '; o.set(S.log); }); y.on(v => { S.log = S.log.slice(-60) + 'y' + v + ' '; o.set(S.log); });";
      const b = bus0(), rec = new R.Recorder(b);
      for (const [id, kind] of [['x', 'num'], ['y', 'num'], ['o', 'str']]) ok(b.addRail({ id, kind: 'state', type: kind }));
      ok(b.addModule('a', A1)); ok(b.addModule('b', Bm)); ok(b.addModule('late', L));
      for (const [m, p, r] of [['a', 'x', 'x'], ['b', 'x', 'x'], ['b', 'y', 'y'], ['late', 'x', 'x'], ['late', 'y', 'y'], ['late', 'o', 'o']]) ok(b.dock(`mod:${m}`, p, r));
      const log = record(b);
      step(b, 150); b.pause();
      const rp = new P.Replay(rec);
      for (let n = 1; n <= 150; n++) sameAt(rp, log, n, 'order');
      assert.match(rp.bus.rails.get('o').value, /x\d+ y\d+ x\d+ y\d+/, 'x then y in every step: ' + rp.bus.rails.get('o').value);
   });

   await check('replay: a module that throws is quarantined at the same step, and one that was quarantined when the window began stays so', () => {
      const THROWS = "const time = input('time', 'state', 'time'); const o = output('o', 'state', 'num'); const S = state({ k: 0 });\ntime.on(({ n }) => { if (n === 90) null.x; S.k++; o.set(S.k); draw([{ shape: 'sphere', p: [S.k, 0, 0], s: .1, color: '#fff' }]); });";
      const b = bus0(), rec = new R.Recorder(b); ok(b.addRail({ id: 'o', kind: 'state', type: 'num' })); ok(b.addModule('q', THROWS)); ok(b.dock('mod:q', 'o', 'o'));
      const log = record(b); step(b, 130); assert.equal(b.modules.get('q').status, 'quarantined'); b.pause();
      const rp = new P.Replay(rec);
      for (let n = 1; n <= 130; n++) sameAt(rp, log, n, 'throws');
      assert.equal(rp.bus.modules.get('q').status, 'quarantined'); assert.equal(rp.bus.rails.get('o').value, 89);
      const b2 = bus0(), rec2 = new R.Recorder(b2, { window: 1 }); ok(b2.addRail({ id: 'o', kind: 'state', type: 'num' })); ok(b2.addModule('q', THROWS)); ok(b2.dock('mod:q', 'o', 'o'));
      const log2 = record(b2); step(b2, 200); b2.pause();
      assert.equal(rec2.segments[0].snap.modules.q.status, 'quarantined', 'the window starts after the throw');
      const rp2 = new P.Replay(rec2);
      for (let n = rec2.segments[0].snap.n + 1; n <= 200; n++) sameAt(rp2, log2, n, 'already thrown');
   });

   await check('replay: an output docked in the middle of the window puts its last value on the new rail (the demo\'s constant); a snapshot keeps output values', () => {
      for (const dockAt of [200, 1000]) {
         const b = bus0({ seed: 3 }), rec = new R.Recorder(b, { window: 10 }), gaze = b.addDevice({ id: 'gaze', outputs: { hit: { kind: 'state', type: 'vec3' } } });
         ok(b.addRail({ id: 'target', kind: 'state', type: 'vec3' }));
         for (const n of ['constant', 'ball']) ok(b.addModule(n, demoRaw(n)));
         ok(b.dock('mod:ball', 'target', 'target')); ok(b.dock('dev:gaze', 'hit', 'target'));     // constant starts undocked
         const log = record(b);
         for (let i = 0; i < 1500; i++) {
            if (i % 5 === 0) gaze.set('hit', [Math.sin(i / 40) * .1, 0, Math.cos(i / 40) * .1]);
            if (i === 1000 + dockAt - 200) { ok(b.undock('dev:gaze', 'hit')); ok(b.dock('mod:constant', 'center', 'target')); }
            b.step();
         }
         b.pause();
         const rp = new P.Replay(rec);
         for (let n = rec.segments[0].snap.n + 1; n <= 1500; n++) sameAt(rp, log, n, `dock at ${1000 + dockAt - 200}`);
      }
      const a = bus0(); ok(a.addRail({ id: 't', kind: 'state', type: 'vec3' })); ok(a.addModule('constant', demoRaw('constant'))); step(a, 3);
      const snap = JSON.parse(JSON.stringify(a.snapshot()));
      assert.deepEqual(snap.modules.constant.outs, { center: [0, 0, 0] });
      const f = bus0(); ok(f.restoreSnapshot(snap, layoutOf(a)));
      ok(f.dock('mod:constant', 'center', 't')); step(f);
      assert.deepEqual(f.rails.get('t').value, [0, 0, 0], 'a restart then a dock of that output pushes the value');
   });

   await check('replay: a module that draws only now and then is drawn at the start of a segment too (a snapshot holds the draw list, and a restore keeps it)', () => {
      const RARE = "const time = input('time', 'state', 'time'); time.on(({ n }) => { if (n === 20 || n === 140) draw([{ shape: 'sphere', p: [n, 0, 0], s: .1, color: '#fff' }]); });";
      const b = bus0(), rec = new R.Recorder(b); ok(b.addModule('rare', RARE));
      const log = record(b); step(b, 200); b.pause();
      assert.deepEqual(rec.segments[2].snap.modules.rare.draw, [{ shape: 'sphere', p: [20, 0, 0], s: .1, color: '#fff' }]);
      const rp = new P.Replay(rec);
      for (const n of [170, 130, 61, 100, 199, 2]) sameAt(rp, log, n, 'rare');
      const f = bus0(); ok(f.restoreSnapshot(JSON.parse(JSON.stringify(rec.segments[2].snap)), { modules: { rare: RARE } }));
      assert.deepEqual(f.modules.get('rare').draw, [{ shape: 'sphere', p: [20, 0, 0], s: .1, color: '#fff' }], 'a restored module draws what it drew');
   });

   await check('replay: a module whose reload cannot be made again, or a snapshot that cannot be built, is a problem and not an exception', () => {
      const b = bus0(), rec = new R.Recorder(b); ok(b.addModule('m', COUNTER)); step(b, 10); ok(b.reload('m', COUNTER + ' // v2')); step(b, 10); b.pause();
      const reload = rec.segments[0].frames.flatMap(f => f.ops).find(o => o.k === 'reload');
      assert.equal(reload.source, COUNTER + ' // v2'); assert.equal(reload.ver, 2);
      reload.source = 'this is not javascript';
      const rp = new P.Replay(rec);
      assert.equal(rp.at(20 * B.DT), false); assert.match(rp.problem, /could not make 'm' again \(reload\)/); assert.equal(rp.bus, null);
      assert.equal(rp.at(0), false, 'a problem is kept until the replay is dropped');
   });

   // ---- the bus that wires itself: variables by name, `use`, `plug` ----

   const TIME = "const time = input('time', 'state', 'time');";
   const A = {
      osc: `${TIME} const target = output('target', 'state', 'vec3'); const S = state({ p: 0 });\ntime.on(({ dt }) => { S.p += dt; target.set([Math.sin(S.p) * .1, 0, Math.cos(S.p) * .1]); });`,
      ball: `${TIME} const target = input('target', 'state', 'vec3'); const S = state({ n: 0, last: [] });\ntarget.on(v => { S.n++; S.last = v; });\ntime.on(() => draw([{ shape: 'sphere', p: S.last.length ? S.last : [0, 0, 0], s: .01, color: '#fff' }]));`,
      // makes a variable and publishes a value into it every `every` ticks (n by default)
      maker: (name, kind = 'state', type = 'num', every = 1, val = 'n') => `${TIME} const o = output('${name}', '${kind}', '${type}');\ntime.on(({ n }) => { if (n % ${every} === 0) o.${kind === 'state' ? 'set' : 'emit'}(${val}); });`,
      // takes a variable and keeps what it heard
      probe: (name, kind = 'state', type = 'num') => `const i = input('${name}', '${kind}', '${type}'); const S = state({ n: 0, last: null });\ni.on(v => { S.n++; S.last = v; });`,
   };
   const portOf = (bus, id, name) => bus._ports.get(`mod:${id}.${name}`);
   const GAZE = { hit: { kind: 'state', type: 'vec3' }, on: { kind: 'state', type: 'bool' } }, POINTER = { pos: { kind: 'state', type: 'vec3' }, down: { kind: 'state', type: 'bool' } };
   // A wired bus with the devices the runtime adds: the clock, gaze and pointer (five built-in variables).
   const wiredBus = (opts = {}) => {
      const bus = new B.Bus(opts);
      bus.gaze = bus.addDevice({ id: 'gaze', outputs: GAZE, vars: { hit: 'gaze_hit', on: 'gaze_on' } });
      bus.pointer = bus.addDevice({ id: 'pointer', outputs: POINTER, vars: { pos: 'pointer_pos', down: 'pointer_down' } });
      return bus;
   };
   const names = bus => [...bus.rails.keys()].sort();
   const refused = (r, re) => { assert.equal(r.ok, false); assert.match(r.reason || r.error.message, re); };

   await check('the clock is the variable time, devices add built-in variables at once, and none of them is ever swept', () => {
      const bus = new B.Bus({ seed: 5 });
      assert.equal(bus.auto, true); assert.deepEqual([...bus.builtins], ['time']);
      assert.ok(bus.rails.has('time') && !bus.rails.has('clock'));
      assert.equal(bus.devices.get('clock').ports[0].rail, 'time'); assert.equal(bus.rails.get('time').type, 'time');
      const log = logOps(bus);
      const gaze = bus.addDevice({ id: 'gaze', outputs: GAZE, vars: { hit: 'gaze_hit', on: 'gaze_on' } });
      assert.deepEqual([...bus.builtins].sort(), ['gaze_hit', 'gaze_on', 'time']);
      assert.equal(bus.rails.get('gaze_hit').type, 'vec3'); assert.equal(bus.rails.get('gaze_on').type, 'bool');
      assert.equal(bus.devices.get('gaze').ports[0].rail, 'gaze_hit', 'docked at once, not queued'); assert.equal(bus.queue.length, 0);
      assert.deepEqual(log.filter(o => o.k === 'dock').map(o => [o.owner, o.port, o.rail]), [['dev:gaze', 'hit', 'gaze_hit'], ['dev:gaze', 'on', 'gaze_on']]);
      ok(bus.addModule('m', `${TIME} const g = input('gaze_hit', 'state', 'vec3'); const S = state({ ticks: 0, hit: null });\ntime.on(() => { S.ticks++; }); g.on(v => { S.hit = v; });`));
      assert.equal(portOf(bus, 'm', 'time').rail, 'time'); assert.equal(portOf(bus, 'm', 'gaze_hit').rail, 'gaze_hit');
      gaze.set('hit', [1, 2, 3]); step(bus, 10);
      assert.equal(mod(bus, 'm').state.ticks, 10, 'one tick a step: the dock to time is not handed a retained tick');
      assert.deepEqual(mod(bus, 'm').state.hit, [1, 2, 3]);
      ok(bus.removeModule('m')); step(bus, 2);
      assert.deepEqual(names(bus), ['gaze_hit', 'gaze_on', 'time'], 'built-ins stay with no port but the device');
      const dev = vars => () => new B.Bus().addDevice({ id: 'x', outputs: { a: { kind: 'state', type: 'num' } }, vars: vars.vars });
      assert.throws(dev({ vars: { a: 'BAD' } }), /variable name/);
      assert.throws(dev({ vars: { a: 'time' } }), /already/);
      assert.throws(dev({ vars: { b: 'xb' } }), /no output 'b'/);
   });

   await check('two modules bind by name at once; the dock ops are the ordinary ones, outputs first', () => {
      const bus = new B.Bus(), log = logOps(bus);
      ok(bus.addModule('osc', A.osc)); ok(bus.addModule('ball', A.ball));
      assert.equal(portOf(bus, 'osc', 'target').rail, 'target'); assert.equal(portOf(bus, 'ball', 'target').rail, 'target');
      assert.equal(portOf(bus, 'ball', 'time').rail, 'time');
      const r = bus.rails.get('target'); assert.equal(r.kind, 'state'); assert.equal(r.type, 'vec3');
      assert.deepEqual(log.filter(o => o.k === 'dock').map(o => [o.owner, o.port, o.rail]),
         [['mod:osc', 'target', 'target'], ['mod:osc', 'time', 'time'], ['mod:ball', 'time', 'time'], ['mod:ball', 'target', 'target']]);
      step(bus, 5);
      assert.equal(mod(bus, 'ball').state.n, 5); assert.deepEqual(mod(bus, 'ball').state.last, [...bus.rails.get('target').value]);
      assert.equal(bus.rails.get('target').by, 'mod:osc.target');
   });

   await check('an input with no variable yet waits (no rail is made for it) and binds when the variable appears', () => {
      const bus = new B.Bus();
      ok(bus.addModule('ball', A.ball)); step(bus, 2);
      assert.equal(portOf(bus, 'ball', 'target').rail, null); assert.ok(!bus.rails.has('target'));
      assert.equal(mod(bus, 'ball').status, 'ok');
      ok(bus.addModule('osc', A.osc));
      assert.equal(portOf(bus, 'ball', 'target').rail, 'target');
      step(bus, 3); assert.ok(mod(bus, 'ball').state.n >= 2);
      // and through a reload that adds the output
      const b = new B.Bus(); ok(b.addModule('probe', A.probe('x'))); ok(b.addModule('m', 'const nothing = 1;'));
      ok(b.reload('m', A.maker('x'))); assert.equal(portOf(b, 'probe', 'x').rail, null, 'queued, not applied');
      step(b, 4); assert.equal(portOf(b, 'probe', 'x').rail, 'x'); assert.ok(mod(b, 'probe').state.n >= 3);
   });

   await check('a reload that keeps its ports keeps the variable (value, seq, tail), and so does removing a publisher and re-adding its variable in one step', () => {
      const bus = new B.Bus();
      ok(bus.addModule('osc', A.osc)); ok(bus.addModule('ball', A.ball)); step(bus, 40);
      const r = bus.rails.get('target'), seq = r.seq;
      ok(bus.reload('osc', `${A.osc}\n// v2\n`)); step(bus);
      assert.equal(bus.rails.get('target'), r, 'the same rail'); assert.equal(r.seq, seq + 1); assert.equal(r.tail.length, 32);
      // the publisher of `x` goes and another card's reload brings `x` in the same step: the variable is not swept in between
      const b = new B.Bus();
      ok(b.addModule('a', A.maker('x'))); ok(b.addModule('b', A.maker('y'))); step(b, 20);
      const x = b.rails.get('x'), xseq = x.seq;
      ok(b.removeModule('a')); ok(b.reload('b', A.maker('x'))); step(b);
      assert.equal(b.rails.get('x'), x, 'x kept its value, seq and tail'); assert.equal(x.seq, xseq + 1); assert.equal(x.tail[0].seq, 1);
      assert.ok(!b.rails.has('y'), 'y has no port left and is swept at the end of the step');
      assert.equal(portOf(b, 'b', 'x').rail, 'x');
   });

   await check('a variable with no docked port left is swept at the end of the step; one that is still taken stays, with no publisher', () => {
      const bus = new B.Bus();
      ok(bus.addModule('osc', A.osc)); ok(bus.addModule('ball', A.ball)); step(bus, 10);
      ok(bus.removeModule('osc')); step(bus);
      const r = bus.rails.get('target'); assert.ok(r, 'the ball still takes it'); assert.equal(r.stale, true); assert.equal(r.value.length, 3, 'its last value stays');
      assert.equal(portOf(bus, 'ball', 'target').rail, 'target');
      ok(bus.removeModule('ball')); step(bus);
      assert.deepEqual(names(bus), ['time']); assert.equal(bus._docked.has('target'), false);
      // a variable nobody takes, whose only publisher goes
      ok(bus.addModule('m', A.maker('lonely', 'event'))); assert.ok(bus.rails.has('lonely'));
      ok(bus.removeModule('m')); assert.ok(bus.rails.has('lonely'), 'not before the step'); step(bus); assert.ok(!bus.rails.has('lonely'));
   });

   await check('use points an input at another variable, resets with null, and refuses what cannot work', () => {
      const bus = wiredBus(), log = logOps(bus);
      ok(bus.addModule('osc', A.osc)); ok(bus.addModule('ball', A.ball)); step(bus, 3);
      ok(bus.addModule('ev', A.maker('spark', 'event', 'num', 10)));
      ok(bus.use('ball', 'target', 'gaze_hit')); assert.deepEqual(bus.uses, {}, 'queued, not applied');
      step(bus); assert.deepEqual(bus.uses, { 'ball.target': 'gaze_hit' });
      assert.equal(portOf(bus, 'ball', 'target').rail, 'gaze_hit');
      assert.ok(log.some(o => o.k === 'dock' && o.owner === 'mod:ball' && o.port === 'target' && o.rail === 'gaze_hit'));
      assert.ok(log.some(o => o.k === 'undock' && o.owner === 'mod:ball' && o.port === 'target' && o.rail === 'target'));
      bus.gaze.set('hit', [.1, 0, .2]); step(bus, 2); assert.deepEqual(mod(bus, 'ball').state.last, [.1, 0, .2]);
      assert.ok(bus.rails.has('target'), 'osc still publishes it');
      // refusals queue nothing
      refused(bus.use('ball', 'target', 'nothing'), /no variable 'nothing'/);
      refused(bus.use('osc', 'target', 'gaze_hit'), /osc\.target is an output/);
      refused(bus.use('ball', 'target', 'spark'), /kind mismatch/);
      refused(bus.use('ball', 'time', 'gaze_hit'), /type mismatch/);
      refused(bus.use('zzz', 'x', 'target'), /no module 'zzz'/);
      refused(bus.use('ball', 'q', 'target'), /no port 'q'/);
      refused(bus.use('ball', 'target', 5), /variable name or null/);
      assert.equal(bus.queue.length, 0);
      // a reset, and naming the default is a reset
      ok(bus.use('ball', 'target', null)); step(bus); assert.deepEqual(bus.uses, {}); assert.equal(portOf(bus, 'ball', 'target').rail, 'target');
      ok(bus.use('ball', 'target', 'gaze_hit')); step(bus); ok(bus.use('ball', 'target', 'target')); step(bus);
      assert.deepEqual(bus.uses, {}); assert.equal(portOf(bus, 'ball', 'target').rail, 'target');
      ok(bus.use('ball', 'target', null)); assert.equal(bus.queue.length, 0, 'nothing to reset');
      // while paused it queues like any structure call and applies on resume
      bus.pause(); ok(bus.use('ball', 'target', 'gaze_hit')); assert.equal(bus.step(), false); assert.equal(portOf(bus, 'ball', 'target').rail, 'target');
      bus.resume(); step(bus); assert.equal(portOf(bus, 'ball', 'target').rail, 'gaze_hit');
      // a use is checked against the queued ops: a port that a queued reload drops, a variable that a queued removal frees
      ok(bus.addModule('ball2', A.ball)); ok(bus.addModule('probe', A.probe('q', 'event', 'num')));
      ok(bus.reload('ball2', 'const nothing = 1;')); refused(bus.use('ball2', 'target', 'gaze_hit'), /no port 'target'/);
      ok(bus.removeModule('ev')); refused(bus.use('probe', 'q', 'spark'), /no variable 'spark'/);
   });

   await check('the two kinds of bus refuse each other\'s calls with a reason: a manual one has no use or plug, a wired one no rail or dock calls', () => {
      const manual = bus0(), wired = wiredBus();
      ok(manual.addModule('m', COUNTER)); ok(wired.addModule('m', COUNTER));
      refused(manual.use('m', 'time', null), /wires itself/); refused(manual.plug('m', false), /wires itself/);
      for (const r of [wired.addRail({ id: 'x', kind: 'state' }), wired.removeRail('time'), wired.dock('mod:m', 'time', 'time'), wired.undock('mod:m', 'time')]) refused(r, /wires itself/);
      assert.equal(wired.queue.length, 0, 'nothing was queued'); assert.equal(portOf(wired, 'm', 'time').rail, 'time');
   });

   await check('a use entry loaded for a missing variable waits; one for a gone module or port is dropped; an incompatible one stays unbound', () => {
      const bus = wiredBus();
      const layout = { modules: { ball: A.ball, probe: A.probe('x') }, uses: { 'ball.target': 'later', 'ghost.x': 'time', 'ball.nope': 'time', 'probe.x': 'gaze_on' }, unplugged: ['ghost'] };
      const r = bus.restore(layout); assert.equal(r.ok, true, JSON.stringify(r));
      assert.deepEqual(bus.uses, { 'ball.target': 'later', 'probe.x': 'gaze_on' }); assert.deepEqual([...bus.unplugged], []);
      assert.equal(portOf(bus, 'ball', 'target').rail, null); assert.equal(portOf(bus, 'probe', 'x').rail, null, 'bool is not num: unbound');
      ok(bus.addModule('later', A.maker('later', 'state', 'vec3', 1, '[n, 0, 0]')));
      assert.equal(portOf(bus, 'ball', 'target').rail, 'later'); step(bus, 3); assert.equal(mod(bus, 'ball').state.n, 3);
      assert.equal(portOf(bus, 'ball', 'target').rail, 'later', 'the entry, not the same-name default, decides');
      refused(bus.use('probe', 'x', 'gaze_on'), /type mismatch/);   // only a loaded entry may wait or stay incompatible
   });

   await check('plug off undocks every port of a card; plug-in publishes a state output again with its latest set(); an event emit while unplugged is dropped', () => {
      const bus = new B.Bus(), log = logOps(bus);
      ok(bus.addModule('osc', A.osc)); ok(bus.addModule('ball', A.ball)); step(bus, 10);
      const r = bus.rails.get('target'), seq = r.seq;
      ok(bus.plug('osc', false)); assert.equal(portOf(bus, 'osc', 'target').rail, 'target', 'queued'); step(bus);
      assert.deepEqual([...bus.unplugged], ['osc']);
      for (const n of ['time', 'target']) assert.equal(portOf(bus, 'osc', n).rail, null);
      assert.ok(log.some(o => o.k === 'undock' && o.owner === 'mod:osc' && o.port === 'target' && o.reason === 'unplugged'));
      const p = mod(bus, 'osc').state.p; step(bus, 5);
      assert.equal(r.stale, true); assert.equal(r.seq, seq, 'nothing published'); assert.equal(bus.rails.get('target'), r, 'the ball still takes it');
      assert.equal(portOf(bus, 'ball', 'target').rail, 'target'); assert.equal(mod(bus, 'osc').state.p, p, 'the card keeps its state but gets no time');
      ok(bus.plug('osc', true)); step(bus); assert.deepEqual([...bus.unplugged], []);
      assert.equal(portOf(bus, 'osc', 'target').rail, 'target'); assert.equal(r.stale, false); assert.ok(r.seq > seq);
      // a card reloaded while unplugged: its setup sets twice and emits; plug-in publishes the latest set only
      const b = new B.Bus(), SETUP = "const o = output('o', 'state', 'num'); const e = output('e', 'event', 'num'); o.set(41); o.set(42); e.emit(1);";
      ok(b.addModule('m', A.maker('o'))); ok(b.addModule('t', A.probe('o'))); ok(b.addModule('te', A.probe('e', 'event')));
      ok(b.plug('m', false)); step(b, 3); ok(b.reload('m', SETUP)); step(b);
      const before = b.rails.get('o').seq; ok(b.plug('m', true)); step(b, 2);
      assert.equal(b.rails.get('o').value, 42); assert.equal(b.rails.get('o').seq, before + 1); assert.equal(mod(b, 't').state.last, 42);
      assert.equal(mod(b, 'te').state.n, 0, 'the emit while unplugged was dropped');
      // already as asked: nothing is queued
      assert.equal(b.plug('m', true).ok, true); assert.equal(b.queue.length, 0); refused(b.plug('zzz', false), /no module 'zzz'/);
   });

   await check('conflicts are refused at queue time with a reason, before anything changes', () => {
      const bus = wiredBus();
      ok(bus.addModule('osc', A.osc)); ok(bus.addModule('ball', A.ball)); ok(bus.removeModule('osc')); step(bus);
      assert.ok(bus.rails.has('target'), 'taken by ball, no publisher');
      let r = bus.addModule('bad', "output('target', 'event', 'num');");
      assert.equal(r.ok, false); assert.equal(r.error.message, 'target is state vec3 (taken by ball), but event num here'); assert.equal(r.error.phase, 'setup');
      assert.ok(!bus.modules.has('bad'));
      ok(bus.addModule('osc', A.osc));
      assert.equal(bus.addModule('bad', "output('target', 'event', 'num');").error.message, 'target is event num here but state vec3 in osc');
      assert.equal(bus.addModule('bad', "output('target', 'state', 'any');").ok, false, 'any matches only any for an output');
      // a reload that changes the shape of a variable another card takes
      const ver = mod(bus, 'osc').ver, queued = bus.queue.length;
      r = bus.reload('osc', "output('target', 'event', 'num');");
      assert.equal(r.ok, false); assert.equal(r.error.message, 'target is state vec3 (taken by ball), but event num here');
      assert.equal(bus.queue.length, queued); step(bus); assert.equal(mod(bus, 'osc').ver, ver); assert.ok(mod(bus, 'osc').editError, 'the error is on the card');
      assert.equal(portOf(bus, 'ball', 'target').rail, 'target', 'old version and takers untouched'); assert.equal(portOf(bus, 'osc', 'target').rail, 'target');
      assert.equal(bus.stage('osc', "output('target', 'event', 'num');").ok, true); assert.equal(bus.commit('osc').ok, false);
      // built-in names
      for (const name of ['gaze_hit', 'time', 'pointer_down']) assert.equal(bus.addModule('b' + name, `output('${name}', 'state', 'any');`).error.message, `${name} is built in`);
      assert.equal(bus.reload('ball', `${A.ball}\noutput('gaze_on', 'state', 'bool');`).error.message, 'gaze_on is built in');
      // two reloads queued in one step: the second is checked against the first, whichever card is older
      const b = new B.Bus();
      ok(b.addModule('a', A.maker('p'))); ok(b.addModule('b', A.maker('q')));
      ok(b.reload('b', A.maker('x'))); r = b.reload('a', A.maker('x', 'event'));
      assert.equal(r.ok, false); assert.equal(r.error.message, 'x is event num here but state num in b');
      ok(b.reload('a', A.maker('x'))); step(b, 3);
      assert.equal(b.rails.get('x').contested, true); assert.ok(!b.rails.has('p') && !b.rails.has('q'));
      // plug-in of a card whose variable has been taken in another shape meanwhile
      const c = new B.Bus();
      ok(c.addModule('a', A.maker('x'))); ok(c.plug('a', false)); step(c);
      ok(c.addModule('b', A.maker('x', 'event')));
      r = c.plug('a', true); assert.equal(r.ok, false); assert.equal(r.reason, 'x is state num here but event num in b');
      assert.deepEqual([...c.unplugged], ['a']);
   });

   await check('at most 64 variables counting the built-ins; names swapped by a reload, or freed by a queued removal, fit', () => {
      const bus = wiredBus();
      const outs = (from, to) => Array.from({ length: to - from }, (_, i) => `output('v${from + i}', 'state', 'num');`).join(' ');
      ok(bus.addModule('one', "output('extra', 'state', 'num');")); ok(bus.plug('one', false)); step(bus);
      assert.equal(bus.rails.has('extra'), false);
      ok(bus.addModule('many', outs(0, 59))); assert.equal(bus.rails.size, 64);
      const over = bus.addModule('over', "output('extra', 'state', 'num');");
      assert.equal(over.ok, false); assert.equal(over.error.message, 'too many variables (64)'); assert.ok(!bus.modules.has('over'));
      ok(bus.addModule('join', "output('v20', 'state', 'num');"));       // an existing name is not a new variable
      refused(bus.plug('one', true), /^too many variables \(64\)$/);
      assert.equal(bus.reload('many', outs(0, 60)).error.message, 'too many variables (64)');
      ok(bus.reload('many', outs(10, 69))); step(bus);                  // ten names out, ten in
      assert.equal(bus.rails.size, 64); assert.ok(bus.rails.has('v68') && !bus.rails.has('v0'));
      ok(bus.removeModule('many')); ok(bus.removeModule('join'));
      ok(bus.plug('one', true));                                         // the queued removals free their variables
      step(bus); assert.deepEqual(names(bus), ['extra', 'gaze_hit', 'gaze_on', 'pointer_down', 'pointer_pos', 'time']);
   });

   await check('an input whose same-name variable has another shape stays unbound, with no error', () => {
      const bus = new B.Bus();
      ok(bus.addModule('osc', A.osc)); ok(bus.addModule('num', A.probe('target', 'state', 'num'))); ok(bus.addModule('ev', A.probe('target', 'event', 'any')));
      ok(bus.addModule('any', A.probe('target', 'state', 'any')));
      assert.equal(portOf(bus, 'num', 'target').rail, null); assert.equal(portOf(bus, 'ev', 'target').rail, null);
      assert.equal(portOf(bus, 'any', 'target').rail, 'target', 'an any input takes anything of its kind');
      assert.equal(mod(bus, 'num').status, 'ok'); assert.equal(mod(bus, 'num').error, null); assert.equal(bus.notices.length, 0);
      step(bus, 3); assert.equal(mod(bus, 'num').state.n, 0); assert.ok(mod(bus, 'any').state.n >= 2);
      refused(bus.use('num', 'target', 'target'), /type mismatch/);
   });

   await check('rename moves uses and unplugged, rm drops them, a reload that drops an input drops its use with a notice', () => {
      const bus = wiredBus();
      ok(bus.addModule('ball', A.ball)); ok(bus.addModule('osc', A.osc));
      ok(bus.use('ball', 'target', 'gaze_hit')); ok(bus.plug('osc', false)); step(bus);
      ok(bus.renameModule('ball', 'ball2')); ok(bus.renameModule('osc', 'osc2')); step(bus);
      assert.deepEqual(bus.uses, { 'ball2.target': 'gaze_hit' }); assert.deepEqual([...bus.unplugged], ['osc2']);
      assert.equal(portOf(bus, 'ball2', 'target').rail, 'gaze_hit'); assert.equal(portOf(bus, 'osc2', 'target').rail, null);
      // a use queued after a rename names the new id
      ok(bus.renameModule('ball2', 'b3')); ok(bus.use('b3', 'target', 'pointer_pos')); step(bus);
      assert.deepEqual(bus.uses, { 'b3.target': 'pointer_pos' });
      const n = bus.notices.length;
      ok(bus.reload('b3', 'const nothing = 1;')); step(bus);
      assert.deepEqual(bus.uses, {}); assert.ok(bus.notices.length > n && /b3\.target/.test(bus.notices[bus.notices.length - 1].text), 'a notice says the use was dropped');
      ok(bus.removeModule('osc2')); step(bus); assert.deepEqual([...bus.unplugged], []);
      ok(bus.addModule('osc2', A.osc)); assert.equal(portOf(bus, 'osc2', 'target').rail, 'target', 'a new card of that name is plugged in');
   });

   // ---- the wired bus: snapshot and restore ----

   const driveAuto = (bus, from, to, at = {}) => {
      for (let i = from; i < to; i++) {
         if (i % 7 === 0) bus.gaze.set('hit', [Math.sin(i) * .1, 0, Math.cos(i) * .1]);
         if (at[i]) at[i](bus);
         bus.step();
      }
   };
   const wiredWorld = (seed = 11) => {
      const bus = wiredBus({ seed });
      for (const n of ['oscillator', 'ball', 'flowers']) ok(bus.addModule(n, demoRaw(n)));
      ok(bus.addModule('count', A.probe('planted', 'event', 'num')));
      return bus;
   };
   const dockPairs = bus => [...bus._ports.values()].filter(p => p.rail).map(p => `${p.owner}.${p.name}=${p.rail}`).sort();

   await check('the demo modules bind by name (the ball follows the oscillator, flowers are counted); a use and an unplug survive a snapshot and restore exactly', () => {
      const a = wiredWorld();
      driveAuto(a, 0, 200, { 50: b => ok(b.use('ball', 'target', 'gaze_hit')), 120: b => ok(b.plug('flowers', false)) });
      assert.ok(mod(a, 'count').state.n >= 2 && mod(a, 'flowers').state.count >= 2);
      assert.deepEqual(a.uses, { 'ball.target': 'gaze_hit' }); assert.deepEqual([...a.unplugged], ['flowers']);
      const snap = JSON.parse(JSON.stringify(a.snapshot())), layout = JSON.parse(JSON.stringify(layoutOf(a)));
      assert.deepEqual(snap.uses, { 'ball.target': 'gaze_hit' }); assert.deepEqual(snap.unplugged, ['flowers']);
      assert.deepEqual(layout.uses, snap.uses); assert.deepEqual(layout.unplugged, snap.unplugged);
      const b = wiredBus({ seed: 11 }); const r = b.restoreSnapshot(snap, layout); assert.equal(r.ok, true, JSON.stringify(r));
      assert.deepEqual(b.uses, a.uses); assert.deepEqual([...b.unplugged], ['flowers']); assert.deepEqual(dockPairs(b), dockPairs(a));
      const pairs0 = dockPairs(a), la = logOps(a), lb = logOps(b);
      driveAuto(a, 200, 300, { 230: x => ok(x.plug('flowers', true)) }); driveAuto(b, 200, 300, { 230: x => ok(x.plug('flowers', true)) });
      assert.deepEqual(b.snapshot(), a.snapshot()); assert.deepEqual(lb, la);
      // the bus snapshot wins over the layout, which only supplies the sources
      const c = wiredBus({ seed: 11 }); ok(c.restoreSnapshot(snap, { modules: layout.modules, uses: {}, unplugged: [] }));
      assert.deepEqual(c.uses, a.snapshot().uses); assert.deepEqual([...c.unplugged], ['flowers']);
      // the layout alone builds the same wiring
      const d = wiredBus({ seed: 11 }); ok(d.restore(layout));
      assert.deepEqual(d.uses, snap.uses); assert.deepEqual([...d.unplugged], ['flowers']);
      assert.deepEqual(dockPairs(d), pairs0);
      assert.equal(d.restore(layout).ok, false, 'a restored bus is not fresh');
      // a fresh bus is one with only its built-ins, whichever devices were added
      assert.equal(new B.Bus().restore({ modules: {} }).ok, true);
   });

   await check('loading a layout whose cards conflict leaves the later one out with an error; an unplugged card does not conflict', () => {
      const bus = wiredBus();
      const r = bus.restore({ modules: { a: A.maker('x'), b: A.maker('x', 'event'), c: A.maker('x'), d: A.maker('x', 'event') }, unplugged: ['d'] });
      assert.equal(r.ok, false); assert.equal(r.errors.length, 1); assert.equal(r.errors[0].what, 'module b');
      assert.equal(r.errors[0].message, 'x is event num here but state num in a');
      assert.deepEqual([...bus.modules.keys()], ['a', 'c', 'd']); assert.deepEqual([...bus.unplugged], ['d']);
      step(bus, 3); assert.equal(bus.rails.get('x').contested, true);
   });

   await check('reconcile is idempotent: a second pass changes and logs nothing', () => {
      const bus = wiredWorld();
      driveAuto(bus, 0, 50, { 10: b => ok(b.use('ball', 'target', 'gaze_hit')), 20: b => ok(b.plug('count', false)) });
      const ops = logOps(bus), rev = bus.rev, rails = names(bus);
      bus._reconcile(); bus._reconcile(true);
      assert.deepEqual(ops, []); assert.equal(bus.rev, rev); assert.deepEqual(names(bus), rails);
      assert.equal(portOf(bus, 'count', 'planted').rail, null); assert.equal(portOf(bus, 'ball', 'time').rail, 'time');
   });

   // ---- the wired bus: the tape ----

   const pick = r => ({ kind: r.kind, type: r.type, value: r.value, by: r.by, seq: r.seq, stale: !!r.stale });
   const liveRails = bus => Object.fromEntries([...bus.rails].map(([id, r]) => [id, pick(r)]));
   const tapeRails = (rec, t) => Object.fromEntries(Object.entries(P.railsAt(rec, t)).map(([id, r]) => [id, pick(r)]));

   await check('railsAt equals the live variables at every step, through use, plug, reload, rm and a variable made again', () => {
      const bus = wiredBus({ seed: 4 }), rec = new R.Recorder(bus), states = new Map(), tails = new Map();
      const capture = () => { states.set(bus.n, liveRails(bus)); tails.set(bus.n, bus.rails.has('planted') ? bus.rails.get('planted').tail.slice(-8).map(m => [m.t, m.v, m.by]) : null); };
      for (const n of ['oscillator', 'ball', 'flowers']) ok(bus.addModule(n, demoRaw(n)));
      ok(bus.addModule('count', A.probe('planted', 'event', 'num')));
      const at = {
         20: b => ok(b.use('ball', 'target', 'gaze_hit')),
         60: b => ok(b.plug('flowers', false)), 80: b => ok(b.plug('flowers', true)),
         100: b => ok(b.removeModule('count')), 120: b => ok(b.addModule('count', A.probe('planted', 'event', 'num'))),
         140: b => ok(b.removeModule('flowers')), 160: b => ok(b.removeModule('count')),
         170: b => { ok(b.addModule('lone', A.maker('solo'))); ok(b.addModule('blip', A.maker('blip', 'event', 'num', 5))); ok(b.addModule('hear', A.probe('blip', 'event', 'num'))); },
         190: b => { ok(b.plug('lone', false)); ok(b.plug('blip', false)); ok(b.plug('hear', false)); },
         200: b => { ok(b.plug('lone', true)); ok(b.plug('blip', true)); ok(b.plug('hear', true)); },
         220: b => { ok(b.reload('ball', `${demoRaw('ball')}\n// v2\n`)); ok(b.reload('oscillator', demoRaw('oscillator').replace("'target'", "'aim'"))); },
         240: b => ok(b.use('ball', 'target', null)), 260: b => ok(b.use('ball', 'target', 'aim')),
         280: b => { ok(b.plug('hear', false)); ok(b.removeModule('blip')); },
      };
      capture();
      for (let i = 0; i < 320; i++) {
         if (i % 7 === 0) bus.gaze.set('hit', [Math.sin(i) * .1, 0, Math.cos(i) * .1]);
         if (at[i]) { at[i](bus); capture(); }
         bus.step(); capture();
      }
      assert.ok(!bus.rails.has('target') && bus.rails.has('aim') && bus.rails.has('solo'));
      let compared = 0;
      for (let n = 1; n <= 320; n++) {
         assert.deepEqual(tapeRails(rec, n * B.DT), states.get(n), `step ${n}`); compared++;
         if (tails.get(n)) assert.deepEqual(P.railsAt(rec, n * B.DT).planted.recent.map(m => [m.t, m.v, m.by]), tails.get(n), `recent at ${n}`);
      }
      assert.equal(compared, 320);
      // the tape knows the variables that came and went
      assert.ok(rec.segments.some(s => s.born.blip || s.snap.rails.blip));
   });

   await check('the recent messages of an event variable that was swept and made again start afresh, while another event variable is still open', () => {
      const bus = new B.Bus(), rec = new R.Recorder(bus);
      ok(bus.addModule('ea', A.maker('ea', 'event', 'num', 3))); ok(bus.addModule('eb', A.maker('eb', 'event', 'num', 40)));
      step(bus, 100); ok(bus.plug('ea', false)); step(bus, 6); assert.ok(!bus.rails.has('ea')); ok(bus.plug('ea', true)); step(bus, 12);
      const live = id => bus.rails.get(id).tail.slice(-8).map(m => [m.t, m.v, m.by]);
      const tape = P.railsAt(rec, bus.t);
      for (const id of ['ea', 'eb']) assert.deepEqual(tape[id].recent.map(m => [m.t, m.v, m.by]), live(id), id);
      assert.ok(live('ea').length < 8, 'only what was said since the variable was made again');
   });

   await check('the recorder notes the rail of every dock op, so a variable made and swept inside the window still has its kind and type', () => {
      const bus = new B.Bus(), rec = new R.Recorder(bus);
      step(bus, 3); ok(bus.addModule('m', A.maker('x')));
      assert.deepEqual(rec.segments[0].born.x, { kind: 'state', type: 'num' }, 'docked between steps');
      ok(bus.reload('m', `${A.maker('x')} output('z', 'event', 'num');`)); step(bus);
      assert.deepEqual(rec.segments[0].born.z, { kind: 'event', type: 'num' }, 'docked in a step');
      ok(bus.reload('m', `${A.maker('x')} output('w', 'event', 'num');`)); ok(bus.reload('m', A.maker('x'))); step(bus);
      assert.ok(!bus.rails.has('w') && !bus.rails.has('z')); assert.deepEqual(rec.segments[0].born.w, { kind: 'event', type: 'num' }, 'made and swept in one step');
   });

   // The replay's private bus is a manual one: it replays the tape's docks and undocks, and the use, plug and module ops, from the tape.
   const wiredReplayWorld = ({ steps = 900 } = {}) => {
      const bus = wiredBus({ seed: 3 }), rec = new R.Recorder(bus);
      for (const n of ['oscillator', 'ball', 'flowers']) ok(bus.addModule(n, demoRaw(n)));
      ok(bus.addModule('count', A.probe('planted', 'event', 'num')));
      ok(bus.addModule('tally', A.probe('spark', 'event', 'num')));
      const log = record(bus);
      const at = {
         100: b => ok(b.use('ball', 'target', 'gaze_hit')),
         200: b => ok(b.addModule('ev', A.maker('spark', 'event', 'num', 10))),
         300: b => { ok(b.plug('ev', false)); ok(b.plug('tally', false)); },        // spark has no port left: swept
         330: b => ok(b.plug('tally', true)),                                      // waits
         360: b => ok(b.plug('ev', true)),                                         // made again, taken again
         400: b => ok(b.use('ball', 'target', null)),
         450: b => ok(b.plug('flowers', false)), 500: b => ok(b.plug('flowers', true)),
         550: b => ok(b.reload('ball', `${demoRaw('ball')}\n// reloaded\n`)),
         600: b => { ok(b.plug('ball', false)); ok(b.plug('count', false)); }, 640: b => { ok(b.plug('ball', true)); ok(b.plug('count', true)); },
         700: b => ok(b.use('count', 'planted', 'spark')),                         // an event variable of another name
         750: b => ok(b.reload('oscillator', demoRaw('oscillator'), { resetState: true })),
         800: b => ok(b.renameModule('tally', 'tally2')),
         830: b => ok(b.removeModule('ev')),
      };
      driveAuto(bus, 0, steps, at);
      bus.pause();
      return { bus, rec, log };
   };
   const aw = wiredReplayWorld();

   await check('replay: exact on the wired bus after a use, an unplug, an event variable made, docked and swept, a card added, renamed and removed, a reload and a reset', () => {
      assert.ok(aw.rec.segments.length >= 10);
      const rp = new P.Replay(aw.rec);
      for (let n = 1; n <= 900; n++) sameAt(rp, aw.log, n, 'wired');
      for (let n = 900; n >= 1; n -= 11) sameAt(rp, aw.log, n, 'wired back');
      assert.equal(rp.problem, null);
      for (let n = 1; n <= 900; n += 37) { sameAt(rp, aw.log, n, 'wired scatter'); sameAt(rp, aw.log, 901 - n, 'wired scatter'); }
   });

   await check('replay: the wiring at a step is the replay\'s too (uses, unplugged and the docks), so that a live bus can be made from it', () => {
      const wiring = bus => JSON.stringify([bus.uses, [...bus.unplugged].sort(), dockPairs(bus).filter(d => !d.startsWith('dev:clock'))]);
      const live = new Map(), again = wiredBus({ seed: 3 });
      for (const n of ['oscillator', 'ball', 'flowers']) ok(again.addModule(n, demoRaw(n)));
      ok(again.addModule('count', A.probe('planted', 'event', 'num'))); ok(again.addModule('tally', A.probe('spark', 'event', 'num')));
      const rec = new R.Recorder(again);
      again.onStep(({ n }) => live.set(n, wiring(again)));
      driveAuto(again, 0, 450, { 100: b => ok(b.use('ball', 'target', 'gaze_hit')), 300: b => ok(b.plug('tally', false)), 330: b => ok(b.plug('tally', true)), 400: b => ok(b.use('ball', 'target', null)) });
      const rp = new P.Replay(rec);
      for (const n of [50, 100, 101, 299, 300, 301, 331, 399, 400, 401, 450]) { assert.ok(rp.at(n * B.DT), rp.problem); assert.equal(wiring(rp.bus), live.get(n), `wiring at ${n}`); }
      assert.notEqual(live.get(150), live.get(50), 'the world did change');
   });

   await check('replay: a card added between steps on a segment boundary (the value it was still to be handed is in the inbox of the tape), a variable swept with messages in flight, a variable made again', () => {
      // a card added right after the 60th step: its dock hands it osc's value in the next step, which the snapshot of that segment cannot hold
      const bus = new B.Bus({ seed: 6 }), rec = new R.Recorder(bus);
      ok(bus.addModule('osc', A.osc)); const log = record(bus); step(bus, 60); ok(bus.addModule('ball', A.ball)); step(bus, 100); bus.pause();
      assert.deepEqual(rec.segments[1].inbox, [{ to: 'mod:ball.target' }]); assert.deepEqual(rec.segments[0].inbox, []);
      const rp = new P.Replay(rec);
      for (let n = 1; n <= 160; n++) sameAt(rp, log, n, 'boundary', );
      const saved = rec.segments[1].inbox; rec.segments[1].inbox = [];
      const bare = new P.Replay(rec); bare.at(100 * B.DT);
      assert.notEqual(JSON.stringify(bare.bus.modules.get('ball').state), log.get(100).mods.ball[1], 'without the delivery that was to come, the ball misses a call');
      rec.segments[1].inbox = saved;
      // a card that takes its own output (a loop of several passes a step), unplugged: the variable is swept with messages in flight
      const b = new B.Bus({ seed: 6 }), rb = new R.Recorder(b);
      ok(b.addModule('loopy', `${TIME} const i = input('x', 'state', 'num'); const o = output('y', 'state', 'num'); const S = state({ n: 0 });\ni.on(v => { S.n++; o.set(v + 1); });\ntime.on(({ n }) => { if (n === 3) o.set(0); });`));
      ok(b.use('loopy', 'x', 'y')); const lb = record(b); step(b, 130); ok(b.plug('loopy', false)); step(b, 30); ok(b.plug('loopy', true)); step(b, 150); b.pause();
      const lp = new P.Replay(rb);
      for (let n = 1; n <= 310; n++) sameAt(lp, lb, n, 'loopy');
      // a state variable that goes with both of its cards and is made again by the publisher alone, then taken again
      const c = new B.Bus({ seed: 6 }), rc = new R.Recorder(c);
      ok(c.addModule('osc', A.osc)); ok(c.addModule('ball', A.ball)); const lc = record(c); step(c, 100);
      ok(c.plug('osc', false)); ok(c.plug('ball', false)); step(c, 40); assert.ok(!c.rails.has('target'));
      ok(c.plug('ball', true)); step(c, 30); ok(c.plug('osc', true)); step(c, 100); c.pause();
      const cp = new P.Replay(rc);
      for (let n = 1; n <= 270; n++) sameAt(cp, lc, n, 'made again');
   });

   await check('replay: a feedback cycle between two cards, cut at the last pass of every step, is exact (the messages in flight are in the tape)', () => {
      const PING = "const time = input('time', 'state', 'time'); const pong = input('pong', 'event', 'num'); const ping = output('ping', 'event', 'num'); const S = state({ k: 0 });\n" +
         "time.on(({ n }) => { if (n === 3) ping.emit(1); }); pong.on(v => { S.k += v; ping.emit(v + 1); draw([{ shape: 'sphere', p: [S.k % 7, 0, 0], s: .1, color: '#fff' }]); });";
      const PONG = "const ping = input('ping', 'event', 'num'); const pong = output('pong', 'event', 'num'); const S = state({ k: 0 });\nping.on(v => { S.k += v; pong.emit(v + 1); draw([{ shape: 'box', p: [S.k % 5, 0, 0], s: [.1, .1, .1], color: '#fff' }]); });";
      const b = new B.Bus({ seed: 2 }), rec = new R.Recorder(b, { window: 2 });
      ok(b.addModule('ping', PING)); ok(b.addModule('pong', PONG));
      const log = record(b); step(b, 400); b.pause();
      assert.ok(rec.segments.some(s => s.inbox.length > 0), 'the cycle is cut at the last pass');
      const rp = new P.Replay(rec), from = rec.segments[0].snap.n;
      for (let n = from + 1; n <= 400; n++) sameAt(rp, log, n, 'cycle');
      for (let n = 400; n > from; n -= 9) sameAt(rp, log, n, 'cycle back');
   });

   // ---- the runtime: the demo by name, use and plug as commands, the snapshot head, the layout (and an old one converted) ----
   const Sn = await load('js/scenes/rails/snapshotter.js');
   const demoV2 = () => ({ ...JSON.parse(fs.readFileSync(path.join(root, 'data', 'layout.js'), 'utf8').trim().slice('export default '.length, -1)), uses: {}, unplugged: [] });   // the saved wiring is the last session's
   const demoSources = () => { const s = {}; for (const n of moduleNames) s[n] = demoRaw(n); return s; };
   const wiredRuntime = (layout = demoV2(), sources = demoSources(), seed = 1) => {
      const rt = new R2.Runtime({ seed });
      const r = rt.load({ layout, sources });
      assert.deepEqual(r.errors, [], JSON.stringify(r.errors));
      return rt;
   };
   const cmd = (rt, op, extra = {}) => rt.handle({ id: 1, op, ...extra });
   const good = (rt, op, extra) => { const a = cmd(rt, op, extra); assert.equal(a.ok, true, a.reason); return a; };
   const refusedBy = (rt, op, extra, re) => { const a = cmd(rt, op, extra); assert.equal(a.ok, false, `${op} should be refused`); assert.match(a.reason, re); };
   const run = (rt, k) => { for (let i = 0; i < k; i++) rt.step(); };
   const ballAt = rt => { const p = rt.bus.modules.get('ball').state.p; return [p[0], p[2]]; };
   const railOf = (rt, card, port) => rt.bus.modules.get(card).ports.find(p => p.name === port).rail;
   const BUILTINS = ['time', 'gaze_hit', 'gaze_on', 'pointer_pos', 'pointer_down'];
   const sortedKeys = m => [...m.keys()].sort();

   await check('runtime: the demo by name (the ball follows the oscillator, no uses), built-in variables, devices', () => {
      const rt = wiredRuntime();
      assert.equal(rt.notices.length, 0);
      assert.deepEqual(sortedKeys(rt.bus.rails), [...BUILTINS, 'center', 'planted', 'target'].sort());
      run(rt, 120);
      for (const [id, m] of rt.bus.modules) assert.equal(m.status, 'ok', id);
      assert.equal(railOf(rt, 'ball', 'target'), 'target'); assert.equal(railOf(rt, 'ball', 'time'), 'time');
      assert.equal(railOf(rt, 'oscillator', 'target'), 'target'); assert.equal(railOf(rt, 'constant', 'center'), 'center');
      assert.deepEqual(rt.bus.uses, {}); assert.equal(rt.bus.unplugged.size, 0);
      assert.equal(rt.bus.rails.get('target').writers.length, 1, 'only the oscillator publishes target');
      assert.deepEqual(rt.bus.rails.get('center').value, [0, 0, 0]);
      const a = ballAt(rt); run(rt, 60); const b = ballAt(rt);
      assert.ok(Math.hypot(b[0] - a[0], b[1] - a[1]) > .005, `the ball moves: ${a} -> ${b}`);
      assert.ok(rt.bus.modules.get('flowers').draw.length >= 1 && rt.bus.rails.get('planted').seq > 0);
      assert.deepEqual(Object.keys(rt.devices).sort(), ['gaze', 'pointer']);
      assert.equal(rt.setDevice('gaze', 'hit', [.1, 0, .2]).ok, true); assert.equal(rt.setDevice('gaze', 'on', true).ok, true);
      assert.equal(rt.setDevice('pointer', 'pos', [.3, 0, .4]).ok, true); assert.equal(rt.setDevice('pointer', 'down', true).ok, true);
      run(rt, 2);
      assert.deepEqual(rt.bus.rails.get('gaze_hit').value, [.1, 0, .2]); assert.equal(rt.bus.rails.get('gaze_on').value, true);
      assert.deepEqual(rt.bus.rails.get('pointer_pos').value, [.3, 0, .4]); assert.equal(rt.bus.rails.get('pointer_down').value, true);
      assert.ok(!rt.bus.rails.has('clock') && !rt.bus.rails.has('gaze'), 'rails are named by variable');
   });

   await check('runtime: use points an input at another variable, resets it, and is refused with a reason', () => {
      const rt = wiredRuntime(); run(rt, 60);
      const rev = rt.snapshot().rev;
      good(rt, 'use', { module: 'ball', port: 'target', variable: 'pointer_pos' }); run(rt, 1);
      assert.equal(railOf(rt, 'ball', 'target'), 'pointer_pos'); assert.equal(railOf(rt, 'flowers', 'target'), 'target', 'only the ball moved');
      assert.deepEqual(rt.layoutFile().uses, { 'ball.target': 'pointer_pos' });
      assert.ok(rt.snapshot().rev > rev, 'a use changes rev');
      rt.setDevice('pointer', 'pos', [.1, 0, .1]); run(rt, 150);
      near(ballAt(rt)[0], .1, 1e-3); near(ballAt(rt)[1], .1, 1e-3);
      good(rt, 'use', { module: 'ball', port: 'target', variable: 'center' }); run(rt, 150);
      near(ballAt(rt)[0], 0, 1e-3); near(ballAt(rt)[1], 0, 1e-3);
      good(rt, 'use', { module: 'ball', port: 'target', variable: 'gaze_hit' }); rt.setDevice('gaze', 'hit', [-.1, 0, .05]); run(rt, 150);
      near(ballAt(rt)[0], -.1, 1e-3); near(ballAt(rt)[1], .05, 1e-3);
      good(rt, 'use', { module: 'ball', port: 'target', variable: null }); run(rt, 1);
      assert.equal(railOf(rt, 'ball', 'target'), 'target'); assert.deepEqual(rt.layoutFile().uses, {});
      good(rt, 'use', { module: 'ball', port: 'target', variable: null });      // nothing to reset is not a refusal
      good(rt, 'use', { module: 'ball', port: 'target', variable: 'target' });  // naming the default is a reset
      assert.deepEqual(rt.bus.uses, {});
      // refusals, each with its reason, and nothing changes
      const r0 = rt.snapshot().rev;
      refusedBy(rt, 'use', { module: 'ball', port: 'target', variable: 'nope' }, /no variable 'nope'/);
      refusedBy(rt, 'use', { module: 'ball', port: 'target', variable: 'planted' }, /kind mismatch/);
      refusedBy(rt, 'use', { module: 'ball', port: 'target', variable: 'gaze_on' }, /type mismatch/);
      refusedBy(rt, 'use', { module: 'zed', port: 'target', variable: 'center' }, /no module 'zed'/);
      refusedBy(rt, 'use', { module: 'ball', port: 'nope', variable: 'center' }, /no port 'nope'/);
      refusedBy(rt, 'use', { module: 'oscillator', port: 'target', variable: 'center' }, /is an output/);
      refusedBy(rt, 'use', { module: 'ball', port: 'target', variable: 5 }, /a variable name or null/);
      run(rt, 2); assert.deepEqual(rt.bus.uses, {}); assert.equal(rt.snapshot().rev, r0);
   });

   await check('runtime: while paused a use is acked and applies when the run resumes', () => {
      const rt = wiredRuntime(); run(rt, 30);
      good(rt, 'pause'); good(rt, 'use', { module: 'ball', port: 'target', variable: 'center' }); good(rt, 'plug', { module: 'oscillator', on: false });
      run(rt, 5); assert.deepEqual(rt.bus.uses, {}, 'queued'); assert.equal(rt.bus.unplugged.size, 0);
      good(rt, 'resume'); run(rt, 2);
      assert.deepEqual(rt.bus.uses, { 'ball.target': 'center' }); assert.deepEqual([...rt.bus.unplugged], ['oscillator']);
   });

   await check('runtime: plug off stops a card (flowers stop, the variable has no publisher), plug on brings it back; refusals', () => {
      const rt = wiredRuntime(); run(rt, 120);
      const count = () => rt.bus.modules.get('flowers').state.count;
      assert.ok(count() >= 1);
      const rev = rt.snapshot().rev;
      good(rt, 'plug', { module: 'oscillator', on: false }); run(rt, 40);
      assert.deepEqual([...rt.bus.unplugged], ['oscillator']); assert.equal(railOf(rt, 'oscillator', 'target'), null);
      assert.ok(rt.bus.rails.has('target'), 'the ball and the flowers still take it'); assert.equal(rt.bus.rails.get('target').stale, true, 'no publisher: stale');
      assert.ok(rt.snapshot().rev > rev, 'a plug changes rev');
      const before = count(), at0 = ballAt(rt); run(rt, 200);
      assert.equal(count(), before, 'a target that no longer moves plants nothing'); assert.deepEqual(ballAt(rt), ballAt(rt));
      near(Math.hypot(ballAt(rt)[0] - at0[0], ballAt(rt)[1] - at0[1]), 0, 2e-3);
      assert.deepEqual(rt.layoutFile().unplugged, ['oscillator']);
      good(rt, 'plug', { module: 'oscillator', on: true }); run(rt, 200);
      assert.equal(railOf(rt, 'oscillator', 'target'), 'target'); assert.ok(count() > before, 'planting goes on'); assert.deepEqual(rt.layoutFile().unplugged, []);
      good(rt, 'plug', { module: 'oscillator', on: true });                 // already plugged: nothing to do
      refusedBy(rt, 'plug', { module: 'zed', on: false }, /no module 'zed'/);
      refusedBy(rt, 'plug', { module: 'ball', on: 'no' }, /true or false/);
   });

   await check('runtime: the snapshot head has vars (sorted, rails exactly), uses, unplugged and geometry cards only', () => {
      const rt = wiredRuntime(); run(rt, 10);
      const s = rt.snapshot();
      assert.deepEqual(s.vars, [...rt.bus.rails.keys()].sort()); assert.deepEqual(s.uses, {}); assert.deepEqual(s.unplugged, []);
      assert.deepEqual(Object.keys(s.geometry), ['cards']); assert.deepEqual(Object.keys(s.geometry.cards).sort(), ['ball', 'constant', 'flowers', 'oscillator']);
      assert.ok(Object.keys(s.rails).length === s.vars.length && Object.keys(s.rails).every(v => s.vars.includes(v)), 'rails are the variables');
      assert.ok(Object.values(s.rails).every(r => !('lane' in r)), 'no lane');
      good(rt, 'use', { module: 'ball', port: 'target', variable: 'center' }); good(rt, 'plug', { module: 'constant', on: false }); run(rt, 3);
      const t = rt.snapshot(); assert.deepEqual(t.uses, { 'ball.target': 'center' }); assert.deepEqual(t.unplugged, ['constant']);
      assert.ok(t.vars.includes('center'), 'a variable that is taken stays');
   });

   await check('runtime: a variable that goes leaves vars (the IDE drops rails that are not in vars)', () => {
      const rt = wiredRuntime(); run(rt, 60);
      const before = rt.snapshot();
      assert.ok(before.vars.includes('target') && before.vars.includes('planted') && 'target' in before.rails);
      good(rt, 'plug', { module: 'oscillator', on: false }); good(rt, 'rmModule', { module: 'ball' }); good(rt, 'rmModule', { module: 'flowers' }); run(rt, 3);
      const after = rt.snapshot();
      assert.ok(!after.vars.includes('target') && !after.vars.includes('planted'), 'nobody holds them any more');
      assert.ok(after.vars.includes('center') && BUILTINS.every(b => after.vars.includes(b)));
      const held = { ...before.rails, ...after.rails };                       // what an IDE has after both
      const kept = Object.keys(held).filter(v => after.vars.includes(v));
      assert.ok(!kept.includes('target') && !kept.includes('planted')); assert.deepEqual(kept.sort(), after.vars);
      assert.deepEqual(Object.keys(after.geometry.cards).sort(), ['constant', 'oscillator']);
   });

   // A v1 layout through the runtime: the file the runtime would save for it.
   const converted = (layout, sources, seed = 1) => {
      const rt = new R2.Runtime({ seed }), r = rt.load({ layout, sources });
      assert.deepEqual(r.errors, [], JSON.stringify(r.errors));
      return rt;
   };
   const SRC = "const time = input('time', 'state', 'time'); const pos = output('pos', 'state', 'vec3'); const bump = output('bump', 'event', 'num');\ntime.on(({ n }) => { pos.set([n / 100, 0, 0]); });";
   const SRC2 = "const time = input('time', 'state', 'time'); const other = output('other', 'state', 'vec3');\ntime.on(({ n }) => { other.set([0, 0, n / 100]); });";
   const EAT = "const time = input('time', 'state', 'time'); const q = input('q', 'state', 'vec3'); const S = state({ v: null });\nq.on(v => { S.v = v; });";
   const EAT2 = "const time = input('time', 'state', 'time'); const pos = input('pos', 'state', 'vec3'); const S = state({ v: null });\npos.on(v => { S.v = v; });";
   const QUIET = "const time = input('time', 'state', 'time'); const x = output('x', 'state', 'num');\ntime.on(({ n }) => { x.set(n); });";
   const SENSE = "const time = input('time', 'state', 'time'); const g = input('gaze_hit', 'state', 'vec3'); const d = input('down', 'state', 'bool'); const tick = input('tick', 'state', 'time');";
   const rail = (kind = 'state', type = 'vec3', lane = 0) => ({ kind, type, lane });
   const clockDocks = ids => ids.map(id => [id, 'time', 'clock']);

   // The demo layout file as v1 saved it (rails, lanes and docks), before the bus wired itself.
   const V1_DEMO = {
      cards: { oscillator: { slot: 0 }, ball: { slot: 1 }, flowers: { slot: 2 }, constant: { slot: 3 } },
      rails: { clock: { kind: 'state', type: 'time', lane: 4 }, target: { kind: 'state', type: 'vec3', lane: 0 }, planted: { kind: 'event', type: 'num', lane: 1 } },
      docks: [['dev:clock', 'time', 'clock'], ['ball', 'target', 'target'], ['ball', 'time', 'clock'], ['constant', 'time', 'clock'], ['flowers', 'planted', 'planted'],
              ['flowers', 'target', 'target'], ['flowers', 'time', 'clock'], ['oscillator', 'target', 'target'], ['oscillator', 'time', 'clock']],
   };

   await check('v1 layout to v2: the demo layout of v1 converts to the same bindings, the constant (its output undocked) unplugged', () => {
      const v1 = JSON.parse(JSON.stringify(V1_DEMO));
      const rt = converted(v1, demoSources());
      assert.equal(rt.notices.length, 0);
      assert.deepEqual(rt.layoutFile(), { cards: { oscillator: { slot: 0 }, ball: { slot: 1 }, flowers: { slot: 2 }, constant: { slot: 3 } }, uses: {}, unplugged: ['constant'] });
      run(rt, 150);
      assert.equal(railOf(rt, 'ball', 'target'), 'target'); assert.equal(railOf(rt, 'oscillator', 'target'), 'target'); assert.equal(railOf(rt, 'constant', 'center'), null);
      const a = ballAt(rt); run(rt, 60); const b = ballAt(rt);
      assert.ok(Math.hypot(b[0] - a[0], b[1] - a[1]) > .005, 'the ball follows the oscillator as in v1');
      assert.ok(rt.bus.modules.get('flowers').draw.length >= 1);
   });

   await check('v1 layout to v2: a rail is named by its first publisher\'s port; an input that does not have that name gets a use, one that does gets none', () => {
      const layout = { cards: { src: { slot: 0 }, eat: { slot: 1 }, eat2: { slot: 2 } }, rails: { p: rail(), clock: { kind: 'state', type: 'time', lane: 4 } },
                       docks: [['src', 'pos', 'p'], ['eat', 'q', 'p'], ['eat2', 'pos', 'p'], ...clockDocks(['src', 'eat', 'eat2']), ['dev:clock', 'time', 'clock']] };
      const rt = converted(layout, { src: SRC, eat: EAT, eat2: EAT2 });
      assert.deepEqual(rt.layoutFile(), { cards: { src: { slot: 0 }, eat: { slot: 1 }, eat2: { slot: 2 } }, uses: { 'eat.q': 'pos' }, unplugged: [] });
      run(rt, 30);
      assert.equal(railOf(rt, 'eat', 'q'), 'pos'); assert.equal(railOf(rt, 'eat2', 'pos'), 'pos');
      assert.deepEqual(rt.bus.modules.get('eat').state.v, rt.bus.modules.get('eat2').state.v);
      assert.ok(!rt.bus.rails.has('p') && !rt.bus.rails.has('clock'), 'the v1 rail names are gone');
      assert.deepEqual(Object.keys(rt.layoutFile()).sort(), ['cards', 'unplugged', 'uses'], 'no rails, no docks, no lanes');
      // the first publisher in the dock list decides, and the old owner form `mod:` reads too
      const l2 = { cards: { src: { slot: 0 }, src2: { slot: 1 }, eat: { slot: 2 } }, rails: { p: rail() },
                   docks: [['mod:src2', 'other', 'p'], ['mod:src', 'pos', 'p'], ['mod:eat', 'q', 'p']] };
      assert.deepEqual(converted(l2, { src: SRC, src2: SRC2, eat: EAT }).layoutFile().uses, { 'eat.q': 'other' });
   });

   await check('v1 layout to v2: a rail fed by a device means its variable (gaze.hit is gaze_hit, pointer.down is pointer_down, the clock is time)', () => {
      const layout = { cards: { ball: { slot: 0 }, osc: { slot: 1 }, sense: { slot: 2 } }, rails: { t: rail(), g: rail(), d: rail('state', 'bool'), clock: { kind: 'state', type: 'time', lane: 4 } },
                       docks: [['dev:gaze', 'hit', 't'], ['dev:gaze', 'hit', 'g'], ['dev:pointer', 'down', 'd'], ['dev:clock', 'time', 'clock'], ['ball', 'target', 't'], ['sense', 'gaze_hit', 'g'], ['sense', 'down', 'd'],
                               ['sense', 'tick', 'clock'], ...clockDocks(['ball', 'osc', 'sense'])] };
      const rt = converted(layout, { ball: demoRaw('ball'), osc: demoRaw('oscillator'), sense: SENSE });
      assert.deepEqual(rt.layoutFile().uses, { 'ball.target': 'gaze_hit', 'sense.down': 'pointer_down', 'sense.tick': 'time' });
      assert.deepEqual(rt.layoutFile().unplugged, ['osc'], 'its only output was not docked; sense has no outputs and stays plugged');
      rt.setDevice('gaze', 'hit', [.1, 0, .12]); run(rt, 200);
      assert.equal(railOf(rt, 'ball', 'target'), 'gaze_hit'); assert.equal(railOf(rt, 'sense', 'down'), 'pointer_down'); assert.equal(railOf(rt, 'sense', 'tick'), 'time');
      assert.equal(railOf(rt, 'sense', 'gaze_hit'), 'gaze_hit'); assert.equal(railOf(rt, 'osc', 'target'), null);
      near(ballAt(rt)[0], .1, 1e-3); near(ballAt(rt)[1], .12, 1e-3);
   });

   await check('v1 layout to v2: only a card with outputs that are all undocked becomes unplugged; a rail nobody publishes keeps its own name; bad docks are ignored', () => {
      const layout = { cards: { src: { slot: 0 }, quiet: { slot: 1 }, eat: { slot: 2 } }, rails: { p: rail(), orphan: rail(), 'bad name': rail(), lonely: 7 },
                       docks: [['src', 'pos', 'p'], ['eat', 'q', 'orphan'], ['dev:nope', 'x', 'p'], ['dev:gaze', 'hit', 'p'], [1, 2], null, 'x', ['ghost', 'q', 'p'], ['eat', 'nothere', 'p']] };
      const rt = converted(layout, { src: SRC, quiet: QUIET, eat: EAT });
      const f = rt.layoutFile();
      assert.deepEqual(f.unplugged, ['quiet'], 'src has one output docked of two: it stays; eat has no outputs: it stays');
      assert.deepEqual(f.uses, { 'eat.q': 'orphan' }, 'an input of a rail without a publisher waits for a variable of the rail\'s name');
      run(rt, 20); assert.equal(railOf(rt, 'eat', 'q'), null, 'and nothing is bound until there is one');
      assert.equal(rt.notices.length, 0);
      for (const bad of [{ cards: { src: { slot: 0 } }, rails: {}, docks: [] }, { cards: { src: { slot: 0 } }, rails: 5, docks: 'x' }, { cards: { src: { slot: 0 } }, docks: [] }]) {
         assert.doesNotThrow(() => converted(bad, { src: SRC }));
      }
      assert.deepEqual(converted({ cards: { src: { slot: 0 } }, rails: {}, docks: [] }, { src: SRC }).layoutFile().unplugged, ['src'], 'in v1 an empty dock list meant nothing was docked');
      assert.deepEqual(converted({ cards: { src: { slot: 0 } } }, { src: SRC }).layoutFile().unplugged, [], 'a layout with neither rails nor docks is v2');
   });

   await check('layoutFile (v2): cards, uses, unplugged, sorted; it loads again to the same bindings and the same file', () => {
      const rt = wiredRuntime(); run(rt, 30);
      good(rt, 'use', { module: 'ball', port: 'target', variable: 'gaze_hit' }); good(rt, 'use', { module: 'flowers', port: 'target', variable: 'center' });
      good(rt, 'plug', { module: 'oscillator', on: false }); good(rt, 'plug', { module: 'ball', on: false }); good(rt, 'geometry', { cards: { constant: { slot: 4 } } });
      run(rt, 3);
      const f = rt.layoutFile();
      assert.deepEqual(Object.keys(f), ['cards', 'uses', 'unplugged']);
      assert.deepEqual(f, { cards: { oscillator: { slot: 0 }, ball: { slot: 1 }, flowers: { slot: 2 }, constant: { slot: 4 } }, uses: { 'ball.target': 'gaze_hit', 'flowers.target': 'center' }, unplugged: ['ball', 'oscillator'] });
      assert.equal(JSON.stringify(rt.layoutFile()), JSON.stringify(f), 'the same text every time (the host saves when it changes)');
      const rt2 = wiredRuntime(JSON.parse(JSON.stringify(f))); run(rt2, 3);
      assert.deepEqual(rt2.layoutFile(), f); assert.deepEqual(rt2.bus.uses, rt.bus.uses); assert.deepEqual([...rt2.bus.unplugged].sort(), ['ball', 'oscillator']);
      assert.equal(railOf(rt2, 'flowers', 'target'), 'center'); assert.equal(railOf(rt2, 'ball', 'target'), null); assert.equal(railOf(rt2, 'oscillator', 'target'), null);
      // a use may name a variable that does not exist yet: it waits and binds when the card that has it comes
      const early = demoV2(); early.uses = { 'ball.target': 'late' };
      const rt3 = wiredRuntime(early, demoSources()); run(rt3, 5);
      assert.equal(railOf(rt3, 'ball', 'target'), null); assert.deepEqual(rt3.layoutFile().uses, { 'ball.target': 'late' });
      good(rt3, 'addModule', { module: 'late', source: "const time = input('time', 'state', 'time'); const late = output('late', 'state', 'vec3'); time.on(() => { late.set([.1, 0, .1]); });" }); run(rt3, 5);
      assert.equal(railOf(rt3, 'ball', 'target'), 'late');
   });

   await check('runtime: rename moves uses and unplugged to the new name, rm drops them, and the layout follows', () => {
      const rt = wiredRuntime(); run(rt, 10);
      good(rt, 'use', { module: 'ball', port: 'target', variable: 'gaze_hit' }); good(rt, 'plug', { module: 'oscillator', on: false }); run(rt, 2);
      good(rt, 'renameModule', { module: 'ball', to: 'sphere' }); good(rt, 'renameModule', { module: 'oscillator', to: 'osc' }); run(rt, 2);
      assert.deepEqual(rt.bus.uses, { 'sphere.target': 'gaze_hit' }); assert.deepEqual([...rt.bus.unplugged], ['osc']);
      assert.deepEqual(rt.layoutFile(), { cards: { sphere: { slot: 1 }, flowers: { slot: 2 }, constant: { slot: 3 }, osc: { slot: 0 } }, uses: { 'sphere.target': 'gaze_hit' }, unplugged: ['osc'] });
      assert.equal(railOf(rt, 'sphere', 'target'), 'gaze_hit');
      good(rt, 'rmModule', { module: 'sphere' }); good(rt, 'rmModule', { module: 'osc' }); run(rt, 2);
      assert.deepEqual(rt.bus.uses, {}); assert.equal(rt.bus.unplugged.size, 0);
      assert.deepEqual(rt.layoutFile().uses, {}); assert.deepEqual(rt.layoutFile().unplugged, []);
      good(rt, 'addModule', { module: 'sphere', source: demoRaw('ball') }); run(rt, 2);
      assert.equal(railOf(rt, 'sphere', 'target'), 'target', 'a new card of an old name has no old use');
   });

   await check('runtime: the v1 rail commands and rail lanes are gone, and so are the ghost and adopt', () => {
      const rt = wiredRuntime(); run(rt, 90);
      refusedBy(rt, 'ghost', { module: 'ball', source: demoRaw('ball') }, /unknown command 'ghost'/); refusedBy(rt, 'adopt', { module: 'ball' }, /unknown command 'adopt'/);
      assert.ok(!('ghost' in rt.snapshot()), 'the snapshot has no ghost field'); assert.ok(!('ghost' in rt));
      for (const [op, extra] of [['addRail', { rail: 'x', kind: 'state' }], ['rmRail', { rail: 'target' }], ['renameRail', { rail: 'target', to: 'y' }], ['kind', { rail: 'target', kind: 'event' }],
                                 ['dock', { owner: 'ball', port: 'target', rail: 'center' }], ['undock', { owner: 'ball', port: 'target' }]]) {
         refusedBy(rt, op, extra, /unknown command/);
      }
      assert.deepEqual(Object.keys(rt.geometry), ['cards']);
      refusedBy(rt, 'geometry', { rails: { target: { lane: 1 } } }, /cards/);
      good(rt, 'geometry', { cards: { ball: { slot: 4 }, constant: { slot: 1 } } });
      assert.deepEqual([rt.geometry.cards.ball.slot, rt.geometry.cards.constant.slot], [4, 1]);
   });

   // ---- the runtime: the paused scene is the past, and the playhead can become the present ----

   const round4 = v => (typeof v === 'number' ? Math.round(v * 1e4) / 1e4 : Array.isArray(v) ? v.map(round4) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, round4(x)])) : v);
   // A demo runtime that runs 12 s of a scripted life: the gaze moves, a use and an unplug, a reload, a card added and a card removed.
   // `log` has, after every step, what each module drew and held, the rails, the wiring and the last gaze value.
   const livedRuntime = (extra = {}) => {
      const rt = wiredRuntime(); rt.handle({ id: 90, op: 'resume' });
      const log = new Map();
      const note = () => {
         const mods = {}, rails = {};
         for (const [id, m] of rt.bus.modules) mods[id] = [JSON.stringify(round4(m.draw)), JSON.stringify(m.state), m.status, m.source];
         for (const [id, r] of rt.bus.rails) rails[id] = [JSON.stringify(r.value === undefined ? null : r.value), r.seq];
         log.set(rt.bus.n, { mods, rails, uses: JSON.stringify(rt.bus.uses), unplugged: JSON.stringify([...rt.bus.unplugged].sort()), gaze: JSON.stringify(rt.bus.devices.get('gaze').ports[0].value), t: rt.bus.t });
      };
      const at = {
         120: () => good(rt, 'use', { module: 'ball', port: 'target', variable: 'gaze_hit' }),
         240: () => good(rt, 'plug', { module: 'flowers', on: false }),
         300: () => good(rt, 'commit', { module: 'ball', source: `${demoRaw('ball')}\n// reloaded\n` }),
         360: () => good(rt, 'plug', { module: 'flowers', on: true }),
         420: () => good(rt, 'addModule', { module: 'extra', source: "const time = input('time', 'state', 'time'); const t = input('gaze_hit', 'state', 'vec3'); const S = state({ n: 0 }); time.on(() => { S.n++; }); t.on(v => draw([{ shape: 'sphere', p: v, s: .02, color: '#fff' }]));" }),
         500: () => good(rt, 'rmModule', { module: 'constant' }),
         ...extra,
      };
      const n0 = rt.bus.n;
      for (let i = 0; i < 720; i++) {
         if (i % 7 === 0) rt.setDevice('gaze', 'hit', [Math.sin(i / 20) * .2, 0, Math.cos(i / 15) * .2]);
         if (i % 31 === 0) rt.setDevice('gaze', 'on', i % 62 === 0);
         if (at[i]) at[i]();
         rt.step(); note();
      }
      return { rt, log, n0 };
   };
   const snapAll = rt => { rt.full(); return rt.snapshot(); };
   // The snapshot's draw lists and rails at the playhead, against the log of the live run at that step.
   const pastIs = (rt, log, n, label) => {
      const s = snapAll(rt), want = log.get(n);
      near(s.playhead, n * B.DT, 1e-6);
      for (const [id, [draw]] of Object.entries(want.mods)) { if (s.modules[id]) assert.equal(JSON.stringify(s.modules[id].draw), draw, `${label}: ${id} draws`); }
      for (const [id, [value, seq]] of Object.entries(want.rails)) {
         if (!s.rails[id]) continue;
         assert.equal(JSON.stringify(s.rails[id].value === undefined ? null : s.rails[id].value), value, `${label}: rail ${id}`); assert.equal(s.rails[id].seq, seq, `${label}: rail ${id} count`);
      }
      return s;
   };

   const lived = livedRuntime();

   await check('runtime: paused in the past, the snapshot\'s pictures and rails are what they were at every step of a lived run (a use, an unplug, a reload, a card added and removed, a gaze that moves)', () => {
      const rt = lived.rt; good(rt, 'pause');
      assert.equal(rt.past, null, 'at the end the live bus is the world');
      const first = Math.round(rt.recorder.range().t0 / B.DT) + 1;
      let n = 0;
      for (let k = first; k <= lived.rt.bus.n; k += 3) { good(rt, 'seek', { t: k * B.DT }); pastIs(rt, lived.log, k, 'seek'); n++; }
      assert.ok(n > 200);
      for (const k of [700, 100, 61, 530, 12, 599, 300, 301, 302]) { if (k < first) continue; good(rt, 'seek', { t: k * B.DT }); pastIs(rt, lived.log, k, 'scatter'); }
      assert.ok(rt.past && rt.replay.problem === null);
   });

   await check('runtime: a seek back and forward again, and play to the window end, show the past step by step; each moves the replay at most 60 steps', () => {
      const rt = lived.rt; good(rt, 'pause');
      const end = rt.recorder.range().t1, endN = Math.round(end / B.DT);
      let ran = 0; const was = P.Replay.prototype._step; P.Replay.prototype._step = function () { ran++; return was.call(this); };
      try {
         for (const k of [650, 400, 520, 330, 610]) { ran = 0; good(rt, 'seek', { t: k * B.DT }); assert.ok(ran <= 60, `seek to ${k} ran ${ran} steps`); pastIs(rt, lived.log, k, 'seek'); }
         good(rt, 'seek', { t: 400 * B.DT }); good(rt, 'play');
         assert.equal(rt.snapshot().playing, true);
         let drawn = 0;
         for (let k = 401; k <= endN; k++) {
            ran = 0; rt.step(); assert.ok(ran <= 1, `a step of play runs one step (${ran})`);
            if (k % 5 === 0 || k > endN - 3) { pastIs(rt, lived.log, k, 'play'); drawn++; }
         }
         assert.ok(drawn > 50);
      } finally { P.Replay.prototype._step = was; }
      assert.equal(rt.playhead, end); assert.equal(rt.playing, false); assert.equal(rt.past, null, 'at the end, the live world again');
      const s = snapAll(rt); for (const [id, m] of rt.bus.modules) assert.equal(JSON.stringify(s.modules[id].draw), JSON.stringify(round4(m.draw)));
      good(rt, 'resume');
   });

   await check('runtime: resume still returns to the real present, and the pictures with it; only a pause that goes away from the end has a replay', () => {
      const rt = livedRuntime().rt; const n = rt.bus.n, bus = rt.bus, live = JSON.stringify(rt.bus.snapshot());
      good(rt, 'pause'); good(rt, 'seek', { t: 300 * B.DT }); assert.ok(rt.past); assert.ok(rt.replay);
      good(rt, 'resume');
      assert.equal(rt.bus, bus, 'the same bus'); assert.equal(rt.bus.n, n); assert.equal(JSON.stringify(rt.bus.snapshot()), live, 'the present is untouched'); assert.equal(rt.past, null); assert.equal(rt.replay, null); assert.equal(rt.playhead, null);
      const s = snapAll(rt); for (const [id, m] of rt.bus.modules) assert.equal(JSON.stringify(s.modules[id].draw), JSON.stringify(round4(m.draw)), `${id} is live again`);
      run(rt, 5); assert.equal(rt.bus.n, n + 5);
   });

   await check('runtime: continue from here keeps the program of now (cards, sources, versions, uses, unplugged) and takes the data of then (state, variables, devices, time)', () => {
      for (const k of [130, 250, 330, 410, 460, 560, 600]) {
         const x = livedRuntime(); const rt = x.rt;
         good(rt, 'pause'); good(rt, 'seek', { t: k * B.DT });
         const now = { mods: [...rt.bus.modules].map(([id, m]) => [id, m.source, m.ver]), uses: JSON.stringify(rt.bus.uses), unplugged: JSON.stringify([...rt.bus.unplugged].sort()),
                       cards: JSON.stringify(rt.geometry.cards), versions: [...rt.bus.modules.keys()].map(id => JSON.stringify(rt.bus.versions(id))) };
         const rev = rt.snapshot().rev, want = x.log.get(k), then = rt.past.snapshot();
         good(rt, 'resumeHere');
         assert.equal(rt.bus.paused, false); assert.equal(rt.playhead, null); assert.equal(rt.playing, false); assert.equal(rt.past, null); assert.equal(rt.replay, null);
         assert.equal(rt.bus.n, k); assert.equal(rt.bus.t, want.t);
         // the program of now
         assert.deepEqual([...rt.bus.modules].map(([id, m]) => [id, m.source, m.ver]), now.mods, `${k}: cards, sources and versions are the live ones`);
         assert.equal(JSON.stringify(rt.bus.uses), now.uses, `${k}: uses`); assert.equal(JSON.stringify([...rt.bus.unplugged].sort()), now.unplugged, `${k}: unplugged`);
         assert.equal(JSON.stringify(rt.geometry.cards), now.cards, 'the cards keep their places');
         assert.deepEqual([...rt.bus.modules.keys()].map(id => JSON.stringify(rt.bus.versions(id))), now.versions, 'and the versions to revert to');
         // the world of then
         for (const [id, m] of rt.bus.modules) {
            if (want.mods[id]) assert.equal(JSON.stringify(m.state), want.mods[id][1], `${k}: ${id} state is the replay's`);
         }
         for (const [id, [value, seq]] of Object.entries(want.rails)) {
            const r = rt.bus.rails.get(id); if (!r) continue;
            assert.equal(JSON.stringify(r.value === undefined ? null : r.value), value, `${k}: rail ${id}`); assert.equal(r.seq, seq);
         }
         assert.equal(JSON.stringify(rt.bus.devices.get('gaze').ports[0].value), want.gaze, `${k}: the gaze value of that moment`);
         // a card that was not there starts from its initial state, a removed one stays removed
         if (!want.mods.extra) assert.equal(rt.bus.modules.get('extra').state.n, 0, `${k}: extra starts afresh`);
         else assert.ok(rt.bus.modules.get('extra').state.n > 0, `${k}: extra goes on`);
         assert.ok(!rt.bus.modules.has('constant'), 'constant stays removed');
         const range = rt.recorder.range(); assert.equal(range.frames, 0, 'no tape'); assert.equal(range.t0, want.t); assert.equal(range.t1, want.t);
         const s = snapAll(rt); assert.deepEqual(s.window, [want.t, want.t]); assert.equal(s.paused, false); assert.ok(s.rev > rev, 'revs go on');
         assert.deepEqual(Object.keys(s.geometry.cards).sort(), [...rt.bus.modules.keys()].sort());
         assert.ok(s.notices.some(n => /continued from/.test(n.text)));
         assert.ok(then.n === k);
         run(rt, 3); assert.equal(rt.bus.n, k + 3); assert.equal(rt.recorder.range().frames, 3, 'the tape starts again');
      }
   });

   await check('runtime: a fix committed live stays fixed: rewind to before it, continue from here, and the new code runs on the old state', () => {
      const CNT = d => `const time = input('time', 'state', 'time'); const out = output('out', 'state', 'num'); const S = state({ n: 0 });\ntime.on(() => { S.n += ${d}; out.set(S.n); });`;
      const rt = new R2.Runtime({ seed: 1 }); rt.load({ layout: { cards: {} }, sources: {} });
      good(rt, 'addModule', { module: 'm', source: CNT(1) }); run(rt, 100);
      good(rt, 'commit', { module: 'm', source: CNT(2) }); run(rt, 60);
      assert.equal(rt.bus.modules.get('m').ver, 2); assert.equal(rt.bus.modules.get('m').state.n, 100 + 2 * 60);
      good(rt, 'pause'); good(rt, 'seek', { t: 50 * B.DT });
      assert.equal(rt.snapshot().rails.out.value, 50, 'the past ran the old code');
      good(rt, 'resumeHere');
      const m = rt.bus.modules.get('m');
      assert.equal(m.source, CNT(2), 'the new code'); assert.equal(m.ver, 2, 'the same version'); assert.equal(m.state.n, 50, 'on the state of then'); assert.equal(m.status, 'ok');
      run(rt, 10); assert.equal(m.state.n, 70, 'it counts by two'); assert.equal(rt.bus.rails.get('out').value, 70);
      good(rt, 'revert', { module: 'm' }); run(rt, 2); assert.equal(rt.bus.modules.get('m').source, CNT(1), 'the old version is still there to revert to');
   });

   await check('runtime: a fix to a card that threw: it is not quarantined after continuing from before the throw, and a card whose source did not change throws again', () => {
      const BAD = d => `const time = input('time', 'state', 'time'); const out = output('out', 'state', 'num'); const S = state({ n: 0 });\ntime.on(({ n }) => { if (n === 90) ${d}; S.n++; out.set(S.n); });`;
      for (const fixed of [false, true]) {
         const rt = new R2.Runtime({ seed: 1 }); rt.load({ layout: { cards: {} }, sources: {} });
         good(rt, 'addModule', { module: 'm', source: BAD('null.x') }); run(rt, 120); assert.equal(rt.bus.modules.get('m').status, 'quarantined');
         if (fixed) good(rt, 'commit', { module: 'm', source: BAD('0') }), run(rt, 20);
         good(rt, 'pause'); good(rt, 'seek', { t: 60 * B.DT }); good(rt, 'resumeHere');
         assert.equal(rt.bus.modules.get('m').status, 'ok', 'it was running then'); assert.equal(rt.bus.modules.get('m').state.n, 60);
         run(rt, 60); assert.equal(rt.bus.modules.get('m').status, fixed ? 'ok' : 'quarantined', fixed ? 'the fix holds' : 'the same bug, the same step');
      }
   });

   await check('runtime: continue from here goes on exactly as a runtime made the same way (steps, devices, commands)', () => {
      const x = livedRuntime(), rt = x.rt;
      good(rt, 'commit', { module: 'ball', source: `${demoRaw('ball')}\n// fixed\n` }); run(rt, 3);
      good(rt, 'pause'); good(rt, 'seek', { t: 380 * B.DT });
      const world = rt.bus.n, layout = rt.layoutFile(), { snapshot, sources, migrate } = rt._pastWorld(rt.past);
      const copy = structuredClone(snapshot);
      good(rt, 'resumeHere');
      const twin = new R2.Runtime({ seed: 1 }); const r = twin.load({ layout, sources, snapshot: copy, migrate }); assert.deepEqual(r.errors, []);
      assert.ok(world > 380); assert.equal(twin.bus.n, 380); assert.equal(rt.bus.n, 380);
      const same = label => {
         assert.equal(JSON.stringify(rt.bus.snapshot()), JSON.stringify(twin.bus.snapshot()), `${label}: bus snapshot`);
         for (const [id, m] of rt.bus.modules) assert.equal(JSON.stringify(m.draw), JSON.stringify(twin.bus.modules.get(id).draw), `${label}: ${id} draw`);
      };
      same('at once');
      for (let i = 0; i < 240; i++) {
         if (i % 5 === 0) for (const q of [rt, twin]) q.setDevice('gaze', 'hit', [Math.sin(i / 9) * .1, 0, .05]);
         if (i === 60) for (const q of [rt, twin]) q.handle({ id: 1, op: 'commit', module: 'ball', source: `${demoRaw('ball')}\n// after\n` });
         if (i === 100) for (const q of [rt, twin]) q.handle({ id: 2, op: 'plug', module: 'oscillator', on: false });
         rt.step(); twin.step();
         if (i % 20 === 0) same(`step ${i}`);
      }
      same('end');
   });

   await check('runtime: continue from here at the window\'s end is plain resume; commands are refused when not paused; a playhead may be anywhere in the window', () => {
      const rt = livedRuntime().rt; const bus = rt.bus;
      refusedBy(rt, 'resumeHere', {}, /needs a pause/); assert.equal(rt.bus.paused, false);
      good(rt, 'pause'); good(rt, 'resumeHere'); assert.equal(rt.bus, bus, 'no rebuild at the end'); assert.equal(rt.bus.paused, false); assert.ok(rt.recorder.range().frames > 600, 'the tape is kept');
      good(rt, 'pause'); good(rt, 'seek', { t: -5 }); assert.equal(rt.playhead, rt.recorder.range().t0);
      good(rt, 'resumeHere'); assert.equal(rt.bus.n, Math.round(rt.recorder.range().t0 / B.DT)); assert.ok(rt.bus.n < bus.n - 600, 'the oldest second of the tape'); assert.equal(rt.recorder.range().frames, 0);
      refusedBy(rt, 'resumeHere', {}, /needs a pause/);
   });

   await check('runtime: the paused commit and the other structure commands say what to do instead (no ghost any more)', () => {
      const rt = wiredRuntime(); run(rt, 30); good(rt, 'pause');
      for (const [op, fields] of [['commit', { module: 'ball', source: demoRaw('ball') }], ['addModule', { module: 'z' }], ['rmModule', { module: 'ball' }], ['renameModule', { module: 'ball', to: 'b2' }]]) {
         const a = cmd(rt, op, fields); assert.equal(a.ok, false, op); assert.equal(a.reason, 'paused: Mod+Shift+Enter continues from here, Mod+P returns to now', op);
      }
   });

   await check('runtime: a replay that cannot be made is a notice and not a crash: the pictures stay live, and continuing is refused with the reason', () => {
      const x = livedRuntime(), rt = x.rt; good(rt, 'pause');
      const seg = rt.recorder.segments[3]; const op = seg.frames.flatMap(f => f.ops).find(o => o.k === 'reload'); const bad = op || null;
      if (bad) bad.source = 'this is not javascript'; else seg.sources.ball = 'this is not javascript';
      good(rt, 'seek', { t: seg.frames[30].t });
      assert.ok(rt.replay.problem, 'a problem'); assert.equal(rt.past, null);
      assert.ok(rt.notices.some(n => /the past cannot be shown/.test(n.text)));
      refusedBy(rt, 'resumeHere', {}, /the past cannot be rebuilt/);
      assert.equal(rt.bus.paused, true); good(rt, 'resume'); assert.equal(rt.bus.paused, false);
   });

   await check('runtime: 64 variables (59 of them with large values) all reach the IDE within a bounded number of snapshots', () => {
      const BIG = "const big = 'x'.repeat(3500);\n";
      const mk = (k, n) => `const time = input('time', 'state', 'time');\n${BIG}` + Array.from({ length: n }, (_, i) => `const o${i} = output('v${k}_${i}', 'state', 'str');`).join('') +
                           `\ntime.on(({ n }) => { if (n === 2) { ${Array.from({ length: n }, (_, i) => `o${i}.set(big + ${i});`).join(' ')} } });`;
      const rt = new R2.Runtime(); rt.load({ layout: {}, sources: {} });
      [12, 12, 12, 12, 11].forEach((n, k) => good(rt, 'addModule', { module: `m${k}`, source: mk(k, n) }));
      run(rt, 6);
      assert.equal(rt.bus.rails.size, 64); for (const [id, m] of rt.bus.modules) assert.equal(m.status, 'ok', `${id}: ${m.error && m.error.message}`);
      rt.full();
      const seen = new Set(); let first = null, snaps = 0;
      for (; snaps < 12 && seen.size < 64; snaps++) {
         const s = rt.snapshot(), size = JSON.stringify(s).length;
         assert.ok(size <= Sn.BUDGET, `${size}`); assert.equal(s.vars.length, 64, 'the head always lists every variable');
         for (const id of Object.keys(s.rails)) seen.add(id);
         if (first === null) first = Object.keys(s.rails).length;
      }
      assert.equal(seen.size, 64, 'every variable arrived'); assert.ok(first < 64, `the first snapshot deferred some (${first})`); assert.ok(snaps <= 8, `within ${snaps} snapshots`);
   });

   console.log(`${passed} rails checks passed.`);
})().catch(err => { console.error(err); process.exit(1); });
