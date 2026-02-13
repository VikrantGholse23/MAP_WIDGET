import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map, shareReplay } from 'rxjs';
import * as topojson from 'topojson-client';
import type { FeatureCollection } from 'geojson';

const WORLD_ATLAS_URL = 'https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json';

/** Map survey country names to world-atlas TopoJSON feature property names. */
export const COUNTRY_NAME_TO_GEO: Record<string, string> = {
  USA: 'United States of America',
  UK: 'United Kingdom',
  UAE: 'United Arab Emirates',
  'Czech Republic': 'Czechia',
  'South Korea': 'South Korea',
  Russia: 'Russia',
  Vietnam: 'Vietnam',
  Taiwan: 'Taiwan'
};

/** Get GeoJSON country name from our survey country name. */
export function geoNameForCountry(surveyCountry: string): string {
  return COUNTRY_NAME_TO_GEO[surveyCountry] ?? surveyCountry;
}

@Injectable({
  providedIn: 'root'
})
export class GeoService {
  private geoJson$: Observable<FeatureCollection> | null = null;

  constructor(private readonly http: HttpClient) {}

  getCountriesGeoJson(): Observable<FeatureCollection> {
    if (!this.geoJson$) {
      this.geoJson$ = this.http.get<{ objects: { countries: unknown } }>(WORLD_ATLAS_URL).pipe(
        map((topology) => {
          const countries = topology.objects.countries;
          return (topojson as { feature: (t: unknown, o: unknown) => FeatureCollection }).feature(
            topology,
            countries
          );
        }),
        shareReplay(1)
      );
    }
    return this.geoJson$;
  }
}
