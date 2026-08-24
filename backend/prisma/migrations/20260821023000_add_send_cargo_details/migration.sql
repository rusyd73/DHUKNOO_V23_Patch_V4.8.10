CREATE TYPE "PackageSize" AS ENUM ('SMALL', 'MEDIUM', 'LARGE');
CREATE TYPE "VehicleRequirement" AS ENUM ('AUTO', 'BIKE', 'CAR');

ALTER TABLE "Order"
  ADD COLUMN "itemDescription" TEXT,
  ADD COLUMN "packageSize" "PackageSize",
  ADD COLUMN "estimatedWeightKg" DECIMAL(8,2),
  ADD COLUMN "handlingNotes" TEXT,
  ADD COLUMN "vehicleRequirement" "VehicleRequirement" DEFAULT 'AUTO';
