import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { PlanFileError } from './plan-validation.js';

const schema = z.object({
  id: z.uuid(), organizationId: z.uuid(), userId: z.uuid(), floorId: z.uuid(),
  name: z.string().min(1).max(180), title: z.string().min(2).max(180),
  contentType: z.enum(['application/pdf', 'image/png', 'image/jpeg']),
  sizeBytes: z.number().int().positive(), objectKey: z.string().min(1), expiresAt: z.number().int()
});
export type PlanUploadIntent = z.infer<typeof schema>;
const signature = (payload: string, secret: string) => createHmac('sha256', secret).update(`safe-enter:plan-upload:v1:${payload}`).digest();

export function signPlanUploadIntent(intent: PlanUploadIntent, secret: string): string {
  const payload = Buffer.from(JSON.stringify(schema.parse(intent))).toString('base64url');
  return `${payload}.${signature(payload, secret).toString('base64url')}`;
}
export function verifyPlanUploadIntent(token: string, secret: string, now = Date.now()): PlanUploadIntent {
  const invalid = () => new PlanFileError('INVALID_UPLOAD_TOKEN', 'La autorización de carga es inválida o ha vencido.', 400);
  if (token.length > 8192) throw invalid();
  const parts = token.split('.');
  if (parts.length !== 2) throw invalid();
  const expected = signature(parts[0], secret);
  const supplied = Buffer.from(parts[1], 'base64url');
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) throw invalid();
  let value: unknown;
  try { value = JSON.parse(Buffer.from(parts[0], 'base64url').toString()); } catch { throw invalid(); }
  const parsed = schema.safeParse(value);
  if (!parsed.success || parsed.data.expiresAt <= now) throw invalid();
  return parsed.data;
}
