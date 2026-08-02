package com.example.ui.screens

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.example.data.*
import com.example.ui.ObamaViewModel
import com.example.ui.theme.*

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DriverScreen(
    viewModel: ObamaViewModel,
    modifier: Modifier = Modifier
) {
    val drivers by viewModel.driversState.collectAsState()
    val activeOrder by viewModel.orderState.collectAsState()
    val chatMessages by viewModel.chatState.collectAsState()

    // Filter verified drivers
    val verifiedDrivers = drivers.filter { it.isVerified }

    var selectedDriverId by remember { mutableStateOf<Int?>(null) }

    // Initialize selection to first verified driver if not set
    if (selectedDriverId == null && verifiedDrivers.isNotEmpty()) {
        selectedDriverId = verifiedDrivers.first().id
    }

    val activeDriver = verifiedDrivers.find { it.id == selectedDriverId }
    var chatInput by remember { mutableStateOf("") }
    val focusManager = LocalFocusManager.current

    LazyColumn(
        modifier = modifier
            .fillMaxSize()
            .background(EmeraldDarkBg)
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        // 1. SELECT DRIVER SIMULATOR PROFILE
        item {
            Card(
                colors = CardDefaults.cardColors(containerColor = EmeraldSurface),
                shape = RoundedCornerShape(16.dp),
                border = BorderStroke(1.dp, EmeraldSurfaceLight),
                modifier = Modifier.fillMaxWidth()
            ) {
                Column(modifier = Modifier.padding(16.dp)) {
                    Text(
                        text = "Pilih Profil Mitra Driver (Simulator)",
                        color = GoldenWarm,
                        fontSize = 14.sp,
                        fontWeight = FontWeight.Bold,
                        modifier = Modifier.padding(bottom = 8.dp)
                    )

                    if (verifiedDrivers.isEmpty()) {
                        Text("Tidak ada driver terverifikasi. Silakan daftarkan driver di tab Admin.", color = ColorError, fontSize = 12.sp)
                    } else {
                        var expanded by remember { mutableStateOf(false) }
                        Box(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clip(RoundedCornerShape(8.dp))
                                .background(EmeraldDarkBg)
                                .border(1.dp, EmeraldSurfaceLight, RoundedCornerShape(8.dp))
                                .clickable { expanded = true }
                                .padding(12.dp)
                        ) {
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    Text(
                                        text = if (activeDriver?.vehicleType == "OBAMA-Ride") "🛵" else if (activeDriver?.vehicleType == "OBAMA-Car") "🚗" else "📦",
                                        fontSize = 20.sp
                                    )
                                    Spacer(modifier = Modifier.width(8.dp))
                                    Column {
                                        Text(activeDriver?.name ?: "Pilih Driver", color = TextLight, fontSize = 13.sp, fontWeight = FontWeight.Bold)
                                        Text("${activeDriver?.vehicleType} • ${activeDriver?.vehiclePlate}", color = TextMuted, fontSize = 10.sp)
                                    }
                                }
                                Icon(Icons.Default.ArrowDropDown, contentDescription = null, tint = TextMuted)
                            }

                            DropdownMenu(
                                expanded = expanded,
                                onDismissRequest = { expanded = false },
                                modifier = Modifier
                                    .fillMaxWidth(0.85f)
                                    .background(EmeraldSurface)
                                    .border(1.dp, EmeraldSurfaceLight)
                            ) {
                                verifiedDrivers.forEach { d ->
                                    DropdownMenuItem(
                                        text = {
                                            Row(verticalAlignment = Alignment.CenterVertically) {
                                                Text(if (d.vehicleType == "OBAMA-Ride") "🛵" else if (d.vehicleType == "OBAMA-Car") "🚗" else "📦", fontSize = 18.sp)
                                                Spacer(modifier = Modifier.width(8.dp))
                                                Column {
                                                    Text(d.name, color = TextLight, fontWeight = FontWeight.Bold, fontSize = 12.sp)
                                                    Text("${d.vehicleType} • ${d.vehiclePlate}", color = TextMuted, fontSize = 10.sp)
                                                }
                                            }
                                        },
                                        onClick = {
                                            selectedDriverId = d.id
                                            expanded = false
                                        }
                                    )
                                }
                            }
                        }
                    }
                }
            }
        }

        if (activeDriver != null) {
            // 2. DRIVER STATUS & EARNINGS CARD
            item {
                Card(
                    colors = CardDefaults.cardColors(containerColor = EmeraldSurface),
                    shape = RoundedCornerShape(16.dp),
                    border = BorderStroke(1.dp, EmeraldSurfaceLight),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Column(modifier = Modifier.padding(16.dp)) {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Column {
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    Box(
                                        modifier = Modifier
                                            .size(8.dp)
                                            .background(if (activeDriver.isOnline) BatuGreen else TextMuted, CircleShape)
                                    )
                                    Spacer(modifier = Modifier.width(6.dp))
                                    Text(
                                        text = if (activeDriver.isOnline) "ONLINE" else "OFFLINE",
                                        color = if (activeDriver.isOnline) BatuGreen else TextMuted,
                                        fontSize = 12.sp,
                                        fontWeight = FontWeight.Bold
                                    )
                                }
                                Text("Status Kerja", color = TextMuted, fontSize = 10.sp)
                            }

                            Switch(
                                checked = activeDriver.isOnline,
                                onCheckedChange = { isOnline ->
                                    viewModel.toggleDriverOnline(activeDriver.id, isOnline)
                                },
                                colors = SwitchDefaults.colors(
                                    checkedThumbColor = TextDark,
                                    checkedTrackColor = BatuGreen,
                                    uncheckedThumbColor = TextMuted,
                                    uncheckedTrackColor = EmeraldDarkBg
                                ),
                                modifier = Modifier.testTag("driver_online_toggle")
                            )
                        }

                        Spacer(modifier = Modifier.height(14.dp))
                        Divider(color = EmeraldSurfaceLight)
                        Spacer(modifier = Modifier.height(14.dp))

                        // Wallet Earnings Display
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Column {
                                Text("Dompet Pendapatan (90% Share)", color = TextMuted, fontSize = 10.sp)
                                Text(
                                    text = "Rp ${viewModel.formatRupiah(activeDriver.walletBalance)}",
                                    color = GoldenWarm,
                                    fontSize = 22.sp,
                                    fontWeight = FontWeight.ExtraBold,
                                    modifier = Modifier.testTag("driver_earnings_text")
                                )
                            }

                            Button(
                                onClick = { viewModel.withdrawDriverEarnings(activeDriver.id) },
                                colors = ButtonDefaults.buttonColors(containerColor = GoldenWarm),
                                shape = RoundedCornerShape(8.dp),
                                enabled = activeDriver.walletBalance > 0,
                                modifier = Modifier.testTag("withdraw_button")
                            ) {
                                Icon(Icons.Default.AccountBalanceWallet, contentDescription = null, tint = TextDark, modifier = Modifier.size(16.dp))
                                Spacer(modifier = Modifier.width(4.dp))
                                Text("Withdraw", color = TextDark, fontWeight = FontWeight.Bold, fontSize = 11.sp)
                            }
                        }
                    }
                }
            }

            // 3. ASSIGNED ACTIVE ORDER PANEL
            val isOrderForThisDriver = activeOrder != null && activeOrder?.driverId == activeDriver.id && activeOrder?.status != "NONE" && activeOrder?.status != "COMPLETED"

            if (isOrderForThisDriver) {
                val order = activeOrder!!
                item {
                    Card(
                        colors = CardDefaults.cardColors(containerColor = EmeraldSurface),
                        shape = RoundedCornerShape(16.dp),
                        border = BorderStroke(1.5.dp, GoldenWarm),
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Column(modifier = Modifier.padding(16.dp)) {
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Text(
                                    text = "Pesanan Aktif Diterima",
                                    color = GoldenWarm,
                                    fontSize = 14.sp,
                                    fontWeight = FontWeight.Bold
                                )
                                Box(
                                    modifier = Modifier
                                        .clip(RoundedCornerShape(4.dp))
                                        .background(BatuGreen.copy(alpha = 0.2f))
                                        .padding(horizontal = 6.dp, vertical = 2.dp)
                                ) {
                                    Text(order.serviceType, color = BatuGreenLight, fontSize = 10.sp, fontWeight = FontWeight.Bold)
                                }
                            }

                            Spacer(modifier = Modifier.height(12.dp))

                            // Route Details
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Icon(Icons.Default.TripOrigin, contentDescription = null, tint = BatuGreen, modifier = Modifier.size(14.dp))
                                Spacer(modifier = Modifier.width(6.dp))
                                Column {
                                    Text("JEMPUT", color = TextMuted, fontSize = 8.sp)
                                    Text(order.pickupName, color = TextLight, fontSize = 12.sp, fontWeight = FontWeight.Bold)
                                }
                            }
                            Spacer(modifier = Modifier.height(8.dp))
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Icon(Icons.Default.LocationOn, contentDescription = null, tint = GoldenWarm, modifier = Modifier.size(14.dp))
                                Spacer(modifier = Modifier.width(6.dp))
                                Column {
                                    Text("TUJUAN", color = TextMuted, fontSize = 8.sp)
                                    Text(order.destinationName, color = TextLight, fontSize = 12.sp, fontWeight = FontWeight.Bold)
                                }
                            }

                            Spacer(modifier = Modifier.height(12.dp))
                            Divider(color = EmeraldSurfaceLight)
                            Spacer(modifier = Modifier.height(12.dp))

                            // Income detail
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Column {
                                    Text("Pendapatan Bersih (90%)", color = TextMuted, fontSize = 10.sp)
                                    Text("Rp ${viewModel.formatRupiah(order.finalPrice * 0.9)}", color = BatuGreenLight, fontSize = 14.sp, fontWeight = FontWeight.Bold)
                                }

                                Text("Jarak: ${String.format("%.1f", order.distanceKm)} Km", color = TextLight, fontSize = 12.sp)
                            }

                            Spacer(modifier = Modifier.height(16.dp))

                            // SIMULATION STEPS ACTION BUTTONS
                            Text("Simulasi Perjalanan:", color = TextMuted, fontSize = 11.sp, modifier = Modifier.padding(bottom = 6.dp))

                            when (order.status) {
                                "ACCEPTED" -> {
                                    // Normally auto moves, but allow skip/force arrive
                                    Button(
                                        onClick = { viewModel.driverArrive() },
                                        colors = ButtonDefaults.buttonColors(containerColor = GoldenWarm),
                                        shape = RoundedCornerShape(10.dp),
                                        modifier = Modifier
                                            .fillMaxWidth()
                                            .height(44.dp)
                                            .testTag("driver_arrive_button")
                                    ) {
                                        Text("Tiba di Titik Jemput", color = TextDark, fontWeight = FontWeight.Bold)
                                    }
                                }
                                "ARRIVED" -> {
                                    Button(
                                        onClick = { viewModel.startTrip() },
                                        colors = ButtonDefaults.buttonColors(containerColor = BatuGreen),
                                        shape = RoundedCornerShape(10.dp),
                                        modifier = Modifier
                                            .fillMaxWidth()
                                            .height(44.dp)
                                            .testTag("driver_start_trip_button")
                                    ) {
                                        Text("Angkut Penumpang (Mulai Perjalanan)", color = TextDark, fontWeight = FontWeight.Bold)
                                    }
                                }
                                "PICKED_UP" -> {
                                    // Auto movement or manual trigger to complete
                                    Button(
                                        onClick = { viewModel.driverCompleteTrip() },
                                        colors = ButtonDefaults.buttonColors(containerColor = BatuGreen),
                                        shape = RoundedCornerShape(10.dp),
                                        modifier = Modifier
                                            .fillMaxWidth()
                                            .height(44.dp)
                                            .testTag("driver_complete_trip_button")
                                    ) {
                                        Text("Selesaikan Perjalanan (Tiba di Tujuan)", color = TextDark, fontWeight = FontWeight.Bold)
                                    }
                                }
                            }
                        }
                    }
                }

                // Chat box on driver companion side for quick communication simulation
                item {
                    ChatSection(
                        messages = chatMessages,
                        chatInput = chatInput,
                        onChatInputChange = { chatInput = it },
                        onSendMessage = {
                            viewModel.sendCustomerMessage(chatInput)
                            chatInput = ""
                            focusManager.clearFocus()
                        }
                    )
                }

            } else {
                // NO ACTIVE ORDER FOR THIS DRIVER
                item {
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(180.dp)
                            .clip(RoundedCornerShape(16.dp))
                            .background(EmeraldSurface)
                            .border(1.dp, EmeraldSurfaceLight, RoundedCornerShape(16.dp)),
                        contentAlignment = Alignment.Center
                    ) {
                        Column(horizontalAlignment = Alignment.CenterHorizontally) {
                            Icon(
                                imageVector = Icons.Default.DirectionsBike,
                                contentDescription = null,
                                tint = TextMuted,
                                modifier = Modifier.size(48.dp)
                            )
                            Spacer(modifier = Modifier.height(8.dp))
                            Text(
                                text = "Menunggu Pesanan Masuk...",
                                color = TextLight,
                                fontSize = 13.sp,
                                fontWeight = FontWeight.Bold
                            )
                            Text(
                                text = "Pastikan status Anda ONLINE di atas.",
                                color = TextMuted,
                                fontSize = 10.sp
                            )
                        }
                    }
                }
            }
        }
    }
}
