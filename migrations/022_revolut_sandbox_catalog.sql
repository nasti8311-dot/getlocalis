-- Sandbox-only catalogue fixtures for Revolut Payment Element verification.
-- Source: the checked-in demo catalogue in index.html and meeting-points.js.
-- These records are intentionally isolated to getlocalis-preview; never apply
-- this migration to production. No real provider Connect account is attached.

INSERT INTO providers (provider_ref, name, connect_account_id, active)
VALUES
  ('sandbox-therme-vip', 'FiiViu Travel Experiences', NULL, 1),
  ('sandbox-night-out', 'Bucharest After Dark', NULL, 1),
  ('sandbox-kart-grand-prix', 'Bucharest Karting Club', NULL, 1)
ON CONFLICT(provider_ref) DO UPDATE SET
  name = excluded.name,
  connect_account_id = NULL,
  active = 1;

INSERT INTO experiences (
  experience_id, provider_connect_account_id, provider_name, title, description,
  category, available_times, price_cents, currency,
  meeting_point_name, meeting_address, meeting_city, meeting_country,
  meeting_instructions, arrival_minutes_before, meeting_latitude, meeting_longitude,
  status
) VALUES
  (
    'therme-vip', NULL, 'FiiViu Travel Experiences',
    'Therme Bucharest – Relax Day',
    'A full day to switch off. Enjoy thermal pools, palm trees and a complete escape from the city.',
    'wellness-beauty', '["09:00","11:00","13:00"]', 5500, 'eur',
    'Therme Bucharest – Main Entrance', 'Calea București 1K', 'Balotești', 'Romania',
    'Please arrive 20 minutes before the scheduled start. Meet the FiiViu representative at the main entrance.',
    20, '44.6568', '26.0774', 'published'
  ),
  (
    'night-out', NULL, 'Bucharest After Dark',
    'Bucharest Night Out',
    'Start with drinks and discover some of the city''s most exciting nightlife spots.',
    'nightlife', '["20:00","21:00","22:00"]', 7500, 'eur',
    'Manuc’s Inn – Main Courtyard', 'Strada Franceză 62', 'București', 'Romania',
    'Please arrive 15 minutes before the start. Meet your guide in the main courtyard near the entrance.',
    15, '44.4305', '26.1014', 'published'
  ),
  (
    'kart-grand-prix', NULL, 'Bucharest Karting Club',
    'Bucharest Kart Grand Prix',
    'Track, speed and competition. Perfect for friends, birthdays and groups.',
    'action-adventure', '["12:00","15:00","18:00"]', 4500, 'eur',
    'Karting Arena – Reception', 'Șoseaua Pipera 4', 'București', 'Romania',
    'Please arrive 20 minutes before the start for registration and safety briefing. Bring your booking ID.',
    20, '44.4900', '26.1200', 'published'
  )
ON CONFLICT(experience_id) DO UPDATE SET
  provider_connect_account_id = NULL,
  provider_name = excluded.provider_name,
  title = excluded.title,
  description = excluded.description,
  category = excluded.category,
  available_times = excluded.available_times,
  price_cents = excluded.price_cents,
  currency = excluded.currency,
  meeting_point_name = excluded.meeting_point_name,
  meeting_address = excluded.meeting_address,
  meeting_city = excluded.meeting_city,
  meeting_country = excluded.meeting_country,
  meeting_instructions = excluded.meeting_instructions,
  arrival_minutes_before = excluded.arrival_minutes_before,
  meeting_latitude = excluded.meeting_latitude,
  meeting_longitude = excluded.meeting_longitude,
  status = 'published',
  updated_at = CURRENT_TIMESTAMP;
