-- Migration for existing databases created before the hook feature.
-- Run once in the Supabase SQL Editor. (schema.sql is for fresh installs only —
-- its CREATE TABLE fails if the table already exists.)
alter table public.scripts
  add column if not exists hook text not null default '';
