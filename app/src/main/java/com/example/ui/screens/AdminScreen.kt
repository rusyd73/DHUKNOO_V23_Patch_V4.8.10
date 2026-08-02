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
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.example.data.DriverEntity
import com.example.ui.ObamaViewModel
import com.example.ui.theme.*

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AdminScreen(
    viewModel: ObamaViewModel,
    modifier: Modifier = Modifier
) {
    val drivers by viewModel.driversState.collectAsState()

    var nameInput by remember { mutableStateOf("") }
    var phoneInput by remember { mutableStateOf("") }
    var plateInput by remember { mutableStateOf("") }
    var selectedVehicleType by remember { mutableStateOf("OBAMA-Ride") } // Default

    val pendingDrivers = drivers.filter { !it.isVerified }
    val verifiedDrivers = drivers.filter { it.isVerified }

    val focusManager = LocalFocusManager.current

    LazyColumn(
        modifier = modifier
            .fillMaxSize()
            .background(EmeraldDarkBg)
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        // 1. STATS OVERVIEW CARD
        item {
            Card(
                colors = CardDefaults.cardColors(containerColor = EmeraldSurface),
                shape = RoundedCornerShape(16.dp),
                border = BorderStroke(1.dp, EmeraldSurfaceLight),
                modifier = Modifier.fillMaxWidth()
            ) {
                Column(modifier = Modifier.padding(16.dp)) {
                    Text(
                        text = "Dashboard Admin OBAMA",
                        color = GoldenWarm,
                        fontSize = 15.sp,
                        fontWeight = FontWeight.Bold,
                        modifier = Modifier.padding(bottom = 12.dp)
                    )

                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        StatBox(
                            title = "Total Mitra",
                            value = "${drivers.size}",
                            icon = Icons.Default.People,
                            modifier = Modifier.weight(1f)
                        )
                        StatBox(
                            title = "Aktif Online",
                            value = "${drivers.count { it.isOnline }}",
                            icon = Icons.Default.NetworkCell,
                            modifier = Modifier.weight(1f)
                        )
                        StatBox(
                            title = "Menunggu Verifikasi",
                            value = "${pendingDrivers.size}",
                            icon = Icons.Default.Pending,
                            modifier = Modifier.weight(1f)
                        )
                    }
                }
            }
        }

        // 2. PENDING VERIFICATION LIST
        item {
            Column {
                Text(
                    text = "Pendaftaran Driver Baru (Menunggu Verifikasi)",
                    color = TextLight,
                    fontSize = 14.sp,
                    fontWeight = FontWeight.Bold,
                    modifier = Modifier.padding(bottom = 6.dp)
                )

                if (pendingDrivers.isEmpty()) {
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .background(EmeraldSurface, RoundedCornerShape(12.dp))
                            .border(1.dp, EmeraldSurfaceLight, RoundedCornerShape(12.dp))
                            .padding(16.dp),
                        contentAlignment = Alignment.Center
                    ) {
                        Text("Tidak ada pengajuan mitra baru saat ini.", color = TextMuted, fontSize = 12.sp)
                    }
                } else {
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        pendingDrivers.forEach { d ->
                            PendingDriverItem(
                                driver = d,
                                onApprove = { viewModel.adminApproveDriver(d.id) },
                                onDelete = { viewModel.adminDeleteDriver(d.id) }
                            )
                        }
                    }
                }
            }
        }

        // 3. REGISTER NEW DRIVER FORM
        item {
            Card(
                colors = CardDefaults.cardColors(containerColor = EmeraldSurface),
                shape = RoundedCornerShape(16.dp),
                border = BorderStroke(1.dp, EmeraldSurfaceLight),
                modifier = Modifier.fillMaxWidth()
            ) {
                Column(modifier = Modifier.padding(16.dp)) {
                    Text(
                        text = "Daftarkan Mitra Baru Secara Manual",
                        color = GoldenWarm,
                        fontSize = 13.sp,
                        fontWeight = FontWeight.Bold,
                        modifier = Modifier.padding(bottom = 12.dp)
                    )

                    // Input Name
                    OutlinedTextField(
                        value = nameInput,
                        onValueChange = { nameInput = it },
                        label = { Text("Nama Lengkap", color = TextMuted, fontSize = 12.sp) },
                        textStyle = LocalTextStyle.current.copy(color = TextLight, fontSize = 13.sp),
                        colors = OutlinedTextFieldDefaults.colors(
                            focusedBorderColor = BatuGreen,
                            unfocusedBorderColor = EmeraldSurfaceLight,
                            focusedContainerColor = EmeraldDarkBg,
                            unfocusedContainerColor = EmeraldDarkBg
                        ),
                        singleLine = true,
                        shape = RoundedCornerShape(8.dp),
                        modifier = Modifier
                            .fillMaxWidth()
                            .testTag("admin_driver_name_input")
                    )

                    Spacer(modifier = Modifier.height(8.dp))

                    // Input Phone
                    OutlinedTextField(
                        value = phoneInput,
                        onValueChange = { phoneInput = it },
                        label = { Text("Nomor Telepon", color = TextMuted, fontSize = 12.sp) },
                        textStyle = LocalTextStyle.current.copy(color = TextLight, fontSize = 13.sp),
                        colors = OutlinedTextFieldDefaults.colors(
                            focusedBorderColor = BatuGreen,
                            unfocusedBorderColor = EmeraldSurfaceLight,
                            focusedContainerColor = EmeraldDarkBg,
                            unfocusedContainerColor = EmeraldDarkBg
                        ),
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone),
                        singleLine = true,
                        shape = RoundedCornerShape(8.dp),
                        modifier = Modifier
                            .fillMaxWidth()
                            .testTag("admin_driver_phone_input")
                    )

                    Spacer(modifier = Modifier.height(8.dp))

                    // Input License Plate
                    OutlinedTextField(
                        value = plateInput,
                        onValueChange = { plateInput = it },
                        label = { Text("Nomor Plat Kendaraan (cth: N 1234 XY)", color = TextMuted, fontSize = 12.sp) },
                        textStyle = LocalTextStyle.current.copy(color = TextLight, fontSize = 13.sp),
                        colors = OutlinedTextFieldDefaults.colors(
                            focusedBorderColor = BatuGreen,
                            unfocusedBorderColor = EmeraldSurfaceLight,
                            focusedContainerColor = EmeraldDarkBg,
                            unfocusedContainerColor = EmeraldDarkBg
                        ),
                        singleLine = true,
                        shape = RoundedCornerShape(8.dp),
                        modifier = Modifier
                            .fillMaxWidth()
                            .testTag("admin_driver_plate_input")
                    )

                    Spacer(modifier = Modifier.height(12.dp))

                    // Vehicle Type Radio Selection
                    Text("Tipe Layanan Kendaraan:", color = TextMuted, fontSize = 11.sp)
                    Spacer(modifier = Modifier.height(6.dp))

                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        VehicleTypeRadioItem(
                            label = "OBAMA-Ride",
                            icon = "🛵",
                            isSelected = selectedVehicleType == "OBAMA-Ride",
                            onClick = { selectedVehicleType = "OBAMA-Ride" },
                            modifier = Modifier.weight(1f)
                        )
                        VehicleTypeRadioItem(
                            label = "OBAMA-Car",
                            icon = "🚗",
                            isSelected = selectedVehicleType == "OBAMA-Car",
                            onClick = { selectedVehicleType = "OBAMA-Car" },
                            modifier = Modifier.weight(1f)
                        )
                        VehicleTypeRadioItem(
                            label = "OBAMA-Send",
                            icon = "📦",
                            isSelected = selectedVehicleType == "OBAMA-Send",
                            onClick = { selectedVehicleType = "OBAMA-Send" },
                            modifier = Modifier.weight(1f)
                        )
                    }

                    Spacer(modifier = Modifier.height(16.dp))

                    // Submit Button
                    Button(
                        onClick = {
                            if (nameInput.isBlank() || phoneInput.isBlank() || plateInput.isBlank()) {
                                viewModel.triggerNotification("Semua field pendaftaran wajib diisi!", isMajor = true)
                            } else {
                                // Add directly as verified driver
                                viewModel.adminRegisterDriver(
                                    name = nameInput,
                                    phone = phoneInput,
                                    vehicleType = selectedVehicleType,
                                    plate = plateInput,
                                    isVerified = true
                                )
                                nameInput = ""
                                phoneInput = ""
                                plateInput = ""
                                focusManager.clearFocus()
                            }
                        },
                        colors = ButtonDefaults.buttonColors(containerColor = BatuGreen),
                        shape = RoundedCornerShape(10.dp),
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(46.dp)
                            .testTag("admin_register_driver_button")
                    ) {
                        Icon(Icons.Default.Add, contentDescription = null, tint = TextDark)
                        Spacer(modifier = Modifier.width(6.dp))
                        Text("Daftarkan & Verifikasi Langsung", color = TextDark, fontWeight = FontWeight.Bold, fontSize = 13.sp)
                    }
                }
            }
        }

        // 4. DATABASE DRIVERS DIRECTORY
        item {
            Column {
                Text(
                    text = "Daftar Seluruh Mitra OBAMA Terdaftar",
                    color = TextLight,
                    fontSize = 14.sp,
                    fontWeight = FontWeight.Bold,
                    modifier = Modifier.padding(bottom = 6.dp)
                )

                if (verifiedDrivers.isEmpty()) {
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .background(EmeraldSurface, RoundedCornerShape(12.dp))
                            .padding(16.dp),
                        contentAlignment = Alignment.Center
                    ) {
                        Text("Tidak ada mitra terverifikasi.", color = TextMuted, fontSize = 12.sp)
                    }
                } else {
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        verifiedDrivers.forEach { d ->
                            VerifiedDriverItem(
                                driver = d,
                                onDelete = { viewModel.adminDeleteDriver(d.id) }
                            )
                        }
                    }
                }
            }
        }

        // 5. SECURITY & PASSWORD MANAGEMENT CARD
        item {
            var oldPasswordInput by remember { mutableStateOf("") }
            var newPasswordInput by remember { mutableStateOf("") }

            Card(
                colors = CardDefaults.cardColors(containerColor = EmeraldSurface),
                shape = RoundedCornerShape(16.dp),
                border = BorderStroke(1.dp, ColorError.copy(alpha = 0.4f)),
                modifier = Modifier.fillMaxWidth()
            ) {
                Column(modifier = Modifier.padding(16.dp)) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        Icon(Icons.Default.Lock, contentDescription = null, tint = ColorError)
                        Text(
                            text = "Pengaturan Keamanan Admin",
                            color = GoldenWarm,
                            fontSize = 13.sp,
                            fontWeight = FontWeight.Bold
                        )
                    }

                    Spacer(modifier = Modifier.height(12.dp))

                    Text(
                        text = "Ganti Password Panel Admin:",
                        color = TextLight,
                        fontSize = 11.sp,
                        fontWeight = FontWeight.Bold
                    )

                    Spacer(modifier = Modifier.height(8.dp))

                    // Old Password
                    OutlinedTextField(
                        value = oldPasswordInput,
                        onValueChange = { oldPasswordInput = it },
                        label = { Text("Password Lama", color = TextMuted, fontSize = 11.sp) },
                        visualTransformation = androidx.compose.ui.text.input.PasswordVisualTransformation(),
                        textStyle = LocalTextStyle.current.copy(color = TextLight, fontSize = 13.sp),
                        colors = OutlinedTextFieldDefaults.colors(
                            focusedBorderColor = ColorError,
                            unfocusedBorderColor = EmeraldSurfaceLight,
                            focusedContainerColor = EmeraldDarkBg,
                            unfocusedContainerColor = EmeraldDarkBg
                        ),
                        singleLine = true,
                        shape = RoundedCornerShape(8.dp),
                        modifier = Modifier
                            .fillMaxWidth()
                            .testTag("admin_old_password_input")
                    )

                    Spacer(modifier = Modifier.height(8.dp))

                    // New Password
                    OutlinedTextField(
                        value = newPasswordInput,
                        onValueChange = { newPasswordInput = it },
                        label = { Text("Password Baru", color = TextMuted, fontSize = 11.sp) },
                        visualTransformation = androidx.compose.ui.text.input.PasswordVisualTransformation(),
                        textStyle = LocalTextStyle.current.copy(color = TextLight, fontSize = 13.sp),
                        colors = OutlinedTextFieldDefaults.colors(
                            focusedBorderColor = ColorError,
                            unfocusedBorderColor = EmeraldSurfaceLight,
                            focusedContainerColor = EmeraldDarkBg,
                            unfocusedContainerColor = EmeraldDarkBg
                        ),
                        singleLine = true,
                        shape = RoundedCornerShape(8.dp),
                        modifier = Modifier
                            .fillMaxWidth()
                            .testTag("admin_new_password_input")
                    )

                    Spacer(modifier = Modifier.height(12.dp))

                    Button(
                        onClick = {
                            if (oldPasswordInput.isEmpty() || newPasswordInput.isEmpty()) {
                                viewModel.triggerNotification("Semua kolom password wajib diisi!", isMajor = true)
                            } else {
                                val success = viewModel.changeAdminPassword(oldPasswordInput, newPasswordInput)
                                if (success) {
                                    oldPasswordInput = ""
                                    newPasswordInput = ""
                                    focusManager.clearFocus()
                                }
                            }
                        },
                        colors = ButtonDefaults.buttonColors(containerColor = ColorError),
                        shape = RoundedCornerShape(8.dp),
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(42.dp)
                            .testTag("admin_change_password_button")
                    ) {
                        Icon(Icons.Default.Save, contentDescription = null, tint = TextLight, modifier = Modifier.size(16.dp))
                        Spacer(modifier = Modifier.width(6.dp))
                        Text("Simpan Password Baru", color = TextLight, fontWeight = FontWeight.Bold, fontSize = 12.sp)
                    }
                }
            }
        }
    }
}

@Composable
fun StatBox(
    title: String,
    value: String,
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    modifier: Modifier = Modifier
) {
    Card(
        colors = CardDefaults.cardColors(containerColor = EmeraldDarkBg),
        border = BorderStroke(1.dp, EmeraldSurfaceLight),
        shape = RoundedCornerShape(10.dp),
        modifier = modifier
    ) {
        Column(
            modifier = Modifier.padding(10.dp),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Icon(icon, contentDescription = null, tint = GoldenWarm, modifier = Modifier.size(16.dp))
            Spacer(modifier = Modifier.height(4.dp))
            Text(value, color = TextLight, fontSize = 16.sp, fontWeight = FontWeight.ExtraBold)
            Text(title, color = TextMuted, fontSize = 8.sp, textAlign = androidx.compose.ui.text.style.TextAlign.Center)
        }
    }
}

@Composable
fun PendingDriverItem(
    driver: DriverEntity,
    onApprove: () -> Unit,
    onDelete: () -> Unit
) {
    Card(
        colors = CardDefaults.cardColors(containerColor = EmeraldSurface),
        shape = RoundedCornerShape(12.dp),
        border = BorderStroke(1.dp, GoldenWarm.copy(alpha = 0.6f)),
        modifier = Modifier.fillMaxWidth()
    ) {
        Row(
            modifier = Modifier
                .padding(12.dp)
                .fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.weight(1f)) {
                Box(
                    modifier = Modifier
                        .size(36.dp)
                        .background(EmeraldSurfaceLight, CircleShape),
                    contentAlignment = Alignment.Center
                ) {
                    Text(
                        text = if (driver.vehicleType == "OBAMA-Ride") "🛵" else if (driver.vehicleType == "OBAMA-Car") "🚗" else "📦",
                        fontSize = 18.sp
                    )
                }
                Spacer(modifier = Modifier.width(10.dp))
                Column {
                    Text(driver.name, color = TextLight, fontWeight = FontWeight.Bold, fontSize = 13.sp)
                    Text("Tel: ${driver.phone} • Plat: ${driver.vehiclePlate}", color = TextMuted, fontSize = 10.sp)
                    Text(driver.vehicleType, color = GoldenWarm, fontSize = 9.sp, fontWeight = FontWeight.Bold)
                }
            }

            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                IconButton(
                    onClick = onApprove,
                    modifier = Modifier
                        .size(32.dp)
                        .background(BatuGreen, CircleShape)
                        .testTag("approve_driver_${driver.id}")
                ) {
                    Icon(Icons.Default.Check, contentDescription = "Approve", tint = TextDark, modifier = Modifier.size(16.dp))
                }

                IconButton(
                    onClick = onDelete,
                    modifier = Modifier
                        .size(32.dp)
                        .background(ColorError.copy(alpha = 0.2f), CircleShape)
                        .testTag("delete_pending_driver_${driver.id}")
                ) {
                    Icon(Icons.Default.Delete, contentDescription = "Delete", tint = ColorError, modifier = Modifier.size(16.dp))
                }
            }
        }
    }
}

@Composable
fun VerifiedDriverItem(
    driver: DriverEntity,
    onDelete: () -> Unit
) {
    Card(
        colors = CardDefaults.cardColors(containerColor = EmeraldSurface),
        shape = RoundedCornerShape(12.dp),
        border = BorderStroke(1.dp, EmeraldSurfaceLight),
        modifier = Modifier.fillMaxWidth()
    ) {
        Row(
            modifier = Modifier
                .padding(12.dp)
                .fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.weight(1f)) {
                Box(
                    modifier = Modifier
                        .size(36.dp)
                        .background(EmeraldSurfaceLight, CircleShape),
                    contentAlignment = Alignment.Center
                ) {
                    Text(
                        text = if (driver.vehicleType == "OBAMA-Ride") "🛵" else if (driver.vehicleType == "OBAMA-Car") "🚗" else "📦",
                        fontSize = 18.sp
                    )
                }
                Spacer(modifier = Modifier.width(10.dp))
                Column {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(driver.name, color = TextLight, fontWeight = FontWeight.Bold, fontSize = 12.sp)
                        Spacer(modifier = Modifier.width(6.dp))
                        Box(
                            modifier = Modifier
                                .size(6.dp)
                                .background(if (driver.isOnline) BatuGreen else TextMuted, CircleShape)
                        )
                    }
                    Text("Tel: ${driver.phone} • Plat: ${driver.vehiclePlate}", color = TextMuted, fontSize = 10.sp)
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(6.dp)
                    ) {
                        Text(driver.vehicleType, color = BatuGreenLight, fontSize = 9.sp)
                        Text("• Dompet: Rp ${"%,.0f".format(driver.walletBalance).replace(",", ".")}", color = GoldenWarm, fontSize = 9.sp, fontWeight = FontWeight.Bold)
                    }
                }
            }

            IconButton(
                onClick = onDelete,
                modifier = Modifier
                    .size(32.dp)
                    .background(ColorError.copy(alpha = 0.15f), CircleShape)
                    .testTag("delete_verified_driver_${driver.id}")
            ) {
                Icon(Icons.Default.Delete, contentDescription = "Delete", tint = ColorError, modifier = Modifier.size(16.dp))
            }
        }
    }
}

@Composable
fun VehicleTypeRadioItem(
    label: String,
    icon: String,
    isSelected: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier
) {
    Box(
        modifier = modifier
            .clip(RoundedCornerShape(8.dp))
            .background(if (isSelected) EmeraldSurfaceLight else EmeraldDarkBg)
            .border(
                width = if (isSelected) 1.5.dp else 1.dp,
                color = if (isSelected) BatuGreen else EmeraldSurfaceLight,
                shape = RoundedCornerShape(8.dp)
            )
            .clickable { onClick() }
            .padding(vertical = 10.dp),
        contentAlignment = Alignment.Center
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Text(icon, fontSize = 20.sp)
            Spacer(modifier = Modifier.height(4.dp))
            Text(label, color = TextLight, fontSize = 10.sp, fontWeight = FontWeight.Bold)
        }
    }
}
