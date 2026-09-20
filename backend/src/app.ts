import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { rateLimit } from 'express-rate-limit';
import { pinoHttp } from 'pino-http';
import { config } from './config.js';
import { prisma, logger } from './db.js';
import { AppError, authenticate, errorHandler, ok } from './http.js';
import { authRouter } from './routes/auth.js';
import { assetsRouter } from './routes/assets.js';
import { directoryRouter } from './routes/directory.js';
import { operationsRouter } from './routes/operations.js';
import { adminRouter } from './routes/admin.js';
import { dashboardRouter } from './routes/dashboard.js';
import { reportsRouter } from './routes/reports.js';

export const app = express();
app.disable('x-powered-by');
if (config.TRUST_PROXY_HOPS > 0) app.set('trust proxy', config.TRUST_PROXY_HOPS);
app.use(helmet());
const origins = config.CORS_ORIGIN.split(',').map((s) => s.trim());
app.use(
  cors({
    origin(origin, callback) {
      if (!origin || origins.includes(origin)) callback(null, true);
      else callback(new AppError(403, 'This origin is not permitted.', 'ORIGIN_FORBIDDEN'));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  }),
);
app.use((req, _res, next) => {
  if (
    !['GET', 'HEAD', 'OPTIONS'].includes(req.method) &&
    req.headers.origin &&
    !origins.includes(req.headers.origin)
  ) {
    next(new AppError(403, 'This origin is not permitted.', 'ORIGIN_FORBIDDEN'));
    return;
  }
  next();
});
app.use(express.json({ limit: '256kb' }));
app.use(cookieParser());
app.use(
  pinoHttp({
    logger,
    autoLogging: config.NODE_ENV !== 'test',
    serializers: {
      req: (req) => ({ id: req.id, method: req.method, url: String(req.url ?? '').split('?')[0] }),
      res: (res) => ({ statusCode: res.statusCode }),
    },
  }),
);
app.use(
  '/api',
  rateLimit({
    windowMs: 15 * 60000,
    limit: config.NODE_ENV === 'test' ? 10000 : 2000,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { success: false, message: 'Too many requests. Try again shortly.', errorCode: 'RATE_LIMITED' },
  }),
);
app.get('/api/health', async (_req, res) => {
  await prisma.$queryRaw`SELECT 1`;
  ok(res, { status: 'ok', database: 'connected' });
});
app.use('/api/auth', authRouter);
app.use('/api', authenticate);
app.use('/api/assets', assetsRouter);
app.use('/api', directoryRouter, operationsRouter, adminRouter, dashboardRouter);
app.use('/api/reports', reportsRouter);
app.use((_req, _res, next) => next(new AppError(404, 'Endpoint not found.', 'NOT_FOUND')));
app.use(errorHandler);
export default app;
