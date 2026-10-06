import { afterEach, expect, it, vi } from 'vitest';
import { uploadPlan } from './upload-plan';
afterEach(() => vi.unstubAllGlobals());
const issued = { id: 'synthetic-plan-id', uploadToken: 'synthetic-upload-token', uploadUrl: 'https://minio.example.test/bucket/synthetic-object' };
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
it.each(['application/pdf', 'image/png', 'image/jpeg'])('transfers %s before confirmation; sends the signed intent to the API', async (type) => {
  const fetch = vi.fn().mockResolvedValueOnce(response(issued, 201)).mockResolvedValueOnce(new Response(null, { status: 200 }))
    .mockResolvedValueOnce(response({ id: issued.id, status: 'ready', version: 6 }));
  vi.stubGlobal('fetch', fetch);
  const file = new File(['synthetic bytes'], 'synthetic-file', { type });
  expect(await uploadPlan('synthetic-floor', 'Synthetic plan', file)).toMatchObject({ status: 'ready', version: 6 });
  expect(fetch.mock.calls.map(([url]) => url)).toEqual(['/api/floors/synthetic-floor/plans/presign', issued.uploadUrl, `/api/floor-plans/${issued.id}/complete`]);
  expect(fetch.mock.calls[1][1]).toMatchObject({ method: 'PUT', body: file });
  expect(JSON.parse(fetch.mock.calls[2][1].body)).toEqual({ uploadToken: issued.uploadToken });
});
it('storage preparation failure never transfers or confirms', async () => {
  const fetch = vi.fn().mockResolvedValue(response({ error: 'STORAGE_UNAVAILABLE', message: 'Almacenamiento no disponible.' }, 503));
  vi.stubGlobal('fetch', fetch);
  await expect(uploadPlan('floor', 'Synthetic plan', new File(['x'], 'test.png', { type: 'image/png' }))).rejects.toThrow('Almacenamiento no disponible.');
  expect(fetch).toHaveBeenCalledOnce();
});
it.each(['denied', 'network'])('a %s transfer never confirms or retries automatically', async (reason) => {
  const fetch = vi.fn().mockResolvedValueOnce(response(issued, 201));
  if (reason === 'denied') fetch.mockResolvedValueOnce(new Response(null, { status: 403 }));
  else fetch.mockRejectedValueOnce(new TypeError('synthetic network failure'));
  vi.stubGlobal('fetch', fetch);
  await expect(uploadPlan('floor', 'Synthetic plan', new File(['x'], 'test.png', { type: 'image/png' }))).rejects.toThrow('no se confirmó ninguna versión');
  expect(fetch).toHaveBeenCalledTimes(2);
});
