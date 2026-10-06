import { expect, it } from 'vitest';
import { normalizeProjectCode, projectCodeForSubmission, projectCodeInputPattern } from './project-code';

it('preserva exactamente TEST-001 en el payload JSON enviado a la API', () => {
  expect(JSON.parse(JSON.stringify({ code: projectCodeForSubmission('TEST-001') }))).toEqual({ code: 'TEST-001' });
});
it('convierte guiones tipográficos de apariencia similar en el guion ASCII visible y enviado', () => {
  for (const dash of ['\u2010', '\u2011', '\u2012', '\u2013', '\u2014', '\u2015', '\u2212', '\uFE63', '\uFF0D']) {
    expect(normalizeProjectCode(`TEST${dash}001`)).toBe('TEST-001');
    expect(projectCodeForSubmission(`TEST${dash}001`)).toBe('TEST-001');
  }
});
it('conserva los caracteres válidos y rechaza espacios internos, invisibles, símbolos y longitudes inválidas', () => {
  expect(projectCodeForSubmission('  TEST-001._  ')).toBe('TEST-001._');
  expect(projectCodeForSubmission('A'.repeat(40))).toBe('A'.repeat(40));
  for (const code of ['', 'A', 'A'.repeat(41), 'TEST 001', 'TEST\u200B-001', 'TEST/001', 'PRÓ-001']) {
    expect(() => projectCodeForSubmission(code)).toThrow('Código:');
  }
});
it('el patrón HTML escapa el guion y acepta TEST-001 con la semántica v del navegador', () => {
  const pattern = new RegExp(`^(?:${projectCodeInputPattern})$`, 'v');
  expect(pattern.test('TEST-001')).toBe(true);
  expect(pattern.test('TEST/001')).toBe(false);
});
