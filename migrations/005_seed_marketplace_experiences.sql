-- Seed the five currently published marketplace experiences.
-- Prices are per guest and intentionally match the current public catalog.
-- The retired Private Limousine Night package is not seeded.

INSERT INTO experiences (
  experience_id,
  provider_connect_account_id,
  title,
  price_cents,
  currency,
  status
) VALUES
  ('old-town-walk', 'acct_1UGKf2Rs1xOECecP', 'Bucharest Old Town Story Walk', 2900, 'eur', 'published'),
  ('bike-bucharest', 'acct_1UGKf2Rs1xOECecP', 'Bucharest Bike Story', 3500, 'eur', 'published'),
  ('therme-vip', 'acct_1UGKf2Rs1xOECecP', 'Therme Bucharest – Relax Day', 5500, 'eur', 'published'),
  ('night-out', 'acct_1UGKf2Rs1xOECecP', 'Bucharest Night Out', 7500, 'eur', 'published'),
  ('kart-grand-prix', 'acct_1UGKf2Rs1xOECecP', 'Bucharest Kart Grand Prix', 4500, 'eur', 'published')
ON CONFLICT(experience_id) DO UPDATE SET
  provider_connect_account_id = excluded.provider_connect_account_id,
  title = excluded.title,
  price_cents = excluded.price_cents,
  currency = excluded.currency,
  status = excluded.status,
  updated_at = CURRENT_TIMESTAMP;
