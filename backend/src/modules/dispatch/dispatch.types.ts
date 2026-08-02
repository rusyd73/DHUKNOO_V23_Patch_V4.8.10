import { Order } from "@prisma/client";


/*
|--------------------------------------------------------------------------
| Dispatch Request
|--------------------------------------------------------------------------
|
| Input utama dispatch engine.
| Order sudah harus tersimpan di database.
|
*/

export interface DispatchRequest {

  order: Order;

}





/*
|--------------------------------------------------------------------------
| Driver Candidate
|--------------------------------------------------------------------------
|
| Hasil filtering location + availability.
|
*/

export interface DispatchCandidate {


  driverId: string;


  userId: string;


  latitude: number;


  longitude: number;


  distanceMeters: number;


  etaMinutes: number;


  autoAcceptEnabled: boolean;


}





/*
|--------------------------------------------------------------------------
| Dispatch Result
|--------------------------------------------------------------------------
|
| Response internal dispatch engine.
|
*/

export interface DispatchResult {


  orderId: string;


  totalDrivers: number;


  currentDriverId?: string;



  status:

    | "DISPATCHING"

    | "ACCEPTED"

    | "EXPIRED"

    | "NO_DRIVER"

    | "ALREADY_DISPATCHING";



  candidates: DispatchCandidate[];

}