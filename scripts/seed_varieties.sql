-- Sow Now variety seed data — curated UK varieties
-- Sources: DT Brown, Thompson & Morgan, RHS, Kings Seeds
-- Apply with: npm run db:seed (appends to existing seed)

INSERT OR IGNORE INTO varieties (
  id, crop_key, name, supplier,
  gdd_to_germinate_min, gdd_to_germinate_max,
  gdd_to_harvest_min, gdd_to_harvest_max,
  base_temp_c, days_to_harvest_min, days_to_harvest_max,
  start_indoors_weeks, sow_method, determinate, description, verified
) VALUES

-- ── Tomatoes ──────────────────────────────────────────────────────────────────
('tomato-gardeners-delight',   'tomato', 'Gardener''s Delight',  'Thompson & Morgan',
  100, 140,  950, 1100, 10.0, 65, 75,  8, 'indoor', 0,
  'Classic cherry tomato. Reliable cropper in UK conditions, sweet flavour. Indeterminate — stake and pinch out.', 1),

('tomato-sungold',             'tomato', 'Sungold F1',           'Thompson & Morgan',
  100, 140,  900, 1050, 10.0, 60, 70,  8, 'indoor', 0,
  'Orange cherry tomato. Very sweet, thin skin. Reliable even in poor summers. Indeterminate.', 1),

('tomato-moneymaker',          'tomato', 'Moneymaker',           'DT Brown',
  100, 140, 1000, 1200, 10.0, 70, 80,  8, 'indoor', 0,
  'Traditional British favourite. Medium fruit, consistent yield. Indeterminate.', 1),

('tomato-alicante',            'tomato', 'Alicante',             'DT Brown',
  100, 140,  980, 1150, 10.0, 68, 78,  8, 'indoor', 0,
  'Medium-sized, smooth-skinned. Good disease resistance. Indeterminate.', 1),

('tomato-ailsa-craig',         'tomato', 'Ailsa Craig',          'Kings Seeds',
  100, 140, 1000, 1200, 10.0, 70, 80,  8, 'indoor', 0,
  'Show-winning variety. Large, smooth fruit. Popular on allotments. Indeterminate.', 1),

('tomato-tigerella',           'tomato', 'Tigerella',            'Thompson & Morgan',
  100, 140,  950, 1100, 10.0, 65, 75,  8, 'indoor', 0,
  'Distinctive red and orange stripes. Tangy flavour. Indeterminate.', 1),

('tomato-golden-sunrise',      'tomato', 'Golden Sunrise',       'DT Brown',
  100, 140, 1000, 1200, 10.0, 70, 80,  8, 'indoor', 0,
  'Yellow-fruited. Mild sweet flavour. Good for northern UK. Indeterminate.', 1),

('tomato-shirley-f1',          'tomato', 'Shirley F1',           'Kings Seeds',
  100, 130,  950, 1100, 10.0, 65, 75,  8, 'indoor', 1,
  'Determinate. Heavy cropper. Good resistance to common diseases. Popular for greenhouse growing.', 1),

('tomato-super-marmande',      'tomato', 'Super Marmande',       'DT Brown',
  100, 140, 1050, 1300, 10.0, 75, 90,  8, 'indoor', 1,
  'Beefsteak type. Large, ribbed fruit. Needs warm summer — greenhouse recommended in northern UK.', 1),

('tomato-sweet-million-f1',    'tomato', 'Sweet Million F1',     'Thompson & Morgan',
  100, 140,  880, 1000, 10.0, 60, 70,  8, 'indoor', 0,
  'Prolific cherry tomato. Very sweet. One of the earliest to harvest. Indeterminate.', 1),

-- ── Potatoes ─────────────────────────────────────────────────────────────────
('potato-charlotte',           'potato', 'Charlotte',            'DT Brown',
  NULL, NULL, 900, 1100, 7.0, 100, 120,
  NULL, 'direct', NULL,
  'Waxy salad potato. Second early. Excellent flavour, holds together when cooked. Very popular UK variety.', 1),

('potato-maris-piper',         'potato', 'Maris Piper',          'DT Brown',
  NULL, NULL, 1100, 1400, 7.0, 120, 140,
  NULL, 'direct', NULL,
  'UK''s most popular variety. Floury. Best for chips, roasties. Maincrop — needs full season.', 1),

('potato-king-edward',         'potato', 'King Edward',          'Thompson & Morgan',
  NULL, NULL, 1100, 1350, 7.0, 120, 140,
  NULL, 'direct', NULL,
  'Classic white floury maincrop. Great for roasting and mash. Needs good soil.', 1),

('potato-jersey-royal',        'potato', 'Jersey Royal',         'Kings Seeds',
  NULL, NULL,  800,  950, 7.0,  80, 100,
  NULL, 'direct', NULL,
  'Famous first early. Distinctive earthy flavour. Best eaten fresh. Not for storing.', 1),

('potato-desiree',             'potato', 'Desiree',              'DT Brown',
  NULL, NULL, 1050, 1300, 7.0, 110, 130,
  NULL, 'direct', NULL,
  'Red-skinned waxy maincrop. Versatile — good for boiling, baking, chips. Drought tolerant.', 1),

('potato-swift',               'potato', 'Swift',                'Thompson & Morgan',
  NULL, NULL,  750,  900, 7.0,  75,  90,
  NULL, 'direct', NULL,
  'First early. Very fast-maturing. Ideal for containers. Good in northern UK and short seasons.', 1),

('potato-nicola',              'potato', 'Nicola',               'Kings Seeds',
  NULL, NULL,  950, 1150, 7.0, 100, 120,
  NULL, 'direct', NULL,
  'Yellow-fleshed waxy salad type. Second early. Holds shape well — great for salads.', 1),

('potato-pink-fir-apple',      'potato', 'Pink Fir Apple',       'DT Brown',
  NULL, NULL, 1150, 1400, 7.0, 125, 145,
  NULL, 'direct', NULL,
  'Heritage knobbly waxy potato. Superb flavour. Maincrop. Worth the wait.', 1),

-- ── Peppers ──────────────────────────────────────────────────────────────────
('pepper-sweet-california',    'pepper', 'California Wonder',    'DT Brown',
  150, 200, 1200, 1450, 10.0, 110, 130, 10, 'indoor', NULL,
  'Classic bell pepper. Large, blocky fruit. Greenhouse essential in UK.', 1),

('pepper-sweet-red-bull',      'pepper', 'Red Bull',             'Thompson & Morgan',
  150, 200, 1150, 1350, 10.0, 100, 120, 10, 'indoor', NULL,
  'Pointed sweet pepper. Turns red when ripe. Good yield in greenhouse.', 1),

('pepper-padron',              'pepper', 'Padrón',               'Thompson & Morgan',
  150, 200, 1100, 1300, 10.0,  95, 115, 10, 'indoor', NULL,
  'Spanish tapas pepper. Pick small and green for mild flavour, larger for heat. Prolific.', 1),

('pepper-sweet-banana',        'pepper', 'Sweet Banana',         'Kings Seeds',
  150, 200, 1050, 1250, 10.0,  90, 110, 10, 'indoor', NULL,
  'Long yellow sweet pepper. Milder than most. Good for cool UK summers in greenhouse.', 1),

('pepper-cayenne-long-slim',   'pepper', 'Cayenne Long Slim',    'DT Brown',
  150, 200, 1150, 1350, 10.0, 100, 120, 10, 'indoor', NULL,
  'Hot cayenne. Long thin red fruits. Prolific. Greenhouse recommended for UK.', 1),

('pepper-hungarian-hot-wax',   'pepper', 'Hungarian Hot Wax',    'Thompson & Morgan',
  150, 200, 1100, 1300, 10.0,  95, 115, 10, 'indoor', NULL,
  'Yellow to red wax pepper. Medium heat. More tolerant of cool conditions than most peppers.', 1),

('pepper-sweet-marconi',       'pepper', 'Sweet Marconi',        'Kings Seeds',
  150, 200, 1150, 1400, 10.0, 100, 125, 10, 'indoor', NULL,
  'Italian frying pepper. Large, elongated, very sweet. Excellent roasted.', 1);
