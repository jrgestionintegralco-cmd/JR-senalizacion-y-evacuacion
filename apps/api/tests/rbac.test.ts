import { describe, expect, it, vi } from 'vitest';
import { authorize } from '../src/auth.js';

describe('control de acceso por permisos', () => {
  it('permite una acción concedida', async () => {
    const request = { authUser: { permissions: ['users.read'] } } as any;
    const reply = { code: vi.fn().mockReturnThis(), send: vi.fn() } as any;
    await authorize('users.read')(request, reply);
    expect(reply.code).not.toHaveBeenCalled();
  });

  it('responde 403 cuando falta el permiso', async () => {
    const request = { authUser: { permissions: [] } } as any;
    const reply = { code: vi.fn().mockReturnThis(), send: vi.fn() } as any;
    await authorize('users.manage')(request, reply);
    expect(reply.code).toHaveBeenCalledWith(403);
    expect(reply.send).toHaveBeenCalledWith(expect.objectContaining({ error: 'FORBIDDEN' }));
  });
});
