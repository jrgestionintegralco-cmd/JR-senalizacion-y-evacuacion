import { expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ProjectCodeInput } from './project-code-input';
import { projectCodeFromForm } from './project-code';

const validCodes = ['TEST-001', 'JR-001', 'PROY-2026-01', 'OBRA_001', 'CLIENTE-25', 'BARRANQUILLA.001', 'PROY.2026'];
it.each(validCodes)('el input conserva %s y permite validarlo para el POST sin bloqueos nativos persistentes', (code) => {
  const onChange = vi.fn();
  const setCustomValidity = vi.fn();
  const input = ProjectCodeInput({ value: '', onChange });
  input.props.onChange({ currentTarget: { value: code, setCustomValidity } });
  expect(onChange).toHaveBeenCalledWith(code);
  expect(setCustomValidity).not.toHaveBeenCalled();
  const html = renderToStaticMarkup(<form><ProjectCodeInput value={code} onChange={onChange} /></form>);
  expect(html).toContain(`value="${code}"`);
  expect(html).not.toContain('pattern=');
  expect(html).toContain('required=""');
  expect(html).toContain('minLength="2"');
  expect(html).toContain('maxLength="40"');
  const data = new FormData();
  data.set('code', code);
  expect(JSON.parse(JSON.stringify({ code: projectCodeFromForm(data) }))).toEqual({ code });
});
it('valida el valor del formulario aunque el estado previo de React sea distinto', () => {
  const input = ProjectCodeInput({ value: 'PROY/001', onChange: vi.fn() });
  expect(input.props.value).toBe('PROY/001');
  const submitted = new FormData();
  submitted.set('code', 'TEST-001');
  expect(projectCodeFromForm(submitted)).toBe('TEST-001');
});
it.each(['PROY/001', 'PROY 001', 'A', '', 'A'.repeat(41)])('sigue bloqueando %s antes del POST', (code) => {
  const data = new FormData();
  data.set('code', code);
  expect(() => projectCodeFromForm(data)).toThrow('Código: utiliza de 2 a 40 caracteres');
});
