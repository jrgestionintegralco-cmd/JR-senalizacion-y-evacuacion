import type { FastifyRequest } from 'fastify';

export interface AuthenticatedUser {
  id: string;
  organizationId: string;
  email: string;
  fullName: string;
  permissions: string[];
}

declare module 'fastify' {
  interface FastifyRequest {
    authUser?: AuthenticatedUser;
  }
}

export type AuthenticatedRequest = FastifyRequest & { authUser: AuthenticatedUser };
