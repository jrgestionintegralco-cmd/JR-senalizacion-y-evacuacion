import { expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ProjectCodeInput } from './project-code-input';
import { projectCodeForSubmission } from './project-code';

it('el input real de Código renderiza TEST-001 sin un pattern nativo que bloquee el envío', () => {
  const html = renderToStaticMarkup(<form><ProjectCodeInput value="TEST-001" onChange={() => {}} /></form>);
  expect(html).toContain('name="code"');
  expect(html).toContain('value="TEST-001"');
  expect(html).not.toContain('pattern=');
  expect(html).toContain('required=""');
  expect(html).toContain('minLength="2"');
  expect(html).toContain('maxLength="40"');
});
it('escribir TEST-001 libera la validación nativa y conserva exactamente el código del payload', () => {
  const onChange = vi.fn();
  const setCustomValidity = vi.fn();
  const input = ProjectCodeInput({ value: '', onChange });
  input.props.onChange({ currentTarget: { value: 'TEST-001', setCustomValidity } });
  expect(setCustomValidity).toHaveBeenCalledWith('');
  expect(onChange).toHaveBeenCalledWith('TEST-001');
  expect(JSON.parse(JSON.stringify({ code: projectCodeForSubmission(onChange.mock.calls[0][0]) }))).toEqual({ code: 'TEST-001' });
});
it('un código inválido se bloquea y corregirlo a TEST-001 elimina el error anterior', () => {
  const onChange = vi.fn();
  const setCustomValidity = vi.fn();
  const input = ProjectCodeInput({ value: '', onChange });
  input.props.onChange({ currentTarget: { value: 'TEST/001', setCustomValidity } });
  expect(setCustomValidity).toHaveBeenLastCalledWith(expect.stringMatching(/^Código:/));
  input.props.onChange({ currentTarget: { value: 'TEST-001', setCustomValidity } });
  expect(setCustomValidity).toHaveBeenLastCalledWith('');
  expect(onChange).toHaveBeenLastCalledWith('TEST-001');
});
