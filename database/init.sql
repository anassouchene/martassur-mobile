-- SmartAssur Mobile V3 - PostgreSQL Database Schema & Seeds

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. Sessions table
CREATE TABLE IF NOT EXISTS insurance_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_token VARCHAR(64) NOT NULL UNIQUE,
    nonce_hash VARCHAR(128) NOT NULL,
    device_type VARCHAR(32) DEFAULT 'desktop',
    status VARCHAR(32) NOT NULL DEFAULT 'PENDING', -- PENDING, PAIRED, IN_PROGRESS, COMPLETED, EXPIRED
    paired_device_info JSONB DEFAULT '{}'::jsonb,
    ip_address VARCHAR(45),
    user_agent TEXT,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. TAC Local Database Catalog
CREATE TABLE IF NOT EXISTS tac_catalog (
    tac VARCHAR(8) PRIMARY KEY,
    brand VARCHAR(100) NOT NULL,
    model VARCHAR(150) NOT NULL,
    market_name VARCHAR(150),
    ram_options VARCHAR(100) DEFAULT '6 Go, 8 Go, 12 Go',
    storage_options VARCHAR(100) DEFAULT '128 Go, 256 Go, 512 Go',
    battery_nominal_mah INT DEFAULT 4500,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Mobile devices registered
CREATE TABLE IF NOT EXISTS mobile_devices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    imei_encrypted TEXT NOT NULL,
    imei_hmac_index VARCHAR(64) NOT NULL, -- For duplicate checks without exposing plain IMEI
    tac VARCHAR(8) NOT NULL,
    brand VARCHAR(100) NOT NULL,
    model VARCHAR(150) NOT NULL,
    ram_gb VARCHAR(50),
    storage_gb VARCHAR(50),
    battery_nominal_mah INT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. Device field provenance and proof
CREATE TABLE IF NOT EXISTS device_fields_sources (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    device_id UUID NOT NULL REFERENCES mobile_devices(id) ON DELETE CASCADE,
    field_name VARCHAR(50) NOT NULL,
    source_type VARCHAR(50) NOT NULL, -- TAC_LOOKUP, CATALOGUE, CLIENT_INPUT, USB_ADB, OPERATOR_API
    source_ref VARCHAR(255),
    confidence_level VARCHAR(20) NOT NULL DEFAULT 'HIGH', -- HIGH, MEDIUM, LOW
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. Insurance applications (Dossiers)
CREATE TABLE IF NOT EXISTS insurance_applications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    application_ref VARCHAR(32) NOT NULL UNIQUE,
    session_id UUID REFERENCES insurance_sessions(id) ON DELETE SET NULL,
    device_id UUID NOT NULL REFERENCES mobile_devices(id) ON DELETE CASCADE,
    client_name VARCHAR(150) NOT NULL,
    client_email VARCHAR(150) NOT NULL,
    client_phone VARCHAR(50) NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'PENDING_REVIEW', -- PENDING_REVIEW, IN_REVIEW, APPROVED, REJECTED, MORE_DOCS_NEEDED
    risk_level VARCHAR(30) NOT NULL DEFAULT 'MEDIUM', -- LOW, MEDIUM, HIGH, INCOHERENT
    verification_mode VARCHAR(30) NOT NULL DEFAULT 'WEB_QR', -- WEB_QR, WEB_DIRECT, USB_ADB, OPERATOR
    consent_cndp BOOLEAN NOT NULL DEFAULT TRUE,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 6. Evidence uploads (Photos)
CREATE TABLE IF NOT EXISTS device_evidence (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    application_id UUID REFERENCES insurance_applications(id) ON DELETE CASCADE,
    session_id UUID REFERENCES insurance_sessions(id) ON DELETE SET NULL,
    evidence_type VARCHAR(50) NOT NULL, -- PHOTO_FRONT, PHOTO_BACK, SCREENSHOT, DOCUMENT_IMEI
    file_path VARCHAR(500) NOT NULL,
    sha256_hash VARCHAR(64) NOT NULL,
    mime_type VARCHAR(50) NOT NULL,
    file_size BIGINT NOT NULL,
    quality_score INT DEFAULT 90, -- 0-100
    quality_flags JSONB DEFAULT '{"blur": false, "lighting": "ok", "framing": "ok"}'::jsonb,
    source VARCHAR(50) DEFAULT 'WEB_CAMERA', -- WEB_CAMERA, FILE_UPLOAD
    captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 7. Device anti-fraud checks & telemetry
CREATE TABLE IF NOT EXISTS device_checks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    application_id UUID REFERENCES insurance_applications(id) ON DELETE CASCADE,
    check_kind VARCHAR(60) NOT NULL, -- LUHN_ALGORITHM, TAC_CONSISTENCY, PHOTO_DUPLICATE_CHECK, ADB_PROPERTIES
    outcome VARCHAR(30) NOT NULL, -- PASSED, FAILED, WARNING, MANUAL_CHECK
    details JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 8. Risk events log
CREATE TABLE IF NOT EXISTS risk_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    application_id UUID REFERENCES insurance_applications(id) ON DELETE CASCADE,
    code VARCHAR(50) NOT NULL,
    severity VARCHAR(20) NOT NULL, -- INFO, WARNING, CRITICAL
    reason TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 9. Review audit log (Backoffice)
CREATE TABLE IF NOT EXISTS review_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    application_id UUID NOT NULL REFERENCES insurance_applications(id) ON DELETE CASCADE,
    reviewer_id VARCHAR(100) NOT NULL DEFAULT 'GESTIONNAIRE_1',
    action VARCHAR(50) NOT NULL, -- ASSIGNED, REQUESTED_DOCS, APPROVED, REJECTED
    decision_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Comptes de l'espace gestionnaire (mot de passe PBKDF2, voir database/create_admin.py)
CREATE TABLE IF NOT EXISTS admin_users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username VARCHAR(64) NOT NULL UNIQUE,
    display_name VARCHAR(120) NOT NULL DEFAULT '',
    password_hash TEXT NOT NULL,
    role VARCHAR(32) NOT NULL DEFAULT 'GESTIONNAIRE',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    last_login_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_tac_catalog_tac ON tac_catalog(tac);
CREATE INDEX IF NOT EXISTS idx_mobile_devices_hmac ON mobile_devices(imei_hmac_index);
CREATE INDEX IF NOT EXISTS idx_insurance_sessions_token ON insurance_sessions(session_token);
CREATE INDEX IF NOT EXISTS idx_insurance_apps_ref ON insurance_applications(application_ref);
CREATE INDEX IF NOT EXISTS idx_device_evidence_hash ON device_evidence(sha256_hash);

-- Seed comprehensive TAC database
INSERT INTO tac_catalog (tac, brand, model, market_name, ram_options, storage_options, battery_nominal_mah)
VALUES
('35874211', 'Apple', 'iPhone 15 Pro Max (A3106)', 'iPhone 15 Pro Max', '8 Go', '256 Go, 512 Go, 1 To', 4441),
('35873911', 'Apple', 'iPhone 15 Pro (A3102)', 'iPhone 15 Pro', '8 Go', '128 Go, 256 Go, 512 Go, 1 To', 3274),
('35873511', 'Apple', 'iPhone 15 (A3090)', 'iPhone 15', '6 Go', '128 Go, 256 Go, 512 Go', 3349),
('35873711', 'Apple', 'iPhone 15 Plus (A3094)', 'iPhone 15 Plus', '6 Go', '128 Go, 256 Go, 512 Go', 4383),
('35362111', 'Apple', 'iPhone 14 Pro (A2890)', 'iPhone 14 Pro', '6 Go', '128 Go, 256 Go, 512 Go, 1 To', 3200),
('35362411', 'Apple', 'iPhone 14 (A2882)', 'iPhone 14', '6 Go', '128 Go, 256 Go, 512 Go', 3279),
('35612310', 'Apple', 'iPhone 13 (A2633)', 'iPhone 13', '4 Go', '128 Go, 256 Go, 512 Go', 3227),
('35391210', 'Apple', 'iPhone 12 (A2403)', 'iPhone 12', '4 Go', '64 Go, 128 Go, 256 Go', 2815),
('35203310', 'Apple', 'iPhone 11 (A2221)', 'iPhone 11', '4 Go', '64 Go, 128 Go, 256 Go', 3110),
('35284144', 'Samsung', 'Galaxy S24 Ultra (SM-S928B)', 'Galaxy S24 Ultra', '12 Go', '256 Go, 512 Go, 1 To', 5000),
('35283844', 'Samsung', 'Galaxy S24+ (SM-S926B)', 'Galaxy S24+', '12 Go', '256 Go, 512 Go', 4900),
('35283544', 'Samsung', 'Galaxy S24 (SM-S921B)', 'Galaxy S24', '8 Go', '128 Go, 256 Go', 4000),
('35198236', 'Samsung', 'Galaxy S23 Ultra (SM-S918B)', 'Galaxy S23 Ultra', '8 Go, 12 Go', '256 Go, 512 Go, 1 To', 5000),
('35864111', 'Samsung', 'Galaxy A55 5G (SM-A556B)', 'Galaxy A55 5G', '8 Go, 12 Go', '128 Go, 256 Go', 5000),
('35863211', 'Samsung', 'Galaxy A54 5G (SM-A546B)', 'Galaxy A54 5G', '6 Go, 8 Go', '128 Go, 256 Go', 5000),
('35762111', 'Samsung', 'Galaxy A15 (SM-A155F)', 'Galaxy A15', '4 Go, 6 Go, 8 Go', '128 Go, 256 Go', 5000),
('86421305', 'Xiaomi', 'Redmi Note 13 Pro 5G', 'Redmi Note 13 Pro', '8 Go, 12 Go', '256 Go, 512 Go', 5100),
('86421105', 'Xiaomi', 'Redmi Note 13', 'Redmi Note 13 4G', '6 Go, 8 Go', '128 Go, 256 Go', 5000),
('86392105', 'Xiaomi', 'Xiaomi 14 (23127PN0CG)', 'Xiaomi 14', '12 Go', '256 Go, 512 Go', 4610),
('35489111', 'Google', 'Pixel 8 Pro (GC3VE)', 'Pixel 8 Pro', '12 Go', '128 Go, 256 Go, 512 Go', 5050),
('35488811', 'Google', 'Pixel 8 (G9BQD)', 'Pixel 8', '8 Go', '128 Go, 256 Go', 4575)
ON CONFLICT (tac) DO UPDATE SET
    model = EXCLUDED.model,
    market_name = EXCLUDED.market_name,
    ram_options = EXCLUDED.ram_options,
    storage_options = EXCLUDED.storage_options,
    battery_nominal_mah = EXCLUDED.battery_nominal_mah;

