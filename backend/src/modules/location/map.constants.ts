/**
|-------------------------------------------------------------------------- 
| Map Provider Configuration
|--------------------------------------------------------------------------
|
| Seluruh konfigurasi provider peta dipusatkan di sini agar tidak ada
| hardcode URL maupun parameter di Service atau Controller.
|
*/

export const MAP_CONSTANTS = {

  /**
   * Active Provider
   */
  PROVIDER: "OSM_OSRM",


  /**
   * OpenStreetMap Nominatim
   */
  NOMINATIM_URL:
    "https://nominatim.openstreetmap.org",


  /**
   * Routing (OSRM)
   */
  ROUTING_URL:
    "https://router.project-osrm.org",


  /**
   * Default Search
   */
  DEFAULT_COUNTRY:
    "id",

  DEFAULT_LANGUAGE:
    "id",

  DEFAULT_SEARCH_LIMIT:
    10,


  /**
   * Driver Search Radius
   */
  DEFAULT_RADIUS:
    5000,


  /**
   * Average Speed
   */
  BIKE_SPEED_KMH:
    35,

  CAR_SPEED_KMH:
    45,

  WALK_SPEED_KMH:
    5,

  DEFAULT_SPEED_KMH:
    40,


  /**
   * Request timeout
   */
  REQUEST_TIMEOUT:
    10000,


  /**
   * Geofence
   */
  DEFAULT_GEOFENCE_RADIUS:
    100,


} as const;