ALTER TABLE gift_products ADD COLUMN IF NOT EXISTS gift_name text NOT NULL DEFAULT '';
ALTER TABLE gift_events ADD COLUMN IF NOT EXISTS gift_name text NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS like_totals (
  id uuid PRIMARY KEY,
  session_id uuid NOT NULL,
  user_id uuid NOT NULL,
  platform_user_id text NOT NULL,
  quantity integer NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT like_totals_session_platform_user_unique UNIQUE(session_id, platform_user_id)
);

CREATE TABLE IF NOT EXISTS free_reading_grants (
  id uuid PRIMARY KEY,
  session_id uuid NOT NULL,
  user_id uuid NOT NULL,
  platform_user_id text NOT NULL,
  request_id uuid NOT NULL,
  like_count integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT free_reading_grants_session_platform_user_unique UNIQUE(session_id, platform_user_id)
);

INSERT INTO gift_products
  (id, account_key, gift_id, gift_name, product_code, cards, priority, question_required, max_words, max_audio_seconds, enabled)
VALUES
  ('0a77b9a9-8df7-5c1a-9cbd-f3c365a77901', 'demo-account', 'rose', 'Rosa', 'quick', 1, 100, true, 80, 30, true),
  ('0a77b9a9-8df7-5c1a-9cbd-f3c365a77902', 'demo-account', '5655', 'Rose', 'quick', 1, 100, true, 80, 30, true),
  ('0a77b9a9-8df7-5c1a-9cbd-f3c365a77903', 'demo-account', '7934', 'Heart Me', 'quick', 1, 100, true, 80, 30, true),
  ('0a77b9a9-8df7-5c1a-9cbd-f3c365a77904', 'demo-account', 'galaxy', 'Galaxy', 'standard', 3, 200, true, 180, 75, true),
  ('0a77b9a9-8df7-5c1a-9cbd-f3c365a77905', 'demo-account', 'universe', 'Universe', 'premium', 5, 300, true, 300, 120, true)
ON CONFLICT (id) DO UPDATE SET
  gift_id = EXCLUDED.gift_id,
  gift_name = EXCLUDED.gift_name,
  product_code = EXCLUDED.product_code,
  cards = EXCLUDED.cards,
  priority = EXCLUDED.priority,
  question_required = EXCLUDED.question_required,
  max_words = EXCLUDED.max_words,
  max_audio_seconds = EXCLUDED.max_audio_seconds,
  enabled = EXCLUDED.enabled;
