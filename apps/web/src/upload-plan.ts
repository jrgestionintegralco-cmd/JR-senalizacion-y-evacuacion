import { api } from './api';

export async function uploadPlan(floorId: string, title: string, file: File) {
  const created = await api<{ id: string; uploadUrl: string; uploadToken: string }>(`/floors/${floorId}/plans/presign`, {
    method: 'POST', body: JSON.stringify({ name: file.name, title, contentType: file.type, sizeBytes: file.size })
  });
  if (!created.uploadToken || !created.uploadUrl) throw new Error('La API no devolvió una autorización de carga válida.');
  let sent: Response;
  try {
    sent = await fetch(created.uploadUrl, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file });
  } catch {
    throw new Error('No fue posible transferir el archivo al almacenamiento. Comprueba su disponibilidad, HTTPS y permisos de conexión; no se confirmó ninguna versión.');
  }
  if (!sent.ok) throw new Error('El almacenamiento no aceptó el archivo; no se confirmó ninguna versión.');
  return api<{ id: string; status: string; version: number }>(`/floor-plans/${created.id}/complete`, {
    method: 'POST', body: JSON.stringify({ uploadToken: created.uploadToken })
  });
}
