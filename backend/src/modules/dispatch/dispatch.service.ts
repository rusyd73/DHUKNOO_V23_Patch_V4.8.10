import { SocketService } from "../../websocket/socket";

import { LocationService } from "../location/location.service";

import { MAP_CONSTANTS } from "../location/map.constants";

import { DispatchRepository } from "./dispatch.repository";

import { DispatchScheduler } from "./dispatch.scheduler";

import { DispatchState } from "./dispatch.state";

import { DispatchLock } from "./dispatch.lock";

import { DISPATCH_CONSTANTS } from "./dispatch.constants";

import { prisma } from "../../config/prisma";
import { logger } from "../../config/logger";

import {
  DispatchCandidate,
  DispatchRequest,
  DispatchResult,
} from "./dispatch.types";


export class DispatchService {


  private repository =
    new DispatchRepository();


  private locationService =
    new LocationService();




  /*
  |--------------------------------------------------------------------------
  | Start Dispatch
  |--------------------------------------------------------------------------
  */

  async dispatch(

    request: DispatchRequest

  ): Promise<DispatchResult> {


    const orderId =
      request.order.id;



    /*
    |--------------------------------------------------------------------------
    | Prevent duplicate dispatch
    |--------------------------------------------------------------------------
    */

    const locked =
      DispatchLock.acquire(
        orderId
      );


    if (!locked) {


      return {

        orderId,

        totalDrivers: 0,

        currentDriverId:
          DispatchState.current(orderId)
            ?.driverId,


        status:
          "ALREADY_DISPATCHING",


        candidates: [],

      };

    }



    try {


      logger.info(`[DISPATCH] Mulai dispatch order ${orderId} (serviceType=${request.order.serviceType})`);

      /*
      |--------------------------------------------------------------------------
      | Find nearest drivers
      |--------------------------------------------------------------------------
      */


      const nearestDrivers =

        await this.locationService.nearestDrivers(

          {

            latitude:
              request.order.pickupLat,


            longitude:
              request.order.pickupLng,


          },


          DISPATCH_CONSTANTS.MAX_CANDIDATES

        );


      logger.info(`[DISPATCH] order ${orderId}: ${nearestDrivers.length} driver online terdekat ditemukan (belum difilter isVerified/klasifikasi/freeze)`);


      /*
      |--------------------------------------------------------------------------
      | Available driver filter
      |--------------------------------------------------------------------------
      */


      const availableDrivers =

        await this.repository.getAvailableDrivers();


      logger.info(`[DISPATCH] order ${orderId}: ${availableDrivers.length} driver lolos getAvailableDrivers (online+verified+lat/lng+bebas freeze CASH)`);




      const availableMap =

        new Map(

          availableDrivers.map(

            driver => [

              driver.id,

              driver

            ]

          )

        );





      const candidates: DispatchCandidate[] =


        nearestDrivers

          .filter(

            driver =>

              availableMap.has(
                driver.driverId
              )

          )

          // KUNCI KLASIFIKASI: hanya tawarkan order ke driver dengan
          // serviceType YANG SAMA (BIKE order -> driver BIKE saja, dst).
          // Sebelumnya semua driver online ditawari order apa pun tanpa
          // pengecekan jenis layanan sama sekali.
          //
          // PENGECUALIAN: order layanan SEND (kirim barang) TIDAK memakai
          // klasifikasi -- siapa saja driver yang online/aktif (toggle ON)
          // berhak menerima publikasi order SEND, terlepas dari serviceType
          // profil driver tsb (BIKE/CAR/SEND semua bisa dapat tawaran SEND).
          .filter(

            driver => {
              if (request.order.serviceType === "SEND") {
                return true;
              }

              const profile = availableMap.get(driver.driverId);
              return profile && (profile as any).serviceType === request.order.serviceType;
            }

          )


          .map(

            driver => {


              const profile =

                availableMap.get(
                  driver.driverId
                )!;



              return {


                driverId:
                  profile.id,


                userId:
                  profile.userId,


                latitude:
                  Number(profile.latitude),


                longitude:
                  Number(profile.longitude),


                distanceMeters:
                  driver.distanceMeters,



                etaMinutes:
                  Math.ceil(

                    driver.distanceMeters /

                    (

                      MAP_CONSTANTS.BIKE_SPEED_KMH *
                      1000 /
                      60

                    )

                  ),

                autoAcceptEnabled:
                  Boolean((profile as any).autoAcceptEnabled),

              };


            }

          );





      /*
      |--------------------------------------------------------------------------
      | Create Dispatch Session
      |--------------------------------------------------------------------------
      */


      logger.info(`[DISPATCH] order ${orderId}: ${candidates.length} kandidat FINAL setelah filter jarak+klasifikasi (serviceType=${request.order.serviceType}) -- ${candidates.length === 0 ? 'TIDAK ADA kandidat, dispatch akan berhenti di sini!' : candidates.map(c => `${c.driverId}(autoAccept=${c.autoAcceptEnabled})`).join(', ')}`);

      DispatchState.create(

        orderId,

        candidates.map(

          driver =>
            driver.driverId

        )

      );





      /*
      |--------------------------------------------------------------------------
      | Offer Driver
      |--------------------------------------------------------------------------
      */


      await this.offerNextDriver(

        request,

        candidates

      );





      return {


        orderId,


        totalDrivers:
          candidates.length,



        currentDriverId:

          DispatchState.current(orderId)
            ?.driverId,



        status:

          candidates.length > 0

            ? "DISPATCHING"

            : "NO_DRIVER",



        candidates,


      };



    }

    finally {


      DispatchLock.release(

        orderId

      );


    }


  }






  /*
  |--------------------------------------------------------------------------
  | Sequential Driver Offer
  |--------------------------------------------------------------------------
  */

  private async offerNextDriver(

    request: DispatchRequest,

    candidates: DispatchCandidate[]

  ) {



    const orderId =
      request.order.id;




    const current =

      DispatchState.current(

        orderId

      );





    /*
    |--------------------------------------------------------------------------
    | No driver available
    |--------------------------------------------------------------------------
    */


    if (!current) {

      // PERBAIKAN: request.order.customerId adalah ID CustomerProfile, BUKAN
      // ID User — SocketService.emitToUser() butuh User.id (room `user_<id>`
      // yang di-auto-join tiap socket saat connect). Mengirim ke customerId
      // berarti notifikasi "tidak ada driver ditemukan" ini TIDAK PERNAH
      // sampai ke siapa pun, karena tidak ada socket yang join room itu.
      const customerProfile = await prisma.customerProfile.findUnique({
        where: { id: request.order.customerId },
        select: { userId: true },
      });

      if (customerProfile) {
        SocketService.emitToUser(
          customerProfile.userId,
          DISPATCH_CONSTANTS.ORDER_EXPIRED_EVENT,
          { orderId }
        );
      }

      SocketService.emitToAdmins(DISPATCH_CONSTANTS.ORDER_EXPIRED_EVENT, { orderId });

      return;

    }





    const driver =

      candidates.find(

        candidate =>

          candidate.driverId ===
          current.driverId

      );





    if (!driver) {


      DispatchState.next(

        orderId

      );


      return this.offerNextDriver(

        request,

        candidates

      );

    }



    if (driver.autoAcceptEnabled) {

      logger.info(`[DISPATCH] order ${orderId}: driver ${driver.driverId} punya autoAcceptEnabled=true, mencoba acceptOffer otomatis...`);

      try {

        await this.acceptOffer(orderId, driver.driverId);
        logger.info(`[DISPATCH] order ${orderId}: AUTO-ACCEPT BERHASIL oleh driver ${driver.driverId}`);
        return; // Sudah diterima otomatis -- tidak perlu lanjut ke offer manual.

      } catch (err: any) {

        // Race condition (mis. order sudah diambil driver lain di jalur manual
        // sesaat sebelum auto-accept ini sempat jalan) -- lanjut ke kandidat
        // berikutnya seperti biasa, JANGAN gagalkan seluruh proses dispatch.
        //
        // PERBAIKAN: sebelumnya error di sini DIBUANG TOTAL TANPA LOG --
        // kalau acceptOffer gagal karena BUKAN race condition (mis. bug),
        // tidak ada jejak sama sekali kenapa "auto accept gagal".
        logger.error(`[DISPATCH] order ${orderId}: auto-accept driver ${driver.driverId} GAGAL: ${err?.message || err} -- lanjut ke kandidat berikutnya.`);
        DispatchState.next(orderId);
        return this.offerNextDriver(request, candidates);

      }

    }





    /*
    |--------------------------------------------------------------------------
    | Emit offer
    |--------------------------------------------------------------------------
    */


    SocketService.emitToUser(

      driver.userId,


      DISPATCH_CONSTANTS.NEW_ORDER_EVENT,


      {


        orderId,


        serviceType:
          request.order.serviceType,


        pickupAddress:
          request.order.pickupAddress,


        dropoffAddress:
          request.order.dropoffAddress,


        pickupLat:
          request.order.pickupLat,


        pickupLng:
          request.order.pickupLng,


        dropoffLat:
          request.order.dropoffLat,


        dropoffLng:
          request.order.dropoffLng,


        distanceKm:
          request.order.distanceKm,


        price:
          request.order.price,


        etaMinutes:
          driver.etaMinutes,


        distanceMeters:
          driver.distanceMeters,


      }

    );





    /*
    |--------------------------------------------------------------------------
    | Offer Timeout
    |--------------------------------------------------------------------------
    */


    DispatchScheduler.start(

      orderId,


      DISPATCH_CONSTANTS.OFFER_TIMEOUT_SECONDS,


      async()=>{


        if (

          DispatchState.hasAccepted(

            orderId

          )

        ) {

          return;

        }



        DispatchState.next(

          orderId

        );



        await this.offerNextDriver(

          request,

          candidates

        );


      }

    );


  }






  /*
  |--------------------------------------------------------------------------
  | Accept Driver Offer
  |--------------------------------------------------------------------------
  */

  async acceptOffer(

    orderId:string,

    driverId:string

  ){



    const current =

      DispatchState.current(

        orderId

      );




    if(!current){


      throw new Error(
        "Dispatch session tidak ditemukan"
      );


    }





    if(

      current.driverId !== driverId

    ){


      throw new Error(
        "Driver bukan penerima offer aktif"
      );


    }





    const locked =

      DispatchLock.acquire(

        orderId

      );



    if(!locked){


      throw new Error(
        "Order sedang diproses"
      );


    }





    try {



      DispatchState.accept(

        orderId,

        driverId

      );




      DispatchScheduler.cancel(

        orderId

      );




      const order =

        await this.repository.assignDriver(

          orderId,

          driverId

        );




      DispatchState.clear(

        orderId

      );

      // Realtime: sebelumnya jalur acceptOffer ini (penerimaan offer sequential
      // dispatch, bukan job pool manual) TIDAK PERNAH memberi tahu customer
      // sama sekali bahwa driver sudah menerima order — celah diam-diam yang
      // membalikkan tujuan utama Dispatch Engine ini sendiri.
      try {
        const driverProfile = await this.repository.getDriver(driverId);
        SocketService.emitToOrder(orderId, "order_status_changed", {
          orderId,
          status: (order as any).status,
          driverId,
        });
        SocketService.emitToUser((order as any).customer.userId, "order_accepted", {
          orderId,
          driverId,
        });
        if (driverProfile?.userId) {
          SocketService.emitToUser(driverProfile.userId, DISPATCH_CONSTANTS.ORDER_ACCEPTED_EVENT, { orderId });
        }
        SocketService.emitToDriversPool("order_taken", { orderId });
        SocketService.emitToAdmins("order_accepted", { orderId });
      } catch {
        // Socket.IO belum siap — abaikan, order tetap berhasil di-assign.
      }




      return order;



    }

    finally {


      DispatchLock.release(

        orderId

      );


    }


  }






  /*
  |--------------------------------------------------------------------------
  | Dispatch Status
  |--------------------------------------------------------------------------
  */

  getStatus(

    orderId:string

  ){


    const current =

      DispatchState.current(

        orderId

      );



    return {


      orderId,


      currentDriverId:

        current?.driverId ?? null,



      hasActiveSession:

        DispatchState.exists(

          orderId

        )


    };


  }



}
