export const DISPATCH_CONSTANTS = {

  /*
  |--------------------------------------------------------------------------
  | Driver Dispatch
  |--------------------------------------------------------------------------
  */

  MAX_CANDIDATES: 10,

  OFFER_TIMEOUT_SECONDS: 20,

  MAX_RETRY: 10,

  /*
  |--------------------------------------------------------------------------
  | Socket Events
  |--------------------------------------------------------------------------
  |
  | PERBAIKAN: nilai-nilai ini sebelumnya UPPERCASE ("NEW_ORDER_AVAILABLE",
  | "ORDER_ACCEPTED", dst), padahal SEMUA listener di frontend memakai
  | lowercase snake_case ("new_order_available", "order_accepted", dst).
  | Event Socket.IO itu case-sensitive exact-match -- akibatnya publikasi
  | order sequential-dispatch (emit dari sini) TIDAK PERNAH sampai ke
  | listener frontend sama sekali, jadi notifikasi ring/toast driver tidak
  | pernah berbunyi untuk jalur dispatch offer per-driver ini.
  */

  NEW_ORDER_EVENT: "new_order_available",

  ORDER_ACCEPTED_EVENT: "order_accepted",

  ORDER_REJECTED_EVENT: "order_rejected",

  ORDER_TIMEOUT_EVENT: "order_timeout",

  ORDER_EXPIRED_EVENT: "order_expired",

  ORDER_CANCELLED_EVENT: "order_cancelled",

} as const;