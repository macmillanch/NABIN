/*
 * Tiny reverse proxy for the disposable chain-scratch backend.
 *
 * Why this exists
 * ---------------
 * supabase-js builds `${SUPABASE_URL}/rest/v1/<table>` for every query, and in the
 * real stack Kong is what strips the `/rest/v1` prefix before handing the request to
 * PostgREST (which serves at its root). The throwaway PostgREST the chain-scratch
 * harness starts has no Kong in front of it, so without this the backend's boot reads
 * fail with PostgREST's "Invalid path specified in request URL".
 *
 * This forwards `/rest/v1/*` to the throwaway PostgREST with the prefix removed, and
 * passes any other path through unchanged. It is deliberately dumb: no TLS, loopback
 * only, no caching. Started and stopped by the harness, never left running.
 */
const http = require('http');

const LISTEN_PORT = Number(process.env.FC_PROXY_PORT || 54331);
const TARGET_HOST = process.env.FC_POSTGREST_HOST || '127.0.0.1';
const TARGET_PORT = Number(process.env.FC_POSTGREST_PORT || 54332);
// supabase-js hardcodes its default schema as `public` and sends it as Accept-Profile /
// Content-Profile on every request. The clone lives in a different schema, so the proxy
// rewrites both profile headers to the clone. Without this, PostgREST answers PGRST106
// ("Invalid schema: public"). The backend needs no change: it still believes it is public.
const PROFILE_SCHEMA = process.env.FC_PROFILE_SCHEMA || 'chain_scratch';

const server = http.createServer((req, res) => {
  const stripped = req.url.replace(/^\/rest\/v1/, '') || '/';
  const headers = {
    ...req.headers,
    host: `${TARGET_HOST}:${TARGET_PORT}`,
    'accept-profile': PROFILE_SCHEMA,
    'content-profile': PROFILE_SCHEMA
  };
  const proxied = http.request(
    { host: TARGET_HOST, port: TARGET_PORT, path: stripped, method: req.method, headers },
    (up) => {
      res.writeHead(up.statusCode, up.headers);
      up.pipe(res);
    }
  );
  proxied.on('error', (e) => {
    res.writeHead(502, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ proxyError: e.message }));
  });
  req.pipe(proxied);
});

server.on('error', (e) => {
  console.error(`chain-scratch proxy failed to bind :${LISTEN_PORT}: ${e.message}`);
  process.exit(1);
});

server.listen(LISTEN_PORT, '127.0.0.1', () => {
  console.log(`chain-scratch proxy on 127.0.0.1:${LISTEN_PORT} -> ${TARGET_HOST}:${TARGET_PORT} (/rest/v1 stripped)`);
});
