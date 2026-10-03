import { Worker } from 'node:worker_threads';
import { createRequire } from 'node:module';

export class PlanFileError extends Error {
  constructor(public code: string, message: string, public statusCode = 422) { super(message); }
}

// No semantic extraction: only format/decoding and resource limits. Run parsers
// off the HTTP thread; never execute document scripts or rewrite the original.
const validator = `
const { parentPort, workerData } = require('node:worker_threads');
(async () => {
  const bytes = Buffer.from(workerData.bytes);
  if (workerData.type === 'application/pdf') {
    if (!bytes.subarray(0, 8).toString('ascii').startsWith('%PDF-')) throw Error('PDF');
    if (!bytes.subarray(Math.max(0, bytes.length - 2048)).includes(Buffer.from('%%EOF'))) throw Error('PDF truncado');
    const { PDFDocument } = require(workerData.pdfLib);
    const pdf = await PDFDocument.load(bytes, { updateMetadata: false, throwOnInvalidObject: true });
    const pages = pdf.getPages();
    if (!pages.length || pages.length > 100) throw Error('Limite de paginas');
    for (const page of pages) {
      const { width, height } = page.getSize();
      if (![width, height].every(n => Number.isFinite(n) && n > 0 && n <= 14400)) throw Error('Dimensiones PDF');
    }
  } else {
    const png = bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
    const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
    if (!(workerData.type === 'image/png' && png || workerData.type === 'image/jpeg' && jpeg)) throw Error('Formato');
    const sharp = require(workerData.sharp);
    sharp.cache(false);
    const image = sharp(bytes, { limitInputPixels: 25000000, failOn: 'warning' }).timeout({ seconds: 10 });
    const meta = await image.metadata();
    if ((meta.pages || 1) !== 1 || !meta.width || !meta.height) throw Error('Imagen multipagina');
    await image.stats();
  }
  parentPort.postMessage(true);
})().catch(() => parentPort.postMessage(false));
`;

export async function validatePlanBytes(bytes: Buffer, type: string): Promise<void> {
  const require = createRequire(import.meta.url);
  await new Promise<void>((resolve, reject) => {
    const worker = new Worker(validator, {
      eval: true,
      workerData: { bytes, type, pdfLib: require.resolve('pdf-lib'), sharp: require.resolve('sharp') },
      resourceLimits: { maxOldGenerationSizeMb: 128, stackSizeMb: 4 }
    });
    let settled = false;
    const finish = (valid: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker.terminate();
      if (valid) resolve();
      else reject(new PlanFileError('INVALID_PLAN_FILE', 'Archivo inválido, protegido o fuera de los límites: 100 páginas PDF y 25 millones de píxeles por imagen.'));
    };
    const timer = setTimeout(() => finish(false), 15_000);
    worker.once('message', (valid) => finish(valid === true));
    worker.once('error', () => finish(false));
    worker.once('exit', () => finish(false));
  });
}
