package com.example.ui.screens

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.example.ui.ObamaViewModel
import com.example.ui.theme.*

@Composable
fun LauncherHubScreen(
    viewModel: ObamaViewModel,
    modifier: Modifier = Modifier
) {
    val useSerif by viewModel.useSerifFont.collectAsState()
    val fontScale by viewModel.fontScale.collectAsState()

    LazyColumn(
        modifier = modifier
            .fillMaxSize()
            .background(EmeraldDarkBg)
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        // 1. BRAND HERO BANNER
        item {
            Card(
                colors = CardDefaults.cardColors(containerColor = EmeraldSurface),
                shape = RoundedCornerShape(24.dp),
                border = BorderStroke(1.5.dp, GoldenWarm.copy(alpha = 0.4f)),
                modifier = Modifier.fillMaxWidth()
            ) {
                Column(
                    modifier = Modifier
                        .background(Brush.verticalGradient(listOf(EmeraldSurface, EmeraldDarkBg)))
                        .padding(24.dp),
                    horizontalAlignment = Alignment.CenterHorizontally
                ) {
                    Box(
                        modifier = Modifier
                            .size(72.dp)
                            .background(GoldenWarm, CircleShape)
                            .border(2.dp, BatuGreen, CircleShape),
                        contentAlignment = Alignment.Center
                    ) {
                        Text(
                            text = "🍏",
                            fontSize = 36.sp,
                            textAlign = TextAlign.Center
                        )
                    }

                    Spacer(modifier = Modifier.height(16.dp))

                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            text = "OBAMA",
                            color = GoldenWarm,
                            style = MaterialTheme.typography.headlineLarge,
                            fontWeight = FontWeight.ExtraBold
                        )
                        Spacer(modifier = Modifier.width(6.dp))
                        Text(
                            text = "Ride",
                            color = BatuGreenLight,
                            style = MaterialTheme.typography.headlineSmall,
                            fontWeight = FontWeight.Bold
                        )
                    }

                    Text(
                        text = "Ojek Batu - Malang Raya",
                        color = TextMuted,
                        style = MaterialTheme.typography.bodyMedium,
                        fontWeight = FontWeight.Bold,
                        modifier = Modifier.padding(top = 4.dp)
                    )

                    Spacer(modifier = Modifier.height(8.dp))

                    Text(
                        text = "Sistem Simulasi Transportasi Online Terintegrasi. Pilih aplikasi mandiri di bawah untuk memulai.",
                        color = TextLight.copy(alpha = 0.8f),
                        style = MaterialTheme.typography.bodyMedium,
                        textAlign = TextAlign.Center
                    )
                }
            }
        }

        // 2. TYPOGRAPHY ACCESSIBILITY PANEL (Arial / Times New Roman & Font Size)
        item {
            Card(
                colors = CardDefaults.cardColors(containerColor = EmeraldSurface),
                shape = RoundedCornerShape(16.dp),
                border = BorderStroke(1.dp, EmeraldSurfaceLight),
                modifier = Modifier.fillMaxWidth()
            ) {
                Column(modifier = Modifier.padding(16.dp)) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        Icon(Icons.Default.TextFormat, contentDescription = null, tint = GoldenWarm)
                        Text(
                            text = "Pengaturan Tampilan & Keterbacaan",
                            style = MaterialTheme.typography.titleMedium,
                            color = GoldenWarm,
                            fontWeight = FontWeight.Bold
                        )
                    }

                    Spacer(modifier = Modifier.height(12.dp))

                    // Font Selection (Arial vs Times New Roman)
                    Text(
                        text = "Pilih Gaya Font (Font Family):",
                        color = TextLight,
                        style = MaterialTheme.typography.bodyMedium,
                        fontWeight = FontWeight.Bold
                    )
                    Spacer(modifier = Modifier.height(8.dp))

                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        // Arial / Sans-Serif
                        Box(
                            modifier = Modifier
                                .weight(1f)
                                .clip(RoundedCornerShape(8.dp))
                                .background(if (!useSerif) EmeraldSurfaceLight else EmeraldDarkBg)
                                .border(1.dp, if (!useSerif) BatuGreen else EmeraldSurfaceLight, RoundedCornerShape(8.dp))
                                .clickable { if (useSerif) viewModel.toggleFontFamily() }
                                .padding(10.dp),
                            contentAlignment = Alignment.Center
                        ) {
                            Text(
                                text = "Arial (Sans-Serif)",
                                color = if (!useSerif) BatuGreenLight else TextMuted,
                                style = MaterialTheme.typography.bodyMedium,
                                fontWeight = FontWeight.Bold
                            )
                        }

                        // Times New Roman / Serif
                        Box(
                            modifier = Modifier
                                .weight(1f)
                                .clip(RoundedCornerShape(8.dp))
                                .background(if (useSerif) EmeraldSurfaceLight else EmeraldDarkBg)
                                .border(1.dp, if (useSerif) BatuGreen else EmeraldSurfaceLight, RoundedCornerShape(8.dp))
                                .clickable { if (!useSerif) viewModel.toggleFontFamily() }
                                .padding(10.dp),
                            contentAlignment = Alignment.Center
                        ) {
                            Text(
                                text = "Times New Roman (Serif)",
                                color = if (useSerif) BatuGreenLight else TextMuted,
                                style = MaterialTheme.typography.bodyMedium,
                                fontWeight = FontWeight.Bold
                            )
                        }
                    }

                    Spacer(modifier = Modifier.height(14.dp))

                    // Font Size Scale
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Column {
                            Text(
                                text = "Ukuran Font Lebih Besar:",
                                color = TextLight,
                                style = MaterialTheme.typography.bodyMedium,
                                fontWeight = FontWeight.Bold
                            )
                            Text(
                                text = "Meningkatkan keterbacaan seluruh layar",
                                color = TextMuted,
                                style = MaterialTheme.typography.bodySmall
                            )
                        }

                        Button(
                            onClick = { viewModel.increaseFontScale() },
                            colors = ButtonDefaults.buttonColors(containerColor = BatuGreen),
                            shape = RoundedCornerShape(8.dp),
                            contentPadding = PaddingValues(horizontal = 12.dp, vertical = 6.dp)
                        ) {
                            Icon(Icons.Default.ZoomIn, contentDescription = null, tint = TextDark, modifier = Modifier.size(16.dp))
                            Spacer(modifier = Modifier.width(4.dp))
                            Text(
                                text = "${(fontScale * 100).toInt()}%",
                                color = TextDark,
                                style = MaterialTheme.typography.labelMedium,
                                fontWeight = FontWeight.Bold
                            )
                        }
                    }
                }
            }
        }

        // 3. APPLICATIONS SELECTOR (SEPARATED DASHBOARDS)
        item {
            Column(
                modifier = Modifier.fillMaxWidth(),
                verticalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                Text(
                    text = "Daftar Aplikasi Mandiri",
                    color = TextLight,
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Bold,
                    modifier = Modifier.padding(start = 4.dp, top = 4.dp)
                )

                // 3a. Customer App Card
                AppLauncherCard(
                    title = "Aplikasi Customer",
                    description = "Pesan perjalanan (Ojek & Mobil), sewa armada, pengiriman barang, top up saldo, & chat dengan mitra driver.",
                    icon = Icons.Default.Person,
                    badgeText = "Customer",
                    badgeColor = GoldenWarm,
                    onClick = { viewModel.setAppRole("CUSTOMER") },
                    modifier = Modifier.testTag("launch_customer_app")
                )

                // 3b. Driver App Card
                AppLauncherCard(
                    title = "Aplikasi Mitra Driver",
                    description = "Dasbor pengemudi untuk mengelola status online, menerima pesanan, navigasi penjemputan, & melacak dompet pendapatan.",
                    icon = Icons.Default.DirectionsBike,
                    badgeText = "Mitra Driver",
                    badgeColor = BatuGreenLight,
                    onClick = { viewModel.setAppRole("DRIVER") },
                    modifier = Modifier.testTag("launch_driver_app")
                )

                // 3c. Admin App Card
                AppLauncherCard(
                    title = "Dashboard Admin",
                    description = "Akses panel kontrol sistem pusat. Lacak mitra terdaftar, pendaftaran manual, verifikasi dokumen, & kelola keamanan.",
                    icon = Icons.Default.AdminPanelSettings,
                    badgeText = "Sistem Admin",
                    badgeColor = ColorError,
                    onClick = { viewModel.setAppRole("ADMIN") },
                    modifier = Modifier.testTag("launch_admin_app")
                )
            }
        }

        item {
            Spacer(modifier = Modifier.height(24.dp))
        }
    }
}

@Composable
fun AppLauncherCard(
    title: String,
    description: String,
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    badgeText: String,
    badgeColor: Color,
    onClick: () -> Unit,
    modifier: Modifier = Modifier
) {
    Card(
        colors = CardDefaults.cardColors(containerColor = EmeraldSurface),
        shape = RoundedCornerShape(16.dp),
        border = BorderStroke(1.dp, EmeraldSurfaceLight),
        modifier = modifier
            .fillMaxWidth()
            .clickable { onClick() }
    ) {
        Row(
            modifier = Modifier.padding(16.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    Box(
                        modifier = Modifier
                            .size(28.dp)
                            .background(badgeColor.copy(alpha = 0.15f), CircleShape),
                        contentAlignment = Alignment.Center
                    ) {
                        Icon(icon, contentDescription = null, tint = badgeColor, modifier = Modifier.size(16.dp))
                    }

                    Text(
                        text = title,
                        style = MaterialTheme.typography.titleMedium,
                        color = TextLight,
                        fontWeight = FontWeight.Bold
                    )
                }

                Spacer(modifier = Modifier.height(6.dp))

                Text(
                    text = description,
                    style = MaterialTheme.typography.bodyMedium,
                    color = TextMuted,
                    lineHeight = 18.sp
                )

                Spacer(modifier = Modifier.height(8.dp))

                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(6.dp)
                ) {
                    Box(
                        modifier = Modifier
                            .background(badgeColor.copy(alpha = 0.2f), RoundedCornerShape(4.dp))
                            .padding(horizontal = 6.dp, vertical = 2.dp)
                    ) {
                        Text(
                            text = badgeText,
                            color = badgeColor,
                            fontSize = 9.sp,
                            fontWeight = FontWeight.Bold
                        )
                    }
                    Text(
                        text = "• Klik untuk Meluncurkan Aplikasi",
                        color = BatuGreenLight,
                        fontSize = 10.sp,
                        fontWeight = FontWeight.Bold
                    )
                }
            }

            Icon(
                imageVector = Icons.Default.ArrowForwardIos,
                contentDescription = null,
                tint = TextMuted.copy(alpha = 0.5f),
                modifier = Modifier
                    .size(16.dp)
                    .padding(start = 8.dp)
            )
        }
    }
}
