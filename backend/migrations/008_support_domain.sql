-- =========================================================================
-- NABIN PLATFORM — SUPPORT & DISPUTE RESOLUTION DOMAIN MIGRATION
-- Migration: 008_support_domain.sql
-- Adds ONLY missing columns and indexes to public.support_tickets
-- Target: TEST database ONLY.
-- =========================================================================

-- 1. Add missing Domain 8 columns
ALTER TABLE public.support_tickets
ADD COLUMN IF NOT EXISTS job_id UUID REFERENCES public.jobs(id) ON DELETE SET NULL;

ALTER TABLE public.support_tickets
ADD COLUMN IF NOT EXISTS category VARCHAR(50) DEFAULT 'GENERAL';

ALTER TABLE public.support_tickets
ADD COLUMN IF NOT EXISTS messages JSONB DEFAULT '[]'::jsonb;

ALTER TABLE public.support_tickets
ADD COLUMN IF NOT EXISTS resolution_notes TEXT;

ALTER TABLE public.support_tickets
ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ;

-- 2. Add appropriate indexes
CREATE INDEX IF NOT EXISTS idx_support_tickets_user_id ON public.support_tickets(user_id);
CREATE INDEX IF NOT EXISTS idx_support_tickets_job_id ON public.support_tickets(job_id);
CREATE INDEX IF NOT EXISTS idx_support_tickets_status ON public.support_tickets(status);
CREATE INDEX IF NOT EXISTS idx_support_tickets_category ON public.support_tickets(category);
CREATE INDEX IF NOT EXISTS idx_support_tickets_created_at ON public.support_tickets(created_at DESC);
