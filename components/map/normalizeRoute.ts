import { Coordinate } from './types';

type GeoJSONLineString = {
  type: 'LineString';
  coordinates: [number, number][];
};

type BackendCoordinate = { lat: number; lng: number } | { latitude: number; longitude: number };

export function normalizeCoordinates(
  input: BackendCoordinate[] | GeoJSONLineString
): Coordinate[] {
  if (!Array.isArray(input) && input.type === 'LineString') {
    return input.coordinates.map(([lng, lat]) => ({
      latitude: lat,
      longitude: lng,
    }));
  }

  if (Array.isArray(input)) {
    return input.map((point) => {
      if ('latitude' in point) {
        return { latitude: point.latitude, longitude: point.longitude };
      }
      return { latitude: point.lat, longitude: point.lng };
    });
  }

  return [];
}
