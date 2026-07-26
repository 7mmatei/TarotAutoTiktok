UPDATE gift_products
SET enabled = false
WHERE id IN (
  '0a77b9a9-8df7-5c1a-9cbd-f3c365a77901',
  '0a77b9a9-8df7-5c1a-9cbd-f3c365a77902',
  '0a77b9a9-8df7-5c1a-9cbd-f3c365a77903',
  '0a77b9a9-8df7-5c1a-9cbd-f3c365a77904',
  '0a77b9a9-8df7-5c1a-9cbd-f3c365a77905'
);

INSERT INTO gift_products
  (id, account_key, gift_id, gift_name, product_code, cards, priority, question_required, max_words, max_audio_seconds, enabled)
VALUES
  ('0a77b9a9-8df7-5c1a-9cbd-f3c365a78011', 'demo-account', 'perfume', 'Perfume', 'quick', 1, 100, true, 80, 30, true),
  ('0a77b9a9-8df7-5c1a-9cbd-f3c365a78012', 'demo-account', 'hand-heart', 'Hand Heart', 'standard', 3, 200, true, 180, 75, true),
  ('0a77b9a9-8df7-5c1a-9cbd-f3c365a78013', 'demo-account', 'fairy-hide', 'Fairy Hide', 'premium', 5, 300, true, 300, 120, true),
  ('0a77b9a9-8df7-5c1a-9cbd-f3c365a78014', 'demo-account', 'face-pulling', 'Face-pulling', 'elite', 7, 400, true, 420, 165, true)
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
