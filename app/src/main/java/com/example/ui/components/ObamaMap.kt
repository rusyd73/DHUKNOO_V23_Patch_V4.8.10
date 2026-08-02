package com.example.ui.components

import androidx.compose.animation.core.*
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.LocationOn
import androidx.compose.material.icons.filled.Navigation
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.example.data.LocationData
import com.example.data.LocationPoint
import com.example.data.OrderEntity
import com.example.ui.theme.*

@Composable
fun ObamaMap(
    activeOrder: OrderEntity?,
    modifier: Modifier = Modifier,
    onLocationSelect: ((LocationPoint) -> Unit)? = null
) {
    val infiniteTransition = rememberInfiniteTransition(label = "pulse")
    val pulseScale by infiniteTransition.animateFloat(
        initialValue = 0.8f,
        targetValue = 1.3f,
        animationSpec = infiniteRepeatable(
            animation = tween(1200, easing = LinearEasing),
            repeatMode = RepeatMode.Reverse
        ),
        label = "pulseScale"
    )

    val neonAlpha by infiniteTransition.animateFloat(
        initialValue = 0.4f,
        targetValue = 0.8f,
        animationSpec = infiniteRepeatable(
            animation = tween(1000, easing = LinearEasing),
            repeatMode = RepeatMode.Reverse
        ),
        label = "neonAlpha"
    )

    BoxWithConstraints(
        modifier = modifier
            .fillMaxWidth()
            .height(280.dp)
            .clip(RoundedCornerShape(16.dp))
            .background(EmeraldDarkBg)
            .border(1.5.dp, EmeraldSurfaceLight, RoundedCornerShape(16.dp))
            .testTag("obama_map_container")
    ) {
        val widthPx = constraints.maxWidth.toFloat()
        val heightPx = constraints.maxHeight.toFloat()
        val widthDp = maxWidth
        val heightDp = maxHeight

        // 1. Draw Map Roads & Active Neon Route on Canvas
        Canvas(modifier = Modifier.fillMaxSize()) {
            // Draw subtle background grid
            val gridSpacing = 40.dp.toPx()
            val cols = (size.width / gridSpacing).toInt()
            val rows = (size.height / gridSpacing).toInt()
            for (i in 0..cols) {
                drawLine(
                    color = EmeraldSurface.copy(alpha = 0.4f),
                    start = Offset(i * gridSpacing, 0f),
                    end = Offset(i * gridSpacing, size.height),
                    strokeWidth = 1f
                )
            }
            for (i in 0..rows) {
                drawLine(
                    color = EmeraldSurface.copy(alpha = 0.4f),
                    start = Offset(0f, i * gridSpacing),
                    end = Offset(size.width, i * gridSpacing),
                    strokeWidth = 1f
                )
            }

            // Draw abstract regional connection roads (Batu - Malang Raya route network)
            val pathPoints = LocationData.locations
            val dottedEffect = PathEffect.dashPathEffect(floatArrayOf(12f, 12f), 0f)

            // Connect Batu sites to Malang sites to outline the transit lanes
            for (i in 0 until pathPoints.size - 1) {
                val start = pathPoints[i]
                val end = pathPoints[i + 1]
                drawLine(
                    color = EmeraldSurfaceLight.copy(alpha = 0.7f),
                    start = Offset(start.x * size.width, start.y * size.height),
                    end = Offset(end.x * size.width, end.y * size.height),
                    strokeWidth = 3f,
                    pathEffect = dottedEffect
                )
            }

            // Connect Batu directly to Malang (Alun Alun Batu -> UB)
            val batuAlun = pathPoints[0] // Alun-Alun Batu
            val ub = pathPoints[3] // UB
            drawLine(
                color = EmeraldSurfaceLight.copy(alpha = 0.7f),
                start = Offset(batuAlun.x * size.width, batuAlun.y * size.height),
                end = Offset(ub.x * size.width, ub.y * size.height),
                strokeWidth = 3f,
                pathEffect = dottedEffect
            )

            // 2. Draw Active Neon Route
            if (activeOrder != null && activeOrder.status != "NONE" && activeOrder.status != "COMPLETED") {
                val pX = activeOrder.pickupX * size.width
                val pY = activeOrder.pickupY * size.height
                val dX = activeOrder.destX * size.width
                val dY = activeOrder.destY * size.height

                // Neon glow outer line
                drawLine(
                    color = BatuGreen.copy(alpha = neonAlpha * 0.4f),
                    start = Offset(pX, pY),
                    end = Offset(dX, dY),
                    strokeWidth = 12f,
                    cap = StrokeCap.Round
                )
                // Neon glow inner line
                drawLine(
                    color = BatuGreenLight,
                    start = Offset(pX, pY),
                    end = Offset(dX, dY),
                    strokeWidth = 4f,
                    cap = StrokeCap.Round
                )
            }
        }

        // 2. Render Location Pins & Labels
        LocationData.locations.forEach { loc ->
            val isPickup = activeOrder != null && activeOrder.status != "NONE" && activeOrder.pickupName == loc.name
            val isDest = activeOrder != null && activeOrder.status != "NONE" && activeOrder.destinationName == loc.name

            val pinColor = when {
                isPickup -> BatuGreen
                isDest -> GoldenWarm
                else -> TextMuted.copy(alpha = 0.8f)
            }

            val pinSize = if (isPickup || isDest) 20.dp else 12.dp

            // Map relative coordinate (0-1) to DP
            val offsetLeft = widthDp * loc.x - (pinSize / 2)
            val offsetTop = heightDp * loc.y - (pinSize / 2)

            Box(
                modifier = Modifier
                    .offset(x = offsetLeft, y = offsetTop)
                    .size(pinSize)
                    .clickable(enabled = onLocationSelect != null) {
                        onLocationSelect?.invoke(loc)
                    },
                contentAlignment = Alignment.Center
            ) {
                // Pulsing outer ring for active nodes
                if (isPickup || isDest) {
                    Box(
                        modifier = Modifier
                            .fillMaxSize()
                            .shadow(4.dp, CircleShape)
                            .background(pinColor.copy(alpha = 0.3f), CircleShape)
                            .border(1.dp, pinColor.copy(alpha = pulseScale), CircleShape)
                    )
                }

                // Inner Solid Circle
                Box(
                    modifier = Modifier
                        .size(if (isPickup || isDest) 10.dp else 6.dp)
                        .background(pinColor, CircleShape)
                )
            }

            // Text Label
            val labelLeft = widthDp * loc.x - 55.dp
            val labelTop = heightDp * loc.y + (pinSize / 2) + 2.dp
            Text(
                text = loc.name,
                color = if (isPickup || isDest) TextLight else TextMuted,
                fontSize = 9.sp,
                fontWeight = if (isPickup || isDest) FontWeight.Bold else FontWeight.Normal,
                textAlign = TextAlign.Center,
                modifier = Modifier
                    .offset(x = labelLeft, y = labelTop)
                    .width(110.dp)
                    .background(EmeraldDarkBg.copy(alpha = 0.75f), RoundedCornerShape(4.dp))
                    .padding(horizontal = 2.dp, vertical = 1.dp)
            )
        }

        // 3. Render Driver Icon (Vehicle)
        if (activeOrder != null && activeOrder.status != "NONE" && activeOrder.status != "COMPLETED" && activeOrder.driverX != 0f) {
            val dLeft = widthDp * activeOrder.driverX - 18.dp
            val dTop = widthDp * (activeOrder.driverY * (heightDp / widthDp)) - 18.dp // Aspect ratio matching

            val iconEmoji = when (activeOrder.serviceType) {
                "OBAMA-Ride" -> "🛵"
                "OBAMA-Car" -> "🚗"
                else -> "📦"
            }

            Box(
                modifier = Modifier
                    .offset(x = dLeft, y = dTop)
                    .size(36.dp)
                    .shadow(6.dp, CircleShape)
                    .background(GoldenWarm, CircleShape)
                    .border(2.dp, BatuGreen, CircleShape)
                    .testTag("driver_vehicle_marker"),
                contentAlignment = Alignment.Center
            ) {
                Text(
                    text = iconEmoji,
                    fontSize = 18.sp
                )
            }
        }

        // Legend Overlays (Top Left)
        Card(
            colors = CardDefaults.cardColors(containerColor = EmeraldSurface.copy(alpha = 0.85f)),
            shape = RoundedCornerShape(8.dp),
            modifier = Modifier
                .padding(8.dp)
                .align(Alignment.TopStart)
        ) {
            Column(modifier = Modifier.padding(6.dp)) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(4.dp)
                ) {
                    Box(modifier = Modifier.size(6.dp).background(BatuGreen, CircleShape))
                    Text("Jemput", color = TextLight, fontSize = 8.sp, fontWeight = FontWeight.Bold)
                }
                Spacer(modifier = Modifier.height(3.dp))
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(4.dp)
                ) {
                    Box(modifier = Modifier.size(6.dp).background(GoldenWarm, CircleShape))
                    Text("Tujuan", color = TextLight, fontSize = 8.sp, fontWeight = FontWeight.Bold)
                }
            }
        }

        // Compass Overlay (Top Right)
        Box(
            modifier = Modifier
                .padding(8.dp)
                .size(28.dp)
                .shadow(2.dp, CircleShape)
                .background(EmeraldSurface.copy(alpha = 0.85f), CircleShape)
                .align(Alignment.TopEnd),
            contentAlignment = Alignment.Center
        ) {
            Icon(
                imageVector = Icons.Default.Navigation,
                contentDescription = "Compass",
                tint = GoldenWarm,
                modifier = Modifier
                    .size(16.dp)
                    .rotate(45f) // point North-East
            )
        }
    }
}
