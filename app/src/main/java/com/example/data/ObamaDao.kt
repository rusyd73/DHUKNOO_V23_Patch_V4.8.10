package com.example.data

import androidx.room.*
import kotlinx.coroutines.flow.Flow

@Dao
interface ObamaDao {
    // Wallet queries
    @Query("SELECT * FROM wallet WHERE id = 1 LIMIT 1")
    fun getWalletFlow(): Flow<WalletEntity?>

    @Query("SELECT * FROM wallet WHERE id = 1 LIMIT 1")
    suspend fun getWallet(): WalletEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertWallet(wallet: WalletEntity)

    // Order queries
    @Query("SELECT * FROM active_order WHERE id = 1 LIMIT 1")
    fun getOrderFlow(): Flow<OrderEntity?>

    @Query("SELECT * FROM active_order WHERE id = 1 LIMIT 1")
    suspend fun getOrder(): OrderEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertOrder(order: OrderEntity)

    @Query("DELETE FROM active_order")
    suspend fun deleteOrder()

    // Chat queries
    @Query("SELECT * FROM chat_messages ORDER BY timestamp ASC")
    fun getChatFlow(): Flow<List<ChatEntity>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertChatMessage(message: ChatEntity)

    @Query("DELETE FROM chat_messages")
    suspend fun clearChat()

    // Driver queries
    @Query("SELECT * FROM drivers ORDER BY id DESC")
    fun getDriversFlow(): Flow<List<DriverEntity>>

    @Query("SELECT * FROM drivers WHERE id = :id LIMIT 1")
    suspend fun getDriverById(id: Int): DriverEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertDriver(driver: DriverEntity)

    @Update
    suspend fun updateDriver(driver: DriverEntity)

    @Query("DELETE FROM drivers WHERE id = :id")
    suspend fun deleteDriverById(id: Int)

    @Query("DELETE FROM drivers")
    suspend fun deleteAllDrivers()
}
