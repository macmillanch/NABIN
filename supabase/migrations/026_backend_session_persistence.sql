-- 026: DURABLE BACKEND AUTH SESSIONS
-- The Express backend used to keep bearer tokens only in a per-process Map, so every
-- restart logged all users out and a second instance could not authorise their traffic.
-- Tokens are stored as SHA-256 hashes: a database read alone must not yield a usable
-- credential. RLS is enabled with no policies, so only the service role (which bypasses
-- RLS) can reach this table -- the public REST surface can never enumerate sessions.
-- =========================================================================

CREATE TABLE IF NOT EXISTS public.backend_sessions (
    token_hash TEXT PRIMARY KEY,
    role VARCHAR(30) NOT NULL,
    entity_id TEXT NOT NULL,
    phone VARCHAR(20),
    entity JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_backend_sessions_expires_at
    ON public.backend_sessions (expires_at);

CREATE INDEX IF NOT EXISTS idx_backend_sessions_entity
    ON public.backend_sessions (entity_id);

ALTER TABLE public.backend_sessions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.backend_sessions FROM anon, authenticated;
