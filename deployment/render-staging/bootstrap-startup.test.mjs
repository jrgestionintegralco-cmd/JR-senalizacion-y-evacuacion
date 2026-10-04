// Tests the startup gate with simulated children. NEVER runs bootstrap-admin.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { spawnSync } from 'node:child_process';
import { runAuthorizedBootstrap } from './bootstrap-startup.mjs';

function authorized() {
  return { CONFIRM_RENDER_STAGING: 'safe_enter_render_staging',
    RENDER: 'true', RENDER_EXTERNAL_URL: 'https://example.onrender.com',
    STAGING_BOOTSTRAP_CONFIRM: 'CREATE_FIRST_JR_RENDER_STAGING_ADMIN',
    STAGING_BOOTSTRAP_EMAIL: 'dummy@example.test',
    STAGING_BOOTSTRAP_PASSWORD: 'fake-test-value-not-a-secret' };
}
test('normal startup never spawns bootstrap', async () => {
  const env = { UNRELATED: 'preserved' };
  await runAuthorizedBootstrap(env, () => assert.fail('Unexpected spawn'));
  assert.deepEqual(env, { UNRELATED: 'preserved' });
});
test('each missing/empty variable or wrong confirmation prevents execution', async () => {
  for (const key of ['CONFIRM_RENDER_STAGING', 'STAGING_BOOTSTRAP_CONFIRM', 'STAGING_BOOTSTRAP_EMAIL', 'STAGING_BOOTSTRAP_PASSWORD']) {
    for (const value of [undefined, '']) {
      const env = authorized();
      if (value === undefined) delete env[key]; else env[key] = value;
      await assert.rejects(runAuthorizedBootstrap(env, () => assert.fail('Unexpected spawn')));
      assert.deepEqual(env, { RENDER: 'true', RENDER_EXTERNAL_URL: 'https://example.onrender.com' });
    }
  }
  for (const key of ['CONFIRM_RENDER_STAGING', 'STAGING_BOOTSTRAP_CONFIRM']) {
    const env = { ...authorized(), [key]: 'wrong' };
    await assert.rejects(runAuthorizedBootstrap(env, () => assert.fail('Unexpected spawn')));
  }
});
test('full authorization waits for one child and removes temporary variables', async () => {
  const env = { ...authorized(), UNRELATED: 'preserved' };
  let calls = 0;
  let child;
  const promise = runAuthorizedBootstrap(env, (command, args, options) => {
    calls++;
    assert.equal(command, process.execPath);
    assert.ok(args[0].endsWith('/bootstrap-admin.mjs'));
    assert.equal(args[1], '--execute-once');
    assert.equal(options.env.STAGING_BOOTSTRAP_PASSWORD, authorized().STAGING_BOOTSTRAP_PASSWORD);
    child = new EventEmitter();
    return child;
  });
  let completed = false;
  promise.then(() => { completed = true; });
  await Promise.resolve();
  assert.equal(completed, false);
  child.emit('exit', 0, null);
  await promise;
  assert.equal(calls, 1);
  assert.deepEqual(env, { UNRELATED: 'preserved', RENDER: 'true', RENDER_EXTERNAL_URL: 'https://example.onrender.com' });
});
test('failure, signal and spawn error stop startup with sanitized errors', async () => {
  for (const outcome of ['failure', 'signal', 'error', 'throw']) {
    const env = authorized();
    const promise = runAuthorizedBootstrap(env, () => {
      if (outcome === 'throw') throw new Error('simulated spawn failure');
      const child = new EventEmitter();
      queueMicrotask(() => {
        if (outcome === 'error') child.emit('error', new Error('internal details'));
        else child.emit('exit', outcome === 'failure' ? 1 : null, outcome === 'signal' ? 'SIGTERM' : null);
      });
      return child;
    });
    await assert.rejects(promise, error => {
      assert.match(error.message, /^Bootstrap .*startup stopped\.$/);
      assert.doesNotMatch(error.message, /internal details|simulated/);
      return true;
    });
    assert.deepEqual(env, { RENDER: 'true', RENDER_EXTERNAL_URL: 'https://example.onrender.com' });
  }
});
test('parent emits fixed authorization codes to real stderr before any child launch', () => {
  const cases = [
    [{ RENDER: undefined }, 'RENDER_ABSENT'],
    [{ RENDER: 'false' }, 'RENDER_VALUE_INVALID'],
    [{ RENDER_EXTERNAL_URL: undefined }, 'RENDER_EXTERNAL_URL_ABSENT'],
    [{ RENDER_EXTERNAL_URL: 'fake-secret-invalid-url' }, 'RENDER_EXTERNAL_URL_FORMAT_INVALID'],
    [{ RENDER_EXTERNAL_URL: 'http://example.onrender.com' }, 'RENDER_EXTERNAL_URL_PROTOCOL_INVALID'],
    [{ RENDER_EXTERNAL_URL: 'https://fake-user:fake-secret@private.test/?token=fake-token' }, 'RENDER_EXTERNAL_URL_HOSTNAME_INVALID'],
    [{ CONFIRM_RENDER_STAGING: 'wrong' }, 'STAGING_DATABASE_CONFIRMATION_INVALID'],
    [{ STAGING_BOOTSTRAP_CONFIRM: 'wrong' }, 'STAGING_BOOTSTRAP_CONFIRMATION_INVALID']
  ];
  for (const [overrides, expected] of cases) {
    const env = { ...authorized(), ...overrides };
    // Run only the parent helper with a forbidden-spawn stub. No bootstrap import,
    // real child launch, database connection or process environment secrets.
    const script = `import { runAuthorizedBootstrap } from ${JSON.stringify(new URL('./bootstrap-startup.mjs', import.meta.url).href)};
      try { await runAuthorizedBootstrap(${JSON.stringify(env)}, () => { process.exit(99); }); }
      catch { process.exitCode = 1; }`;
    const result = spawnSync(process.execPath, ['--input-type=module', '--eval', script], {
      encoding: 'utf8', env: {}, timeout: 5000
    });
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, `Bootstrap authorization; diagnostic_version=render-bootstrap-auth-v1; process=parent; diagnostic=${expected}\n`);
    assert.doesNotMatch(result.stderr, /fake-secret|fake-user|fake-token|private\.test/);
  }
});
