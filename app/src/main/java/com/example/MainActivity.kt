package com.example

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.viewmodel.compose.viewModel
import com.example.data.ObamaDatabase
import com.example.data.ObamaRepository
import com.example.ui.ObamaViewModel
import com.example.ui.ObamaViewModelFactory
import com.example.ui.components.CustomerLoginScreen
import com.example.ui.components.DriverLoginScreen
import com.example.ui.components.AdminLoginScreen
import com.example.ui.screens.AdminScreen
import com.example.ui.screens.CustomerScreen
import com.example.ui.screens.DriverScreen
import com.example.ui.screens.LauncherHubScreen
import com.example.ui.theme.*

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        // Initialize Room Database & Repository
        val database = ObamaDatabase.getDatabase(this)
        val repository = ObamaRepository(database.obamaDao())

        setContent {
            // Initialize ViewModel with custom factory
            val obamaViewModel: ObamaViewModel = viewModel(
                factory = ObamaViewModelFactory(application, repository)
            )
            val useSerif by obamaViewModel.useSerifFont.collectAsState()
            val fontScale by obamaViewModel.fontScale.collectAsState()

            MyApplicationTheme(useSerif = useSerif, fontScale = fontScale) {
                ObamaAppShell(viewModel = obamaViewModel)
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ObamaAppShell(viewModel: ObamaViewModel) {
    val currentRole by viewModel.currentAppRole.collectAsState()
    val customerEmail by viewModel.customerEmail.collectAsState()
    val driverEmail by viewModel.driverEmail.collectAsState()
    val isAdminLoggedIn by viewModel.isAdminLoggedIn.collectAsState()

    val notificationMessage by viewModel.notification.collectAsState()
    val wallet by viewModel.walletState.collectAsState()

    Scaffold(
        modifier = Modifier.fillMaxSize(),
        containerColor = EmeraldDarkBg,
        topBar = {
            // 1. Direct Sound-Synced Push Notification Banner (Sticky at top)
            AnimatedVisibility(
                visible = notificationMessage != null,
                enter = slideInVertically(initialOffsetY = { -it }) + fadeIn(),
                exit = slideOutVertically(targetOffsetY = { -it }) + fadeOut()
            ) {
                notificationMessage?.let { msg ->
                    Column(modifier = Modifier.fillMaxWidth()) {
                        Box(
                            modifier = Modifier
                                .fillMaxWidth()
                                .background(GoldenWarm)
                                .padding(horizontal = 16.dp, vertical = 10.dp)
                                .testTag("push_notification_banner"),
                            contentAlignment = Alignment.CenterStart
                        ) {
                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(10.dp)
                            ) {
                                Icon(
                                    imageVector = Icons.Default.NotificationsActive,
                                    contentDescription = "Alert",
                                    tint = TextDark,
                                    modifier = Modifier.size(20.dp)
                                )
                                Text(
                                    text = msg,
                                    color = TextDark,
                                    style = MaterialTheme.typography.bodyMedium,
                                    fontWeight = FontWeight.Bold,
                                    modifier = Modifier.weight(1f)
                                )
                            }
                        }
                        HorizontalDivider(color = BatuGreen, thickness = 1.5.dp)
                    }
                }
            }
        }
    ) { innerPadding ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(innerPadding)
        ) {
            when (currentRole) {
                null -> {
                    // Launcher Hub Screen
                    LauncherHubScreen(
                        viewModel = viewModel,
                        modifier = Modifier.fillMaxSize()
                    )
                }

                "CUSTOMER" -> {
                    if (customerEmail == null) {
                        // Customer activation/login
                        CustomerLoginScreen(
                            viewModel = viewModel,
                            onBack = { viewModel.setAppRole(null) }
                        )
                    } else {
                        // Standing customer app
                        Scaffold(
                            topBar = {
                                TopAppBar(
                                    title = {
                                        Column {
                                            Row(verticalAlignment = Alignment.CenterVertically) {
                                                Text(
                                                    text = "OBAMA",
                                                    color = GoldenWarm,
                                                    style = MaterialTheme.typography.titleMedium,
                                                    fontWeight = FontWeight.ExtraBold
                                                )
                                                Spacer(modifier = Modifier.width(4.dp))
                                                Text(
                                                    text = "Ride",
                                                    color = BatuGreenLight,
                                                    style = MaterialTheme.typography.titleSmall,
                                                    fontWeight = FontWeight.Bold
                                                )
                                            }
                                            Text(
                                                text = "Customer: $customerEmail",
                                                color = TextMuted,
                                                style = MaterialTheme.typography.labelSmall
                                            )
                                        }
                                    },
                                    actions = {
                                        wallet?.let { w ->
                                            Row(
                                                modifier = Modifier
                                                    .background(EmeraldSurfaceLight, RoundedCornerShape(12.dp))
                                                    .border(1.dp, BatuGreen.copy(alpha = 0.2f), RoundedCornerShape(12.dp))
                                                    .padding(horizontal = 10.dp, vertical = 6.dp),
                                                verticalAlignment = Alignment.CenterVertically,
                                                horizontalArrangement = Arrangement.spacedBy(6.dp)
                                            ) {
                                                Box(
                                                    modifier = Modifier
                                                        .size(6.dp)
                                                        .background(BatuGreen, CircleShape)
                                                )
                                                Text(
                                                    text = "Rp ${viewModel.formatRupiah(w.balance)}",
                                                    color = TextLight,
                                                    style = MaterialTheme.typography.labelMedium,
                                                    fontWeight = FontWeight.Bold
                                                )
                                            }
                                        }
                                        Spacer(modifier = Modifier.width(8.dp))
                                        IconButton(
                                            onClick = { viewModel.logoutCustomer() },
                                            modifier = Modifier.testTag("customer_logout_button")
                                        ) {
                                            Icon(
                                                imageVector = Icons.Default.Logout,
                                                contentDescription = "Keluar Aplikasi",
                                                tint = ColorError
                                            )
                                        }
                                    },
                                    colors = TopAppBarDefaults.topAppBarColors(
                                        containerColor = EmeraldSurface,
                                        titleContentColor = TextLight
                                    )
                                )
                            }
                        ) { cPadding ->
                            CustomerScreen(
                                viewModel = viewModel,
                                modifier = Modifier
                                    .fillMaxSize()
                                    .padding(cPadding)
                            )
                        }
                    }
                }

                "DRIVER" -> {
                    if (driverEmail == null) {
                        // Driver activation/login
                        DriverLoginScreen(
                            viewModel = viewModel,
                            onBack = { viewModel.setAppRole(null) }
                        )
                    } else {
                        // Standing driver app
                        Scaffold(
                            topBar = {
                                TopAppBar(
                                    title = {
                                        Column {
                                            Row(verticalAlignment = Alignment.CenterVertically) {
                                                Text(
                                                    text = "OBAMA",
                                                    color = GoldenWarm,
                                                    style = MaterialTheme.typography.titleMedium,
                                                    fontWeight = FontWeight.ExtraBold
                                                )
                                                Spacer(modifier = Modifier.width(4.dp))
                                                Text(
                                                    text = "Driver Companion",
                                                    color = BatuGreenLight,
                                                    style = MaterialTheme.typography.titleSmall,
                                                    fontWeight = FontWeight.Bold
                                                )
                                            }
                                            Text(
                                                text = "Mitra: $driverEmail",
                                                color = TextMuted,
                                                style = MaterialTheme.typography.labelSmall
                                            )
                                        }
                                    },
                                    actions = {
                                        IconButton(
                                            onClick = { viewModel.logoutDriver() },
                                            modifier = Modifier.testTag("driver_logout_button")
                                        ) {
                                            Icon(
                                                imageVector = Icons.Default.Logout,
                                                contentDescription = "Keluar Aplikasi",
                                                tint = ColorError
                                            )
                                        }
                                    },
                                    colors = TopAppBarDefaults.topAppBarColors(
                                        containerColor = EmeraldSurface,
                                        titleContentColor = TextLight
                                    )
                                )
                            }
                        ) { dPadding ->
                            DriverScreen(
                                viewModel = viewModel,
                                modifier = Modifier
                                    .fillMaxSize()
                                    .padding(dPadding)
                            )
                        }
                    }
                }

                "ADMIN" -> {
                    if (!isAdminLoggedIn) {
                        // Admin login
                        AdminLoginScreen(
                            viewModel = viewModel,
                            onBack = { viewModel.setAppRole(null) }
                        )
                    } else {
                        // Standing Admin App
                        Scaffold(
                            topBar = {
                                TopAppBar(
                                    title = {
                                        Row(verticalAlignment = Alignment.CenterVertically) {
                                            Text(
                                                text = "OBAMA",
                                                color = GoldenWarm,
                                                style = MaterialTheme.typography.titleMedium,
                                                fontWeight = FontWeight.ExtraBold
                                            )
                                            Spacer(modifier = Modifier.width(4.dp))
                                            Text(
                                                text = "Admin Panel",
                                                color = ColorError,
                                                style = MaterialTheme.typography.titleSmall,
                                                fontWeight = FontWeight.Bold
                                            )
                                        }
                                    },
                                    actions = {
                                        IconButton(
                                            onClick = { viewModel.resetAll() },
                                            modifier = Modifier.testTag("reset_application_button")
                                        ) {
                                            Icon(
                                                imageVector = Icons.Default.Refresh,
                                                contentDescription = "Reset Database",
                                                tint = GoldenWarm
                                            )
                                        }
                                        Spacer(modifier = Modifier.width(4.dp))
                                        IconButton(
                                            onClick = { viewModel.logoutAdmin() },
                                            modifier = Modifier.testTag("admin_logout_button")
                                        ) {
                                            Icon(
                                                imageVector = Icons.Default.Logout,
                                                contentDescription = "Keluar Panel Admin",
                                                tint = ColorError
                                            )
                                        }
                                    },
                                    colors = TopAppBarDefaults.topAppBarColors(
                                        containerColor = EmeraldSurface,
                                        titleContentColor = TextLight
                                    )
                                )
                            }
                        ) { aPadding ->
                            AdminScreen(
                                viewModel = viewModel,
                                modifier = Modifier
                                    .fillMaxSize()
                                    .padding(aPadding)
                            )
                        }
                    }
                }
            }
        }
    }
}
