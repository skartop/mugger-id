import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// Browsers cache the page's scripts (GitHub Pages: 10 minutes). Every script URL carries the same
// ?v= release stamp so a new release never runs a fresh index.html against stale modules.
// Bump RELEASE in every file together when shipping a change.
test('index.html and every relative import share one ?v= release stamp', () => {
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const script = /<script type="module" src="src\/app\.js\?v=([\w.-]+)">/.exec(html);
  assert.ok(script, 'index.html must load src/app.js with a ?v= stamp');
  const release = script[1];
  const srcDir = new URL('../src/', import.meta.url);
  for (const file of fs.readdirSync(srcDir).filter((f) => f.endsWith('.js'))) {
    const code = fs.readFileSync(new URL(file, srcDir), 'utf8');
    for (const [, spec] of code.matchAll(/from '(\.[^']+)'/g)) {
      assert.match(spec, new RegExp(`\\.js\\?v=${release}$`), `${file} imports ${spec} without ?v=${release}`);
    }
  }
});
