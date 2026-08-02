package com.example.data

import androidx.room.Entity
import androidx.room.PrimaryKey
import kotlinx.coroutines.flow.Flow

@Entity(tableName = "drivers")
data class DriverEntity(
    @PrimaryKey(autoGenerate = true) val id: Int = 0,
    val name: String,
    val phone: String,
    val vehicleType: String, // "OBAMA-Ride" (Bike), "OBAMA-Car" (Car), "OBAMA-Send" (Cargo/Box)
    val vehiclePlate: String,
    val isVerified: Boolean = false, // false = pending Admin approval, true = verified
    val isOnline: Boolean = true,
    val walletBalance: Double = 0.0
)

class ObamaRepository(private val obamaDao: ObamaDao) {

    // Flows
    val walletFlow: Flow<WalletEntity?> = obamaDao.getWalletFlow()
    val orderFlow: Flow<OrderEntity?> = obamaDao.getOrderFlow()
    val chatFlow: Flow<List<ChatEntity>> = obamaDao.getChatFlow()
    val driversFlow: Flow<List<DriverEntity>> = obamaDao.getDriversFlow()

    // Wallet Operations
    suspend fun getWallet(): WalletEntity {
        return obamaDao.getWallet() ?: WalletEntity().also {
            obamaDao.insertWallet(it)
        }
    }

    suspend fun updateWalletBalance(balance: Double) {
        obamaDao.insertWallet(WalletEntity(balance = balance))
    }

    // Order Operations
    suspend fun getOrder(): OrderEntity? = obamaDao.getOrder()

    suspend fun saveOrder(order: OrderEntity) {
        obamaDao.insertOrder(order)
    }

    suspend fun clearOrder() {
        obamaDao.deleteOrder()
    }

    // Chat Operations
    suspend fun sendChatMessage(sender: String, message: String) {
        obamaDao.insertChatMessage(ChatEntity(sender = sender, message = message))
    }

    suspend fun clearChat() {
        obamaDao.clearChat()
    }

    // Driver Operations
    suspend fun registerDriver(name: String, phone: String, vehicleType: String, plate: String, isVerified: Boolean = false) {
        val driver = DriverEntity(
            name = name,
            phone = phone,
            vehicleType = vehicleType,
            vehiclePlate = plate,
            isVerified = isVerified,
            isOnline = true,
            walletBalance = 0.0
        )
        obamaDao.insertDriver(driver)
    }

    suspend fun updateDriver(driver: DriverEntity) {
        obamaDao.updateDriver(driver)
    }

    suspend fun verifyDriver(driverId: Int) {
        val driver = obamaDao.getDriverById(driverId)
        if (driver != null) {
            obamaDao.updateDriver(driver.copy(isVerified = true))
        }
    }

    suspend fun deleteDriver(driverId: Int) {
        obamaDao.deleteDriverById(driverId)
    }

    // Global reset
    suspend fun resetAll() {
        obamaDao.deleteOrder()
        obamaDao.clearChat()
        obamaDao.deleteAllDrivers()
        obamaDao.insertWallet(WalletEntity()) // Reset to 50000.0

        // Populate default drivers (verified and pending)
        registerDriver(
            name = "Slamet Ojek",
            phone = "081234567890",
            vehicleType = "OBAMA-Ride",
            plate = "N 1234 AB",
            isVerified = true
        )
        registerDriver(
            name = "Pak Bambang (Car)",
            phone = "082345678901",
            vehicleType = "OBAMA-Car",
            plate = "N 5678 CD",
            isVerified = true
        )
        registerDriver(
            name = "Mas Agus (Kurir)",
            phone = "083456789012",
            vehicleType = "OBAMA-Send",
            plate = "N 9012 EF",
            isVerified = true
        )
        // Add one pending driver for admin verification demo!
        registerDriver(
            name = "Cak Lontong",
            phone = "084567890123",
            vehicleType = "OBAMA-Ride",
            plate = "N 3456 GH",
            isVerified = false
        )
    }
}
