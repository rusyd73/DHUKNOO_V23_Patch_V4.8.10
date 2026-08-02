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
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.example.data.*
import com.example.ui.ObamaViewModel
import com.example.ui.components.ObamaMap
import com.example.ui.theme.*

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CustomerScreen(
    viewModel: ObamaViewModel,
    modifier: Modifier = Modifier
) {
    val wallet by viewModel.walletState.collectAsState()
    val activeOrder by viewModel.orderState.collectAsState()
    val chatMessages by viewModel.chatState.collectAsState()

    var pickupSelected by remember { mutableStateOf(LocationData.locations[5]) } // Default: Stasiun Malang Baru
    var destSelected by remember { mutableStateOf(LocationData.locations[0]) } // Default: Alun-Alun Batu

    var selectedServiceType by remember { mutableStateOf("OBAMA-Ride") } // Default
    var promoCodeInput by remember { mutableStateOf("") }
    var chatInput by remember { mutableStateOf("") }

    val focusManager = LocalFocusManager.current

    // Calculate dynamic pricing preview for selection
    val distance = LocationData.calculateDistanceKm(pickupSelected, destSelected)
    val ridePrice = distance * 2000.0
    val carPrice = distance * 3500.0
    val sendPrice = distance * 1800.0

    LazyColumn(
        modifier = modifier
            .fillMaxSize()
            .background(EmeraldDarkBg)
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        // 1. OBAMA-Pay Card
        item {
            ObamaPayCard(
                wallet = wallet,
                onTopUp = { amount -> viewModel.topUpWallet(amount) }
            )
        }

        // 2. Interactive OBAMA-Map
        item {
            Column {
                Text(
                    text = "OBAMA-Map (Malang Raya)",
                    color = TextLight,
                    fontSize = 14.sp,
                    fontWeight = FontWeight.Bold,
                    modifier = Modifier.padding(bottom = 6.dp)
                )
                val order = activeOrder
                ObamaMap(
                    activeOrder = order,
                    onLocationSelect = { loc ->
                        // Quick toggle selection
                        if (order == null || order.status == "NONE") {
                            if (loc.name != destSelected.name) {
                                pickupSelected = loc
                                viewModel.playAlertSound(false)
                            }
                        }
                    }
                )
            }
        }

        val order = activeOrder
        if (order == null || order.status == "NONE") {
            // BOOKING FLOW
            item {
                Card(
                    colors = CardDefaults.cardColors(containerColor = EmeraldSurface),
                    shape = RoundedCornerShape(16.dp),
                    border = BorderStroke(1.dp, EmeraldSurfaceLight),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Column(modifier = Modifier.padding(16.dp)) {
                        Text(
                            text = "Pesan Perjalanan OBAMA",
                            color = GoldenWarm,
                            fontSize = 16.sp,
                            fontWeight = FontWeight.Bold,
                            modifier = Modifier.padding(bottom = 12.dp)
                        )

                        // Pickup Dropdown/Selector
                        Text("Titik Penjemputan", color = TextMuted, fontSize = 11.sp)
                        Spacer(modifier = Modifier.height(4.dp))
                        LocationSelector(
                            selected = pickupSelected,
                            onSelected = { pickupSelected = it }
                        )

                        Spacer(modifier = Modifier.height(12.dp))

                        // Destination Dropdown/Selector
                        Text("Titik Tujuan", color = TextMuted, fontSize = 11.sp)
                        Spacer(modifier = Modifier.height(4.dp))
                        LocationSelector(
                            selected = destSelected,
                            onSelected = { destSelected = it }
                        )

                        Spacer(modifier = Modifier.height(12.dp))

                        // Distance summary
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .background(EmeraldDarkBg, RoundedCornerShape(8.dp))
                                .padding(8.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Icon(Icons.Default.Info, contentDescription = "Dist", tint = GoldenWarm, modifier = Modifier.size(16.dp))
                            Spacer(modifier = Modifier.width(6.dp))
                            Text(
                                text = "Estimasi Jarak Rute: ",
                                color = TextMuted,
                                fontSize = 12.sp
                            )
                            Text(
                                text = "$distance Km",
                                color = BatuGreenLight,
                                fontSize = 12.sp,
                                fontWeight = FontWeight.Bold
                            )
                        }
                    }
                }
            }

            // Service Type Selector & Promo Code
            item {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(
                        text = "Pilih Layanan OBAMA",
                        color = TextLight,
                        fontSize = 14.sp,
                        fontWeight = FontWeight.Bold
                    )

                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        ServiceTypeItem(
                            title = "OBAMA-Ride",
                            subtitle = "Ojek Motor",
                            icon = "🛵",
                            price = ridePrice,
                            isSelected = selectedServiceType == "OBAMA-Ride",
                            modifier = Modifier.weight(1f),
                            onClick = { selectedServiceType = "OBAMA-Ride" }
                        )
                        ServiceTypeItem(
                            title = "OBAMA-Car",
                            subtitle = "Mobil Lokal",
                            icon = "🚗",
                            price = carPrice,
                            isSelected = selectedServiceType == "OBAMA-Car",
                            modifier = Modifier.weight(1f),
                            onClick = { selectedServiceType = "OBAMA-Car" }
                        )
                        ServiceTypeItem(
                            title = "OBAMA-Send",
                            subtitle = "Kurir Barang",
                            icon = "📦",
                            price = sendPrice,
                            isSelected = selectedServiceType == "OBAMA-Send",
                            modifier = Modifier.weight(1f),
                            onClick = { selectedServiceType = "OBAMA-Send" }
                        )
                    }
                }
            }

            // Promo Code Input Widget
            item {
                Card(
                    colors = CardDefaults.cardColors(containerColor = EmeraldSurface),
                    shape = RoundedCornerShape(12.dp),
                    border = BorderStroke(1.dp, EmeraldSurfaceLight),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Column(modifier = Modifier.padding(12.dp)) {
                        Text(
                            text = "Gunakan Voucher Promo",
                            color = TextLight,
                            fontSize = 12.sp,
                            fontWeight = FontWeight.Bold
                        )
                        Spacer(modifier = Modifier.height(8.dp))
                        Row(
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            OutlinedTextField(
                                value = promoCodeInput,
                                onValueChange = { promoCodeInput = it },
                                placeholder = { Text("Kode Promo", color = TextMuted, fontSize = 12.sp) },
                                textStyle = LocalTextStyle.current.copy(color = TextLight, fontSize = 13.sp),
                                colors = OutlinedTextFieldDefaults.colors(
                                    focusedBorderColor = GoldenWarm,
                                    unfocusedBorderColor = EmeraldSurfaceLight,
                                    focusedContainerColor = EmeraldDarkBg,
                                    unfocusedContainerColor = EmeraldDarkBg
                                ),
                                shape = RoundedCornerShape(8.dp),
                                modifier = Modifier
                                    .weight(1f)
                                    .height(50.dp)
                                    .testTag("promo_code_input")
                            )

                            Button(
                                onClick = { focusManager.clearFocus() },
                                colors = ButtonDefaults.buttonColors(containerColor = EmeraldSurfaceLight),
                                shape = RoundedCornerShape(8.dp),
                                modifier = Modifier.height(50.dp)
                            ) {
                                Text("Terapkan", color = GoldenWarm, fontSize = 12.sp)
                            }
                        }

                        Spacer(modifier = Modifier.height(8.dp))

                        // Quick Select Chips
                        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            PromoQuickChip(
                                code = "OBAMAMURAH",
                                desc = "Diskon Rp1.500",
                                onClick = { promoCodeInput = "OBAMAMURAH" }
                            )
                            PromoQuickChip(
                                code = "MALANGBATU",
                                desc = "Diskon Rp2.500",
                                onClick = { promoCodeInput = "MALANGBATU" }
                            )
                        }
                    }
                }
            }

            // Total Bill & Book Button
            item {
                val currentBasePrice = when (selectedServiceType) {
                    "OBAMA-Ride" -> ridePrice
                    "OBAMA-Car" -> carPrice
                    else -> sendPrice
                }
                val discount = viewModel.applyPromoCode(promoCodeInput, currentBasePrice)
                val finalPrice = (currentBasePrice - discount).coerceAtLeast(0.0)

                Card(
                    colors = CardDefaults.cardColors(containerColor = EmeraldSurface),
                    shape = RoundedCornerShape(16.dp),
                    border = BorderStroke(1.5.dp, BatuGreen),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Column(modifier = Modifier.padding(16.dp)) {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Column {
                                Text("Total Pembayaran", color = TextMuted, fontSize = 12.sp)
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    if (discount > 0) {
                                        Text(
                                            text = "Rp ${viewModel.formatRupiah(currentBasePrice)}",
                                            color = TextMuted,
                                            fontSize = 12.sp,
                                            style = MaterialTheme.typography.bodyMedium.copy(
                                                textDecoration = androidx.compose.ui.text.style.TextDecoration.LineThrough
                                            ),
                                            modifier = Modifier.padding(end = 6.dp)
                                        )
                                    }
                                    Text(
                                        text = "Rp ${viewModel.formatRupiah(finalPrice)}",
                                        color = GoldenWarm,
                                        fontSize = 20.sp,
                                        fontWeight = FontWeight.ExtraBold
                                    )
                                }
                            }

                            Button(
                                onClick = {
                                    if (pickupSelected.name == destSelected.name) {
                                        viewModel.triggerNotification("Titik jemput dan tujuan tidak boleh sama!", isMajor = true)
                                    } else {
                                        viewModel.createOrder(
                                            pickup = pickupSelected,
                                            destination = destSelected,
                                            serviceType = selectedServiceType,
                                            promoCode = promoCodeInput
                                        )
                                    }
                                },
                                colors = ButtonDefaults.buttonColors(containerColor = BatuGreen),
                                shape = RoundedCornerShape(12.dp),
                                modifier = Modifier
                                    .height(48.dp)
                                    .testTag("order_now_button")
                            ) {
                                Icon(Icons.Default.DirectionsCar, contentDescription = null, tint = TextDark)
                                Spacer(modifier = Modifier.width(6.dp))
                                Text("Pesan Sekarang", color = TextDark, fontWeight = FontWeight.Bold, fontSize = 14.sp)
                            }
                        }
                    }
                }
            }

        } else {
            // ACTIVE ORDER IN PROGRESS STATE
            item {
                ActiveOrderCard(
                    order = order!!,
                    viewModel = viewModel,
                    onClear = { viewModel.clearActiveOrder() }
                )
            }

            // Chat Box Section
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
        }
    }
}

@Composable
fun ObamaPayCard(
    wallet: WalletEntity?,
    onTopUp: (Double) -> Unit
) {
    Card(
        colors = CardDefaults.cardColors(containerColor = EmeraldSurface),
        shape = RoundedCornerShape(16.dp),
        border = BorderStroke(1.dp, EmeraldSurfaceLight),
        modifier = Modifier
            .fillMaxWidth()
            .testTag("obama_pay_card")
    ) {
        Column(
            modifier = Modifier
                .background(
                    Brush.verticalGradient(
                        listOf(EmeraldSurface, EmeraldDarkBg)
                    )
                )
                .padding(16.dp)
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Box(
                        modifier = Modifier
                            .size(32.dp)
                            .background(GoldenWarm, CircleShape),
                        contentAlignment = Alignment.Center
                    ) {
                        Text("O", color = TextDark, fontWeight = FontWeight.Bold, fontSize = 16.sp)
                    }
                    Spacer(modifier = Modifier.width(8.dp))
                    Column {
                        Text("OBAMA-Pay", color = TextLight, fontWeight = FontWeight.Bold, fontSize = 14.sp)
                        Text("Dompet Digital Lokal", color = TextMuted, fontSize = 10.sp)
                    }
                }

                Column(horizontalAlignment = Alignment.End) {
                    Text("Saldo Anda", color = TextMuted, fontSize = 10.sp)
                    Text(
                        text = "Rp ${"%,.0f".format(wallet?.balance ?: 50000.0).replace(",", ".")}",
                        color = GoldenWarm,
                        fontSize = 18.sp,
                        fontWeight = FontWeight.ExtraBold,
                        modifier = Modifier.testTag("wallet_balance_text")
                    )
                }
            }

            Spacer(modifier = Modifier.height(14.dp))
            Divider(color = EmeraldSurfaceLight)
            Spacer(modifier = Modifier.height(10.dp))

            Text("Isi Saldo Cepat (Top Up):", color = TextMuted, fontSize = 11.sp)
            Spacer(modifier = Modifier.height(8.dp))

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                TopUpChip(label = "+10rb", onClick = { onTopUp(10000.0) }, modifier = Modifier.weight(1f))
                TopUpChip(label = "+20rb", onClick = { onTopUp(20000.0) }, modifier = Modifier.weight(1f))
                TopUpChip(label = "+50rb", onClick = { onTopUp(50000.0) }, modifier = Modifier.weight(1f))
            }
        }
    }
}

@Composable
fun TopUpChip(label: String, onClick: () -> Unit, modifier: Modifier = Modifier) {
    Box(
        modifier = modifier
            .clip(RoundedCornerShape(8.dp))
            .background(EmeraldSurfaceLight)
            .border(1.dp, EmeraldSurfaceLight.copy(alpha = 0.8f), RoundedCornerShape(8.dp))
            .clickable { onClick() }
            .padding(vertical = 8.dp),
        contentAlignment = Alignment.Center
    ) {
        Text(label, color = GoldenWarm, fontSize = 12.sp, fontWeight = FontWeight.Bold)
    }
}

@Composable
fun LocationSelector(
    selected: LocationPoint,
    onSelected: (LocationPoint) -> Unit
) {
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
            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier.weight(1f)
            ) {
                Icon(
                    imageVector = Icons.Default.LocationOn,
                    contentDescription = null,
                    tint = GoldenWarm,
                    modifier = Modifier.size(18.dp)
                )
                Spacer(modifier = Modifier.width(8.dp))
                Column {
                    Text(selected.name, color = TextLight, fontSize = 13.sp, fontWeight = FontWeight.Bold)
                    Text(selected.description, color = TextMuted, fontSize = 10.sp)
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
            LocationData.locations.forEach { loc ->
                DropdownMenuItem(
                    text = {
                        Column {
                            Text(loc.name, color = TextLight, fontWeight = FontWeight.Bold, fontSize = 13.sp)
                            Text(loc.description, color = TextMuted, fontSize = 10.sp)
                        }
                    },
                    onClick = {
                        onSelected(loc)
                        expanded = false
                    },
                    modifier = Modifier.background(
                        if (loc.name == selected.name) EmeraldSurfaceLight else Color.Transparent
                    )
                )
            }
        }
    }
}

@Composable
fun ServiceTypeItem(
    title: String,
    subtitle: String,
    icon: String,
    price: Double,
    isSelected: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier
) {
    Card(
        colors = CardDefaults.cardColors(
            containerColor = if (isSelected) EmeraldSurfaceLight else EmeraldSurface
        ),
        border = BorderStroke(
            width = if (isSelected) 1.5.dp else 1.dp,
            color = if (isSelected) BatuGreen else EmeraldSurfaceLight
        ),
        shape = RoundedCornerShape(12.dp),
        modifier = modifier
            .clickable { onClick() }
            .testTag("service_item_${title.lowercase()}")
    ) {
        Column(
            modifier = Modifier.padding(10.dp),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Text(icon, fontSize = 24.sp)
            Spacer(modifier = Modifier.height(4.dp))
            Text(title, color = TextLight, fontSize = 11.sp, fontWeight = FontWeight.Bold, textAlign = TextAlign.Center)
            Text(subtitle, color = TextMuted, fontSize = 8.sp, textAlign = TextAlign.Center)
            Spacer(modifier = Modifier.height(4.dp))
            Text(
                "Rp ${"%,.0f".format(price).replace(",", ".")}",
                color = GoldenWarm,
                fontSize = 11.sp,
                fontWeight = FontWeight.Bold,
                textAlign = TextAlign.Center
            )
        }
    }
}

@Composable
fun PromoQuickChip(
    code: String,
    desc: String,
    onClick: () -> Unit
) {
    Box(
        modifier = Modifier
            .clip(RoundedCornerShape(6.dp))
            .background(EmeraldSurfaceLight)
            .clickable { onClick() }
            .padding(horizontal = 8.dp, vertical = 4.dp)
    ) {
        Text(
            text = "$code ($desc)",
            color = BatuGreenLight,
            fontSize = 9.sp,
            fontWeight = FontWeight.Bold
        )
    }
}

@Composable
fun ActiveOrderCard(
    order: OrderEntity,
    viewModel: ObamaViewModel,
    onClear: () -> Unit
) {
    val progressMessage = when (order.status) {
        "SEARCHING" -> "Menghubungi Mitra Driver Terdekat..."
        "ACCEPTED" -> "Driver Menuju Lokasi Penjemputan..."
        "ARRIVED" -> "Driver Telah Tiba di Lokasi Anda!"
        "PICKED_UP" -> "Perjalanan Menuju Destinasi..."
        "COMPLETED" -> "Perjalanan Anda Telah Selesai!"
        else -> "Mengatur Koordinasi..."
    }

    val statusColor = when (order.status) {
        "SEARCHING" -> GoldenWarm
        "ACCEPTED" -> ColorInfo
        "ARRIVED" -> BatuGreenLight
        "PICKED_UP" -> BatuGreen
        else -> GoldenWarm
    }

    Card(
        colors = CardDefaults.cardColors(containerColor = EmeraldSurface),
        shape = RoundedCornerShape(16.dp),
        border = BorderStroke(1.5.dp, statusColor),
        modifier = Modifier
            .fillMaxWidth()
            .testTag("active_order_card")
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            // Status Header
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Box(
                        modifier = Modifier
                            .size(8.dp)
                            .background(statusColor, CircleShape)
                    )
                    Spacer(modifier = Modifier.width(6.dp))
                    Text(
                        text = "STATUS: ${order.status}",
                        color = statusColor,
                        fontSize = 11.sp,
                        fontWeight = FontWeight.Bold
                    )
                }

                if (order.status == "COMPLETED") {
                    IconButton(
                        onClick = onClear,
                        modifier = Modifier
                            .size(24.dp)
                            .testTag("close_order_button")
                    ) {
                        Icon(Icons.Default.Close, contentDescription = "Close", tint = TextMuted)
                    }
                }
            }

            Spacer(modifier = Modifier.height(6.dp))
            Text(
                text = progressMessage,
                color = TextLight,
                fontSize = 15.sp,
                fontWeight = FontWeight.Bold
            )

            Spacer(modifier = Modifier.height(12.dp))
            Divider(color = EmeraldSurfaceLight)
            Spacer(modifier = Modifier.height(12.dp))

            // Driver detail if assigned
            if (order.status != "SEARCHING") {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Box(
                        modifier = Modifier
                            .size(40.dp)
                            .background(EmeraldSurfaceLight, CircleShape),
                        contentAlignment = Alignment.Center
                    ) {
                        Text(
                            text = if (order.serviceType == "OBAMA-Ride") "🛵" else if (order.serviceType == "OBAMA-Car") "🚗" else "📦",
                            fontSize = 20.sp
                        )
                    }
                    Spacer(modifier = Modifier.width(12.dp))
                    Column(modifier = Modifier.weight(1f)) {
                        Text(
                            text = order.driverName,
                            color = TextLight,
                            fontSize = 13.sp,
                            fontWeight = FontWeight.Bold
                        )
                        Text(
                            text = "Mitra Driver OBAMA • ${order.driverPhone}",
                            color = TextMuted,
                            fontSize = 11.sp
                        )
                    }
                }
                Spacer(modifier = Modifier.height(12.dp))
            }

            // Route details
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Default.TripOrigin, contentDescription = null, tint = BatuGreen, modifier = Modifier.size(16.dp))
                Spacer(modifier = Modifier.width(8.dp))
                Text(order.pickupName, color = TextLight, fontSize = 12.sp)
            }
            Box(
                modifier = Modifier
                    .padding(start = 7.dp)
                    .width(1.5.dp)
                    .height(14.dp)
                    .background(TextMuted)
            )
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Default.LocationOn, contentDescription = null, tint = GoldenWarm, modifier = Modifier.size(16.dp))
                Spacer(modifier = Modifier.width(8.dp))
                Text(order.destinationName, color = TextLight, fontSize = 12.sp)
            }

            Spacer(modifier = Modifier.height(12.dp))
            Divider(color = EmeraldSurfaceLight)
            Spacer(modifier = Modifier.height(12.dp))

            // Cost structure
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Text("Tarif Asli (${String.format("%.1f", order.distanceKm)} km)", color = TextMuted, fontSize = 11.sp)
                Text("Rp ${viewModel.formatRupiah(order.price)}", color = TextLight, fontSize = 11.sp)
            }
            if (order.discountApplied > 0) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    Text("Diskon Promo Voucher", color = BatuGreenLight, fontSize = 11.sp)
                    Text("-Rp ${viewModel.formatRupiah(order.discountApplied)}", color = BatuGreenLight, fontSize = 11.sp)
                }
            }
            Spacer(modifier = Modifier.height(4.dp))
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text("Total Dibayar (OBAMA-Pay)", color = TextLight, fontSize = 12.sp, fontWeight = FontWeight.Bold)
                Text(
                    "Rp ${viewModel.formatRupiah(order.finalPrice)}",
                    color = GoldenWarm,
                    fontSize = 14.sp,
                    fontWeight = FontWeight.Bold
                )
            }

            if (order.status == "COMPLETED") {
                Spacer(modifier = Modifier.height(14.dp))
                Button(
                    onClick = onClear,
                    colors = ButtonDefaults.buttonColors(containerColor = GoldenWarm),
                    shape = RoundedCornerShape(10.dp),
                    modifier = Modifier
                        .fillMaxWidth()
                        .testTag("dismiss_completed_trip_button")
                ) {
                    Text("Pesan Perjalanan Baru", color = TextDark, fontWeight = FontWeight.Bold)
                }
            }
        }
    }
}

@Composable
fun ChatSection(
    messages: List<ChatEntity>,
    chatInput: String,
    onChatInputChange: (String) -> Unit,
    onSendMessage: () -> Unit
) {
    Card(
        colors = CardDefaults.cardColors(containerColor = EmeraldSurface),
        shape = RoundedCornerShape(16.dp),
        border = BorderStroke(1.dp, EmeraldSurfaceLight),
        modifier = Modifier
            .fillMaxWidth()
            .testTag("chat_section_container")
    ) {
        Column(modifier = Modifier.padding(12.dp)) {
            Text(
                text = "💬 Live Chat dengan Driver",
                color = TextLight,
                fontSize = 13.sp,
                fontWeight = FontWeight.Bold,
                modifier = Modifier.padding(bottom = 8.dp)
            )

            // Chat Messages Container
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(130.dp)
                    .background(EmeraldDarkBg, RoundedCornerShape(8.dp))
                    .padding(8.dp)
            ) {
                if (messages.isEmpty()) {
                    Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                        Text("Belum ada obrolan. Kirim pesan ke driver...", color = TextMuted, fontSize = 11.sp)
                    }
                } else {
                    LazyColumn(
                        modifier = Modifier.fillMaxSize(),
                        verticalArrangement = Arrangement.spacedBy(6.dp)
                    ) {
                        items(messages) { msg ->
                            val isCustomer = msg.sender == "CUSTOMER"
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = if (isCustomer) Arrangement.End else Arrangement.Start
                            ) {
                                Box(
                                    modifier = Modifier
                                        .clip(
                                            RoundedCornerShape(
                                                topStart = 8.dp,
                                                topEnd = 8.dp,
                                                bottomStart = if (isCustomer) 8.dp else 0.dp,
                                                bottomEnd = if (isCustomer) 0.dp else 8.dp
                                            )
                                        )
                                        .background(if (isCustomer) BatuGreen else EmeraldSurfaceLight)
                                        .padding(horizontal = 8.dp, vertical = 6.dp)
                                        .widthIn(max = 200.dp)
                                ) {
                                    Text(
                                        text = msg.message,
                                        color = if (isCustomer) TextDark else TextLight,
                                        fontSize = 11.sp
                                    )
                                }
                            }
                        }
                    }
                }
            }

            Spacer(modifier = Modifier.height(8.dp))

            // Pre-defined quick reply chips
            Row(
                horizontalArrangement = Arrangement.spacedBy(6.dp),
                modifier = Modifier.fillMaxWidth()
            ) {
                QuickChatChip(label = "Saya sudah di lobby", onClick = { onChatInputChange("Saya sudah di lobby") })
                QuickChatChip(label = "Sesuai maps ya pak", onClick = { onChatInputChange("Sesuai maps ya pak") })
            }

            Spacer(modifier = Modifier.height(8.dp))

            // Input Row
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                OutlinedTextField(
                    value = chatInput,
                    onValueChange = onChatInputChange,
                    placeholder = { Text("Ketik pesan...", color = TextMuted, fontSize = 11.sp) },
                    textStyle = LocalTextStyle.current.copy(color = TextLight, fontSize = 12.sp),
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedBorderColor = BatuGreen,
                        unfocusedBorderColor = EmeraldSurfaceLight,
                        focusedContainerColor = EmeraldDarkBg,
                        unfocusedContainerColor = EmeraldDarkBg
                    ),
                    shape = RoundedCornerShape(8.dp),
                    modifier = Modifier
                        .weight(1f)
                        .height(46.dp)
                        .testTag("chat_input_field"),
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send),
                    keyboardActions = KeyboardActions(onSend = { onSendMessage() })
                )

                IconButton(
                    onClick = onSendMessage,
                    modifier = Modifier
                        .size(46.dp)
                        .background(BatuGreen, RoundedCornerShape(8.dp))
                        .testTag("send_chat_button"),
                    enabled = chatInput.isNotBlank()
                ) {
                    Icon(Icons.Default.Send, contentDescription = "Send", tint = TextDark, modifier = Modifier.size(18.dp))
                }
            }
        }
    }
}

@Composable
fun QuickChatChip(label: String, onClick: () -> Unit) {
    Box(
        modifier = Modifier
            .clip(RoundedCornerShape(6.dp))
            .background(EmeraldSurfaceLight)
            .clickable { onClick() }
            .padding(horizontal = 8.dp, vertical = 4.dp)
    ) {
        Text(label, color = TextMuted, fontSize = 9.sp)
    }
}
