// Phase 10 audit helper: verify backend privilege configuration and test-role reliance.
const fs = require('fs');
const path = require('path');

const envPath = path.resolve(__dirname, '.env');
const env = {};
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].trim();
  }
}

const mask = (v) => !v ? '(MISSING)' : `set(len=${v.length}, hasPlaceholder=${/your-|example|changeme/i.test(v)})`;

console.log('SUPABASE_URL                 :', env.SUPABASE_URL || '(MISSING)');
console.log('SUPABASE_ANON_KEY            :', mask(env.SUPABASE_ANON_KEY));
console.log('SUPABASE_SERVICE_ROLE_KEY    :', mask(env.SUPABASE_SERVICE_ROLE_KEY));
console.log('SUPABASE_POSTGRES_LIVE       :', env.SUPABASE_POSTGRES_LIVE);
console.log('NODE_ENV                     :', env.NODE_ENV);
console.log('DATABASE_URL host            :', (env.DATABASE_URL || '').replace(/:[^:@]*@/, ':***@'));

const svcKeyIsReal = Boolean(env.SUPABASE_SERVICE_ROLE_KEY) &&
  !/your-|example|changeme/i.test(env.SUPABASE_SERVICE_ROLE_KEY);
console.log('\nSAFE_TO_REVOKE_ANON_WRITES   :', svcKeyIsReal ? 'YES (service_role key configured)' : 'NO - backend would fall back to anon key');

// Which test files reference role switching or direct table writes?
const testFiles = fs.readdirSync(__dirname).filter(f => /^(test_|restart_test)/.test(f) && f.endsWith('.js'));
console.log('\n--- test files referencing SET ROLE / anon / TRUNCATE / direct inserts ---');
let hits = 0;
for (const f of testFiles) {
  const lines = fs.readFileSync(path.join(__dirname, f), 'utf8').split(/\r?\n/);
  lines.forEach((l, i) => {
    if (/\bSET\s+ROLE\b|role\s+authenticated|role\s+anon|TRUNCATE|\.from\('?\w+'?\)\s*\.\s*(insert|update|delete)/i.test(l)) {
      console.log(`${f}:${i + 1}  ${l.trim().slice(0, 130)}`);
      hits++;
    }
  });
}
console.log(`total hits: ${hits}`);