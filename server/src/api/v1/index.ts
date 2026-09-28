import type { FastifyInstance } from 'fastify';
import type { Services } from '../../services/index.js';
import authRoutes from './auth.js';
import configRoutes from './config.js';
import logRoutes from './logs.js';
import playerRoutes from './players.js';
import publicRoutes from './public.js';
import serverRoutes from './server.js';
import siteRoutes from './site.js';
import userRoutes from './users.js';
import paldefenderRoutes from './paldefender.js';
import worldRoutes from './world.js';

export default async function v1(app: FastifyInstance, opts: { services: Services }) {
  await app.register(authRoutes, { ...opts, prefix: '/auth' });
  await app.register(userRoutes, { ...opts, prefix: '/users' });
  await app.register(serverRoutes, { ...opts, prefix: '/server' });
  await app.register(playerRoutes, { ...opts, prefix: '/players' });
  await app.register(configRoutes, { ...opts, prefix: '/config' });
  await app.register(worldRoutes, { ...opts, prefix: '/world' });
  await app.register(paldefenderRoutes, { ...opts, prefix: '/paldefender' });
  await app.register(logRoutes, { ...opts, prefix: '/logs' });
  await app.register(publicRoutes, { ...opts, prefix: '/public' });
  await app.register(siteRoutes, { ...opts, prefix: '/site' });
}
