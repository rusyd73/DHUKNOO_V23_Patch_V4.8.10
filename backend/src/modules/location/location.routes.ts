import { Router } from "express";
import { LocationController } from "./location.controller";

import {
    authenticateToken,
    authorizeRoles,
} from "../../core/middleware/auth.middleware";

import {
    validateBody,
    validateQuery,
} from "../../core/middleware/validation.middleware";

import {
    updateLocationSchema,
    searchAddressSchema,
    reverseGeocodeSchema,
    calculateDistanceSchema,
    estimateEtaSchema,
    routePolylineSchema,
    nearestDriverSchema,
    geofenceSchema,
} from "../../core/validation/schemas";

const router = Router();
const locationController = new LocationController();

/*
|--------------------------------------------------------------------------
| Driver Location
|--------------------------------------------------------------------------
*/

router.patch(
    "/driver",
    authenticateToken as any,
    authorizeRoles("DRIVER") as any,
    validateBody(updateLocationSchema),
    locationController.updateMine as any
);

router.get(
    "/driver/:driverId",
    authenticateToken as any,
    locationController.getForDriver as any
);

router.get(
    "/drivers/online",
    authenticateToken as any,
    authorizeRoles("ADMIN") as any,
    locationController.listOnline as any
);

/*
|--------------------------------------------------------------------------
| Map Engine
|--------------------------------------------------------------------------
*/

/**
 * GET /location/search?query=...
 */
router.get(
    "/search",
    authenticateToken as any,
    validateQuery(searchAddressSchema),
    locationController.searchAddress as any
);

/**
 * GET /location/reverse?latitude=...&longitude=...
 */
router.get(
    "/reverse",
    authenticateToken as any,
    validateQuery(reverseGeocodeSchema),
    locationController.reverseGeocode as any
);

/**
 * POST /location/distance
 */
router.post(
    "/distance",
    authenticateToken as any,
    validateBody(calculateDistanceSchema),
    locationController.calculateDistance as any
);

/**
 * POST /location/eta
 */
router.post(
    "/eta",
    authenticateToken as any,
    validateBody(estimateEtaSchema),
    locationController.estimateETA as any
);

/**
 * POST /location/polyline
 */
router.post(
    "/polyline",
    authenticateToken as any,
    validateBody(routePolylineSchema),
    locationController.routePolyline as any
);

/**
 * POST /location/nearest
 *
 * Internal Dispatch Engine
 */
router.post(
    "/nearest",
    authenticateToken as any,
    validateBody(nearestDriverSchema),
    locationController.nearestDrivers as any
);

/**
 * POST /location/geofence
 *
 * Internal Dispatch Engine
 */
router.post(
    "/geofence",
    authenticateToken as any,
    validateBody(geofenceSchema),
    locationController.geofence as any
);

export const locationRouter = router;