// types/route.ts — contratos de API compartidos entre frontend y backend

export interface Coordinates {
  lat: number;
  lon: number;
}

export interface VehicleProfile {
  maxWeightKg: number;
  maxHeightM:  number;
  maxWidthM:   number;
  maxLengthM:  number;
}

export interface RoutingOptions {
  avoidTolls:     boolean;
  preferHighways: boolean;
}

/** Cuerpo del POST /api/routes */
export interface RouteRequest {
  originLabel:      string;
  destinationLabel: string;
  origin:           Coordinates;
  destination:      Coordinates;
  vehicle:          VehicleProfile;
  routingOptions:   RoutingOptions;
}

/** Cada nodo del path devuelto */
export interface RouteNode {
  nodeId: string;
  lat:    number;
  lon:    number;
  label:  string;
}

/** Respuesta del POST /api/routes */
export interface RouteResponse {
  found:                boolean;
  routeId:              string | null;
  originLabel:          string;
  destinationLabel:     string;
  distanceM:            number;
  estimatedDurationMin: number;
  routeSummary:         string;
  path:                 RouteNode[];
  warnings:             string[];
}

/** Respuesta del GET /api/health */
export interface HealthResponse {
  status:  string;
  service: string;
}

/** Resultado de búsqueda de calle (GET /api/search) */
export interface SearchResult {
  nombre:         string;
  nombreOriginal: string;
  lat:            number;
  lon:            number;
  score:          string;
}
