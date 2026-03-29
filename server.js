require('dotenv').config();

// ── Env validation — fail fast if critical vars missing ────────────────────
const requiredEnv = ['DATABASE_URL', 'JWT_SECRET'];
for (const key of requiredEnv) {
  if (!process.env[key]) {
    console.error(`FATAL: Missing required environment variable: ${key}`);
    process.exit(1);
  }
}

const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const initDB = require('./src/config/initDB');

const app = express();

// ── Security headers ───────────────────────────────────────────────────────
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));

// ── CORS ───────────────────────────────────────────────────────────────────
const allowedOrigins = [
  process.env.CLIENT_URL,
  'http://localhost:3000', 'http://localhost:3001', 'http://localhost:3002',
  'http://127.0.0.1:3000', 'http://127.0.0.1:3001',
  'https://client-seven-omega-32.vercel.app',
].filter(Boolean);

app.use(cors({
  origin: (origin, cb) => {
    if (!origin || allowedOrigins.includes(origin) || /^http:\/\/localhost:\d+$/.test(origin)) {
      cb(null, true);
    } else {
      cb(new Error(`CORS blocked: ${origin}`));
    }
  },
  credentials: true,
}));

app.use(express.json({ limit: '10mb' }));

// ── Logging — skip token details in production ─────────────────────────────
if (process.env.NODE_ENV !== 'production') {
  app.use(morgan('dev'));
} else {
  app.use(morgan('combined', {
    skip: (req) => req.path === '/api/health',
  }));
}

// ── Rate limiting ──────────────────────────────────────────────────────────
// Strict limit on auth endpoints — prevent brute force
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,   // 15 minutes
  max: 20,                     // max 20 login attempts per 15 min per IP
  message: { success: false, message: 'Too many login attempts. Please try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// General API limiter — prevent API abuse
const apiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,    // 1 minute
  max: 200,                    // 200 requests per minute per IP
  message: { success: false, message: 'Too many requests. Please slow down.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// ── Routes ─────────────────────────────────────────────────────────────────
app.use('/api/v1/auth', authLimiter, require('./src/routes/auth'));
app.use('/api/v1/employees', apiLimiter, require('./src/routes/employees'));
app.use('/api/v1/departments', apiLimiter, require('./src/routes/departments'));
app.use('/api/v1/attendance', apiLimiter, require('./src/routes/attendance'));
app.use('/api/v1/leaves', apiLimiter, require('./src/routes/leaves'));
app.use('/api/v1/payroll', apiLimiter, require('./src/routes/payroll'));
app.use('/api/v1/settings', apiLimiter, require('./src/routes/settings'));
app.use('/api/v1/breaks',        apiLimiter, require('./src/routes/breaks'));
app.use('/api/v1/face',          apiLimiter, require('./src/routes/face'));
app.use('/api/v1/notifications', apiLimiter, require('./src/routes/notifications'));
app.use('/api/v1/performance',   apiLimiter, require('./src/routes/performance'));

// ── Health check ───────────────────────────────────────────────────────────
app.get('/api/health', (_, res) => res.json({ status: 'ok', db: 'supabase', timestamp: new Date() }));

// ── 404 ───────────────────────────────────────────────────────────────────
app.use((req, res) => res.status(404).json({ success: false, message: 'Route not found' }));

// ── Global error handler ───────────────────────────────────────────────────
app.use((err, req, res, next) => {
  // Don't leak internal error details in production
  const isDev = process.env.NODE_ENV !== 'production';
  console.error(`[${new Date().toISOString()}] ERROR ${req.method} ${req.path}:`, err.message);
  res.status(err.status || 500).json({
    success: false,
    message: isDev ? err.message : 'An unexpected error occurred. Please try again.',
  });
});

// ── Unhandled rejections ───────────────────────────────────────────────────
process.on('unhandledRejection', (reason) => {
  console.error('[UnhandledRejection]', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[UncaughtException]', err);
  process.exit(1);
});

// ── Server start ───────────────────────────────────────────────────────────
const PORT = process.env.PORT || 5000;
const server = app.listen(PORT, async () => {
  console.log(`Server running on http://localhost:${PORT} [${process.env.NODE_ENV || 'development'}]`);
  try {
    await initDB();
  } catch (err) {
    console.error('Schema init error:', err.message);
  }
});

// ── Graceful shutdown ──────────────────────────────────────────────────────
const shutdown = (signal) => {
  console.log(`\n${signal} received — shutting down gracefully`);
  server.close(() => {
    console.log('HTTP server closed');
    const pool = require('./src/config/db');
    pool.end(() => {
      console.log('Database pool closed');
      process.exit(0);
    });
  });
  // Force exit after 10s
  setTimeout(() => process.exit(1), 10000);
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
