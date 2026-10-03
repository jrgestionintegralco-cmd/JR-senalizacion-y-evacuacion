import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import sharp from 'sharp';
import { validatePlanBytes } from '../src/plan-validation.js';

describe('validación de bytes de planos', () => {
  it('acepta un PDF real', async () => {
    const pdf = await PDFDocument.create(); pdf.addPage([400, 300]);
    await expect(validatePlanBytes(Buffer.from(await pdf.save()), 'application/pdf')).resolves.toBeUndefined();
  });
  it.each(['png', 'jpeg'] as const)('decodifica %s real', async (format) => {
    const bytes = await sharp({ create: { width: 10, height: 10, channels: 3, background: 'white' } }).toFormat(format).toBuffer();
    await expect(validatePlanBytes(bytes, `image/${format}`)).resolves.toBeUndefined();
  });
  it('rechaza PDF falso con cabecera y final aparentes', async () => {
    await expect(validatePlanBytes(Buffer.from('%PDF-1.7\nnot a document\n%%EOF'), 'application/pdf')).rejects.toMatchObject({ code: 'INVALID_PLAN_FILE' });
  });
  it('rechaza un tipo declarado distinto del real', async () => {
    const bytes = await sharp({ create: { width: 2, height: 2, channels: 3, background: 'white' } }).png().toBuffer();
    await expect(validatePlanBytes(bytes, 'image/jpeg')).rejects.toMatchObject({ code: 'INVALID_PLAN_FILE' });
  });
  it('rechaza exceso de páginas', async () => {
    const pdf = await PDFDocument.create(); for (let i = 0; i < 101; i++) pdf.addPage([100, 100]);
    await expect(validatePlanBytes(Buffer.from(await pdf.save()), 'application/pdf')).rejects.toMatchObject({ code: 'INVALID_PLAN_FILE' });
  });
  it('rechaza una imagen truncada', async () => {
    await expect(validatePlanBytes(Buffer.from([137,80,78,71,13,10,26,10]), 'image/png')).rejects.toMatchObject({ code: 'INVALID_PLAN_FILE' });
  });
});
