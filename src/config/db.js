const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 10,
  idleTimeoutMillis: 30000,
});

pool.on('connect', () => console.log('PostgreSQL connected: Supabase'));
pool.on('error', (err) => console.error('PostgreSQL error:', err.message));

module.exports = pool;
