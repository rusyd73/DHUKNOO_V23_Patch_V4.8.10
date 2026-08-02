import { Response } from "express";
import { AuthenticatedRequest } from "../../core/middleware/auth.middleware";
import { LocationService } from "./location.service";
import { AppError } from "../../core/errors/AppError";
import { logger } from "../../config/logger";


export class LocationController {

  private locationService =
    new LocationService();



  /*
  |--------------------------------------------------------------------------
  | Driver Update Location
  |--------------------------------------------------------------------------
  */

  updateMine = async (
    req: AuthenticatedRequest,
    res: Response
  ) => {

    try {

      const userId =
        req.user!.id;


      const {
        latitude,
        longitude,
        isOnline
      } = req.body;


      const updated =
        await this.locationService
          .updateMyLocation(
            userId,
            latitude,
            longitude,
            isOnline
          );


      return res.status(200).json({
        message:
          "Lokasi berhasil diperbarui!",
        driver:
          updated,
      });


    } catch(err:any){

      logger.error(
        "LocationController.updateMine error: %s",
        err.message
      );


      const status =
        err instanceof AppError
        ? err.statusCode
        : 500;


      return res.status(status)
        .json({
          error:
            err.message ||
            "Gagal memperbarui lokasi."
        });

    }

  };



  /*
  |--------------------------------------------------------------------------
  | Search Address
  |--------------------------------------------------------------------------
  */

  searchAddress = async(
    req:AuthenticatedRequest,
    res:Response
  )=>{

    try{

      const keyword =
        String(req.query.keyword);


      const result =
        await this.locationService
          .searchAddress(keyword);


      return res.json(result);


    }catch(err:any){

      return this.error(
        res,
        err
      );

    }

  };



  /*
  |--------------------------------------------------------------------------
  | Reverse Geocode
  |--------------------------------------------------------------------------
  */

  reverseGeocode = async(
    req:AuthenticatedRequest,
    res:Response
  )=>{

    try{

      const latitude =
        Number(req.query.latitude);

      const longitude =
        Number(req.query.longitude);


      const result =
        await this.locationService
          .reverseGeocode(
            latitude,
            longitude
          );


      return res.json(result);


    }catch(err:any){

      return this.error(
        res,
        err
      );

    }

  };



  /*
  |--------------------------------------------------------------------------
  | Distance
  |--------------------------------------------------------------------------
  */

  calculateDistance = async(
    req:AuthenticatedRequest,
    res:Response
  )=>{

    try{

      const result =
        await this.locationService
          .calculateDistance(
            req.body.origin,
            req.body.destination
          );


      return res.json(result);


    }catch(err:any){

      return this.error(
        res,
        err
      );

    }

  };



  /*
  |--------------------------------------------------------------------------
  | ETA
  |--------------------------------------------------------------------------
  */

  estimateETA = async(
    req:AuthenticatedRequest,
    res:Response
  )=>{

    try{

      const result =
        await this.locationService
          .estimateETA(
            req.body.distanceMeters,
            req.body.speedKm
          );


      return res.json(result);


    }catch(err:any){

      return this.error(
        res,
        err
      );

    }

  };



  /*
  |--------------------------------------------------------------------------
  | Route Polyline
  |--------------------------------------------------------------------------
  */

  routePolyline = async(
    req:AuthenticatedRequest,
    res:Response
  )=>{

    try{

      const result =
        await this.locationService
          .routePolyline(
            req.body.origin,
            req.body.destination
          );


      return res.json(result);


    }catch(err:any){

      return this.error(
        res,
        err
      );

    }

  };



  /*
  |--------------------------------------------------------------------------
  | Nearest Drivers
  |--------------------------------------------------------------------------
  */

  nearestDrivers = async(
    req:AuthenticatedRequest,
    res:Response
  )=>{

    try{


      const result =
        await this.locationService
          .nearestDrivers(
            {
              latitude:
                req.body.latitude,

              longitude:
                req.body.longitude,
            },

            req.body.limit
          );


      return res.json(result);


    }catch(err:any){

      return this.error(
        res,
        err
      );

    }

  };



  /*
  |--------------------------------------------------------------------------
  | Geofence
  |--------------------------------------------------------------------------
  */

  geofence = async(
    req:AuthenticatedRequest,
    res:Response
  )=>{

    try{


      const result =
        await this.locationService
          .geofence(
            req.body
          );


      return res.json(result);


    }catch(err:any){

      return this.error(
        res,
        err
      );

    }

  };



  /*
  |--------------------------------------------------------------------------
  | Get Driver Location
  |--------------------------------------------------------------------------
  */

  getForDriver = async(
    req:AuthenticatedRequest,
    res:Response
  )=>{

    try{

      const location =
        await this.locationService
          .getDriverLocation(
            req.params.driverId
          );


      return res.json({
        location
      });


    }catch(err:any){

      return this.error(
        res,
        err
      );

    }

  };



  /*
  |--------------------------------------------------------------------------
  | Online Drivers
  |--------------------------------------------------------------------------
  */

  listOnline = async(
    _req:AuthenticatedRequest,
    res:Response
  )=>{

    try{

      const drivers =
        await this.locationService
          .listOnlineDrivers();


      return res.json({
        drivers
      });


    }catch(err:any){

      return this.error(
        res,
        err
      );

    }

  };



  /*
  |--------------------------------------------------------------------------
  | Error Handler
  |--------------------------------------------------------------------------
  */

  private error(
    res:Response,
    err:any
  ){

    logger.error(
      "LocationController error: %s",
      err.message
    );


    const status =
      err instanceof AppError
      ? err.statusCode
      : 500;


    return res
      .status(status)
      .json({
        error:
          err.message ||
          "Location error"
      });

  }


}