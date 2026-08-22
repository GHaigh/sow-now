/**
 * Durable Object: DeviceStateDO
 *
 * One instance per device (keyed by deviceId).
 * Holds:
 *  - latest sensor readings (in-memory, persisted to DO storage)
 *  - current season GDD accumulators per zone (outdoor, greenhouse)
 *  - pending alert flags
 *
 * Handles:
 *   POST /readings  — ingest new readings from Worker, update state
 *   GET  /state     — return current state to dashboard Worker
 */

import type { DurableObjectState } from '@cloudflare/workers-types';
import type { Env } from '../types/env';

interface LatestReadings {
  outdoor: {
    temp_c: number | null;
    humidity_pct: number | null;
    recorded_at: number | null;
  };
  greenhouse: {
    temp_c: number | null;
    humidity_pct: number | null;
    recorded_at: number | null;
  };
  indoor: {
    temp_c: number | null;
    humidity_pct: number | null;
    recorded_at: number | null;
  };
  soil: Record<string, { moisture_pct: number | null; temp_c: number | null; battery_pct: number | null; recorded_at: number | null }>;
}

interface GddAccumulators {
  outdoor: number;
  greenhouse: number;
  indoor: number;
  season_start: string;   // 'YYYY-MM-DD'
}

interface DeviceState {
  latest: LatestReadings;
  gdd: GddAccumulators;
  alerts: string[];
  updated_at: number;
}

const DEFAULT_STATE: DeviceState = {
  latest: {
    outdoor:    { temp_c: null, humidity_pct: null, recorded_at: null },
    greenhouse: { temp_c: null, humidity_pct: null, recorded_at: null },
    indoor:     { temp_c: null, humidity_pct: null, recorded_at: null },
    soil: {},
  },
  gdd: { outdoor: 0, greenhouse: 0, indoor: 0, season_start: new Date().toISOString().slice(0, 10) },
  alerts: [],
  updated_at: 0,
};

export class DeviceStateDO {
  private state: DurableObjectState;
  private env: Env;
  private deviceState: DeviceState = DEFAULT_STATE;
  private loaded = false;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env   = env;
  }

  private async load(): Promise<void> {
    if (this.loaded) return;
    const stored = await this.state.storage.get<DeviceState>('state');
    if (stored) this.deviceState = stored;
    this.loaded = true;
  }

  private async save(): Promise<void> {
    this.deviceState.updated_at = Math.floor(Date.now() / 1000);
    await this.state.storage.put('state', this.deviceState);
  }

  async fetch(request: Request): Promise<Response> {
    await this.load();
    const url = new URL(request.url);

    if (url.pathname === '/readings' && request.method === 'POST') {
      return this.handleReadings(request);
    }
    if (url.pathname === '/state' && request.method === 'GET') {
      return new Response(JSON.stringify(this.deviceState), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response('Not found', { status: 404 });
  }

  private async handleReadings(request: Request): Promise<Response> {
    const { readings } = await request.json() as { readings: Array<Record<string, unknown>> };

    for (const r of readings) {
      const sensorType = r['sensor_type'] as string;
      const rfId = r['sensor_rf_id'] as string;

      if (sensorType === 'greenhouse') {
        this.deviceState.latest.greenhouse = {
          temp_c:       (r['greenhouse_temp_c'] as number | null) ?? this.deviceState.latest.greenhouse.temp_c,
          humidity_pct: (r['greenhouse_humidity_pct'] as number | null) ?? this.deviceState.latest.greenhouse.humidity_pct,
          recorded_at:  (r['recorded_at'] as number) ?? this.deviceState.latest.greenhouse.recorded_at,
        };
      } else if (sensorType === 'indoor') {
        this.deviceState.latest.indoor = {
          temp_c:       (r['indoor_temp_c'] as number | null) ?? this.deviceState.latest.indoor.temp_c,
          humidity_pct: (r['indoor_humidity_pct'] as number | null) ?? this.deviceState.latest.indoor.humidity_pct,
          recorded_at:  (r['recorded_at'] as number) ?? this.deviceState.latest.indoor.recorded_at,
        };
      } else if (sensorType === 'soil') {
        this.deviceState.latest.soil[rfId] = {
          moisture_pct: (r['soil_moisture_pct'] as number | null) ?? null,
          temp_c:       (r['soil_temp_c'] as number | null) ?? null,
          battery_pct:  (r['battery_pct'] as number | null) ?? null,
          recorded_at:  (r['recorded_at'] as number) ?? null,
        };
      }
    }

    // Generate alerts
    this.deviceState.alerts = this.evaluateAlerts();

    await this.save();
    return new Response(JSON.stringify({ ok: true }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  private evaluateAlerts(): string[] {
    const alerts: string[] = [];
    const { outdoor, soil } = this.deviceState.latest;

    // Frost risk alert
    if (outdoor.temp_c !== null && outdoor.temp_c < 2) {
      alerts.push('frost_risk');
    }

    // Soil moisture alerts
    for (const [rfId, s] of Object.entries(soil)) {
      if (s.moisture_pct !== null && s.moisture_pct < 30) {
        alerts.push(`low_moisture:${rfId}`);
      }
      if (s.battery_pct !== null && s.battery_pct < 15) {
        alerts.push(`low_battery:${rfId}`);
      }
    }

    return alerts;
  }
}
