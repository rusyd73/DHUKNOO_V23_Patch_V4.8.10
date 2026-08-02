package com.example.ui.theme

import android.os.Build
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.dynamicDarkColorScheme
import androidx.compose.material3.dynamicLightColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.platform.LocalContext

private val DarkColorScheme =
  darkColorScheme(
    primary = BatuGreen,
    secondary = GoldenWarm,
    tertiary = BatuGreenLight,
    background = EmeraldDarkBg,
    surface = EmeraldSurface,
    onPrimary = TextDark,
    onSecondary = TextDark,
    onBackground = TextLight,
    onSurface = TextLight,
    surfaceVariant = EmeraldSurfaceLight,
    onSurfaceVariant = TextLight,
    error = ColorError
  )

private val LightColorScheme =
  darkColorScheme( // We want to force the gorgeous dark emerald theme for brand identity
    primary = BatuGreen,
    secondary = GoldenWarm,
    tertiary = BatuGreenLight,
    background = EmeraldDarkBg,
    surface = EmeraldSurface,
    onPrimary = TextDark,
    onSecondary = TextDark,
    onBackground = TextLight,
    onSurface = TextLight,
    surfaceVariant = EmeraldSurfaceLight,
    onSurfaceVariant = TextLight,
    error = ColorError
  )

@Composable
fun MyApplicationTheme(
  darkTheme: Boolean = isSystemInDarkTheme(),
  // Dynamic color is disabled to strictly enforce our unique green-gold branding
  dynamicColor: Boolean = false,
  useSerif: Boolean = false,
  fontScale: Float = 1.15f,
  content: @Composable () -> Unit,
) {
  val colorScheme = if (darkTheme) DarkColorScheme else LightColorScheme
  val customTypography = getCustomTypography(useSerif, fontScale)

  MaterialTheme(colorScheme = colorScheme, typography = customTypography, content = content)
}
