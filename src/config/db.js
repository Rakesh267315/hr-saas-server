const { Pool } = require('pg');
const dns = require('dns');

// Force IPv4 — Railway containers may resolve Supabase hostname to IPv6
dns.setDefaultResultOrder('ipv4first');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

pool.on('connect', () => console.log('PostgreSQL connected: Supabase'));
pool.on('error', (err) => console.error('PostgreSQL error:', err.message));

module.exports = pool;
