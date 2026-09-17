-- Demo/test-only organizer and meeting details for the current marketplace catalog.
-- Replace these values later with real provider-supplied data.

ALTER TABLE experiences ADD COLUMN provider_name TEXT;

UPDATE experiences SET
  provider_name = 'FiiViu City Guides',
  meeting_point_name = 'Universitate – National Theatre',
  meeting_address = 'Piața Universității 2',
  meeting_city = 'București',
  meeting_country = 'Romania',
  meeting_instructions = 'Please arrive 15 minutes before the start. Look for the FiiViu guide with a FiiViu sign near the main entrance.',
  arrival_minutes_before = 15,
  meeting_latitude = '44.4354',
  meeting_longitude = '26.1027'
WHERE experience_id = 'old-town-walk';

UPDATE experiences SET
  provider_name = 'Urban Pedal Bucharest',
  meeting_point_name = 'Piața Unirii Fountain',
  meeting_address = 'Piața Unirii',
  meeting_city = 'București',
  meeting_country = 'Romania',
  meeting_instructions = 'Please arrive 15 minutes before the start. Your guide will wait beside the main fountain with the bicycles.',
  arrival_minutes_before = 15,
  meeting_latitude = '44.4279',
  meeting_longitude = '26.1025'
WHERE experience_id = 'bike-bucharest';

UPDATE experiences SET
  provider_name = 'FiiViu Travel Experiences',
  meeting_point_name = 'Therme Bucharest – Main Entrance',
  meeting_address = 'Calea București 1K',
  meeting_city = 'Balotești',
  meeting_country = 'Romania',
  meeting_instructions = 'Please arrive 20 minutes before the scheduled start. Meet the FiiViu representative at the main entrance.',
  arrival_minutes_before = 20,
  meeting_latitude = '44.6568',
  meeting_longitude = '26.0774'
WHERE experience_id = 'therme-vip';

UPDATE experiences SET
  provider_name = 'Bucharest After Dark',
  meeting_point_name = 'Manuc’s Inn – Main Courtyard',
  meeting_address = 'Strada Franceză 62',
  meeting_city = 'București',
  meeting_country = 'Romania',
  meeting_instructions = 'Please arrive 15 minutes before the start. Meet your guide in the main courtyard near the entrance.',
  arrival_minutes_before = 15,
  meeting_latitude = '44.4305',
  meeting_longitude = '26.1014'
WHERE experience_id = 'night-out';

UPDATE experiences SET
  provider_name = 'Bucharest Karting Club',
  meeting_point_name = 'Karting Arena – Reception',
  meeting_address = 'Șoseaua Pipera 4',
  meeting_city = 'București',
  meeting_country = 'Romania',
  meeting_instructions = 'Please arrive 20 minutes before the start for registration and safety briefing. Bring your booking ID.',
  arrival_minutes_before = 20,
  meeting_latitude = '44.4900',
  meeting_longitude = '26.1200'
WHERE experience_id = 'kart-grand-prix';

ALTER TABLE bookings ADD COLUMN provider_name TEXT;
