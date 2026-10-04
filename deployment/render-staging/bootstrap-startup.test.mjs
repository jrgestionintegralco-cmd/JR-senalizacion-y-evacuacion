// Tests the startup gate with simulated children. NEVER runs bootstrap-admin.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { runAuthorizedBootstrap } from './bootstrap-startup.mjs';

function authorized() {
  return { CONFIRM_RENDER_STAGING: 'safe_enter_render_staging',
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
  for (const key of Object.keys(authorized())) {
    for (const value of [undefined, '']) {
      const env = authorized();
      if (value === undefined) delete env[key]; else env[key] = value;
      await assert.rejects(runAuthorizedBootstrap(env, () => assert.fail('Unexpected spawn')));
      assert.deepEqual(env, {});
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
  assert.deepEqual(env, { UNRELATED: 'preserved' });
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
    assert.deepEqual(env, {});
  }
});
