package com.example.data

enum class UserRole {
    CUSTOMER, DRIVER, ADMIN
}

data class SharedUser(
    val id: String,
    val email: String,
    val name: String,
    val role: UserRole,
    val phoneNumber: String? = null,
    val isVerified: Boolean = false
)

data class Customer(
    val id: String,
    val email: String,
    val name: String,
    val phoneNumber: String? = null,
    val hasAppInstalled: Boolean = true
)
