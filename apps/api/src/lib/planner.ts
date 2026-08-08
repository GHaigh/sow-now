/**
 * Predictive planting engine.
 *
 * Given:
 *  - A variety's GDD thresholds
 *  - The user's historical average daily GDD for outdoor + greenhouse zones
 *  - Today's date
 *
 * Produces:
 *  - Recommended sow date (indoors or direct)
 *  - Recommended move-to-greenhouse date (if indoor start)
 *  - Recommended plant-out date
 *  - Predicted first harvest date (min and max)
 *  - Whether this variety is viable in this climate
 */

export interface VarietyProfile {
  crop_key:            string;
  name:                string;
  base_temp_c:         number;
  gdd_to_harvest_min:  number;
  gdd_to_harvest_max:  number;
  gdd_to_germinate_min: number | null;
  gdd_to_germinate_max: number | null;
  start_indoors_weeks: number | null;
  sow_method:          'indoor' | 'direct' | 'either';
}

export interface GddProfile {
  /** Average daily GDD (base 10°C) accumulated outdoors over the season */
  outdoor_avg_daily_gdd:     number;
  /** Average daily GDD in the greenhouse — typically higher */
  greenhouse_avg_daily_gdd:  number;
  /** Estimated last frost date for this location */
  last_frost_date:           Date;
  /** Estimated first frost date (end of season) */
  first_autumn_frost_date:   Date;
  /** Total season GDD outdoors (historical average Apr–Sep) */
  season_gdd_outdoor:        number;
}

export interface PlantingPlan {
  variety_name:         string;
  crop_key:             string;
  sow_date:             Date | null;       // recommended sow date
  sow_location:         'indoor' | 'direct';
  move_to_greenhouse:   Date | null;       // null if direct sow
  plant_out_date:       Date | null;       // null if greenhouse crop
  harvest_date_min:     Date | null;
  harvest_date_max:     Date | null;
  viable:               boolean;           // false if season GDD too low
  viability_note:       string | null;     // explanation if not viable
  gdd_needed:           number;            // target GDD for harvest (midpoint)
  season_gdd_available: number;
}

/**
 * Add `days` calendar days to a date.
 */
function addDays(d: Date, days: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + days);
  return r;
}

/**
 * Estimate date when accumulated GDD will reach `target`,
 * starting from `fromDate` at `startGdd` accumulated,
 * accumulating at `dailyRate` GDD/day.
 */
function dateAtGdd(
  target: number,
  startGdd: number,
  dailyRate: number,
  fromDate: Date,
): Date | null {
  if (startGdd >= target) return fromDate;
  if (dailyRate <= 0) return null;
  const daysNeeded = Math.ceil((target - startGdd) / dailyRate);
  return addDays(fromDate, daysNeeded);
}

/**
 * Generate a full planting plan for a variety given the user's GDD profile.
 *
 * Logic:
 *  1. If indoor start: sow = last_frost_date minus start_indoors_weeks
 *  2. Move to greenhouse when indoor GDD has accumulated enough to germinate
 *     and seedling is established (germinate_max + 50 GDD buffer)
 *  3. Plant out after last frost and once greenhouse GDD is sufficient
 *  4. Harvest = plant-out date + GDD needed at outdoor daily rate
 *  5. Viability check: season GDD outdoor must be >= gdd_to_harvest_min * 0.85
 *     (15% tolerance — greenhouse can top up)
 */
export function generatePlantingPlan(
  variety: VarietyProfile,
  gddProfile: GddProfile,
  today: Date = new Date(),
): PlantingPlan {
  const base: Omit<PlantingPlan, 'viable' | 'viability_note'> = {
    variety_name:         variety.name,
    crop_key:             variety.crop_key,
    sow_date:             null,
    sow_location:         variety.sow_method === 'direct' ? 'direct' : 'indoor',
    move_to_greenhouse:   null,
    plant_out_date:       null,
    harvest_date_min:     null,
    harvest_date_max:     null,
    gdd_needed:           Math.round((variety.gdd_to_harvest_min + variety.gdd_to_harvest_max) / 2),
    season_gdd_available: gddProfile.season_gdd_outdoor,
  };

  // ── Viability check ───────────────────────────────────────────────────────
  // A crop is viable if outdoor + greenhouse GDD can reach harvest min.
  // Greenhouse adds ~30% more GDD than outdoor in a typical UK season.
  const effectiveSeasonGdd = gddProfile.season_gdd_outdoor * 1.3;
  const viable = effectiveSeasonGdd >= variety.gdd_to_harvest_min * 0.85;

  let viabilityNote: string | null = null;
  if (!viable) {
    viabilityNote = `This variety needs ${variety.gdd_to_harvest_min} GDD to harvest. Your location accumulates ~${Math.round(gddProfile.season_gdd_outdoor)} GDD outdoors — even with a greenhouse this may not be enough. Consider a faster-maturing variety.`;
  } else if (gddProfile.season_gdd_outdoor < variety.gdd_to_harvest_min) {
    viabilityNote = `Outdoor season GDD (${Math.round(gddProfile.season_gdd_outdoor)}) is below target — greenhouse growing recommended to reach ${variety.gdd_to_harvest_min} GDD.`;
  }

  // ── Direct sow crops (potatoes, carrots etc.) ─────────────────────────────
  if (variety.sow_method === 'direct') {
    // Sow after last frost when soil is warming
    const sowDate = addDays(gddProfile.last_frost_date, 0);
    const harvestMin = dateAtGdd(
      variety.gdd_to_harvest_min,
      0,
      gddProfile.outdoor_avg_daily_gdd,
      sowDate,
    );
    const harvestMax = dateAtGdd(
      variety.gdd_to_harvest_max,
      0,
      gddProfile.outdoor_avg_daily_gdd,
      sowDate,
    );

    return {
      ...base,
      sow_date:           sowDate < today ? today : sowDate,
      sow_location:       'direct',
      harvest_date_min:   harvestMin,
      harvest_date_max:   harvestMax,
      viable,
      viability_note:     viabilityNote,
    };
  }

  // ── Indoor start crops (tomatoes, peppers etc.) ───────────────────────────
  const weeksIndoors = variety.start_indoors_weeks ?? 8;
  const sowDate = addDays(gddProfile.last_frost_date, -(weeksIndoors * 7));

  // Move to greenhouse once germinated + 50 GDD established
  const germinateGdd = variety.gdd_to_germinate_max ?? 150;
  const establishBuffer = 50;
  const indoorDaysToMove = Math.ceil(
    (germinateGdd + establishBuffer) / gddProfile.greenhouse_avg_daily_gdd,
  );
  const moveToGreenhouse = addDays(sowDate, indoorDaysToMove);

  // Plant out after last frost
  const plantOutDate = gddProfile.last_frost_date > moveToGreenhouse
    ? gddProfile.last_frost_date
    : addDays(gddProfile.last_frost_date, 7); // 1 week buffer after last frost

  // GDD accumulated in greenhouse from move date to plant-out
  const daysInGreenhouse = Math.max(
    0,
    Math.round((plantOutDate.getTime() - moveToGreenhouse.getTime()) / 86400000),
  );
  const gddAtPlantOut = daysInGreenhouse * gddProfile.greenhouse_avg_daily_gdd;

  // Remaining GDD needed after plant-out
  const harvestMin = dateAtGdd(
    variety.gdd_to_harvest_min,
    gddAtPlantOut,
    gddProfile.outdoor_avg_daily_gdd,
    plantOutDate,
  );
  const harvestMax = dateAtGdd(
    variety.gdd_to_harvest_max,
    gddAtPlantOut,
    gddProfile.outdoor_avg_daily_gdd,
    plantOutDate,
  );

  return {
    ...base,
    sow_date:           sowDate < today ? today : sowDate,
    sow_location:       'indoor',
    move_to_greenhouse: moveToGreenhouse < today ? today : moveToGreenhouse,
    plant_out_date:     plantOutDate < today ? today : plantOutDate,
    harvest_date_min:   harvestMin,
    harvest_date_max:   harvestMax,
    viable,
    viability_note:     viabilityNote,
  };
}

/**
 * Build a GDD profile from the user's historical gdd_daily records.
 * Falls back to UK climate-zone defaults if insufficient history.
 */
export function buildGddProfile(
  dailyGddRows: Array<{ date: string; zone: string; gdd: number }>,
  climateZone: string,
  lastFrostDate?: Date,
  firstAutumnFrostDate?: Date,
): GddProfile {
  // Default frost dates by UK climate zone
  const frostDefaults: Record<string, { last: string; first: string }> = {
    'uk-south':    { last: '04-15', first: '10-31' },
    'uk-midlands': { last: '04-25', first: '10-20' },
    'uk-north':    { last: '05-05', first: '10-10' },
    'uk-scotland': { last: '05-15', first: '09-30' },
  };

  const zone = frostDefaults[climateZone] ?? frostDefaults['uk-midlands']!;
  const year = new Date().getFullYear();

  const lastFrost  = lastFrostDate  ?? new Date(`${year}-${zone.last}`);
  const firstFrost = firstAutumnFrostDate ?? new Date(`${year}-${zone.first}`);

  // Compute average daily GDD per zone from history (Apr–Sep only)
  const outdoorRows    = dailyGddRows.filter(r => r.zone === 'outdoor');
  const greenhouseRows = dailyGddRows.filter(r => r.zone === 'greenhouse');

  const avgOutdoor    = outdoorRows.length > 0
    ? outdoorRows.reduce((s, r) => s + r.gdd, 0) / outdoorRows.length
    : zoneDefaultAvgDaily(climateZone, 'outdoor');

  const avgGreenhouse = greenhouseRows.length > 0
    ? greenhouseRows.reduce((s, r) => s + r.gdd, 0) / greenhouseRows.length
    : avgOutdoor * 1.35;  // greenhouse typically 35% warmer

  // Season total (Apr–Sep = ~183 days)
  const seasonDays = Math.round(
    (firstFrost.getTime() - lastFrost.getTime()) / 86400000,
  );
  const seasonGdd = avgOutdoor * seasonDays;

  return {
    outdoor_avg_daily_gdd:    avgOutdoor,
    greenhouse_avg_daily_gdd: avgGreenhouse,
    last_frost_date:          lastFrost,
    first_autumn_frost_date:  firstFrost,
    season_gdd_outdoor:       seasonGdd,
  };
}

/** UK climate zone default average daily GDD (base 10°C, Apr–Sep) */
function zoneDefaultAvgDaily(zone: string, _type: string): number {
  const defaults: Record<string, number> = {
    'uk-south':    7.5,
    'uk-midlands': 6.5,
    'uk-north':    5.5,
    'uk-scotland': 4.5,
  };
  return defaults[zone] ?? 6.0;
}
