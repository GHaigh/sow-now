import { describe, it, expect } from 'vitest';
import { calcDailyGdd, accumulateGdd, estimateTargetDate } from '../src/lib/gdd';
import {
  generatePlantingPlan,
  buildGddProfile,
  type VarietyProfile,
} from '../src/lib/planner';

// ── calcDailyGdd ──────────────────────────────────────────────────────────────

describe('calcDailyGdd', () => {
  it('returns 0 when mean temp is below base temp', () => {
    expect(calcDailyGdd(8, 4, 10)).toBe(0);
  });

  it('returns 0 when mean temp equals base temp', () => {
    expect(calcDailyGdd(12, 8, 10)).toBe(0);
  });

  it('calculates correct GDD above base temp', () => {
    // mean = (20 + 10) / 2 = 15, GDD = 15 - 10 = 5
    expect(calcDailyGdd(20, 10, 10)).toBe(5);
  });

  it('uses default base temp of 10°C', () => {
    expect(calcDailyGdd(22, 14)).toBe(8); // mean=18, 18-10=8
  });

  it('handles warm summer day', () => {
    // mean = (28 + 16) / 2 = 22, GDD = 22 - 10 = 12
    expect(calcDailyGdd(28, 16, 10)).toBe(12);
  });

  it('clamps to 0 for very cold day', () => {
    expect(calcDailyGdd(-2, -8, 10)).toBe(0);
  });
});

// ── accumulateGdd ─────────────────────────────────────────────────────────────

describe('accumulateGdd', () => {
  it('returns 0 for empty array', () => {
    expect(accumulateGdd([])).toBe(0);
  });

  it('accumulates GDD over multiple days', () => {
    const readings = [
      { tMax: 20, tMin: 10 }, // GDD = 5
      { tMax: 22, tMin: 14 }, // GDD = 8
      { tMax: 18, tMin: 8 },  // GDD = 3
    ];
    expect(accumulateGdd(readings, 10)).toBe(16);
  });

  it('ignores days below base temp', () => {
    const readings = [
      { tMax: 8, tMin: 2 },  // mean=5, GDD=0
      { tMax: 20, tMin: 10 }, // GDD=5
    ];
    expect(accumulateGdd(readings, 10)).toBe(5);
  });
});

// ── estimateTargetDate ────────────────────────────────────────────────────────

describe('estimateTargetDate', () => {
  it('returns null if current GDD already meets target', () => {
    const result = estimateTargetDate(1000, 800, 5);
    expect(result).toBeNull();
  });

  it('returns null if avg daily GDD is 0', () => {
    const result = estimateTargetDate(0, 800, 0);
    expect(result).toBeNull();
  });

  it('returns a date in the future when GDD is needed', () => {
    const from = new Date('2025-04-01');
    const result = estimateTargetDate(0, 500, 5, from); // 100 days needed
    expect(result).not.toBeNull();
    expect(result!.getTime()).toBeGreaterThan(from.getTime());
    // 500/5 = 100 days
    const expectedDate = new Date('2025-04-01');
    expectedDate.setDate(expectedDate.getDate() + 100);
    expect(result!.toISOString().slice(0, 10)).toBe(expectedDate.toISOString().slice(0, 10));
  });

  it('rounds up to whole days', () => {
    const from = new Date('2025-04-01');
    const result = estimateTargetDate(0, 11, 5, from); // 11/5 = 2.2 days → 3
    expect(result!.getDate()).toBe(from.getDate() + 3);
  });
});

// ── buildGddProfile ───────────────────────────────────────────────────────────

describe('buildGddProfile', () => {
  it('returns default climate-zone values when no history', () => {
    const profile = buildGddProfile([], 'uk-midlands');
    expect(profile.outdoor_avg_daily_gdd).toBe(6.5);
    expect(profile.greenhouse_avg_daily_gdd).toBeCloseTo(6.5 * 1.35, 2);
    expect(profile.season_gdd_outdoor).toBeGreaterThan(0);
  });

  it('computes averages from supplied rows', () => {
    const rows = [
      { date: '2025-05-01', zone: 'outdoor', gdd: 4 },
      { date: '2025-05-02', zone: 'outdoor', gdd: 6 },
    ];
    const profile = buildGddProfile(rows, 'uk-midlands');
    expect(profile.outdoor_avg_daily_gdd).toBe(5);
  });

  it('uses separate rates for greenhouse zone', () => {
    const rows = [
      { date: '2025-05-01', zone: 'outdoor', gdd: 5 },
      { date: '2025-05-01', zone: 'greenhouse', gdd: 8 },
    ];
    const profile = buildGddProfile(rows, 'uk-midlands');
    expect(profile.outdoor_avg_daily_gdd).toBe(5);
    expect(profile.greenhouse_avg_daily_gdd).toBe(8);
  });
});

// ── generatePlantingPlan ──────────────────────────────────────────────────────

describe('generatePlantingPlan', () => {
  const indoorVariety: VarietyProfile = {
    crop_key: 'tomato',
    name: "Gardener's Delight",
    base_temp_c: 10,
    gdd_to_harvest_min: 900,
    gdd_to_harvest_max: 1100,
    gdd_to_germinate_min: 100,
    gdd_to_germinate_max: 150,
    start_indoors_weeks: 8,
    sow_method: 'indoor',
  };

  const directVariety: VarietyProfile = {
    crop_key: 'carrot',
    name: 'Nantes',
    base_temp_c: 10,
    gdd_to_harvest_min: 600,
    gdd_to_harvest_max: 800,
    gdd_to_germinate_min: null,
    gdd_to_germinate_max: null,
    start_indoors_weeks: null,
    sow_method: 'direct',
  };

  const gddProfile = buildGddProfile([], 'uk-midlands');

  it('indoor variety returns sow_location indoor', () => {
    const plan = generatePlantingPlan(indoorVariety, gddProfile);
    expect(plan.sow_location).toBe('indoor');
  });

  it('direct-sow variety returns sow_location direct', () => {
    const plan = generatePlantingPlan(directVariety, gddProfile);
    expect(plan.sow_location).toBe('direct');
    expect(plan.move_to_greenhouse).toBeNull();
    expect(plan.plant_out_date).toBeNull();
  });

  it('indoor variety has a move_to_greenhouse date', () => {
    const plan = generatePlantingPlan(indoorVariety, gddProfile);
    expect(plan.move_to_greenhouse).not.toBeNull();
  });

  it('harvest dates are after sow date', () => {
    const today = new Date('2025-02-01');
    const plan = generatePlantingPlan(indoorVariety, gddProfile, today);
    expect(plan.sow_date).not.toBeNull();
    expect(plan.harvest_date_min).not.toBeNull();
    expect(plan.harvest_date_min!.getTime()).toBeGreaterThan(plan.sow_date!.getTime());
  });

  it('variety with very high GDD threshold is marked not viable', () => {
    const hardVariety: VarietyProfile = {
      ...indoorVariety,
      gdd_to_harvest_min: 9999,
      gdd_to_harvest_max: 12000,
    };
    const plan = generatePlantingPlan(hardVariety, gddProfile);
    expect(plan.viable).toBe(false);
    expect(plan.viability_note).not.toBeNull();
  });

  it('gdd_needed is midpoint of min/max', () => {
    const plan = generatePlantingPlan(indoorVariety, gddProfile);
    expect(plan.gdd_needed).toBe(
      Math.round((indoorVariety.gdd_to_harvest_min + indoorVariety.gdd_to_harvest_max) / 2),
    );
  });
});
