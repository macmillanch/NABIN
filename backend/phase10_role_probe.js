// Phase 10 audit helper: determine which PostgreSQL role the backend actually
// authenticates as. Prints ONLY the non-secret `role` claim of the JWT and
// non-secret configuration flags — never the key material itself.
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });

function roleClaim(jwt) {
  if (!jwt) return '(unset)';
  const parts = String(jwt).split('.');
  if (parts.length !== 3) return '(not-a-jwt)';
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    return payload.role || '(no role claim)';
  } catch (e) {
    return `(decode-failed: ${e.message})`;
  }
}

const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.SUPABASE_ANON_KEY;

console.log('NODE_ENV                 :', process.env.NODE_ENV);
console.log('SUPABASE_POSTGRES_LIVE   :', process.env.SUPABASE_POSTGRES_LIVE);
console.log('SUPABASE_URL host        :', (() => {
  try { return new URL(process.env.SUPABASE_URL).host; } catch (e) { return process.env.SUPABASE_URL; }
})());
console.log('DATABASE_URL host        :', (() => {
  try { const u = new URL(process.env.DATABASE_URL); return `${u.hostname}:${u.port}`; } catch (e) { return '(unset)'; }
})());
console.log('SERVICE_ROLE_KEY present :', Boolean(serviceKey));
console.log('SERVICE_ROLE_KEY role    :', roleClaim(serviceKey));
console.log('ANON_KEY present         :', Boolean(anonKey));
console.log('ANON_KEY role            :', roleClaim(anonKey));
console.log('');
console.log('=> supabaseAdmin will authenticate as:',
  roleClaim(serviceKey) === 'service_role' ? 'service_role (SAFE for migration 024)'
    : `ANON FALLBACK -> ${roleClaim(serviceKey === undefined ? anonKey : serviceKey)} (migration 024 would break writes)`);
console.log('=> backend writes via DATABASE_URL authenticate as: postgres (owner, unaffected by 024)');