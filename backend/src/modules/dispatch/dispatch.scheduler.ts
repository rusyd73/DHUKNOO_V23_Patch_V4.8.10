export class DispatchScheduler {

  private static timers =
    new Map<string, NodeJS.Timeout>();


  /*
  |--------------------------------------------------------------------------
  | Start
  |--------------------------------------------------------------------------
  */

  static start(

    orderId: string,

    timeoutSeconds: number,

    onExpired: () => Promise<void>

  ) {

    this.cancel(orderId);

    const timer =
      setTimeout(

        async () => {

          this.timers.delete(orderId);

          await onExpired();

        },

        timeoutSeconds * 1000

      );

    this.timers.set(

      orderId,

      timer

    );

  }


  /*
  |--------------------------------------------------------------------------
  | Cancel
  |--------------------------------------------------------------------------
  */

  static cancel(

    orderId: string

  ) {

    const timer =
      this.timers.get(orderId);

    if (!timer) {

      return;

    }

    clearTimeout(timer);

    this.timers.delete(orderId);

  }


  /*
  |--------------------------------------------------------------------------
  | Running
  |--------------------------------------------------------------------------
  */

  static isRunning(

    orderId: string

  ): boolean {

    return this.timers.has(orderId);

  }


  /*
  |--------------------------------------------------------------------------
  | Clear
  |--------------------------------------------------------------------------
  */

  static clear() {

    this.timers.forEach(

      timer => clearTimeout(timer)

    );

    this.timers.clear();

  }

}