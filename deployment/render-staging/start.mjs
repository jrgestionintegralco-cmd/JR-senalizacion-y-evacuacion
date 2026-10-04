import { readFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
const port = process.env.PORT ?? '10000';
if (!/^\d+$/.test(port) || +port < 1 || +port > 65535 || +port === 4000) throw new Error('Invalid public PORT');
const origin = process.env.WEB_ORIGIN || process.env.RENDER_EXTERNAL_URL;
if (!origin || !origin.startsWith('https://')) throw new Error('An exact HTTPS WEB_ORIGIN or RENDER_EXTERNAL_URL is required');
writeFileSync('/etc/nginx/conf.d/default.conf', readFileSync(new URL('./nginx.conf.template', import.meta.url), 'utf8').replaceAll('${PORT}', port));
const children = [
  spawn(process.execPath, ['apps/api/dist/server.js'], { stdio: 'inherit', env: { ...process.env, API_PORT: '4000', WEB_ORIGIN: origin, COOKIE_SECURE: 'true' } }),
  spawn('nginx', ['-g', 'daemon off;'], { stdio: 'inherit' })
];
let stopping = false;
function stop(code) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill('SIGTERM');
  setTimeout(() => { for (const child of children) child.kill('SIGKILL'); process.exit(code); }, 5000).unref();
  Promise.all(children.map(child => child.exitCode !== null || child.signalCode !== null ? Promise.resolve() : new Promise(resolve => child.once('exit', resolve)))).then(() => process.exit(code));
}
for (const child of children) { child.once('error', () => stop(1)); child.once('exit', code => stop(code === 0 ? 1 : code ?? 1)); }
process.on('SIGTERM', () => stop(0));
process.on('SIGINT', () => stop(0));
