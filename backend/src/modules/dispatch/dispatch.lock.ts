export class DispatchLock {

  private static locks =
    new Set<string>();


  /*
  |--------------------------------------------------------------------------
  | Acquire
  |--------------------------------------------------------------------------
  */

  static acquire(
    orderId: string
  ): boolean {

    if (this.locks.has(orderId)) {

      return false;

    }

    this.locks.add(orderId);

    return true;

  }


  /*
  |--------------------------------------------------------------------------
  | Release
  |--------------------------------------------------------------------------
  */

  static release(
    orderId: string
  ) {

    this.locks.delete(orderId);

  }


  /*
  |--------------------------------------------------------------------------
  | Locked
  |--------------------------------------------------------------------------
  */

  static isLocked(
    orderId: string
  ): boolean {

    return this.locks.has(orderId);

  }


  /*
  |--------------------------------------------------------------------------
  | Clear
  |--------------------------------------------------------------------------
  */

  static clear() {

    this.locks.clear();

  }

}