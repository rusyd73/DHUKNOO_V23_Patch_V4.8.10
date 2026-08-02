package com.example.ui.components

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.example.ui.ObamaViewModel
import com.example.ui.theme.*

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CustomerLoginScreen(
    viewModel: ObamaViewModel,
    onBack: () -> Unit
) {
    var emailInput by remember { mutableStateOf("") }
    var isInstalledChecked by remember { mutableStateOf(true) }
    var emailError by remember { mutableStateOf<String?>(null) }
    val focusManager = LocalFocusManager.current

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(EmeraldDarkBg)
            .padding(24.dp),
        contentAlignment = Alignment.Center
    ) {
        Card(
            colors = CardDefaults.cardColors(containerColor = EmeraldSurface),
            shape = RoundedCornerShape(24.dp),
            border = BorderStroke(1.5.dp, GoldenWarm.copy(alpha = 0.5f)),
            modifier = Modifier
                .fillMaxWidth()
                .padding(vertical = 16.dp)
        ) {
            Column(
                modifier = Modifier.padding(24.dp),
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                // Badge Icon
                Box(
                    modifier = Modifier
                        .size(64.dp)
                        .background(Brush.radialGradient(listOf(GoldenWarm, BatuGreen)), CircleShape),
                    contentAlignment = Alignment.Center
                ) {
                    Icon(
                        imageVector = Icons.Default.Person,
                        contentDescription = "Customer",
                        tint = TextDark,
                        modifier = Modifier.size(36.dp)
                    )
                }

                Spacer(modifier = Modifier.height(16.dp))

                Text(
                    text = "Aktivasi Aplikasi Customer",
                    style = MaterialTheme.typography.titleLarge,
                    color = GoldenWarm,
                    fontWeight = FontWeight.Bold,
                    textAlign = TextAlign.Center
                )

                Text(
                    text = "Hubungkan perangkat Anda dengan akun email aktif untuk mulai memesan perjalanan OBAMA.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = TextMuted,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.padding(vertical = 8.dp)
                )

                Spacer(modifier = Modifier.height(16.dp))

                // Email Input
                OutlinedTextField(
                    value = emailInput,
                    onValueChange = { 
                        emailInput = it
                        emailError = null
                    },
                    label = { Text("Alamat Email Anda", color = TextMuted) },
                    placeholder = { Text("contoh@email.com", color = TextMuted.copy(alpha = 0.5f)) },
                    textStyle = LocalTextStyle.current.copy(color = TextLight),
                    isError = emailError != null,
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedBorderColor = BatuGreen,
                        unfocusedBorderColor = EmeraldSurfaceLight,
                        focusedContainerColor = EmeraldDarkBg,
                        unfocusedContainerColor = EmeraldDarkBg
                    ),
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email),
                    shape = RoundedCornerShape(12.dp),
                    modifier = Modifier
                        .fillMaxWidth()
                        .testTag("customer_login_email_input")
                )

                if (emailError != null) {
                    Text(
                        text = emailError ?: "",
                        color = ColorError,
                        style = MaterialTheme.typography.bodySmall,
                        modifier = Modifier
                            .align(Alignment.Start)
                            .padding(start = 4.dp, top = 4.dp)
                    )
                }

                Spacer(modifier = Modifier.height(16.dp))

                // App Install Check Rule
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .background(EmeraldDarkBg, RoundedCornerShape(12.dp))
                        .border(1.dp, if (isInstalledChecked) BatuGreen.copy(alpha = 0.4f) else EmeraldSurfaceLight, RoundedCornerShape(12.dp))
                        .padding(12.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Checkbox(
                        checked = isInstalledChecked,
                        onCheckedChange = { isInstalledChecked = it },
                        colors = CheckboxDefaults.colors(
                            checkedColor = BatuGreen,
                            uncheckedColor = TextMuted,
                            checkmarkColor = TextDark
                        )
                    )
                    Spacer(modifier = Modifier.width(8.dp))
                    Column(modifier = Modifier.weight(1f)) {
                        Text(
                            text = "Deteksi Instalasi Aplikasi",
                            style = MaterialTheme.typography.labelMedium,
                            color = if (isInstalledChecked) BatuGreenLight else TextLight,
                            fontWeight = FontWeight.Bold
                        )
                        Text(
                            text = "Memverifikasi aplikasi terpasang resmi di OS Android lokal",
                            style = MaterialTheme.typography.bodySmall,
                            color = TextMuted
                        )
                    }
                }

                Spacer(modifier = Modifier.height(24.dp))

                // Submit Button
                Button(
                    onClick = {
                        val email = emailInput.trim()
                        if (email.isEmpty()) {
                            emailError = "Alamat email wajib diisi!"
                        } else if (!email.contains("@") || !email.contains(".")) {
                            emailError = "Format email tidak valid!"
                        } else if (!isInstalledChecked) {
                            viewModel.triggerNotification("Anda harus menyetujui deteksi instalasi aplikasi!", isMajor = true)
                        } else {
                            focusManager.clearFocus()
                            viewModel.loginCustomer(email)
                        }
                    },
                    colors = ButtonDefaults.buttonColors(containerColor = BatuGreen),
                    shape = RoundedCornerShape(12.dp),
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(50.dp)
                        .testTag("customer_login_submit_button")
                ) {
                    Icon(Icons.Default.CloudDone, contentDescription = null, tint = TextDark)
                    Spacer(modifier = Modifier.width(8.dp))
                    Text(
                        text = "Aktivasi & Masuk",
                        style = MaterialTheme.typography.titleMedium,
                        color = TextDark,
                        fontWeight = FontWeight.Bold
                    )
                }

                Spacer(modifier = Modifier.height(12.dp))

                TextButton(onClick = onBack) {
                    Icon(Icons.Default.ArrowBack, contentDescription = null, tint = GoldenWarm, modifier = Modifier.size(16.dp))
                    Spacer(modifier = Modifier.width(6.dp))
                    Text("Kembali ke Hub Utama", color = GoldenWarm, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Bold)
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DriverLoginScreen(
    viewModel: ObamaViewModel,
    onBack: () -> Unit
) {
    var emailInput by remember { mutableStateOf("") }
    var isInstalledChecked by remember { mutableStateOf(true) }
    var emailError by remember { mutableStateOf<String?>(null) }
    val focusManager = LocalFocusManager.current

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(EmeraldDarkBg)
            .padding(24.dp),
        contentAlignment = Alignment.Center
    ) {
        Card(
            colors = CardDefaults.cardColors(containerColor = EmeraldSurface),
            shape = RoundedCornerShape(24.dp),
            border = BorderStroke(1.5.dp, BatuGreen.copy(alpha = 0.5f)),
            modifier = Modifier
                .fillMaxWidth()
                .padding(vertical = 16.dp)
        ) {
            Column(
                modifier = Modifier.padding(24.dp),
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                // Badge Icon
                Box(
                    modifier = Modifier
                        .size(64.dp)
                        .background(Brush.radialGradient(listOf(BatuGreen, EmeraldDarkBg)), CircleShape),
                    contentAlignment = Alignment.Center
                ) {
                    Icon(
                        imageVector = Icons.Default.DirectionsBike,
                        contentDescription = "Mitra Driver",
                        tint = GoldenWarm,
                        modifier = Modifier.size(36.dp)
                    )
                }

                Spacer(modifier = Modifier.height(16.dp))

                Text(
                    text = "Aktivasi Aplikasi Driver",
                    style = MaterialTheme.typography.titleLarge,
                    color = GoldenWarm,
                    fontWeight = FontWeight.Bold,
                    textAlign = TextAlign.Center
                )

                Text(
                    text = "Lakukan aktivasi akun mitra pengemudi Anda menggunakan alamat email terdaftar di sistem OBAMA.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = TextMuted,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.padding(vertical = 8.dp)
                )

                Spacer(modifier = Modifier.height(16.dp))

                // Email Input
                OutlinedTextField(
                    value = emailInput,
                    onValueChange = { 
                        emailInput = it
                        emailError = null
                    },
                    label = { Text("Email Mitra Driver", color = TextMuted) },
                    placeholder = { Text("mitra@obamaride.com", color = TextMuted.copy(alpha = 0.5f)) },
                    textStyle = LocalTextStyle.current.copy(color = TextLight),
                    isError = emailError != null,
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedBorderColor = BatuGreen,
                        unfocusedBorderColor = EmeraldSurfaceLight,
                        focusedContainerColor = EmeraldDarkBg,
                        unfocusedContainerColor = EmeraldDarkBg
                    ),
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email),
                    shape = RoundedCornerShape(12.dp),
                    modifier = Modifier
                        .fillMaxWidth()
                        .testTag("driver_login_email_input")
                )

                if (emailError != null) {
                    Text(
                        text = emailError ?: "",
                        color = ColorError,
                        style = MaterialTheme.typography.bodySmall,
                        modifier = Modifier
                            .align(Alignment.Start)
                            .padding(start = 4.dp, top = 4.dp)
                    )
                }

                Spacer(modifier = Modifier.height(16.dp))

                // App Install Check Rule
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .background(EmeraldDarkBg, RoundedCornerShape(12.dp))
                        .border(1.dp, if (isInstalledChecked) BatuGreen.copy(alpha = 0.4f) else EmeraldSurfaceLight, RoundedCornerShape(12.dp))
                        .padding(12.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Checkbox(
                        checked = isInstalledChecked,
                        onCheckedChange = { isInstalledChecked = it },
                        colors = CheckboxDefaults.colors(
                            checkedColor = BatuGreen,
                            uncheckedColor = TextMuted,
                            checkmarkColor = TextDark
                        )
                    )
                    Spacer(modifier = Modifier.width(8.dp))
                    Column(modifier = Modifier.weight(1f)) {
                        Text(
                            text = "Instalasi Driver Companion",
                            style = MaterialTheme.typography.labelMedium,
                            color = if (isInstalledChecked) BatuGreenLight else TextLight,
                            fontWeight = FontWeight.Bold
                        )
                        Text(
                            text = "Menyinkronkan modul GPS & background service dengan OS",
                            style = MaterialTheme.typography.bodySmall,
                            color = TextMuted
                        )
                    }
                }

                Spacer(modifier = Modifier.height(24.dp))

                // Submit Button
                Button(
                    onClick = {
                        val email = emailInput.trim()
                        if (email.isEmpty()) {
                            emailError = "Email Driver wajib diisi!"
                        } else if (!email.contains("@") || !email.contains(".")) {
                            emailError = "Format email tidak valid!"
                        } else if (!isInstalledChecked) {
                            viewModel.triggerNotification("Driver Companion harus terinstall di perangkat!", isMajor = true)
                        } else {
                            focusManager.clearFocus()
                            viewModel.loginDriver(email)
                        }
                    },
                    colors = ButtonDefaults.buttonColors(containerColor = GoldenWarm),
                    shape = RoundedCornerShape(12.dp),
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(50.dp)
                        .testTag("driver_login_submit_button")
                ) {
                    Icon(Icons.Default.VerifiedUser, contentDescription = null, tint = TextDark)
                    Spacer(modifier = Modifier.width(8.dp))
                    Text(
                        text = "Aktivasi Mitra",
                        style = MaterialTheme.typography.titleMedium,
                        color = TextDark,
                        fontWeight = FontWeight.Bold
                    )
                }

                Spacer(modifier = Modifier.height(12.dp))

                TextButton(onClick = onBack) {
                    Icon(Icons.Default.ArrowBack, contentDescription = null, tint = GoldenWarm, modifier = Modifier.size(16.dp))
                    Spacer(modifier = Modifier.width(6.dp))
                    Text("Kembali", color = GoldenWarm, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Bold)
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AdminLoginScreen(
    viewModel: ObamaViewModel,
    onBack: () -> Unit
) {
    var passwordInput by remember { mutableStateOf("") }
    var passwordError by remember { mutableStateOf<String?>(null) }
    val focusManager = LocalFocusManager.current

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(EmeraldDarkBg)
            .padding(24.dp),
        contentAlignment = Alignment.Center
    ) {
        Card(
            colors = CardDefaults.cardColors(containerColor = EmeraldSurface),
            shape = RoundedCornerShape(24.dp),
            border = BorderStroke(1.5.dp, GoldenWarm.copy(alpha = 0.5f)),
            modifier = Modifier
                .fillMaxWidth()
                .padding(vertical = 16.dp)
        ) {
            Column(
                modifier = Modifier.padding(24.dp),
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                // Badge Icon
                Box(
                    modifier = Modifier
                        .size(64.dp)
                        .background(ColorError.copy(alpha = 0.2f), CircleShape),
                    contentAlignment = Alignment.Center
                ) {
                    Icon(
                        imageVector = Icons.Default.AdminPanelSettings,
                        contentDescription = "Admin Area",
                        tint = GoldenWarm,
                        modifier = Modifier.size(36.dp)
                    )
                }

                Spacer(modifier = Modifier.height(16.dp))

                Text(
                    text = "Autentikasi Dashboard Admin",
                    style = MaterialTheme.typography.titleLarge,
                    color = GoldenWarm,
                    fontWeight = FontWeight.Bold,
                    textAlign = TextAlign.Center
                )

                Text(
                    text = "Area terbatas. Masukkan password administrator untuk mengakses panel kontrol pendaftaran mitra.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = TextMuted,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.padding(vertical = 8.dp)
                )

                Spacer(modifier = Modifier.height(16.dp))

                // Password Input
                OutlinedTextField(
                    value = passwordInput,
                    onValueChange = { 
                        passwordInput = it
                        passwordError = null
                    },
                    label = { Text("Password Admin", color = TextMuted) },
                    visualTransformation = PasswordVisualTransformation(),
                    textStyle = LocalTextStyle.current.copy(color = TextLight),
                    isError = passwordError != null,
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedBorderColor = BatuGreen,
                        unfocusedBorderColor = EmeraldSurfaceLight,
                        focusedContainerColor = EmeraldDarkBg,
                        unfocusedContainerColor = EmeraldDarkBg
                    ),
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                    shape = RoundedCornerShape(12.dp),
                    modifier = Modifier
                        .fillMaxWidth()
                        .testTag("admin_login_password_input")
                )

                if (passwordError != null) {
                    Text(
                        text = passwordError ?: "",
                        color = ColorError,
                        style = MaterialTheme.typography.bodySmall,
                        modifier = Modifier
                            .align(Alignment.Start)
                            .padding(start = 4.dp, top = 4.dp)
                    )
                }

                Spacer(modifier = Modifier.height(24.dp))

                // Submit Button
                Button(
                    onClick = {
                        if (passwordInput.isEmpty()) {
                            passwordError = "Password wajib diisi!"
                        } else {
                            val success = viewModel.loginAdmin(passwordInput)
                            if (!success) {
                                passwordError = "Password administrator salah!"
                            } else {
                                focusManager.clearFocus()
                            }
                        }
                    },
                    colors = ButtonDefaults.buttonColors(containerColor = ColorError),
                    shape = RoundedCornerShape(12.dp),
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(50.dp)
                        .testTag("admin_login_submit_button")
                ) {
                    Icon(Icons.Default.LockOpen, contentDescription = null, tint = TextLight)
                    Spacer(modifier = Modifier.width(8.dp))
                    Text(
                        text = "Buka Kunci Akses",
                        style = MaterialTheme.typography.titleMedium,
                        color = TextLight,
                        fontWeight = FontWeight.Bold
                    )
                }

                Spacer(modifier = Modifier.height(12.dp))

                TextButton(onClick = onBack) {
                    Icon(Icons.Default.ArrowBack, contentDescription = null, tint = GoldenWarm, modifier = Modifier.size(16.dp))
                    Spacer(modifier = Modifier.width(6.dp))
                    Text("Kembali", color = GoldenWarm, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Bold)
                }
            }
        }
    }
}
