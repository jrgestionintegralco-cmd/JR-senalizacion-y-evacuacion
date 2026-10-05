export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

const fieldLabels: Record<string, string> = {
  clientId: 'Cliente', establishmentId: 'Establecimiento', code: 'Código',
  name: 'Nombre', description: 'Descripción', startsOn: 'Fecha de inicio', dueOn: 'Fecha límite'
};
const object = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';

export function apiErrorMessage(body: unknown, status: number): string {
  const root = object(body);
  const nested = object(root?.error);
  const messages: string[] = [];
  const add = (value: unknown, label = '') => {
    const message = text(value);
    if (message) messages.push(label ? `${label}: ${message}` : message);
  };
  add(root?.message ?? nested?.message);
  add(root?.detail);
  if (!messages.length) add(root?.title);
  const collect = (details: unknown) => {
    if (typeof details === 'string') { add(details); return; }
    if (Array.isArray(details)) {
      for (const issue of details) {
        if (typeof issue === 'string') add(issue);
        else {
          const item = object(issue);
          const path = Array.isArray(item?.path) ? item.path.join('.') : text(item?.field);
          add(item?.message, fieldLabels[path] ?? path);
        }
      }
      return;
    }
    const flattened = object(details);
    if (!flattened) return;
    if (Array.isArray(flattened.formErrors)) flattened.formErrors.forEach(value => add(value));
    for (const [field, errors] of Object.entries(object(flattened.fieldErrors) ?? {})) {
      const label = fieldLabels[field] ?? field;
      if (Array.isArray(errors)) errors.forEach(value => add(value, label));
      else add(errors, label);
    }
  };
  collect(root?.details ?? nested?.details);
  collect(root?.errors);
  if (messages.length) return [...new Set(messages)].join(' ');
  const code = text(root?.error) || text(nested?.code) || text(root?.code);
  if (code === 'INVALID_INPUT') return 'Revisa los datos del formulario: la API los rechazó (INVALID_INPUT).';
  if (code) return `La solicitud fue rechazada (${code}).`;
  return `No fue posible completar la solicitud (HTTP ${status}).`;
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const response = await fetch(`/api${path}`, {
    ...options,
    credentials: 'include',
    cache: 'no-store',
    headers
  });
  if (response.status === 204) return undefined as T;
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(apiErrorMessage(body, response.status), response.status);
  return body as T;
}
