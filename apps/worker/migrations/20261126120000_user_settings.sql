-- EXF-472: per-user display options (theme, progress bars, balance style), keyed by the identity actor.
-- Additive. No row means the defaults (dark, progress bars on, default balance style).
CREATE TABLE user_settings (
  actor text PRIMARY KEY NOT NULL,
  theme text NOT NULL DEFAULT 'dark',
  progress_bars integer NOT NULL DEFAULT 1,
  balance_style text NOT NULL DEFAULT 'default',
  updated_at text NOT NULL
);
