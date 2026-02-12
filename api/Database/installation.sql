
/* 1. Identity & Billing */
CREATE TABLE IF NOT EXISTS "user"
(
    user_id                UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    sso_provider           TEXT        NOT NULL,
    sso_user_id            TEXT        NOT NULL,
    email                  TEXT        UNIQUE,
    display_name           TEXT,
    avatar_url             TEXT,
    stripe_user_id         TEXT        UNIQUE,
    subscription_tier      TEXT        NOT NULL DEFAULT 'free'
        CHECK (subscription_tier IN ('free', 'hobby', 'pro')),
    boost_multiplier       INTEGER     NOT NULL DEFAULT 1,
    payment_failed_at      TIMESTAMPTZ,
    current_period_end     TIMESTAMPTZ,
    stripe_subscription_id TEXT,
    last_stripe_error      TEXT,
    custom_retention_days  INTEGER,
    last_login_at          TIMESTAMPTZ          DEFAULT now(),
    created_at             TIMESTAMPTZ          DEFAULT now(),
    updated_at             TIMESTAMPTZ          DEFAULT now(),
    UNIQUE (sso_provider, sso_user_id)
);

CREATE INDEX IF NOT EXISTS idx_user_sso ON "user" (sso_provider, sso_user_id);

/* 2. Project */
CREATE TABLE IF NOT EXISTS project
(
    project_id   UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id      UUID        NOT NULL REFERENCES "user" (user_id),
    name         TEXT        NOT NULL,
    slug         TEXT        NOT NULL UNIQUE,
    api_key_hash TEXT        NOT NULL,
    created_at   TIMESTAMPTZ          DEFAULT now(),
    updated_at   TIMESTAMPTZ          DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_project_slug ON project (slug);

/* 3. State Versioning (Config) */
CREATE TABLE IF NOT EXISTS project_state
(
    project_state_id UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    project_id       UUID        NOT NULL REFERENCES project (project_id) ON DELETE CASCADE,
    environment      TEXT        NOT NULL CHECK (environment IN ('development', 'staging', 'production')),
    major            INTEGER     NOT NULL,
    minor            INTEGER     NOT NULL,
    patch            INTEGER     NOT NULL,
    state            JSONB       NOT NULL DEFAULT '{}',
    comment          TEXT,
    created_at       TIMESTAMPTZ          DEFAULT now(),
    state_size_bytes INTEGER     NOT NULL DEFAULT 0,
    UNIQUE (project_id, environment, major, minor, patch)
);

CREATE INDEX IF NOT EXISTS idx_project_state_project_env ON project_state (project_id, environment);

/* 5. Billing & Invoicing */
CREATE TABLE IF NOT EXISTS invoice
(
    invoice_id           UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id              UUID        NOT NULL REFERENCES "user" (user_id),
    tier                 TEXT        NOT NULL,
    boost_multiplier     INTEGER     NOT NULL DEFAULT 1,
    amount_paid_cents    INTEGER     NOT NULL,
    status               TEXT        NOT NULL DEFAULT 'paid'
        CHECK (status IN ('pending', 'paid', 'void', 'failed')),
    billing_period_start TIMESTAMPTZ NOT NULL,
    billing_period_end   TIMESTAMPTZ NOT NULL,
    created_at           TIMESTAMPTZ          DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_invoice_user_date ON invoice (user_id, created_at DESC);

/* 6. Webhook Event Tracking */
CREATE TABLE IF NOT EXISTS webhook_event
(
    webhook_event_id UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    stripe_event_id  TEXT        NOT NULL UNIQUE,
    event_type       TEXT        NOT NULL,
    received_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    processed_at     TIMESTAMPTZ,
    error            TEXT
);

CREATE INDEX IF NOT EXISTS idx_webhook_event_type ON webhook_event (event_type, received_at DESC);

/* 7. API Request Counter */
CREATE TABLE IF NOT EXISTS api_request_counter
(
    user_id       UUID    NOT NULL REFERENCES "user" (user_id) ON DELETE CASCADE,
    counter_year  INTEGER NOT NULL,
    counter_month INTEGER NOT NULL,
    request_count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, counter_year, counter_month)
);
