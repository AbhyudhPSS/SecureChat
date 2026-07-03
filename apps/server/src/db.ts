import { PrismaClient } from '@prisma/client';
import { isProd } from './config.js';

/**
 * Single Prisma client for the process. Connection is lazy: importing this
 * module does not require the database to be up, so `/health` works even before
 * migrations have run.
 */
export const prisma = new PrismaClient({
  log: isProd ? ['error'] : ['warn', 'error'],
});
