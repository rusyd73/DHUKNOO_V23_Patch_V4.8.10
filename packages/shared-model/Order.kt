package com.example.data

import androidx.room.Entity
import androidx.room.PrimaryKey
import kotlin.math.sqrt

@Entity(tableName = "active_order")
data class OrderEntity(
    @PrimaryKey val id: Int = 1,
    val pickupName: String = "",
    val destinationName: String = "",
    val pickupX: Float = 0f,
    val pickupY: Float = 0f,
    val destX: Float = 0f,
    val destY: Float = 0f,
    val distanceKm: Double = 0.0,
    val price: Double = 0.0,
    val discountApplied: Double = 0.0,
    val finalPrice: Double = 0.0,
    val serviceType: String = "", // "OBAMA-Ride", "OBAMA-Car", "OBAMA-Send"
    val status: String = "NONE", // "NONE", "SEARCHING", "ACCEPTED", "ARRIVED", "PICKED_UP", "COMPLETED"
    val driverId: Int = 0,
    val driverName: String = "",
    val driverPhone: String = "",
    val driverX: Float = 0f,
    val driverY: Float = 0f,
    val timestamp: Long = 0L
)

@Entity(tableName = "chat_messages")
data class ChatEntity(
    @PrimaryKey(autoGenerate = true) val id: Int = 0,
    val sender: String, // "CUSTOMER" or "DRIVER"
    val message: String,
    val timestamp: Long = System.currentTimeMillis()
)

data class LocationPoint(
    val name: String,
    val description: String,
    val x: Float, // Normalized coordinates (0.0 to 1.0) on canvas
    val y: Float
)

object LocationData {
    val locations = listOf(
        LocationPoint(
            name = "Alun-Alun Batu",
            description = "Pusat Kota Batu, sejuk & ramai kuliner",
            x = 0.15f,
            y = 0.22f
        ),
        LocationPoint(
            name = "Museum Angkut",
            description = "Destinasi wisata koleksi transportasi Batu",
            x = 0.12f,
            y = 0.40f
        ),
        LocationPoint(
            name = "Jatim Park 3",
            description = "Taman bermain dinosaurus & teknologi Batu",
            x = 0.32f,
            y = 0.48f
        ),
        LocationPoint(
            name = "Universitas Brawijaya (UB)",
            description = "Kampus pusat mahasiswa di Kota Malang",
            x = 0.58f,
            y = 0.55f
        ),
        LocationPoint(
            name = "Jl. Soekarno-Hatta (Suhat)",
            description = "Pusat kuliner dan kafe hits mahasiswa Malang",
            x = 0.62f,
            y = 0.35f
        ),
        LocationPoint(
            name = "Stasiun Malang Baru",
            description = "Gerbang utama kedatangan kereta api Malang",
            x = 0.82f,
            y = 0.68f
        ),
        LocationPoint(
            name = "Alun-Alun Malang",
            description = "Pusat sejarah Kota Malang, masjid jamik & burung",
            x = 0.76f,
            y = 0.82f
        )
    )

    fun getByName(name: String): LocationPoint? {
        return locations.find { it.name.equals(name, ignoreCase = true) }
    }

    /**
     * Calculates distance in kilometers between two points using Euclidean distance
     * scaled by a factor of 22 km (realistic Malang-Batu distance is ~15-20 km)
     */
    fun calculateDistanceKm(p1: LocationPoint, p2: LocationPoint): Double {
        val dx = p1.x - p2.x
        val dy = p1.y - p2.y
        val dist = sqrt((dx * dx + dy * dy).toDouble())
        return Math.round(dist * 25.0 * 10.0) / 10.0 // 1 decimal place
    }
}
