// Vertex-clustering decimation for the ASCII STL parts of the SO101 arm.
// Usage: node tools/decimate-stl.cjs <in dir> <out dir> <cell size in metres>
// The output keeps the exact ASCII layout that js/render/core/stl.js parses.
const fs = require('node:fs');
const path = require('node:path');
const [input, output, cellText] = process.argv.slice(2);
const cell = Number(cellText);
fs.mkdirSync(output, { recursive: true });

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

for (const file of fs.readdirSync(input).filter(f => f.endsWith('.stl'))) {
   const text = fs.readFileSync(path.join(input, file), 'utf8');
   const vertices = [...text.matchAll(/vertex (\S+) (\S+) (\S+)/g)].map(m => [+m[1], +m[2], +m[3]]);
   // Every vertex in a grid cell collapses to the cell's average position.
   const cells = new Map(), key = v => v.map(x => Math.floor(x / cell)).join(',');
   for (const v of vertices) {
      const c = cells.get(key(v)) || cells.set(key(v), { sum: [0, 0, 0], n: 0 }).get(key(v));
      c.sum = c.sum.map((s, i) => s + v[i]); c.n++;
   }
   const out = [`solid ${path.basename(file, '.stl')}`], seen = new Set();
   let kept = 0;
   for (let i = 0; i < vertices.length; i += 3) {
      const keys = [0, 1, 2].map(j => key(vertices[i + j]));
      const id = [...keys].sort().join('|');
      if (new Set(keys).size < 3 || seen.has(id)) continue;
      seen.add(id);
      const p = keys.map(k => { const c = cells.get(k); return c.sum.map(s => s / c.n); });
      const n = cross(sub(p[1], p[0]), sub(p[2], p[0])), length = Math.hypot(...n);
      if (length < 1e-12) continue;
      out.push(`  facet normal ${n.map(x => x / length).join(' ')}`, '    outer loop',
         ...p.map(v => `      vertex ${v.join(' ')}`), '    endloop', '  endfacet');
      kept++;
   }
   out.push(`endsolid ${path.basename(file, '.stl')}`);
   fs.writeFileSync(path.join(output, file), out.join('\n') + '\n');
   console.log(`${file}: ${vertices.length / 3} -> ${kept} triangles`);
}
