import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const KEYS = ['CONFIRM_RENDER_STAGING', 'STAGING_BOOTSTRAP_CONFIRM',
  'STAGING_BOOTSTRAP_EMAIL', 'STAGING_BOOTSTRAP_PASSWORD'];

export async function runAuthorizedBootstrap(env = process.env, spawnProcess = spawn) {
  if (KEYS.every(key => env[key] === undefined)) return;
  try {
    if (env.CONFIRM_RENDER_STAGING !== 'safe_enter_render_staging' ||
        env.STAGING_BOOTSTRAP_CONFIRM !== 'CREATE_FIRST_JR_RENDER_STAGING_ADMIN' ||
        !env.STAGING_BOOTSTRAP_EMAIL?.trim() || !env.STAGING_BOOTSTRAP_PASSWORD) {
      throw new Error('Incomplete or invalid bootstrap authorization; startup stopped.');
    }
    await new Promise((resolve, reject) => {
      let child;
      try {
        child = spawnProcess(process.execPath, [
          fileURLToPath(new URL('./bootstrap-admin.mjs', import.meta.url)), '--execute-once'
        ], { env: { ...env }, stdio: 'inherit' });
      } catch {
        reject(new Error('Bootstrap could not start; startup stopped.'));
        return;
      }
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new Error('Bootstrap timed out; startup stopped. Check commit outcome before retrying.'));
      }, 60_000);
      child.once('error', () => {
        clearTimeout(timer);
        reject(new Error('Bootstrap could not start; startup stopped.'));
      });
      child.once('exit', (code, signal) => {
        clearTimeout(timer);
        if (code === 0 && !signal) resolve();
        else reject(new Error('Bootstrap did not succeed; startup stopped.'));
      });
    });
  } finally {
    // Never propagate temporary authorization or password to API/Nginx children.
    for (const key of KEYS) delete env[key];
  }
}
