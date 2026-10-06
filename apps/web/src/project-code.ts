// Normalize typographic hyphens that look like '-' when a code is pasted.
// All other characters remain subject to the API's existing ASCII contract.
export const projectCodePattern = /^[A-Za-z0-9._-]{2,40}$/;

export function normalizeProjectCode(value: string): string {
  return value.trim().replace(/[\u2010-\u2015\u2212\uFE63\uFF0D]/g, '-');
}

export function projectCodeValidationMessage(value: string): string {
  return projectCodePattern.test(normalizeProjectCode(value)) ? ''
    : 'Código: utiliza de 2 a 40 caracteres: letras A–Z/a–z, números 0–9, punto (.), guion (-) y guion bajo (_).';
}

export function projectCodeForSubmission(value: string): string {
  const code = normalizeProjectCode(value);
  const message = projectCodeValidationMessage(code);
  if (message) throw new Error(message);
  return code;
}

// Read the actual submitted control, including values filled by the browser.
export function projectCodeFromForm(data: FormData): string {
  return projectCodeForSubmission(String(data.get('code') ?? ''));
}
