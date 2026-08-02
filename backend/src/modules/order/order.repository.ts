import { Prisma, OrderStatus } from '@prisma/client';
import { prisma } from '../../config/prisma';


export class OrderRepository {


  /*
  |--------------------------------------------------------------------------
  | CUSTOMER
  |--------------------------------------------------------------------------
  */


  findCustomerProfileByUserId(userId: string) {

    return prisma.customerProfile.findUnique({

      where: {
        userId
      }

    });

  }




  /*
  |--------------------------------------------------------------------------
  | DRIVER
  |--------------------------------------------------------------------------
  */


  findDriverProfileByUserId(userId: string) {

    return prisma.driverProfile.findUnique({

      where: {
        userId
      }

    });

  }





  /*
  |--------------------------------------------------------------------------
  | FIND DETAIL
  |--------------------------------------------------------------------------
  */


  findById(id: string) {

    return prisma.order.findUnique({

      where: {
        id
      },


      include: {

        driver: {

          include: {

            user: {

              select: {

                fullName: true,
                email: true

              }

            }

          }

        },


        customer: {

          include: {

            user: {

              select: {

                fullName: true,
                email: true

              }

            }

          }

        },


        pricingHistory: true

      }

    });

  }





  /*
  |--------------------------------------------------------------------------
  | CREATE ORDER
  |--------------------------------------------------------------------------
  |
  | Transaction aware.
  | Dipakai oleh OrderService.
  |
  */


  async create(

    data: Prisma.OrderCreateInput,

    tx?: Prisma.TransactionClient

  ) {


    const db = tx ?? prisma;


    return db.order.create({

      data

    });

  }





  /*
  |--------------------------------------------------------------------------
  | CUSTOMER ORDER LIST
  |--------------------------------------------------------------------------
  */


  listForCustomer(customerId: string) {


    return prisma.order.findMany({

      where: {

        customerId

      },


      include: {

        driver: {

          include: {

            user: {

              select: {

                fullName: true,
                email: true

              }

            }

          }

        }

      },


      orderBy: {

        createdAt: 'desc'

      }

    });

  }





  /*
  |--------------------------------------------------------------------------
  | DRIVER ORDER LIST
  |--------------------------------------------------------------------------
  */


  listForDriver(driverId: string) {


    return prisma.order.findMany({

      where: {

        driverId

      },


      orderBy: {

        createdAt: 'desc'

      }

    });

  }





  /*
  |--------------------------------------------------------------------------
  | AVAILABLE ORDER FOR DRIVER
  |--------------------------------------------------------------------------
  |
  | Dipakai driver app.
  |
  */


  listAvailableAndAssignedToDriver(
    driverId: string
  ) {


    return prisma.order.findMany({

      where: {

        OR: [

          {
            status: OrderStatus.PENDING
          },


          {
            driverId
          }

        ]

      },


      include: {

        customer: {

          include: {

            user: {

              select: {

                fullName:true,
                email:true

              }

            }

          }

        }

      },


      orderBy: {

        createdAt:'desc'

      }

    });

  }





  /*
  |--------------------------------------------------------------------------
  | ASSIGN DRIVER
  |--------------------------------------------------------------------------
  |
  | Dipanggil Dispatch Engine setelah matching.
  |
  */


  assignDriver(

    orderId:string,

    driverId:string,

    tx?: Prisma.TransactionClient

  ) {


    const db = tx ?? prisma;


    return db.order.update({

      where: {

        id: orderId

      },


      data: {

        driverId,


        status:
          OrderStatus.ACCEPTED

      }

    });

  }





  /*
  |--------------------------------------------------------------------------
  | UPDATE STATUS
  |--------------------------------------------------------------------------
  */


  updateStatus(

    orderId:string,

    status:OrderStatus,

    tx?: Prisma.TransactionClient

  ) {


    const db = tx ?? prisma;


    return db.order.update({

      where: {

        id:orderId

      },


      data: {

        status

      }

    });

  }





  /*
  |--------------------------------------------------------------------------
  | DRIVER ACCEPT VALIDATION
  |--------------------------------------------------------------------------
  |
  | Mencegah race condition.
  |
  */


  async claimOrder(

    orderId:string,

    driverId:string

  ) {


    return prisma.order.updateMany({

      where: {

        id: orderId,


        status:
          OrderStatus.PENDING,


        driverId:null

      },


      data: {

        driverId,


        status:
          OrderStatus.ACCEPTED

      }

    });

  }


  /*
  |--------------------------------------------------------------------------
  | ACTIVE ORDER FOR DRIVER
  |--------------------------------------------------------------------------
  |
  | Dipakai LocationService untuk menyiarkan lokasi driver langsung ke room
  | order_<id> yang sedang ia kerjakan, tanpa customer perlu join manual.
  |
  */

  findActiveOrderForDriver(driverProfileId: string) {

    return prisma.order.findFirst({

      where: {
        driverId: driverProfileId,
        status: { in: [OrderStatus.ACCEPTED, OrderStatus.ON_THE_WAY, OrderStatus.ARRIVED] },
      },

      select: { id: true },

    });

  }

}