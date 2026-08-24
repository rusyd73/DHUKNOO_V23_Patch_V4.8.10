-- MART trip lifecycle: distinguish merchant arrival from customer arrival.
-- Existing OrderStatus values are preserved; new values are append-only enum additions.
ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'PICKED_UP';
ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'ARRIVED_CUSTOMER';
