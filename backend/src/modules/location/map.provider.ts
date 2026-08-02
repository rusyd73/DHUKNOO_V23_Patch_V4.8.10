import axios from "axios";
import { MAP_CONSTANTS } from "./map.constants";
import {
  Coordinate,
  SearchAddressResult,
  ReverseGeocodeResult,
  DistanceResult,
  ETAResult,
  RoutePolylineResult,
} from "./map.types";

export class MapProvider {
  private http = axios.create({
    timeout: MAP_CONSTANTS.REQUEST_TIMEOUT,
    headers: {
      "User-Agent": "RAVA-RIDE-PLATFORM",
    },
  });

  /*
  |--------------------------------------------------------------------------
  | Search Address
  |--------------------------------------------------------------------------
  */

  async searchAddress(
    keyword: string
  ): Promise<SearchAddressResult[]> {
    const { data } = await this.http.get(
      `${MAP_CONSTANTS.NOMINATIM_URL}/search`,
      {
        params: {
          q: keyword,
          countrycodes: MAP_CONSTANTS.DEFAULT_COUNTRY,
          format: "jsonv2",
          addressdetails: 1,
          limit: MAP_CONSTANTS.DEFAULT_SEARCH_LIMIT,
        },
      }
    );

    return data.map((item: any) => ({
      displayName: item.display_name,

      latitude: Number(item.lat),

      longitude: Number(item.lon),

      city:
        item.address?.city ||
        item.address?.town,

      district:
        item.address?.suburb,

      province:
        item.address?.state,

      postalCode:
        item.address?.postcode,
    }));
  }

  /*
  |--------------------------------------------------------------------------
  | Reverse Geocode
  |--------------------------------------------------------------------------
  */

  async reverseGeocode(
    latitude: number,
    longitude: number
  ): Promise<ReverseGeocodeResult> {
    const { data } = await this.http.get(
      `${MAP_CONSTANTS.NOMINATIM_URL}/reverse`,
      {
        params: {
          lat: latitude,
          lon: longitude,
          format: "jsonv2",
          addressdetails: 1,
        },
      }
    );

    return {
      displayName: data.display_name,

      address: {
        road: data.address?.road,

        houseNumber:
          data.address?.house_number,

        village:
          data.address?.village,

        suburb:
          data.address?.suburb,

        district:
          data.address?.county,

        city:
          data.address?.city,

        regency:
          data.address?.state_district,

        province:
          data.address?.state,

        postalCode:
          data.address?.postcode,

        country:
          data.address?.country,
      },
    };
  }

  /*
  |--------------------------------------------------------------------------
  | Calculate Distance
  |--------------------------------------------------------------------------
  */

  calculateDistance(
    origin: Coordinate,
    destination: Coordinate
  ): DistanceResult {
    const R = 6371000;

    const dLat =
      ((destination.latitude -
        origin.latitude) *
        Math.PI) /
      180;

    const dLon =
      ((destination.longitude -
        origin.longitude) *
        Math.PI) /
      180;

    const a =
      Math.sin(dLat / 2) *
        Math.sin(dLat / 2) +
      Math.cos(
        origin.latitude *
          Math.PI /
          180
      ) *
        Math.cos(
          destination.latitude *
            Math.PI /
            180
        ) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);

    const c =
      2 *
      Math.atan2(
        Math.sqrt(a),
        Math.sqrt(1 - a)
      );

    const distance = R * c;

    return {
      distanceMeters: distance,

      distanceKm:
        Number(
          (distance / 1000).toFixed(2)
        ),
    };
  }

  /*
  |--------------------------------------------------------------------------
  | Estimate ETA
  |--------------------------------------------------------------------------
  */

  estimateETA(
    distanceMeters: number,
    speedKm: number
  ): ETAResult {
    const seconds =
      distanceMeters /
      ((speedKm * 1000) / 3600);

    return {
      distanceMeters,

      distanceKm:
        Number(
          (distanceMeters / 1000).toFixed(
            2
          )
        ),

      durationSeconds:
        Math.round(seconds),

      durationMinutes:
        Math.ceil(seconds / 60),

      estimatedArrival:
        new Date(
          Date.now() +
            seconds * 1000
        ),
    };
  }

  /*
  |--------------------------------------------------------------------------
  | Route Polyline
  |--------------------------------------------------------------------------
  */

  async routePolyline(
    origin: Coordinate,
    destination: Coordinate
  ): Promise<RoutePolylineResult> {
    const { data } =
      await this.http.get(
        `${MAP_CONSTANTS.ROUTING_URL}/route/v1/driving/${origin.longitude},${origin.latitude};${destination.longitude},${destination.latitude}`,
        {
          params: {
            overview: "full",

            geometries:
              "geojson",
          },
        }
      );

    const route =
      data.routes[0];

    return {
      distanceMeters:
        route.distance,

      durationSeconds:
        route.duration,

      geometry:
        JSON.stringify(
          route.geometry
        ),

      coordinates:
        route.geometry.coordinates.map(
          (c: number[]) => ({
            latitude: c[1],

            longitude: c[0],
          })
        ),
    };
  }

  /*
  |--------------------------------------------------------------------------
  | Snap To Road
  |--------------------------------------------------------------------------
  */

  async snapToRoad(
    coordinate: Coordinate
  ): Promise<Coordinate> {
    return coordinate;
  }
}