package com.example.data

enum class PaymentStatus {
    PENDING, SUCCESS, FAILED
}

enum class PaymentMethod {
    WALLET, CASH
}

data class PaymentTransaction(
    val id: String,
    val amount: Double,
    val method: PaymentMethod,
    val status: PaymentStatus,
    val timestamp: Long = System.currentTimeMillis()
)
