/*
|--------------------------------------------------------------------------
| Common Coordinate
|--------------------------------------------------------------------------
*/

export interface Coordinate {
  latitude: number;
  longitude: number;
}

/*
|--------------------------------------------------------------------------
| Search Address
|--------------------------------------------------------------------------
*/

export interface SearchAddressResult {
  displayName: string;
  latitude: number;
  longitude: number;
  city?: string;
  district?: string;
  province?: string;
  postalCode?: string;
}

/*
|--------------------------------------------------------------------------
| Reverse Geocode
|--------------------------------------------------------------------------
*/

export interface ReverseGeocodeResult {
  displayName: string;
  address: {
    road?: string;
    houseNumber?: string;
    village?: string;
    suburb?: string;
    district?: string;
    city?: string;
    regency?: string;
    province?: string;
    postalCode?: string;
    country?: string;
  };
}

/*
|--------------------------------------------------------------------------
| Distance
|--------------------------------------------------------------------------
*/

export interface DistanceResult {
  distanceMeters: number;
  distanceKm: number;
}

/*
|--------------------------------------------------------------------------
| ETA
|--------------------------------------------------------------------------
*/

export interface ETAResult {
  distanceMeters: number;
  distanceKm: number;

  durationSeconds: number;

  durationMinutes: number;

  estimatedArrival: Date;
}

/*
|--------------------------------------------------------------------------
| Route Polyline
|--------------------------------------------------------------------------
*/

export interface RoutePolylineResult {
  distanceMeters: number;

  durationSeconds: number;

  geometry: string;

  coordinates: Coordinate[];
}

/*
|--------------------------------------------------------------------------
| Snap To Road
|--------------------------------------------------------------------------
*/

export interface SnapToRoadResult {
  original: Coordinate;

  snapped: Coordinate;

  distance: number;
}

/*
|--------------------------------------------------------------------------
| Nearest Driver
|--------------------------------------------------------------------------
*/

export interface NearestDriverResult {
  driverId: string;

  latitude: number;

  longitude: number;

  distanceMeters: number;

  etaMinutes: number;
}

/*
|--------------------------------------------------------------------------
| Geofence
|--------------------------------------------------------------------------
*/

export interface GeofenceResult {
  inside: boolean;

  radius: number;

  distance: number;
}

/*
|--------------------------------------------------------------------------
| Route Request
|--------------------------------------------------------------------------
*/

export interface RouteRequest {
  origin: Coordinate;

  destination: Coordinate;
}

/*
|--------------------------------------------------------------------------
| Geofence Request
|--------------------------------------------------------------------------
*/

export interface GeofenceRequest {
  center: Coordinate;

  point: Coordinate;

  radius: number;
}