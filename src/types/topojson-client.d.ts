declare module 'topojson-client' {
  export function feature(topology: unknown, object: unknown): import('geojson').FeatureCollection;
}
