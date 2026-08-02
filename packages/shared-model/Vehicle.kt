package com.example.data

enum class VehicleType(val displayName: String, val baseFare: Double, val ratePerKm: Double) {
    RIDE("OBAMA-Ride", 4000.0, 2000.0),
    CAR("OBAMA-Car", 8000.0, 3500.0),
    SEND("OBAMA-Send", 6000.0, 2500.0);

    companion object {
        fun fromString(typeStr: String): VehicleType {
            return when (typeStr) {
                "OBAMA-Car" -> CAR
                "OBAMA-Send" -> SEND
                else -> RIDE
            }
        }
    }
}

data class Vehicle(
    val plateNumber: String,
    val type: VehicleType,
    val model: String
)
