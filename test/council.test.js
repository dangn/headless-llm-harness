'use strict';
// Offline unit tests for council internals — no OpenRouter calls, no API key needed.
// Run: npm test   (node --test)
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');

const { makeGuard, makeTools } = require('../bin/council');

let ROOT, guard, ro, rw;

before(() => {
  ROOT = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'council-test-')));
  fs.writeFileSync(path.join(ROOT, 'config.js'), 'export const PORT = 4317;\nexport const x = 1;\n');
  guard = makeGuard(ROOT);
  ro = makeTools(ROOT, guard, { write: false }).registry;
  rw = makeTools(ROOT, guard, { write: true }).registry;
});

after(() => { try { fs.rmSync(ROOT, { recursive: true, force: true }); } catch {} });

test('makeGuard confines to root and blocks escapes', () => {
  assert.ok(guard('config.js').startsWith(ROOT), 'allows in-root path');
  assert.throws(() => guard('../../etc/passwd'), /escapes/, 'blocks ../ traversal');
  assert.throws(() => guard('/etc/passwd'), /escapes/, 'blocks absolute path');
  const link = path.join(ROOT, 'evil');
  fs.symlinkSync('/etc/passwd', link);
  assert.throws(() => guard('evil'), /escapes/, 'blocks symlink escape');
  fs.unlinkSync(link);
});

test('read_file: paged window is exact', async () => {
  const big = path.join(ROOT, 'big.txt');
  const lines = Array.from({ length: 5000 }, (_, i) => `L${i + 1}`).join('\n') + '\n';
  fs.writeFileSync(big, lines);
  const out = await ro.read_file.fn({ file: 'big.txt', start_line: 2, end_line: 4 });
  assert.equal(out, '2\tL2\n3\tL3\n4\tL4');
});

test('read_file: whole-file read drops the trailing-newline ghost line', async () => {
  fs.writeFileSync(path.join(ROOT, 'tn.txt'), 'a\nb\n');
  const out = await ro.read_file.fn({ file: 'tn.txt' });
  assert.equal(out, '1\ta\n2\tb');
});

test('read_file: end_line < start_line throws a clear error', async () => {
  await assert.rejects(
    () => ro.read_file.fn({ file: 'config.js', start_line: 5, end_line: 3 }),
    /before start_line/,
  );
});

test('read_file: many ranged reads do not leak file descriptors', async () => {
  for (let i = 0; i < 300; i++) {
    await ro.read_file.fn({ file: 'config.js', start_line: 1, end_line: 2 });
  }
  // would throw EMFILE if the underlying ReadStream were never destroyed
});

test('write_file refuses to follow a symlink (no-follow)', async () => {
  const target = path.join(ROOT, 'outside-target');
  fs.symlinkSync(target, path.join(ROOT, 'link.txt'));
  await assert.rejects(() => rw.write_file.fn({ file: 'link.txt', content: 'x' }), /symlink/);
  assert.equal(fs.existsSync(target), false, 'symlink target was not written');
  fs.unlinkSync(path.join(ROOT, 'link.txt'));
});

test('run: returns stdout and exit code', async () => {
  const out = await rw.run.fn({ command: 'echo hello' });
  assert.match(out, /hello/);
  assert.match(out, /exit=0/);
});

test('run: does not hang on a backgrounded descendant, and sweeps it', async () => {
  const tag = 'council-test-sleep-4242';
  const out = await rw.run.fn({ command: `echo started; sleep 90 & echo "${tag}" >/dev/null` });
  assert.match(out, /started/);
  await new Promise((r) => setTimeout(r, 400));
  const alive = cp.execSync('pgrep -f "sleep 90" | wc -l').toString().trim();
  assert.equal(alive, '0', 'backgrounded sleep was swept on exit');
});

test('run: denylist blocks destructive commands', async () => {
  assert.match(await rw.run.fn({ command: 'rm -rf /*' }), /refused/);
  assert.match(await rw.run.fn({ command: 'rm -fr ~/important' }), /refused/);
  assert.match(await rw.run.fn({ command: 'sudo whoami' }), /refused/);
});

test('run: OPENROUTER_API_KEY is stripped from the child env', async () => {
  process.env.OPENROUTER_API_KEY = 'sk-or-test-should-not-leak';
  const out = await rw.run.fn({ command: 'echo "KEY=[$OPENROUTER_API_KEY]"' });
  assert.match(out, /KEY=\[\]/);
});

test('read-only tools never expose write/run', () => {
  assert.ok(ro.read_file && ro.grep && ro.glob && ro.list_dir, 'read tools present');
  assert.equal(ro.write_file, undefined);
  assert.equal(ro.edit_file, undefined);
  assert.equal(ro.run, undefined);
});

test('grep finds matches (skipped if ripgrep is absent)', async (t) => {
  const hasRg = (() => { try { cp.execSync('command -v rg', { stdio: 'ignore' }); return true; } catch { return false; } })();
  if (!hasRg) return t.skip('ripgrep not installed');
  const out = await ro.grep.fn({ pattern: 'PORT' });
  assert.match(out, /config\.js/);
  assert.match(out, /4317/);
});
