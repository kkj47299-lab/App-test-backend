-- ═══════════════════════════════════════════════════════════════
-- Migration 002: Allow same phone for both customer and driver
-- Run this in Supabase SQL Editor AFTER 001_initial.sql
-- ═══════════════════════════════════════════════════════════════

-- Drop the old UNIQUE(phone) constraint — it prevents the same
-- phone from registering as both customer and driver.
ALTER TABLE app_auth.users DROP CONSTRAINT IF EXISTS users_phone_key;

-- Add a composite unique constraint: same phone + role combo is unique,
-- but one phone can have both a "customer" and a "driver" row.
ALTER TABLE app_auth.users ADD CONSTRAINT users_phone_role_key UNIQUE (phone, role);
