/**
 * GDD (Growing Degree Day) calculation engine.
 *
 * Standard formula used across agriculture:
 *   GDD_daily = max( ((T_max + T_min) / 2) - T_base , 0 )
 *
 * Both the Cloudflare Worker (cron) and Pi agent use this same logic.
 * This module is intentionally dependency-free so it can run in both
 * environments without modification.
 */

export interface DailyGdd {
  date: string;       // 'YYYY-MM-DD'
  tMax: number;       // °C
  tMin: number;       // °C
  gdd: number;        // daily GDD contribution (>= 0)
  baseTemp: number;   // base temp used
}

/**
 * Calculate a single day's GDD contribution.
 *
 * @param tMax     - Maximum temperature for the day (°C)
 * @param tMin     - Minimum temperature for the day (°C)
 * @param baseTemp - Crop base temperature (°C). Defaults to 10°C.
 * @returns GDD value >= 0
 */
export function calcDailyGdd(tMax: number, tMin: number, baseTemp = 10): number {
  const meanTemp = (tMax + tMin) / 2;
  return Math.max(meanTemp - baseTemp, 0);
}

/**
 * Accumulate GDD from an array of daily readings.
 *
 * @param readings  - Array of { tMax, tMin } objects ordered oldest → newest
 * @param baseTemp  - Crop base temperature (°C)
 * @returns Total accumulated GDD
 */
export function accumulateGdd(
  readings: Array<{ tMax: number; tMin: number }>,
  baseTemp = 10,
): number {
  return readings.reduce((sum, r) => sum + calcDailyGdd(r.tMax, r.tMin, baseTemp), 0);
}

/**
 * Estimate the date on which a GDD target will be reached, given:
 *  - current accumulated GDD
 *  - recent average daily GDD (used to project forward)
 *  - target GDD threshold
 *
 * Returns null if the target has already been passed or avgDailyGdd <= 0.
 */
export function estimateTargetDate(
  currentGdd: number,
  targetGdd: number,
  avgDailyGdd: number,
  fromDate: Date = new Date(),
): Date | null {
  if (currentGdd >= targetGdd) return null;
  if (avgDailyGdd <= 0) return null;

  const daysRemaining = Math.ceil((targetGdd - currentGdd) / avgDailyGdd);
  const result = new Date(fromDate);
  result.setDate(result.getDate() + daysRemaining);
  return result;
}

/**
 * Check whether soil temperature has crossed the minimum threshold for
 * direct sowing a given crop.
 */
export function isSoilReadyToSow(soilTempC: number, minSoilTempC: number): boolean {
  return soilTempC >= minSoilTempC;
}

/**
 * Format a Date as ISO date string 'YYYY-MM-DD'.
 */
export function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
