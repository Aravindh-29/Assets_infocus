import { app } from './app.js';
import { config } from './config.js';
import { prisma, logger } from './db.js';
import { generateWarrantyAlerts } from './services/alerts.js';

await prisma.$connect();
const server = app.listen(config.PORT, config.HOST, () =>
  logger.info({ port: config.PORT, host: config.HOST }, 'Asset Management API is running'),
);
server.on('error', (error) => {
  logger.error({ message: error.message }, 'Server startup failed');
  process.exitCode = 1;
  void prisma.$disconnect();
});
void generateWarrantyAlerts();
const alertTimer = setInterval(() => void generateWarrantyAlerts(), 60 * 60 * 1000);
alertTimer.unref();
let stopping = false;
async function stop(signal: string) {
  if (stopping) return;
  stopping = true;
  logger.info({ signal }, 'Stopping server');
  clearInterval(alertTimer);
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
  setTimeout(() => {
    server.closeAllConnections();
    process.exit(1);
  }, 10000).unref();
}
process.on('SIGINT', () => void stop('SIGINT'));
process.on('SIGTERM', () => void stop('SIGTERM'));
