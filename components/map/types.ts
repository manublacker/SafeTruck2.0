export interface Coordinate {
  latitude: number;
  longitude: number;
}

export interface StreetSegment {
  id: string;
  coordinates: Coordinate[];
  habilitada: boolean;
  partido?: string;
  motivo?: string;
}

export interface RouteResponse {
  route: Coordinate[];
  segments: StreetSegment[];
  startsOnRestrictedStreet?: boolean;
}

export type ReportType = 'multa' | 'control' | 'obra' | 'accidente';

export interface CollaborativeReport {
  id: string;
  type: ReportType;
  coordinate: Coordinate;
  description?: string;
  reportedAt?: string;
  segmentId?: string;
}

export interface TruckProfile {
  patente: string;
  pesoKg: number;
  alturaM: number;
  anchoM: number;
  largoM: number;
}
