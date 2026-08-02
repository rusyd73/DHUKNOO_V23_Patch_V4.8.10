interface OfferState {

  driverId:string;

  accepted:boolean;

}



interface DispatchSession {

  currentIndex:number;

  offers:OfferState[];

}



export class DispatchState {


  private static sessions =
    new Map<string,DispatchSession>();





  /*
  |--------------------------------------------------------------------------
  | Create
  |--------------------------------------------------------------------------
  */


  static create(

    orderId:string,

    driverIds:string[]

  ){


    if(
      this.sessions.has(orderId)
    ){

      return;

    }



    this.sessions.set(

      orderId,

      {


        currentIndex:0,


        offers:

          driverIds.map(

            driverId=>({

              driverId,

              accepted:false,

            })

          )

      }

    );


  }





  /*
  |--------------------------------------------------------------------------
  | Current Driver
  |--------------------------------------------------------------------------
  */


  static current(

    orderId:string

  ){


    const session =
      this.sessions.get(orderId);



    if(!session){

      return null;

    }



    return (

      session.offers[
        session.currentIndex
      ]

      ??

      null

    );


  }





  /*
  |--------------------------------------------------------------------------
  | Next Driver
  |--------------------------------------------------------------------------
  */


  static next(

    orderId:string

  ){


    const session =
      this.sessions.get(orderId);



    if(!session){

      return null;

    }



    if(

      session.currentIndex >=

      session.offers.length - 1

    ){

      return null;

    }



    session.currentIndex++;



    return session.offers[
      session.currentIndex
    ] ?? null;


  }





  /*
  |--------------------------------------------------------------------------
  | Accept
  |--------------------------------------------------------------------------
  */


  static accept(

    orderId:string,

    driverId:string

  ){


    const session =
      this.sessions.get(orderId);



    if(!session){

      return false;

    }



    const offer =

      session.offers.find(

        item =>

          item.driverId === driverId

      );



    if(!offer){

      return false;

    }



    offer.accepted=true;


    return true;


  }





  /*
  |--------------------------------------------------------------------------
  | Accepted
  |--------------------------------------------------------------------------
  */


  static hasAccepted(

    orderId:string

  ):boolean{


    const session =
      this.sessions.get(orderId);



    if(!session){

      return false;

    }



    return session.offers.some(

      offer =>

        offer.accepted

    );


  }





  /*
  |--------------------------------------------------------------------------
  | Clear
  |--------------------------------------------------------------------------
  */


  static clear(

    orderId:string

  ){


    this.sessions.delete(
      orderId
    );


  }





  /*
  |--------------------------------------------------------------------------
  | Exists
  |--------------------------------------------------------------------------
  */


  static exists(

    orderId:string

  ){


    return this.sessions.has(
      orderId
    );


  }


}