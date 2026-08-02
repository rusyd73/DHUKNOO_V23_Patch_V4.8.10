import { prisma } from "../../config/prisma";


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

        // BEKUKAN driver dari publikasi order baru selama ada order CASH yang
        // sudah COMPLETED tapi BELUM dikonfirmasi diterima (isPaid masih false).
        // Tanpa ini driver bisa terus menumpuk order baru padahal belum
        // menyetorkan/mengkonfirmasi uang tunai dari order sebelumnya.
        orders: {
          none: {
            status: 'COMPLETED',
            paymentMethod: 'CASH',
            isPaid: false,
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

  driverId:string

){


  // PERBAIKAN: sebelumnya ini `prisma.order.update` TANPA PENJAGA SAMA
  // SEKALI (`where: { id: orderId }` saja) -- order APAPUN statusnya akan
  // ditimpa jadi ACCEPTED milik driver ini, bahkan kalau order itu SUDAH
  // diambil driver lain lebih dulu (race condition) atau sudah dibatalkan.
  // Sekarang pakai `updateMany` dengan penjaga status:PENDING & driverId:null
  // (pola yang sama seperti OrderRepository.claimOrder), supaya kalau count
  // hasilnya 0 berarti order sudah "diambil" pihak lain -- pemanggil
  // (DispatchService.acceptOffer) akan menangkap ini sebagai race dan
  // lanjut ke kandidat berikutnya, BUKAN diam-diam menimpa data driver lain.
  const result = await prisma.order.updateMany({

    where: {
      id: orderId,
      status: "PENDING",
      driverId: null,
    },

    data:{


      driverId,


      status:
        "ACCEPTED",

      acceptedAt:
        new Date()


    },

  });

  if (result.count === 0) {
    throw new Error("Order sudah diambil pihak lain sebelum assignDriver sempat jalan (race condition).");
  }

  // PENTING: relasi customer disertakan supaya pemanggil (DispatchService.acceptOffer)
  // bisa mengambil customer.userId yang BENAR untuk notifikasi realtime — order.customerId
  // saja adalah ID CustomerProfile, BUKAN ID User yang dipakai room socket `user_<id>`.
  return prisma.order.findUniqueOrThrow({
    where: { id: orderId },
    include: {
      customer: true,
    },
  });

}

}