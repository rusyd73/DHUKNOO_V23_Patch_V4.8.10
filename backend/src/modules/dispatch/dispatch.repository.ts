import { prisma } from "../../config/prisma";
import type { DriverPickupCompensationSnapshot } from "../driver/services/driver-pickup-compensation.service";


export class DispatchRepository {


  /*
  |--------------------------------------------------------------------------
  | Available Drivers
  |--------------------------------------------------------------------------
  */


  async getAvailableDrivers() {


    return prisma.driverProfile.findMany({


      where:{


        isOnline:true,


        isVerified:true,


        latitude:{
          not:null,
        },


        longitude:{
          not:null,
        },

        // BEKUKAN driver dari publikasi order baru selama settlement order
        // sebelumnya masih menggantung. CASH menunggu konfirmasi driver;
        // QRIS/TRANSFER/EWALLET menunggu upload + approval bukti bayar customer.
        orders: {
          none: {
            status: 'COMPLETED',
            isPaid: false,
            paymentMethod: { in: ['CASH', 'QRIS', 'TRANSFER', 'EWALLET'] },
          },
        },


      },


      select:{


        id:true,


        userId:true,


        latitude:true,


        longitude:true,


        vehicleModel:true,


        vehiclePlate:true,

        // PERBAIKAN: serviceType & autoAcceptEnabled sebelumnya TIDAK
        // di-select sama sekali di sini, padahal DispatchService memakai
        // kedua field ini (profile.serviceType utk filter klasifikasi &
        // profile.autoAcceptEnabled utk jalur auto-accept). Akibatnya
        // kedua field selalu undefined -> filter klasifikasi selalu
        // gagal (order tidak pernah cocok) dan toggle auto-accept driver
        // tidak pernah terbaca (auto-accept tidak pernah jalan meski
        // toggle driver ON).
        serviceType:true,

        autoAcceptEnabled:true,


      },


    });


  }





  /*
  |--------------------------------------------------------------------------
  | Driver By Id
  |--------------------------------------------------------------------------
  */


  async getDriver(

    driverId:string

  ){


    return prisma.driverProfile.findUnique({


      where:{

        id:driverId,

      },


      select:{


        id:true,


        userId:true,


        isOnline:true,


        isVerified:true,


        latitude:true,


        longitude:true,


        vehicleModel:true,


        vehiclePlate:true,


        user:{

          select:{

            fullName:true,

          },

        },


      },


    });


  }





  /*
  |--------------------------------------------------------------------------
  | Order Availability
  |--------------------------------------------------------------------------
  |
  | Dipakai sebelum offer driver.
  |
  */


  async isOrderAvailable(

    orderId:string

  ){


    const order =

      await prisma.order.findUnique({


        where:{

          id:orderId,

        },


        select:{


          status:true,


          driverId:true,


        },


      });




    if(!order){


      return false;


    }





    return (

      (

        order.status === "PENDING"

      )

      &&

      order.driverId === null

    );


  }

async assignDriver(

  orderId:string,

  driverId:string,

  pickupCompensationSnapshot?: DriverPickupCompensationSnapshot

){

  // FIX7: claim order + snapshot kompensasi driver->pickup berada dalam
  // SATU transaksi. Jika snapshot pricing gagal, claim ikut rollback.
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`
      WITH driver_lock AS MATERIALIZED (
        SELECT pg_advisory_xact_lock(hashtext(${driverId}))
      )
      SELECT 1::INTEGER AS locked FROM driver_lock
    `;
    const activeOrder = await tx.order.findFirst({
      where: {
        driverId,
        status: { in: ["ACCEPTED", "ON_THE_WAY", "ARRIVED", "PICKED_UP", "ARRIVED_CUSTOMER"] },
      },
      select: { id: true },
    });
    if (activeOrder) {
      throw new Error("Driver sudah memiliki order aktif.");
    }

    const result = await tx.order.updateMany({
      where: {
        id: orderId,
        status: "PENDING",
        driverId: null,
        createdAt: { gt: new Date(Date.now() - 30 * 60 * 1000) },
      },
      data:{
        driverId,
        status: "ACCEPTED",
        acceptedAt: new Date(),
      },
    });

    if (result.count === 0) {
      throw new Error("Order sudah diambil pihak lain sebelum assignDriver sempat jalan (race condition).");
    }

    if (pickupCompensationSnapshot) {
      const pricing = await tx.pricingHistory.findUnique({ where: { orderId } });
      const currentBreakdown = pricing?.breakdown && typeof pricing.breakdown === 'object'
        ? (pricing.breakdown as Record<string, unknown>)
        : {};

      await tx.pricingHistory.upsert({
        where: { orderId },
        create: { orderId, tariffVersionId: null, breakdown: pickupCompensationSnapshot as any },
        update: { breakdown: { ...currentBreakdown, ...pickupCompensationSnapshot } as any },
      });
    }

    return tx.order.findUniqueOrThrow({
      where: { id: orderId },
      include: {
        customer: true,
        merchant: { select: { ownerId: true } },
      },
    });
  });

}

}
