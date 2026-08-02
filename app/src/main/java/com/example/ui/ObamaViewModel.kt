package com.example.ui

import android.app.Application
import android.media.AudioManager
import android.media.ToneGenerator
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.example.data.*
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import kotlin.random.Random

class ObamaViewModel(
    application: Application,
    private val repository: ObamaRepository
) : AndroidViewModel(application) {

    // UI state flows
    private val _currentAppRole = MutableStateFlow<String?>(null) // null = Launcher Hub, "CUSTOMER", "DRIVER", "ADMIN"
    val currentAppRole: StateFlow<String?> = _currentAppRole.asStateFlow()

    private val _customerEmail = MutableStateFlow<String?>(null)
    val customerEmail: StateFlow<String?> = _customerEmail.asStateFlow()

    private val _driverEmail = MutableStateFlow<String?>(null)
    val driverEmail: StateFlow<String?> = _driverEmail.asStateFlow()

    private val _adminPassword = MutableStateFlow("admin123")
    val adminPassword: StateFlow<String> = _adminPassword.asStateFlow()

    private val _isAdminLoggedIn = MutableStateFlow(false)
    val isAdminLoggedIn: StateFlow<Boolean> = _isAdminLoggedIn.asStateFlow()

    private val _useSerifFont = MutableStateFlow(false) // false = Arial (SansSerif), true = Times New Roman (Serif)
    val useSerifFont: StateFlow<Boolean> = _useSerifFont.asStateFlow()

    private val _fontScale = MutableStateFlow(1.15f) // default slightly larger (15% larger font size scaling)
    val fontScale: StateFlow<Float> = _fontScale.asStateFlow()

    fun setAppRole(role: String?) {
        _currentAppRole.value = role
        if (role == null) {
            _isAdminLoggedIn.value = false
        }
    }

    fun loginCustomer(email: String) {
        _customerEmail.value = email
        triggerNotification("Customer login berhasil: $email")
    }

    fun logoutCustomer() {
        _customerEmail.value = null
        _currentAppRole.value = null
    }

    fun loginDriver(email: String) {
        _driverEmail.value = email
        triggerNotification("Mitra Driver login berhasil: $email")
    }

    fun logoutDriver() {
        _driverEmail.value = null
        _currentAppRole.value = null
    }

    fun loginAdmin(password: String): Boolean {
        return if (password == _adminPassword.value) {
            _isAdminLoggedIn.value = true
            triggerNotification("Admin login berhasil!")
            true
        } else {
            triggerNotification("Password Admin salah!", isMajor = true)
            false
        }
    }

    fun logoutAdmin() {
        _isAdminLoggedIn.value = false
        _currentAppRole.value = null
    }

    fun changeAdminPassword(old: String, new: String): Boolean {
        return if (old == _adminPassword.value) {
            if (new.length >= 4) {
                _adminPassword.value = new
                triggerNotification("Password Admin berhasil diubah!")
                true
            } else {
                triggerNotification("Password baru minimal 4 karakter!", isMajor = true)
                false
            }
        } else {
            triggerNotification("Password lama salah!", isMajor = true)
            false
        }
    }

    fun toggleFontFamily() {
        _useSerifFont.value = !_useSerifFont.value
        triggerNotification("Font dirubah ke: ${if (_useSerifFont.value) "Serif (Times New Roman)" else "Sans-Serif (Arial)"}")
    }

    fun increaseFontScale() {
        val current = _fontScale.value
        if (current < 1.4f) {
            _fontScale.value = current + 0.05f
        } else {
            _fontScale.value = 1.0f // reset
        }
        triggerNotification("Ukuran font disesuaikan ke: ${(_fontScale.value * 100).toInt()}%")
    }

    val walletState: StateFlow<WalletEntity?> = repository.walletFlow.stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(5000),
        initialValue = null
    )

    val orderState: StateFlow<OrderEntity?> = repository.orderFlow.stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(5000),
        initialValue = null
    )

    val chatState: StateFlow<List<ChatEntity>> = repository.chatFlow.stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(5000),
        initialValue = emptyList()
    )

    val driversState: StateFlow<List<DriverEntity>> = repository.driversFlow.stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(5000),
        initialValue = emptyList()
    )

    // Notification banner
    private val _notification = MutableStateFlow<String?>(null)
    val notification: StateFlow<String?> = _notification.asStateFlow()

    private var animationJob: Job? = null
    private var toneGenerator: ToneGenerator? = null

    init {
        try {
            toneGenerator = ToneGenerator(AudioManager.STREAM_NOTIFICATION, 90)
        } catch (e: Exception) {
            e.printStackTrace()
        }
        
        // Initial setup of database defaults if empty
        viewModelScope.launch {
            val wallet = repository.getWallet()
            val drivers = repository.driversFlow.first()
            if (drivers.isEmpty()) {
                repository.resetAll()
            }
        }
    }

    fun playAlertSound(isMajorEvent: Boolean = false) {
        viewModelScope.launch {
            try {
                if (isMajorEvent) {
                    toneGenerator?.startTone(ToneGenerator.TONE_PROP_ACK, 250)
                    delay(300)
                    toneGenerator?.startTone(ToneGenerator.TONE_PROP_ACK, 250)
                } else {
                    toneGenerator?.startTone(ToneGenerator.TONE_PROP_BEEP, 150)
                }
            } catch (e: Exception) {
                e.printStackTrace()
            }
        }
    }

    fun triggerNotification(message: String, isMajor: Boolean = false) {
        _notification.value = message
        playAlertSound(isMajor)
        viewModelScope.launch {
            delay(5000) // Hide after 5 seconds
            if (_notification.value == message) {
                _notification.value = null
            }
        }
    }

    fun topUpWallet(amount: Double) {
        viewModelScope.launch {
            val current = repository.getWallet()
            val newBalance = current.balance + amount
            repository.updateWalletBalance(newBalance)
            triggerNotification("Top Up OBAMA-Pay Berhasil! +Rp ${formatRupiah(amount)}")
        }
    }

    fun applyPromoCode(code: String, currentPrice: Double): Double {
        val trimmed = code.trim().uppercase()
        return when (trimmed) {
            "OBAMAMURAH" -> {
                if (currentPrice > 1500) 1500.0 else 0.0
            }
            "MALANGBATU" -> {
                if (currentPrice > 2500) 2500.0 else 0.0
            }
            else -> 0.0
        }
    }

    fun createOrder(
        pickup: LocationPoint,
        destination: LocationPoint,
        serviceType: String,
        promoCode: String
    ) {
        viewModelScope.launch {
            val distance = LocationData.calculateDistanceKm(pickup, destination)
            val basePrice = distance * 2000.0
            val discount = applyPromoCode(promoCode, basePrice)
            val finalPrice = (basePrice - discount).coerceAtLeast(0.0)

            val wallet = repository.getWallet()
            if (wallet.balance < finalPrice) {
                triggerNotification("Saldo tidak cukup! Silakan isi saldo OBAMA-Pay Anda.", isMajor = true)
                return@launch
            }

            // Create initial Order
            val initialOrder = OrderEntity(
                pickupName = pickup.name,
                destinationName = destination.name,
                pickupX = pickup.x,
                pickupY = pickup.y,
                destX = destination.x,
                destY = destination.y,
                distanceKm = distance,
                price = basePrice,
                discountApplied = discount,
                finalPrice = finalPrice,
                serviceType = serviceType,
                status = "SEARCHING",
                timestamp = System.currentTimeMillis()
            )
            repository.saveOrder(initialOrder)
            repository.clearChat()
            triggerNotification("Mencari armada OBAMA terdekat...")

            // Simulate Driver Search and Auto-Accept
            delay(2500)
            assignDriverToOrder(serviceType, pickup)
        }
    }

    private suspend fun assignDriverToOrder(serviceType: String, pickup: LocationPoint) {
        val activeDrivers = repository.driversFlow.first()
        val availableDriver = activeDrivers.firstOrNull {
            it.isVerified && it.isOnline && it.vehicleType == serviceType
        } ?: activeDrivers.firstOrNull { it.isVerified && it.isOnline } // Fallback to any online verified driver

        if (availableDriver == null) {
            triggerNotification("Maaf, mitra pengemudi sedang sibuk atau offline. Mohon coba lagi.", isMajor = true)
            repository.clearOrder()
            return
        }

        val currentOrder = repository.getOrder() ?: return

        // Set starting location for driver slightly offset from pickup
        val startX = pickup.x + (Random.nextFloat() * 0.2f - 0.1f)
        val startY = pickup.y + (Random.nextFloat() * 0.2f - 0.1f)

        val acceptedOrder = currentOrder.copy(
            status = "ACCEPTED",
            driverId = availableDriver.id,
            driverName = availableDriver.name,
            driverPhone = availableDriver.phone,
            driverX = startX,
            driverY = startY
        )
        repository.saveOrder(acceptedOrder)
        triggerNotification("Mitra ${availableDriver.name} menerima pesanan Anda!", isMajor = true)

        // Pre-fill some welcome messages
        repository.sendChatMessage("DRIVER", "Halo kak! Saya mitra OBAMA siap menjemput Anda.")
        repository.sendChatMessage("DRIVER", "Mohon tunggu sebentar ya, saya sedang meluncur ke lokasi.")

        // Start movement simulation towards pickup location
        simulateMovementTo(pickup.x, pickup.y, onArrive = {
            viewModelScope.launch {
                val order = repository.getOrder()
                if (order != null && order.status == "ACCEPTED") {
                    repository.saveOrder(order.copy(status = "ARRIVED", driverX = pickup.x, driverY = pickup.y))
                    triggerNotification("Driver telah tiba di titik jemput Anda!", isMajor = true)
                    repository.sendChatMessage("DRIVER", "Saya sudah sampai di titik jemput kak. Mengenakan helm OBAMA hijau emas.")
                }
            }
        })
    }

    fun startTrip() {
        viewModelScope.launch {
            val order = repository.getOrder() ?: return@launch
            if (order.status != "ARRIVED") return@launch

            repository.saveOrder(order.copy(status = "PICKED_UP"))
            triggerNotification("Perjalanan dimulai! Nikmati kenyamanan berkendara bersama OBAMA.", isMajor = false)
            repository.sendChatMessage("DRIVER", "Perjalanan dimulai kak, mohon pegangan erat.")

            // Simulate movement from pickup to destination
            simulateMovementTo(order.destX, order.destY, onArrive = {
                viewModelScope.launch {
                    completeTrip()
                }
            })
        }
    }

    fun driverArrive() {
        viewModelScope.launch {
            val order = repository.getOrder() ?: return@launch
            if (order.status == "ACCEPTED") {
                repository.saveOrder(order.copy(status = "ARRIVED", driverX = order.pickupX, driverY = order.pickupY))
                triggerNotification("Simulasi: Driver tiba di titik jemput!", isMajor = true)
                repository.sendChatMessage("DRIVER", "Saya sudah sampai di lokasi jemput ya kak.")
            }
        }
    }

    fun driverCompleteTrip() {
        viewModelScope.launch {
            val order = repository.getOrder() ?: return@launch
            if (order.status == "PICKED_UP") {
                completeTrip()
            }
        }
    }

    private suspend fun completeTrip() {
        val order = repository.getOrder() ?: return
        if (order.status != "PICKED_UP") return

        // Deduct customer wallet
        val wallet = repository.getWallet()
        val newCustomerBalance = (wallet.balance - order.finalPrice).coerceAtLeast(0.0)
        repository.updateWalletBalance(newCustomerBalance)

        // Credit Driver wallet (90% share, 10% platform fee)
        val driverShare = order.finalPrice * 0.90
        val drivers = repository.driversFlow.first()
        val driver = drivers.find { it.id == order.driverId }
        if (driver != null) {
            val updatedDriver = driver.copy(
                walletBalance = driver.walletBalance + driverShare
            )
            repository.updateDriver(updatedDriver)
        }

        // Complete order
        val completedOrder = order.copy(
            status = "COMPLETED",
            driverX = order.destX,
            driverY = order.destY
        )
        repository.saveOrder(completedOrder)
        triggerNotification("Perjalanan selesai! Terima kasih telah menggunakan OBAMA.", isMajor = true)
        repository.sendChatMessage("DRIVER", "Alhamdulillah, kita sudah sampai di tujuan dengan selamat kak. Terima kasih!")
    }

    private fun simulateMovementTo(targetX: Float, targetY: Float, onArrive: () -> Unit) {
        animationJob?.cancel()
        animationJob = viewModelScope.launch {
            var order = repository.getOrder()
            if (order == null) return@launch

            val steps = 25
            val startX = order.driverX
            val startY = order.driverY

            for (i in 1..steps) {
                delay(300) // update coordinate every 300ms
                order = repository.getOrder()
                if (order == null || (order.status != "ACCEPTED" && order.status != "PICKED_UP")) {
                    break
                }
                val t = i.toFloat() / steps
                val currentX = startX + t * (targetX - startX)
                val currentY = startY + t * (targetY - startY)

                repository.saveOrder(order.copy(driverX = currentX, driverY = currentY))
            }

            if (repository.getOrder()?.status == order?.status) {
                onArrive()
            }
        }
    }

    fun sendCustomerMessage(message: String) {
        if (message.isBlank()) return
        viewModelScope.launch {
            repository.sendChatMessage("CUSTOMER", message)
            // Auto reply from driver for simulation context
            delay(1500)
            val order = repository.getOrder()
            if (order != null && order.status != "NONE" && order.status != "COMPLETED") {
                val responses = listOf(
                    "Oke kak dimengerti!",
                    "Siap kak, sebentar lagi sampai.",
                    "Saya jalan pelan-pelan ya kak.",
                    "Baik kak, sesuai maps ya.",
                    "Aman kak!"
                )
                repository.sendChatMessage("DRIVER", responses[Random.nextInt(responses.size)])
                playAlertSound(false)
            }
        }
    }

    fun clearActiveOrder() {
        viewModelScope.launch {
            repository.clearOrder()
            repository.clearChat()
        }
    }

    fun toggleDriverOnline(driverId: Int, isOnline: Boolean) {
        viewModelScope.launch {
            val drivers = repository.driversFlow.first()
            val driver = drivers.find { it.id == driverId }
            if (driver != null) {
                repository.updateDriver(driver.copy(isOnline = isOnline))
                triggerNotification("${driver.name} sekarang ${if (isOnline) "Online" else "Offline"}")
            }
        }
    }

    fun adminApproveDriver(driverId: Int) {
        viewModelScope.launch {
            repository.verifyDriver(driverId)
            val drivers = repository.driversFlow.first()
            val driver = drivers.find { it.id == driverId }
            if (driver != null) {
                triggerNotification("Mitra ${driver.name} telah diverifikasi!", isMajor = true)
            }
        }
    }

    fun adminRegisterDriver(name: String, phone: String, vehicleType: String, plate: String, isVerified: Boolean) {
        viewModelScope.launch {
            repository.registerDriver(name, phone, vehicleType, plate, isVerified)
            triggerNotification("Driver $name berhasil didaftarkan!")
        }
    }

    fun adminDeleteDriver(driverId: Int) {
        viewModelScope.launch {
            repository.deleteDriver(driverId)
            triggerNotification("Mitra dihapus dari database.")
        }
    }

    fun withdrawDriverEarnings(driverId: Int) {
        viewModelScope.launch {
            val drivers = repository.driversFlow.first()
            val driver = drivers.find { it.id == driverId }
            if (driver != null && driver.walletBalance > 0) {
                val amount = driver.walletBalance
                repository.updateDriver(driver.copy(walletBalance = 0.0))
                triggerNotification("Pencairan dana Rp ${formatRupiah(amount)} berhasil dikirim!", isMajor = true)
            } else {
                triggerNotification("Saldo dompet mitra kosong atau tidak cukup.")
            }
        }
    }

    fun resetAll() {
        animationJob?.cancel()
        _notification.value = null
        viewModelScope.launch {
            repository.resetAll()
            triggerNotification("Aplikasi OBAMA Berhasil Direset!", isMajor = true)
        }
    }

    override fun onCleared() {
        super.onCleared()
        animationJob?.cancel()
        try {
            toneGenerator?.release()
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    fun formatRupiah(amount: Double): String {
        return "%,.0f".format(amount).replace(",", ".")
    }
}

class ObamaViewModelFactory(
    private val application: Application,
    private val repository: ObamaRepository
) : ViewModelProvider.Factory {
    override fun <T : ViewModel> create(modelClass: Class<T>): T {
        if (modelClass.isAssignableFrom(ObamaViewModel::class.java)) {
            @Suppress("UNCHECKED_CAST")
            return ObamaViewModel(application, repository) as T
        }
        throw IllegalArgumentException("Unknown ViewModel class")
    }
}
