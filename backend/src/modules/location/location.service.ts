import { LocationRepository } from "./location.repository";
import { MapProvider } from "./map.provider";
import { SocketService } from "../../websocket/socket";
import { OrderRepository } from "../order/order.repository";
import {
  Coordinate,
  GeofenceRequest,
} from "./map.types";
import {
  NotFoundError,
} from "../../core/errors/AppError";


export class LocationService {

  private locationRepo =
    new LocationRepository();

  private mapProvider =
    new MapProvider();

  private orderRepo =
    new OrderRepository();


  /*
  |--------------------------------------------------------------------------
  | Update Driver Location
  |--------------------------------------------------------------------------
  */

  async updateMyLocation(
    userId: string,
    latitude: number,
    longitude: number,
    isOnline?: boolean
  ) {

    const updated =
      await this.locationRepo.updateDriverLocation(
        userId,
        latitude,
        longitude,
        isOnline
      );


    /*
    |--------------------------------------------------------------------------
    | Realtime Map Broadcast
    |--------------------------------------------------------------------------
    */

    SocketService.emitToRoom(
      "map_updates",
      "location_changed",
      {
        driverId: updated.id,

        latitude,

        longitude,

        timestamp:
          new Date(),
      }
    );


    /*
    |--------------------------------------------------------------------------
    | Driver Private Room
    |--------------------------------------------------------------------------
    */

    SocketService.emitToRoom(
      `driver_${updated.id}`,
      "driver_location_updated",
      {
        latitude,

        longitude,
      }
    );


    /*
    |--------------------------------------------------------------------------
    | Order Room (supaya peta customer bergerak walau belum join room driver_<id>)
    |--------------------------------------------------------------------------
    */

    try {
      const activeOrder = await this.orderRepo.findActiveOrderForDriver(updated.id);
      if (activeOrder) {
        SocketService.emitToOrder(activeOrder.id, "location_changed", {
          driverId: updated.id,
          latitude,
          longitude,
        });
      }
    } catch {
      // Best-effort — kegagalan di sini tidak boleh menggagalkan update lokasi.
    }


    return updated;
  }



  /*
  |--------------------------------------------------------------------------
  | Search Address
  |--------------------------------------------------------------------------
  */

  searchAddress(
    keyword:string
  ){

    return this.mapProvider
      .searchAddress(keyword);

  }



  /*
  |--------------------------------------------------------------------------
  | Reverse Geocode
  |--------------------------------------------------------------------------
  */

  reverseGeocode(
    latitude:number,
    longitude:number
  ){

    return this.mapProvider
      .reverseGeocode(
        latitude,
        longitude
      );

  }



  /*
  |--------------------------------------------------------------------------
  | Calculate Distance
  |--------------------------------------------------------------------------
  */

  calculateDistance(
    origin:Coordinate,
    destination:Coordinate
  ){

    return this.mapProvider
      .calculateDistance(
        origin,
        destination
      );

  }



  /*
  |--------------------------------------------------------------------------
  | Estimate ETA
  |--------------------------------------------------------------------------
  */

  estimateETA(
    distanceMeters:number,
    speed:number
  ){

    return this.mapProvider
      .estimateETA(
        distanceMeters,
        speed
      );

  }



  /*
  |--------------------------------------------------------------------------
  | Route Polyline
  |--------------------------------------------------------------------------
  */

  routePolyline(
    origin:Coordinate,
    destination:Coordinate
  ){

    return this.mapProvider
      .routePolyline(
        origin,
        destination
      );

  }



  /*
  |--------------------------------------------------------------------------
  | Snap To Road
  |--------------------------------------------------------------------------
  */

  snapToRoad(
    coordinate:Coordinate
  ){

    return this.mapProvider
      .snapToRoad(
        coordinate
      );

  }



  /*
  |--------------------------------------------------------------------------
  | Driver Location
  |--------------------------------------------------------------------------
  */

  async getDriverLocation(
    driverId:string
  ){

    const location =
      await this.locationRepo
        .findDriverLocation(
          driverId
        );


    if(!location){

      throw new NotFoundError(
        "Driver tidak ditemukan!"
      );

    }


    return location;

  }



  /*
  |--------------------------------------------------------------------------
  | Online Drivers
  |--------------------------------------------------------------------------
  */

  listOnlineDrivers(){

    return this.locationRepo
      .listOnlineDrivers();

  }



  /*
  |--------------------------------------------------------------------------
  | Nearest Drivers
  |--------------------------------------------------------------------------
  */

  async nearestDrivers(
    coordinate:Coordinate,
    limit:number = 10
  ){

    const drivers =
      await this.locationRepo
        .listOnlineDrivers();


    return drivers
      .map(driver=>{

        const distance =
          this.mapProvider
            .calculateDistance(
              coordinate,
              {
                latitude:
                  Number(driver.latitude),

                longitude:
                  Number(driver.longitude),
              }
            );


        return {

          driverId:
            driver.id,


          latitude:
            driver.latitude,


          longitude:
            driver.longitude,


          distanceMeters:
            distance.distanceMeters,

        };

      })

      .sort(
        (a,b)=>
          a.distanceMeters -
          b.distanceMeters
      )

      .slice(
        0,
        limit
      );

  }



  /*
  |--------------------------------------------------------------------------
  | Geofence
  |--------------------------------------------------------------------------
  */

  geofence(
    request:GeofenceRequest
  ){

    const distance =
      this.mapProvider
        .calculateDistance(
          request.center,
          request.point
        );


    return {

      inside:
        distance.distanceMeters
        <= request.radius,


      radius:
        request.radius,


      distance:
        distance.distanceMeters,

    };

  }

}