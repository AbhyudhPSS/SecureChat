import { buildApp } from './app.js';
import { config } from './config.js';
import { prisma } from './db.js';
import { connectRedis, disconnectRedis } from './redis.js';

async function main(): Promise<void> {
  await connectRedis();
  const app = await buildApp();

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info(`${signal} received, shutting down`);
    await app.close();
    await disconnectRedis();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  try {
    await app.listen({ port: config.SERVER_PORT, host: '0.0.0.0' });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

void main();
