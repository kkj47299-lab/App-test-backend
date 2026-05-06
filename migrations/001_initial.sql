-- ═══════════════════════════════════════════════════════════════
-- RideShare — Full Database Migration
-- Run this in Supabase SQL Editor (supabase.com → SQL Editor)
-- This creates ALL schemas, tables, indexes, and seed data.
-- Safe to re-run — uses IF NOT EXISTS / ON CONFLICT throughout.
-- ═══════════════════════════════════════════════════════════════

-- ── Extensions ──────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── Schemas ─────────────────────────────────────────────────────
CREATE SCHEMA IF NOT EXISTS app_auth;
CREATE SCHEMA IF NOT EXISTS users;
CREATE SCHEMA IF NOT EXISTS drivers;
CREATE SCHEMA IF NOT EXISTS rides;
CREATE SCHEMA IF NOT EXISTS bookings;
CREATE SCHEMA IF NOT EXISTS payments;
CREATE SCHEMA IF NOT EXISTS locations;
CREATE SCHEMA IF NOT EXISTS ratings;
CREATE SCHEMA IF NOT EXISTS notifications;

-- ═══════════════════════════════════════════════════════════════
-- SCHEMA: auth
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS app_auth.users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone         VARCHAR(15) UNIQUE NOT NULL,
  role          VARCHAR(10) NOT NULL CHECK (role IN ('customer', 'driver')),
  firebase_uid  TEXT,
  is_active     BOOLEAN DEFAULT true,
  created_at    TIMESTAMPTZ DEFAULT now(),
  last_login_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_auth_users_phone ON app_auth.users(phone);

-- ═══════════════════════════════════════════════════════════════
-- SCHEMA: users
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS users.profiles (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID UNIQUE NOT NULL,
  role               VARCHAR(10),
  full_name          VARCHAR(100) NOT NULL,
  email              VARCHAR(150),
  phone              VARCHAR(15),
  date_of_birth      DATE,
  gender             VARCHAR(10),
  avatar_url         TEXT,
  avg_rating         NUMERIC(3,2) DEFAULT 5.00,
  total_reviews      INTEGER DEFAULT 0,
  notification_prefs JSONB DEFAULT '{"push":true,"sms":true}',
  is_deleted         BOOLEAN DEFAULT false,
  created_at         TIMESTAMPTZ DEFAULT now(),
  updated_at         TIMESTAMPTZ DEFAULT now()
);

-- ═══════════════════════════════════════════════════════════════
-- SCHEMA: drivers
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS drivers.vehicles (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id        UUID NOT NULL,
  make             VARCHAR(50) NOT NULL,
  model            VARCHAR(50) NOT NULL,
  year             SMALLINT NOT NULL,
  color            VARCHAR(30) NOT NULL,
  registration_no  VARCHAR(20) UNIQUE NOT NULL,
  seats_total      SMALLINT NOT NULL DEFAULT 4,
  is_ac            BOOLEAN DEFAULT true,
  fuel_type        VARCHAR(15) DEFAULT 'petrol',
  photos           TEXT[],
  is_active        BOOLEAN DEFAULT true,
  is_default       BOOLEAN DEFAULT false,
  created_at       TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_vehicles_driver ON drivers.vehicles(driver_id);

CREATE TABLE IF NOT EXISTS drivers.documents (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id           UUID NOT NULL,
  vehicle_id          UUID REFERENCES drivers.vehicles(id),
  doc_type            VARCHAR(30) NOT NULL,
  file_url            TEXT,
  doc_url             TEXT,
  expiry_date         DATE,
  status              VARCHAR(15) DEFAULT 'pending',
  verification_status VARCHAR(15) DEFAULT 'pending'
                      CHECK (verification_status IN ('pending','verified','rejected')),
  rejection_reason    TEXT,
  uploaded_at         TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_docs_driver ON drivers.documents(driver_id, doc_type);

-- ═══════════════════════════════════════════════════════════════
-- SCHEMA: rides
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS rides.rides (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id        UUID NOT NULL,
  vehicle_id       UUID,

  origin_address   TEXT NOT NULL,
  origin_city      VARCHAR(100) DEFAULT '',
  origin_lat       DOUBLE PRECISION DEFAULT 0,
  origin_lng       DOUBLE PRECISION DEFAULT 0,

  destination_address TEXT,
  dest_address     TEXT,
  dest_city        VARCHAR(100) DEFAULT '',
  destination_city VARCHAR(100) DEFAULT '',
  dest_lat         DOUBLE PRECISION DEFAULT 0,
  dest_lng         DOUBLE PRECISION DEFAULT 0,

  route_polyline   TEXT,
  distance_km      NUMERIC(8,2),
  duration_minutes INTEGER,

  departure_at     TIMESTAMPTZ NOT NULL,
  seats_total      SMALLINT NOT NULL,
  seats_available  SMALLINT NOT NULL,

  price_per_seat   INTEGER NOT NULL,       -- paise (₹100 = 10000)
  currency         VARCHAR(3) DEFAULT 'INR',

  luggage_allowed  BOOLEAN DEFAULT true,
  pets_allowed     BOOLEAN DEFAULT false,
  women_only       BOOLEAN DEFAULT false,
  instant_booking  BOOLEAN DEFAULT true,

  status           VARCHAR(20) DEFAULT 'active'
                   CHECK (status IN ('draft','active','in_progress','completed','cancelled')),
  notes            TEXT,
  created_at       TIMESTAMPTZ DEFAULT now(),
  updated_at       TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_rides_status ON rides.rides(status, departure_at);
CREATE INDEX IF NOT EXISTS idx_rides_driver ON rides.rides(driver_id);

-- ═══════════════════════════════════════════════════════════════
-- SCHEMA: bookings
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS bookings.bookings (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id            UUID NOT NULL,
  customer_id        UUID NOT NULL,
  seats_booked       SMALLINT NOT NULL DEFAULT 1,
  price_per_seat     INTEGER,
  total_amount_paise INTEGER NOT NULL DEFAULT 0,
  total_amount       INTEGER,
  currency           VARCHAR(3) DEFAULT 'INR',
  payment_id         UUID,
  razorpay_order_id  TEXT,
  status             VARCHAR(20) DEFAULT 'pending'
                     CHECK (status IN ('pending','confirmed','cancelled','completed','refunded')),
  cancelled_by       VARCHAR(10),
  cancelled_at       TIMESTAMPTZ,
  refund_amount      INTEGER,
  created_at         TIMESTAMPTZ DEFAULT now(),
  confirmed_at       TIMESTAMPTZ,
  updated_at         TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_bookings_ride ON bookings.bookings(ride_id);
CREATE INDEX IF NOT EXISTS idx_bookings_customer ON bookings.bookings(customer_id, status);

CREATE TABLE IF NOT EXISTS bookings.cancellation_policy (
  id                          SERIAL PRIMARY KEY,
  hours_before_departure_min  INTEGER NOT NULL,
  hours_before_departure_max  INTEGER,
  fee_percent                 NUMERIC(5,2) NOT NULL
);
-- Seed cancellation policy (idempotent)
INSERT INTO bookings.cancellation_policy (id, hours_before_departure_min, hours_before_departure_max, fee_percent)
VALUES (1, 0, 2, 50.00), (2, 2, 24, 25.00), (3, 24, NULL, 0.00)
ON CONFLICT (id) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════
-- SCHEMA: payments
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS payments.transactions (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id           UUID NOT NULL,
  customer_id          UUID NOT NULL,
  driver_id            UUID NOT NULL,
  ride_id              UUID NOT NULL,
  razorpay_order_id    TEXT UNIQUE NOT NULL,
  razorpay_payment_id  TEXT UNIQUE,
  amount               INTEGER NOT NULL,
  platform_fee         INTEGER,
  driver_payout_amount INTEGER,
  currency             VARCHAR(3) DEFAULT 'INR',
  status               VARCHAR(25) DEFAULT 'created'
                       CHECK (status IN ('created','captured','failed','refunded','partially_refunded')),
  refund_id            TEXT,
  refunded_amount      INTEGER,
  payout_id            TEXT,
  payout_status        VARCHAR(20),
  payout_at            TIMESTAMPTZ,
  created_at           TIMESTAMPTZ DEFAULT now(),
  captured_at          TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_tx_booking ON payments.transactions(booking_id);
CREATE INDEX IF NOT EXISTS idx_tx_driver ON payments.transactions(driver_id, payout_status);

CREATE TABLE IF NOT EXISTS payments.driver_bank_accounts (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id                 UUID UNIQUE NOT NULL,
  account_holder            TEXT NOT NULL,
  account_number_encrypted  TEXT NOT NULL,
  ifsc_code                 TEXT NOT NULL,
  bank_name                 TEXT,
  razorpay_fund_account_id  TEXT,
  is_verified               BOOLEAN DEFAULT false,
  created_at                TIMESTAMPTZ DEFAULT now()
);

-- ═══════════════════════════════════════════════════════════════
-- SCHEMA: locations
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS locations.driver_positions (
  driver_id   UUID PRIMARY KEY,
  ride_id     UUID,
  lat         DOUBLE PRECISION NOT NULL DEFAULT 0,
  lng         DOUBLE PRECISION NOT NULL DEFAULT 0,
  heading     SMALLINT DEFAULT 0,
  speed       SMALLINT DEFAULT 0,
  speed_kmh   SMALLINT DEFAULT 0,
  recorded_at TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS locations.location_trail (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id   UUID NOT NULL,
  ride_id     UUID NOT NULL,
  lat         DOUBLE PRECISION NOT NULL,
  lng         DOUBLE PRECISION NOT NULL,
  heading     SMALLINT,
  speed_kmh   SMALLINT,
  recorded_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_trail_ride ON locations.location_trail(ride_id, recorded_at DESC);

-- ═══════════════════════════════════════════════════════════════
-- SCHEMA: ratings
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS ratings.reviews (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prompt_id     UUID,
  ride_id       UUID,
  booking_id    UUID,
  reviewer_id   UUID NOT NULL,
  reviewee_id   UUID,
  reviewer_role VARCHAR(10),
  rating        SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment       TEXT,
  created_at    TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_reviews_reviewee ON ratings.reviews(reviewee_id);

CREATE TABLE IF NOT EXISTS ratings.review_prompts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id       UUID,
  booking_id    UUID,
  reviewer_id   UUID NOT NULL,
  reviewee_id   UUID,
  reviewer_role VARCHAR(10),
  submitted     BOOLEAN DEFAULT false,
  is_submitted  BOOLEAN DEFAULT false,
  expires_at    TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '7 days')
);
CREATE INDEX IF NOT EXISTS idx_prompts_reviewer ON ratings.review_prompts(reviewer_id, is_submitted);

-- ═══════════════════════════════════════════════════════════════
-- SCHEMA: notifications
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS notifications.fcm_tokens (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL,
  device_id  TEXT NOT NULL,
  fcm_token  TEXT NOT NULL,
  app_type   VARCHAR(10) NOT NULL,
  is_active  BOOLEAN DEFAULT true,
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, device_id)
);
CREATE INDEX IF NOT EXISTS idx_fcm_user ON notifications.fcm_tokens(user_id, is_active);

CREATE TABLE IF NOT EXISTS notifications.inbox (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL,
  title      TEXT NOT NULL,
  body       TEXT NOT NULL,
  type       VARCHAR(30) NOT NULL DEFAULT 'general',
  data       JSONB,
  is_read    BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_inbox_user ON notifications.inbox(user_id, is_read, created_at DESC);

-- ═══════════════════════════════════════════════════════════════
-- EVENT TRIGGERS (pg_notify for inter-service events)
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION rides.notify_ride_created()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM pg_notify('ride_events', json_build_object(
    'event', 'ride.created',
    'rideId', NEW.id,
    'driverId', NEW.driver_id,
    'originCity', NEW.origin_city,
    'destCity', NEW.dest_city,
    'departureAt', NEW.departure_at
  )::text);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS on_ride_created ON rides.rides;
CREATE TRIGGER on_ride_created
AFTER INSERT ON rides.rides
FOR EACH ROW EXECUTE FUNCTION rides.notify_ride_created();

-- ═══════════════════════════════════════════════════════════════
-- ✅ MIGRATION COMPLETE
-- ═══════════════════════════════════════════════════════════════
-- Schemas created:  auth, users, drivers, rides, bookings,
--                   payments, locations, ratings, notifications
-- Tables created:   15
-- Indexes created:  13
-- Triggers:         1 (ride.created → pg_notify)
-- Seed data:        cancellation_policy (3 rows)
-- ═══════════════════════════════════════════════════════════════
