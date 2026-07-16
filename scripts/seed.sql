-- Vernal D1 seed data — crop knowledge base
-- Apply with: npm run db:seed:local
-- This seeds reference data only — no user data

INSERT OR IGNORE INTO crops_reference (
  crop_key, display_name, base_temp_c,
  soil_temp_min_c, gdd_to_germinate_min, gdd_to_germinate_max,
  gdd_to_harvest_min, gdd_to_harvest_max,
  moisture_min_pct, moisture_max_pct, notes
) VALUES
  ('tomato',        'Tomato',        10.0, 18.0, 100, 150, 1000, 1400, 60, 80, 'Start indoors 6-8 weeks before last frost. Harden off before transplanting.'),
  ('french_bean',   'French Bean',   10.0, 15.0,  60, 100,  800, 1000, 50, 70, 'Direct sow after last frost. Do not sow in cold wet soil.'),
  ('sweetcorn',     'Sweetcorn',     10.0, 15.0,  50, 100, 1400, 1600, 50, 70, 'Sow in blocks not rows for wind pollination. Needs warm summer.'),
  ('courgette',     'Courgette',     10.0, 18.0,  50,  80,  700,  900, 60, 80, 'Sow indoors 3-4 weeks before last frost or direct sow once warm.'),
  ('pea',           'Pea',            4.0,  7.0, 100, 150, 1000, 1200, 50, 70, 'Hardy — can sow early spring. Dislikes waterlogged soil.'),
  ('carrot',        'Carrot',         7.0, 10.0, 120, 200, 1200, 1500, 40, 60, 'Direct sow only — does not transplant. Thin to 5cm.'),
  ('lettuce',       'Lettuce',        4.0,  5.0,  50,  80,  600,  800, 50, 70, 'Succession sow every 2-3 weeks. Bolts in heat — sow in shade in summer.'),
  ('strawberry',    'Strawberry',     5.0,   NULL, NULL, NULL, 200,  300, 50, 70, '200-300 GDD from first flower to ripe fruit. GDD tracking from flowering.'),
  ('potato',        'Potato',         7.0, 10.0, 150, 200, 1000, 1500, 60, 80, 'Chit before planting. Earth up as foliage grows. Avoid frost.'),
  ('onion',         'Onion',          7.0,  7.0, 100, 150, 1000, 1200, 40, 60, 'Can start from sets or seed. Seed needs early indoor start.'),
  ('cucumber',      'Cucumber',      10.0, 20.0,  80, 120,  800, 1000, 60, 80, 'Needs warmth — greenhouse recommended in UK. Regular watering essential.'),
  ('pepper',        'Pepper',        10.0, 20.0, 150, 200, 1200, 1500, 60, 75, 'Slow grower — start early indoors (Jan-Feb). Greenhouse in UK.'),
  ('brassica',      'Cabbage / Kale', 5.0,  5.0,  80, 120,  800, 1200, 50, 70, 'Brassica family — rotate beds. Net against cabbage white butterfly.'),
  ('beetroot',      'Beetroot',       7.0, 10.0, 100, 150,  900, 1100, 50, 70, 'Sow direct. Can succession sow. Bolt-resistant varieties for early sowing.'),
  ('spinach',       'Spinach',        5.0,  5.0,  50,  80,  600,  800, 60, 75, 'Cool season crop. Bolts in heat. Best spring and autumn.'),
  ('parsnip',       'Parsnip',        7.0,  7.0, 150, 250, 1400, 1800, 40, 60, 'Slow to germinate — mark row with quick radish to avoid hoeing seedlings.'),
  ('leek',          'Leek',           5.0,  5.0, 100, 150, 1200, 1600, 50, 70, 'Start indoors Jan-Feb. Transplant at pencil thickness.'),
  ('pumpkin',       'Pumpkin',       10.0, 18.0,  80, 120, 1100, 1400, 60, 80, 'Needs space and warmth. Start indoors and protect from frost.');
