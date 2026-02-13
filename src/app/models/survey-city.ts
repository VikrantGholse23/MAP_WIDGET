/**
 * Represents city-level survey metrics for map visualization.
 */
export interface SurveyCity {
  city: string;
  state: string;
  country: string;
  latitude: number;
  longitude: number;
  nps: number;
  /** 0–100; optional for backward compatibility (defaults used if missing). */
  csat?: number;
  /** 1–7; optional for backward compatibility (defaults used if missing). */
  ces?: number;
  responseCount: number;
  /** ISO date string for time-based display (e.g. "2024-06-15T10:30:00Z"). */
  surveyDate?: string;
}

/** Display type for map markers: circles, time labels, or area-colored regions. */
export type DisplayType = 'circle' | 'time' | 'area';

/** Drill level for hierarchical view. */
export type DrillLevel = 'country' | 'state' | 'city';

/** Aggregated data at country or state level for drill-down. */
export interface SurveyAggregate {
  name: string;
  country?: string;
  state?: string;
  latitude: number;
  longitude: number;
  nps: number;
  csat: number;
  ces: number;
  responseCount: number;
  surveyDate?: string;
  level: DrillLevel;
}

/** Metric keys available for visualization. */
export type SurveyMetric = 'nps' | 'csat' | 'ces';
