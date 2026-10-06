import { expect, it } from 'vitest';
import { signPlanUploadIntent, verifyPlanUploadIntent } from '../src/plan-upload-intent.js';
const secret = 'synthetic-test-only-secret';
const intent = {
  id: '11111111-1111-4111-8111-111111111111', organizationId: '22222222-2222-4222-8222-222222222222',
  userId: '33333333-3333-4333-8333-333333333333', floorId: '44444444-4444-4444-8444-444444444444',
  name: 'plano.png', title: 'Plano de prueba', contentType: 'image/png' as const, sizeBytes: 123,
  objectKey: 'synthetic/staging/test', expiresAt: 2000
};
it('preserves the signed intent without persisting metadata', () => {
  expect(verifyPlanUploadIntent(signPlanUploadIntent(intent, secret), secret, 1000)).toEqual(intent);
});
it('rejects modified data, signatures, wrong secrets and expired intents', () => {
  const token = signPlanUploadIntent(intent, secret);
  const [payload, sig] = token.split('.');
  const forged = Buffer.from(JSON.stringify({ ...intent, floorId: intent.userId })).toString('base64url');
  for (const bad of [`${forged}.${sig}`, `${payload}.bad`, 'bad', 'x'.repeat(8193)]) {
    expect(() => verifyPlanUploadIntent(bad, secret, 1000)).toThrow();
  }
  expect(() => verifyPlanUploadIntent(token, 'wrong-secret', 1000)).toThrow();
  expect(() => verifyPlanUploadIntent(token, secret, 2000)).toThrow();
});
