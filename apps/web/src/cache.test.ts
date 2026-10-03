import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

function worker() {
  const handlers: Record<string, (event: any) => void> = {};
  const cache = { addAll: vi.fn(), put: vi.fn() };
  const caches = { open: vi.fn().mockResolvedValue(cache), keys: vi.fn().mockResolvedValue(['jr-platform-shell-v1', 'unrelated']), delete: vi.fn().mockResolvedValue(true), match: vi.fn() };
  const self = { location: { origin: 'https://jr.test' }, addEventListener: (name: string, fn: any) => { handlers[name] = fn; }, skipWaiting: vi.fn(), clients: { claim: vi.fn() } };
  const fetch = vi.fn().mockResolvedValue({ ok: true, type: 'basic', clone: () => ({}) });
  runInNewContext(readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8'), { self, caches, fetch, URL, Response });
  return { handlers, caches, fetch };
}
describe('privacidad de la caché', () => {
  it.each(['/api/floor-plans', '/plans/file.pdf', '/?X-Amz-Signature=secret', 'https://storage.test/private.png', '/assets/a.js?token=secret'])('no intercepta %s', (url) => {
    const { handlers, fetch } = worker();
    const respondWith = vi.fn();
    handlers.fetch({ request: { method: 'GET', url: new URL(url, 'https://jr.test').href }, respondWith });
    expect(respondWith).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
  it('elimina la caché antigua y toma control', async () => {
    const { handlers, caches } = worker();
    let pending: Promise<unknown> = Promise.resolve();
    handlers.activate({ waitUntil: (value: Promise<unknown>) => { pending = value; } });
    await pending;
    expect(caches.delete).toHaveBeenCalledExactlyOnceWith('jr-platform-shell-v1');
  });
  it('permite guardar recursos públicos', async () => {
    const { handlers, fetch } = worker();
    let pending: Promise<unknown> = Promise.resolve();
    handlers.fetch({ request: { method: 'GET', url: 'https://jr.test/assets/app.js' }, respondWith: (value: Promise<unknown>) => { pending = value; }, waitUntil: () => {} });
    await pending;
    expect(fetch).toHaveBeenCalledOnce();
  });
});
