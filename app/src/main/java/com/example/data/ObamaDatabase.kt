package com.example.data

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase

@Database(
    entities = [WalletEntity::class, OrderEntity::class, ChatEntity::class, DriverEntity::class],
    version = 1,
    exportSchema = false
)
abstract class ObamaDatabase : RoomDatabase() {
    abstract fun obamaDao(): ObamaDao

    companion object {
        @Volatile
        private var INSTANCE: ObamaDatabase? = null

        fun getDatabase(context: Context): ObamaDatabase {
            return INSTANCE ?: synchronized(this) {
                val instance = Room.databaseBuilder(
                    context.applicationContext,
                    ObamaDatabase::class.java,
                    "obama_database"
                )
                .fallbackToDestructiveMigration()
                .build()
                INSTANCE = instance
                instance
            }
        }
    }
}
