import {
  AfterViewInit,
  Component,
  DestroyRef,
  inject,
  signal,
  computed,
  ChangeDetectorRef,
  OnDestroy
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import * as L from 'leaflet';
import { MapDataService } from '../../services/map-data.service';
import { GeoService, geoNameForCountry } from '../../services/geo.service';
import {
  SurveyCity,
  SurveyMetric,
  SurveyAggregate,
  DisplayType,
  DrillLevel
} from '../../models/survey-city';

/** Minimum and maximum radius for circle markers (pixels). */
const RADIUS_MIN = 5;
const RADIUS_MAX = 25;
const RADIUS_DIVISOR = 10;

/** Safe numeric value for metrics (handles NaN/undefined). */
export function safeMetricValue(value: number | undefined): number {
  const n = Number(value);
  return typeof value === 'number' && !Number.isNaN(n) ? n : 0;
}

/** Format metric for display; use "—" when value is missing or NaN. */
export function formatMetricValue(value: number | undefined, metric: SurveyMetric): string {
  const n = safeMetricValue(value);
  if (typeof value !== 'number' || Number.isNaN(value)) return '—';
  if (metric === 'ces') return n.toFixed(1);
  return String(Math.round(n));
}

export function getColor(metric: SurveyMetric, value: number): string {
  const v = safeMetricValue(value);
  switch (metric) {
    case 'nps':
      if (v >= 50) return '#22c55e';
      if (v >= 0) return '#eab308';
      return '#ef4444';
    case 'csat':
      if (v >= 80) return '#22c55e';
      if (v >= 60) return '#eab308';
      return '#ef4444';
    case 'ces':
      if (v < 3) return '#22c55e';
      if (v <= 5) return '#eab308';
      return '#ef4444';
    default:
      return '#6b7280';
  }
}

export const METRIC_LABELS: Record<SurveyMetric, string> = {
  nps: 'NPS',
  csat: 'CSAT',
  ces: 'CES'
};

/** Format ISO date for display (e.g. "Nov 15, 2024 09:30"). */
function formatSurveyTime(iso?: string): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch {
    return iso;
  }
}

/** Aggregate cities by country. */
function aggregateByCountry(cities: SurveyCity[]): SurveyAggregate[] {
  const byCountry = new Map<string, { lat: number; lng: number; nps: number; csat: number; ces: number; count: number; date?: string }>();
  for (const c of cities) {
    const key = c.country;
    const existing = byCountry.get(key);
    const count = c.responseCount;
    const nps = Number(c.nps);
    const csat = typeof c.csat === 'number' && !Number.isNaN(c.csat) ? c.csat : 50;
    const ces = typeof c.ces === 'number' && !Number.isNaN(c.ces) ? c.ces : 3;
    if (!existing) {
      byCountry.set(key, {
        lat: c.latitude * count,
        lng: c.longitude * count,
        nps: (Number.isNaN(nps) ? 0 : nps) * count,
        csat: csat * count,
        ces: ces * count,
        count,
        date: c.surveyDate
      });
    } else {
      existing.lat += c.latitude * count;
      existing.lng += c.longitude * count;
      existing.nps += (Number.isNaN(nps) ? 0 : nps) * count;
      existing.csat += csat * count;
      existing.ces += ces * count;
      existing.count += count;
      if (c.surveyDate && (!existing.date || c.surveyDate > (existing.date ?? ''))) existing.date = c.surveyDate;
    }
  }
  return Array.from(byCountry.entries()).map(([name, agg]) => ({
    name,
    latitude: agg.lat / agg.count,
    longitude: agg.lng / agg.count,
    nps: agg.nps / agg.count,
    csat: agg.csat / agg.count,
    ces: agg.ces / agg.count,
    responseCount: agg.count,
    surveyDate: agg.date,
    level: 'country' as DrillLevel
  }));
}

/** Aggregate cities by state within a country. */
function aggregateByState(cities: SurveyCity[], country: string): SurveyAggregate[] {
  const filtered = cities.filter((c) => c.country === country);
  const byState = new Map<string, { lat: number; lng: number; nps: number; csat: number; ces: number; count: number; date?: string }>();
  for (const c of filtered) {
    const key = c.state || c.country;
    const existing = byState.get(key);
    const count = c.responseCount;
    const nps = Number(c.nps);
    const csat = typeof c.csat === 'number' && !Number.isNaN(c.csat) ? c.csat : 50;
    const ces = typeof c.ces === 'number' && !Number.isNaN(c.ces) ? c.ces : 3;
    if (!existing) {
      byState.set(key, {
        lat: c.latitude * count,
        lng: c.longitude * count,
        nps: (Number.isNaN(nps) ? 0 : nps) * count,
        csat: csat * count,
        ces: ces * count,
        count,
        date: c.surveyDate
      });
    } else {
      existing.lat += c.latitude * count;
      existing.lng += c.longitude * count;
      existing.nps += (Number.isNaN(nps) ? 0 : nps) * count;
      existing.csat += csat * count;
      existing.ces += ces * count;
      existing.count += count;
      if (c.surveyDate && (!existing.date || c.surveyDate > (existing.date ?? ''))) existing.date = c.surveyDate;
    }
  }
  return Array.from(byState.entries()).map(([name, agg]) => ({
    name,
    country,
    state: name,
    latitude: agg.lat / agg.count,
    longitude: agg.lng / agg.count,
    nps: agg.nps / agg.count,
    csat: agg.csat / agg.count,
    ces: agg.ces / agg.count,
    responseCount: agg.count,
    surveyDate: agg.date,
    level: 'state' as DrillLevel
  }));
}

@Component({
  selector: 'app-map',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './map.component.html',
  styleUrl: './map.component.css'
})
export class MapComponent implements AfterViewInit, OnDestroy {
  private readonly mapDataService = inject(MapDataService);
  private readonly geoService = inject(GeoService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly cdr = inject(ChangeDetectorRef);

  private map: L.Map | null = null;
  private markerLayers: L.Layer[] = [];
  private geoJsonLayer: L.GeoJSON | null = null;
  private baseLayers: Record<string, L.TileLayer> = {};

  readonly selectedMetric = signal<SurveyMetric>('nps');
  readonly surveyData = signal<SurveyCity[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);

  /** Display type: circle markers or time labels. */
  readonly displayType = signal<DisplayType>('circle');
  /** Drill level and selection for hierarchy. */
  readonly drillLevel = signal<DrillLevel>('country');
  readonly selectedCountry = signal<string | null>(null);
  readonly selectedState = signal<string | null>(null);

  /** Terrain / base map selection. */
  readonly baseLayerKey = signal<string>('standard');

  readonly metricOptions: { value: SurveyMetric; label: string }[] = [
    { value: 'nps', label: METRIC_LABELS.nps },
    { value: 'csat', label: METRIC_LABELS.csat },
    { value: 'ces', label: METRIC_LABELS.ces }
  ];

  readonly displayTypeOptions: { value: DisplayType; label: string }[] = [
    { value: 'circle', label: 'Circle' },
    { value: 'time', label: 'Time' },
    { value: 'area', label: 'Area' }
  ];

  readonly baseLayerOptions: { value: string; label: string }[] = [
    { value: 'standard', label: 'Standard' },
    { value: 'satellite', label: 'Satellite' },
    { value: 'terrain', label: 'Terrain' }
  ];

  /** Unique countries for drill-down. */
  readonly countries = computed(() => {
    const data = this.surveyData();
    return [...new Set(data.map((c) => c.country))].sort();
  });

  /** States in selected country. */
  readonly states = computed(() => {
    const country = this.selectedCountry();
    if (!country) return [];
    const data = this.surveyData();
    return [...new Set(data.filter((c) => c.country === country).map((c) => c.state || c.country))].sort();
  });

  /** Cities in selected country/state (for city-level view). */
  readonly citiesInSelection = computed(() => {
    const data = this.surveyData();
    const country = this.selectedCountry();
    const state = this.selectedState();
    if (!country) return data;
    let list = data.filter((c) => c.country === country);
    if (state != null && state !== '') list = list.filter((c) => (c.state || c.country) === state);
    return list;
  });

  /** Current data to show on map (aggregated or city list). */
  readonly currentMapData = computed(() => {
    const data = this.surveyData();
    const level = this.drillLevel();
    const country = this.selectedCountry();
    const state = this.selectedState();
    if (level === 'country') return aggregateByCountry(data);
    if (level === 'state' && country) return aggregateByState(data, country);
    if (level === 'city') {
      if (!country) return data;
      let list = data.filter((c) => c.country === country);
      if (state != null && state !== '') list = list.filter((c) => (c.state || c.country) === state);
      return list;
    }
    return [];
  });

  get currentMetric(): SurveyMetric {
    return this.selectedMetric();
  }
  set currentMetric(value: SurveyMetric) {
    this.selectedMetric.set(value);
    this.updateMarkers();
  }

  get currentDisplayType(): DisplayType {
    return this.displayType();
  }
  set currentDisplayType(value: DisplayType) {
    this.displayType.set(value);
    this.updateMarkers();
  }

  get currentBaseLayer(): string {
    return this.baseLayerKey();
  }
  set currentBaseLayer(value: string) {
    this.baseLayerKey.set(value);
    this.switchBaseLayer(value);
  }

  /** Legend info for current metric (industry-standard color scale). */
  readonly legendRanges = computed(() => {
    const metric = this.selectedMetric();
    if (metric === 'nps') return [{ label: '50+', color: '#22c55e' }, { label: '0–49', color: '#eab308' }, { label: '<0', color: '#ef4444' }];
    if (metric === 'csat') return [{ label: '80+', color: '#22c55e' }, { label: '60–79', color: '#eab308' }, { label: '<60', color: '#ef4444' }];
    return [{ label: '1–2.9', color: '#22c55e' }, { label: '3–5', color: '#eab308' }, { label: '>5', color: '#ef4444' }];
  });

  ngAfterViewInit(): void {
    this.initMap();
    this.loadData();
  }

  private initMap(): void {
    const container = document.getElementById('survey-map');
    if (!container) return;

    this.map = L.map(container, {
      center: [20, 0],
      zoom: 2,
      zoomControl: true
    });

    const standard = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
    });
    const satellite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      attribution: 'Tiles &copy; Esri'
    });
    const terrain = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
      attribution: 'Map data: &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, SRTM | Map style: &copy; <a href="https://opentopomap.org">OpenTopoMap</a>'
    });

    this.baseLayers['standard'] = standard;
    this.baseLayers['satellite'] = satellite;
    this.baseLayers['terrain'] = terrain;
    standard.addTo(this.map);
  }

  private switchBaseLayer(key: string): void {
    if (!this.map) return;
    const layer = this.baseLayers[key];
    if (!layer) return;
    Object.values(this.baseLayers).forEach((l) => this.map!.removeLayer(l));
    layer.addTo(this.map);
  }

  private loadData(): void {
    this.loading.set(true);
    this.error.set(null);
    this.mapDataService
      .getSurveyData()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (data) => {
          this.surveyData.set(data);
          this.loading.set(false);
          this.updateMarkers();
          this.cdr.markForCheck();
        },
        error: (err) => {
          this.loading.set(false);
          this.error.set(err?.message ?? 'Failed to load survey data');
          this.cdr.markForCheck();
        }
      });
  }

  setDrillLevel(level: DrillLevel, country?: string | null, state?: string | null): void {
    this.drillLevel.set(level);
    this.selectedCountry.set(country ?? null);
    this.selectedState.set(state ?? null);
    this.updateMarkers();
    this.fitMapToData();
    this.cdr.markForCheck();
  }

  onCountrySelect(country: string): void {
    this.selectedCountry.set(country);
    this.selectedState.set(null);
    this.drillLevel.set('state');
    this.updateMarkers();
    this.fitMapToData();
    this.cdr.markForCheck();
  }

  onStateSelect(state: string): void {
    this.selectedState.set(state);
    this.drillLevel.set('city');
    this.updateMarkers();
    this.fitMapToData();
    this.cdr.markForCheck();
  }

  /** Called from state dropdown; only drill to city when a state is selected. */
  onStateSelectFromSelect(value: string): void {
    if (value) this.onStateSelect(value);
  }

  goToWorld(): void {
    this.setDrillLevel('country', null, null);
  }

  goBackFromState(): void {
    this.setDrillLevel('country', null, null);
  }

  goBackFromCity(): void {
    const country = this.selectedCountry();
    this.setDrillLevel('state', country, null);
  }

  private fitMapToData(): void {
    if (!this.map) return;
    const data = this.currentMapData();
    if (data.length === 0) return;
    const isAggregate = (d: SurveyAggregate | SurveyCity): d is SurveyAggregate => 'level' in d;
    const latLngs = data.map((d) => L.latLng(d.latitude, d.longitude));
    this.map.fitBounds(L.latLngBounds(latLngs), { padding: [40, 40], maxZoom: 10 });
  }

  private updateMarkers(): void {
    if (!this.map) return;
    this.clearMarkers();
    const data = this.currentMapData();
    const metric = this.selectedMetric();
    const displayType = this.displayType();
    const drillLevel = this.drillLevel();
    const isAggregate = (d: SurveyAggregate | SurveyCity): d is SurveyAggregate => 'level' in d && 'name' in d;

    const isCountryChoropleth = displayType === 'area' && drillLevel === 'country';
    if (isCountryChoropleth && data.length > 0) {
      this.addChoroplethLayer(data as SurveyAggregate[], metric);
      return;
    }

    for (const item of data) {
      const value = item[metric] as number | undefined;
      const safeVal = safeMetricValue(value);
      const color = getColor(metric, safeVal);
      const label = isAggregate(item) ? item.name : `${(item as SurveyCity).city}, ${(item as SurveyCity).state ? (item as SurveyCity).state + ', ' : ''}${(item as SurveyCity).country}`;
      const responseCount = item.responseCount;
      const surveyDate = item.surveyDate;

      if (displayType === 'time') {
        const timeStr = formatSurveyTime(surveyDate);
        const divIcon = L.divIcon({
          className: 'survey-time-marker',
          html: `<span class="survey-time-label">${timeStr}</span>`,
          iconSize: [120, 24],
          iconAnchor: [60, 12]
        });
        const marker = L.marker([item.latitude, item.longitude], { icon: divIcon });
        const tooltipContent = this.buildTooltipContent(item, metric, safeVal, label, responseCount, surveyDate);
        marker.bindTooltip(tooltipContent, {
          permanent: false,
          direction: 'top',
          className: 'survey-marker-tooltip'
        });
        if (isAggregate(item) && (item.level === 'country' || item.level === 'state')) {
          marker.on('click', () => {
            if (item.level === 'country') this.onCountrySelect(item.name);
            if (item.level === 'state' && item.country) this.onStateSelect(item.name);
          });
        }
        marker.addTo(this.map);
        this.markerLayers.push(marker);
      } else if (displayType === 'area') {
        const level: DrillLevel = isAggregate(item) ? item.level : 'city';
        const radiusMeters = level === 'country' ? 600000 : level === 'state' ? 180000 : 70000;
        const areaCircle = L.circle([item.latitude, item.longitude], {
          radius: radiusMeters,
          fillColor: color,
          color: 'rgba(31, 41, 55, 0.6)',
          weight: 1.5,
          opacity: 0.8,
          fillOpacity: 0.4
        });
        const tooltipContent = this.buildTooltipContent(item, metric, safeVal, label, responseCount, surveyDate);
        areaCircle.bindTooltip(tooltipContent, {
          permanent: false,
          direction: 'top',
          className: 'survey-marker-tooltip'
        });
        if (isAggregate(item) && (item.level === 'country' || item.level === 'state')) {
          areaCircle.on('click', () => {
            if (item.level === 'country') this.onCountrySelect(item.name);
            if (item.level === 'state' && item.country) this.onStateSelect(item.name);
          });
        }
        areaCircle.addTo(this.map);
        this.markerLayers.push(areaCircle);
      } else {
        const radius = Math.min(RADIUS_MAX, Math.max(RADIUS_MIN, responseCount / RADIUS_DIVISOR));
        const circle = L.circleMarker([item.latitude, item.longitude], {
          radius,
          fillColor: color,
          color: '#1f2937',
          weight: 1,
          opacity: 1,
          fillOpacity: 0.8
        });
        const tooltipContent = this.buildTooltipContent(item, metric, safeVal, label, responseCount, surveyDate);
        circle.bindTooltip(tooltipContent, {
          permanent: false,
          direction: 'top',
          className: 'survey-marker-tooltip'
        });
        if (isAggregate(item) && (item.level === 'country' || item.level === 'state')) {
          circle.on('click', () => {
            if (item.level === 'country') this.onCountrySelect(item.name);
            if (item.level === 'state' && item.country) this.onStateSelect(item.name);
          });
        }
        circle.addTo(this.map);
        this.markerLayers.push(circle);
      }
    }
  }

  private buildTooltipContent(
    item: SurveyAggregate | SurveyCity,
    metric: SurveyMetric,
    value: number,
    label: string,
    responseCount: number,
    surveyDate?: string
  ): string {
    const metricLabel = METRIC_LABELS[metric];
    const lines = [
      label,
      `${metricLabel}: ${formatMetricValue(value, metric)}`,
      `Response Count: ${responseCount}`,
      `NPS: ${formatMetricValue(item.nps, 'nps')}`,
      `CSAT: ${formatMetricValue(item.csat, 'csat')}`,
      `CES: ${formatMetricValue(item.ces, 'ces')}`,
      surveyDate ? `Survey: ${formatSurveyTime(surveyDate)}` : null
    ].filter(Boolean) as string[];
    return lines.join('<br>');
  }

  private addChoroplethLayer(aggregates: SurveyAggregate[], metric: SurveyMetric): void {
    const byGeoName = new Map<string, { value: number; color: string; agg: SurveyAggregate }>();
    for (const agg of aggregates) {
      const geoName = geoNameForCountry(agg.name);
      const value = agg[metric];
      byGeoName.set(geoName, { value, color: getColor(metric, value), agg });
    }
    this.geoService.getCountriesGeoJson().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (geojson) => {
        if (!this.map) return;
        const geoLayer = L.geoJSON(geojson, {
          style: (feature) => {
            const name = feature?.properties?.['name'];
            const info = name ? byGeoName.get(name) : undefined;
            const color = info?.color ?? '#e5e7eb';
            return {
              fillColor: color,
              weight: 1,
              opacity: 1,
              color: '#374151',
              fillOpacity: 0.65
            };
          },
          onEachFeature: (feature, layer) => {
            const name = feature.properties?.['name'];
            const info = name ? byGeoName.get(name) : undefined;
            if (info) {
              const { agg } = info;
              const label = agg.name;
              const content = this.buildTooltipContent(
                agg,
                metric,
                info.value,
                label,
                agg.responseCount,
                agg.surveyDate
              );
              layer.bindTooltip(content, {
                permanent: false,
                direction: 'top',
                className: 'survey-marker-tooltip'
              });
              layer.on('click', () => this.onCountrySelect(agg.name));
            }
          }
        });
        geoLayer.addTo(this.map);
        this.geoJsonLayer = geoLayer;
        this.fitMapToData();
      }
    });
  }

  private clearMarkers(): void {
    if (this.geoJsonLayer && this.map) {
      this.map.removeLayer(this.geoJsonLayer);
      this.geoJsonLayer = null;
    }
    for (const layer of this.markerLayers) {
      this.map?.removeLayer(layer);
    }
    this.markerLayers = [];
  }

  ngOnDestroy(): void {
    this.clearMarkers();
    if (this.map) {
      this.map.remove();
      this.map = null;
    }
  }
}
