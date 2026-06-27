#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ANDROID_APP_DIR="$ROOT_DIR/src-tauri/gen/android/app"
MAIN_ACTIVITY="$ANDROID_APP_DIR/src/main/java/com/mwakageneraldealer/pos/MainActivity.kt"
MANIFEST="$ANDROID_APP_DIR/src/main/AndroidManifest.xml"
PROGUARD_RULES="$ANDROID_APP_DIR/proguard-rules.pro"

if [[ ! -d "$ANDROID_APP_DIR" ]]; then
  echo "Skipping Android printer bridge patch: generated Android app not found."
  exit 0
fi

mkdir -p "$(dirname "$MAIN_ACTIVITY")"

cat >"$MAIN_ACTIVITY" <<'EOF'
package com.mwakageneraldealer.pos

import android.Manifest
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothManager
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import androidx.activity.enableEdgeToEdge
import androidx.annotation.Keep
import androidx.core.app.ActivityCompat
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.util.UUID

class MainActivity : TauriActivity() {
  private val bluetoothPermissionRequestCode = 4102
  private val sppUuid: UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB")

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    ensureBluetoothPermission()
  }

  @Keep
  fun getBluetoothPrintersJson(): String {
    if (!ensureBluetoothPermission()) {
      return "[]"
    }

    val adapter = bluetoothAdapter() ?: return "[]"
    if (!adapter.isEnabled) {
      return "[]"
    }

    val printers = JSONArray()
    for (device in adapter.bondedDevices.orEmpty()) {
      val name = safeDeviceName(device)
      if (!isLikelyPrinter(name)) {
        continue
      }

      val address = safeDeviceAddress(device)
      val id = if (address.isNotBlank()) "bt:$address" else name
      printers.put(
        JSONObject()
          .put("id", id)
          .put("name", name.ifBlank { "Bluetooth Printer" })
          .put("type", "bluetooth_paired")
          .put("status", "ready")
          .put("is_default", false)
          .put("description", "Paired Bluetooth receipt printer")
      )
    }

    return printers.toString()
  }

  @Keep
  fun printBluetoothReceiptEscPos(printerId: String, payload: ByteArray, copies: Int, paperWidth: String): String {
    if (!ensureBluetoothPermission()) {
      return "Allow Nearby devices permission, then scan printers again."
    }

    val adapter = bluetoothAdapter() ?: return "Bluetooth is not available on this device."
    if (!adapter.isEnabled) {
      return "Bluetooth is turned off."
    }

    val target = normalizePrinterId(printerId)
    val device = adapter.bondedDevices.orEmpty().firstOrNull { device ->
      val address = safeDeviceAddress(device)
      val name = safeDeviceName(device)
      address.equals(target, ignoreCase = true) ||
        name.equals(target, ignoreCase = true) ||
        "bt:$address".equals(target, ignoreCase = true)
    } ?: return "Bluetooth printer is not paired."

    return try {
      adapter.cancelDiscovery()
      val repeatCount = copies.coerceAtLeast(1)
      device.createRfcommSocketToServiceRecord(sppUuid).use { socket ->
        socket.connect()
        val output = socket.outputStream
        repeat(repeatCount) {
          output.write(payload)
          output.flush()
        }
      }
      "Printed to ${safeDeviceName(device).ifBlank { "Bluetooth printer" }}."
    } catch (error: IOException) {
      "Bluetooth print failed: ${error.message ?: "connection error"}"
    } catch (error: SecurityException) {
      "Bluetooth permission denied."
    }
  }

  private fun bluetoothAdapter(): BluetoothAdapter? {
    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
      val manager = getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
      manager?.adapter
    } else {
      @Suppress("DEPRECATION")
      BluetoothAdapter.getDefaultAdapter()
    }
  }

  private fun ensureBluetoothPermission(): Boolean {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) {
      return true
    }

    val permission = Manifest.permission.BLUETOOTH_CONNECT
    if (ActivityCompat.checkSelfPermission(this, permission) == PackageManager.PERMISSION_GRANTED) {
      return true
    }

    ActivityCompat.requestPermissions(this, arrayOf(permission), bluetoothPermissionRequestCode)
    return false
  }

  private fun safeDeviceName(device: BluetoothDevice): String {
    return try {
      device.name ?: ""
    } catch (_: SecurityException) {
      ""
    }
  }

  private fun safeDeviceAddress(device: BluetoothDevice): String {
    return try {
      device.address ?: ""
    } catch (_: SecurityException) {
      ""
    }
  }

  private fun normalizePrinterId(value: String): String {
    return value.trim().removePrefix("bt:").trim()
  }

  private fun isLikelyPrinter(name: String): Boolean {
    if (name.isBlank()) {
      return true
    }

    val lower = name.lowercase()
    return listOf(
      "printer",
      "thermal",
      "receipt",
      "pos",
      "xprinter",
      "sunmi",
      "epson",
      "star",
      "bixolon",
      "rongta",
      "gprinter",
      "mpt",
      "rpp"
    ).any { lower.contains(it) }
  }
}
EOF

if [[ -f "$MANIFEST" ]] && ! grep -q 'android.permission.BLUETOOTH_CONNECT' "$MANIFEST"; then
  python3 - "$MANIFEST" <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
text = path.read_text()
needle = '    <uses-permission android:name="android.permission.INTERNET" />'
insert = '''    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.BLUETOOTH" android:maxSdkVersion="30" />
    <uses-permission android:name="android.permission.BLUETOOTH_ADMIN" android:maxSdkVersion="30" />
    <uses-permission android:name="android.permission.BLUETOOTH_CONNECT" />'''
if needle in text:
    text = text.replace(needle, insert, 1)
path.write_text(text)
PY
fi

if [[ -f "$PROGUARD_RULES" ]] && ! grep -q 'getBluetoothPrintersJson' "$PROGUARD_RULES"; then
  cat >>"$PROGUARD_RULES" <<'EOF'

# Called from Rust through JNI. Keep method names/signatures intact in release builds.
-keep class com.mwakageneraldealer.pos.MainActivity {
    public java.lang.String getBluetoothPrintersJson();
    public java.lang.String printBluetoothReceiptEscPos(java.lang.String, byte[], int, java.lang.String);
}
EOF
fi

echo "Patched Tauri Android Bluetooth printer bridge."
