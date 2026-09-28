import type { FastifyInstance } from 'fastify';
import type { Services } from '../../services/index.js';
import authRoutes from './auth.js';
import logRoutes from './logs.js';
import playerRoutes from './players.js';
import serverRoutes from './server.js';
import userRoutes from './users.js';

export default async function v1(app: FastifyInstance, opts: { services: Services }) {
  await app.register(authRoutes, { ...opts, prefix: '/auth' });
  await app.register(userRoutes, { ...opts, prefix: '/users' });
  await app.register(serverRoutes, { ...opts, prefix: '/server' });
  await app.register(playerRoutes, { ...opts, prefix: '/players' });
  await app.register(logRoutes, { ...opts, prefix: '/logs' });
}
