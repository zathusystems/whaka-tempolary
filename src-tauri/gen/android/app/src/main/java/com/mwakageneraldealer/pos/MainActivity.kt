package com.mwakageneraldealer.pos

import android.Manifest
import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothClass
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothSocket
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
import androidx.annotation.Keep
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import org.json.JSONArray
import org.json.JSONObject
import java.util.Locale
import java.util.UUID
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference

class MainActivity : TauriActivity() {
  companion object {
    private const val BLUETOOTH_PERMISSION_REQUEST_CODE = 9042
    private const val DISCOVERY_TIMEOUT_MS = 20_000L
    private const val MIN_PRINT_TIMEOUT_MS = 90_000L
    private const val MAX_PRINT_TIMEOUT_MS = 240_000L
    private const val SPLASH_READY_POLL_INTERVAL_MS = 120L
    private const val SPLASH_MAX_HOLD_MS = 12_000L

    private val SERIAL_PORT_PROFILE_UUID: UUID =
      UUID.fromString("00001101-0000-1000-8000-00805F9B34FB")

    @Volatile private var permissionRequestInFlight = false
    @Volatile private var bluetoothPermissionRequestedAtLeastOnce = false
  }

  private val mainHandler = Handler(Looper.getMainLooper())
  @Volatile private var keepSplashOnScreen = true
  private var splashReadyPoller: Runnable? = null

  override fun onCreate(savedInstanceState: Bundle?) {
    val splashScreen = installSplashScreen()
    splashScreen.setKeepOnScreenCondition { keepSplashOnScreen }

    // Hard fallback in case the webview never reports readiness.
    mainHandler.postDelayed(
      { keepSplashOnScreen = false },
      SPLASH_MAX_HOLD_MS
    )

    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
  }

  override fun onWebViewCreate(webView: WebView) {
    super.onWebViewCreate(webView)
    startSplashReadyPolling(webView)
  }

  override fun onDestroy() {
    stopSplashReadyPolling()
    keepSplashOnScreen = false
    super.onDestroy()
  }

  override fun onRequestPermissionsResult(
    requestCode: Int,
    permissions: Array<out String>,
    grantResults: IntArray
  ) {
    if (requestCode == BLUETOOTH_PERMISSION_REQUEST_CODE) {
      permissionRequestInFlight = false
    }
    super.onRequestPermissionsResult(requestCode, permissions, grantResults)
  }

  @Keep
  @SuppressLint("MissingPermission")
  fun getBluetoothPrintersJson(): String = runBlockingBluetoothOperation(
    operationName = "Bluetooth printer discovery",
    timeoutMs = DISCOVERY_TIMEOUT_MS
  ) {
    val adapter = ensureBluetoothReadyForAccess()
    val bondedDevices = adapter.bondedDevices?.toList().orEmpty()
    if (bondedDevices.isEmpty()) {
      return@runBlockingBluetoothOperation JSONArray().toString()
    }

    val uniqueBondedDevices = bondedDevices
      .distinctBy { normalizeBluetoothAddress(it.address) }
      .filter { normalizeBluetoothAddress(it.address).isNotBlank() }

    val likelyPrinters = uniqueBondedDevices.filter(::isLikelyPrinter)
    val devicesToExpose = if (likelyPrinters.isNotEmpty()) likelyPrinters else uniqueBondedDevices

    val printers = JSONArray()
    devicesToExpose.forEachIndexed { index, device ->
      val normalizedAddress = normalizeBluetoothAddress(device.address)
      if (normalizedAddress.isBlank()) {
        return@forEachIndexed
      }

      val printerName = device.name?.trim().takeUnless { it.isNullOrBlank() }
        ?: "Bluetooth Device $normalizedAddress"

      val printer = JSONObject()
      printer.put("id", "bt:$normalizedAddress")
      printer.put("name", printerName)
      printer.put("type", "bluetooth_thermal")
      printer.put("status", "ready")
      printer.put("is_default", index == 0)
      printer.put(
        "description",
        if (isLikelyPrinter(device)) {
          "Paired Bluetooth printer ($normalizedAddress)"
        } else {
          "Paired Bluetooth device ($normalizedAddress)"
        }
      )
      printers.put(printer)
    }

    printers.toString()
  }

  @Keep
  @SuppressLint("MissingPermission")
  @Suppress("UNUSED_PARAMETER")
  fun printBluetoothReceiptEscPos(
    printerId: String,
    payload: ByteArray,
    copies: Int,
    printerPaperWidth: String?
  ): String {
    if (payload.isEmpty()) {
      throw IllegalStateException("Receipt payload is empty.")
    }

    val totalCopies = copies.coerceAtLeast(1)
    val timeoutMs = (totalCopies.toLong() * 45_000L)
      .coerceIn(MIN_PRINT_TIMEOUT_MS, MAX_PRINT_TIMEOUT_MS)

    return runBlockingBluetoothOperation(
      operationName = "Bluetooth printing",
      timeoutMs = timeoutMs
    ) {
      val adapter = ensureBluetoothReadyForAccess()
      val address = extractPrinterAddress(printerId)
      val targetDevice = resolveTargetDevice(adapter, address)

      repeat(totalCopies) { index ->
        printSingleCopy(adapter, targetDevice, payload)
        if (index < totalCopies - 1) {
          Thread.sleep(150)
        }
      }

      "success"
    }
  }

  private fun startSplashReadyPolling(webView: WebView) {
    stopSplashReadyPolling()
    val startedAt = SystemClock.uptimeMillis()

    val poller = object : Runnable {
      override fun run() {
        if (!keepSplashOnScreen) {
          return
        }

        val elapsed = SystemClock.uptimeMillis() - startedAt
        if (elapsed >= SPLASH_MAX_HOLD_MS) {
          keepSplashOnScreen = false
          stopSplashReadyPolling()
          return
        }

        if ((webView.url ?: "").isBlank() || webView.url == "about:blank") {
          mainHandler.postDelayed(this, SPLASH_READY_POLL_INTERVAL_MS)
          return
        }

        try {
          webView.evaluateJavascript(
            "(function(){try{return document.documentElement && document.documentElement.getAttribute('data-tauri-app-ready')==='true';}catch(_){return false;}})();"
          ) { rawResult ->
            if (!keepSplashOnScreen) {
              return@evaluateJavascript
            }

            val appReady = rawResult?.trim()?.equals("true", ignoreCase = true) == true
            if (appReady) {
              keepSplashOnScreen = false
              stopSplashReadyPolling()
            } else {
              mainHandler.postDelayed(this, SPLASH_READY_POLL_INTERVAL_MS)
            }
          }
        } catch (_: Throwable) {
          // If evaluateJavascript fails for any reason, release splash to avoid deadlock.
          keepSplashOnScreen = false
          stopSplashReadyPolling()
        }
      }
    }

    splashReadyPoller = poller
    mainHandler.post(poller)
  }

  private fun stopSplashReadyPolling() {
    splashReadyPoller?.let { mainHandler.removeCallbacks(it) }
    splashReadyPoller = null
  }

  private fun <T> runBlockingBluetoothOperation(
    operationName: String,
    timeoutMs: Long,
    operation: () -> T
  ): T {
    val latch = CountDownLatch(1)
    val resultRef = AtomicReference<T?>(null)
    val errorRef = AtomicReference<Throwable?>(null)

    val worker = Thread {
      try {
        resultRef.set(operation())
      } catch (error: Throwable) {
        errorRef.set(error)
      } finally {
        latch.countDown()
      }
    }
    worker.name = "handypos-${operationName.lowercase(Locale.ROOT).replace(' ', '-')}"
    worker.isDaemon = true
    worker.start()

    val completed = latch.await(timeoutMs, TimeUnit.MILLISECONDS)
    if (!completed) {
      worker.interrupt()
      throw IllegalStateException(
        "$operationName timed out. Ensure Bluetooth is enabled and the printer is nearby."
      )
    }

    val error = errorRef.get()
    if (error != null) {
      when (error) {
        is IllegalStateException -> throw error
        is Exception -> throw IllegalStateException(error.message ?: "$operationName failed.", error)
        else -> throw IllegalStateException("$operationName failed.", error)
      }
    }

    return resultRef.get()
      ?: throw IllegalStateException("$operationName failed: empty result")
  }

  @SuppressLint("MissingPermission")
  private fun ensureBluetoothReadyForAccess(): BluetoothAdapter {
    ensureBluetoothPermissionsOrRequest()

    val adapter = BluetoothAdapter.getDefaultAdapter()
      ?: throw IllegalStateException("Bluetooth is not supported on this device.")

    if (!adapter.isEnabled) {
      throw IllegalStateException("Bluetooth is off. Turn on Bluetooth and try again.")
    }

    return adapter
  }

  private fun ensureBluetoothPermissionsOrRequest() {
    val runtimePermissions = requiredBluetoothRuntimePermissions()
    if (runtimePermissions.isEmpty()) {
      return
    }

    val missingPermissions = runtimePermissions.filterNot(::isPermissionGranted)
    if (missingPermissions.isEmpty()) {
      return
    }

    val permanentlyDenied = bluetoothPermissionRequestedAtLeastOnce &&
      missingPermissions.none { permission ->
        ActivityCompat.shouldShowRequestPermissionRationale(this, permission)
      }

    if (permanentlyDenied) {
      throw IllegalStateException(
        "Bluetooth permission is denied. Open Android Settings > Apps > Mwaka POS > Permissions and allow Nearby devices."
      )
    }

    if (!permissionRequestInFlight) {
      permissionRequestInFlight = true
      bluetoothPermissionRequestedAtLeastOnce = true
      val permissionsToRequest = missingPermissions.toTypedArray()
      runOnUiThread {
        ActivityCompat.requestPermissions(
          this,
          permissionsToRequest,
          BLUETOOTH_PERMISSION_REQUEST_CODE
        )
      }
    }

    throw IllegalStateException(
      "Bluetooth permission requested. Please allow Nearby devices permission, then tap Scan for Printers again."
    )
  }

  private fun requiredBluetoothRuntimePermissions(): Array<String> {
    val requiredPermissions = mutableListOf<String>()

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      requiredPermissions.add(Manifest.permission.BLUETOOTH_SCAN)
      requiredPermissions.add(Manifest.permission.BLUETOOTH_CONNECT)
    } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
      requiredPermissions.add(Manifest.permission.ACCESS_FINE_LOCATION)
    }

    return requiredPermissions
      .filter(::isPermissionDeclared)
      .distinct()
      .toTypedArray()
  }

  private fun isPermissionGranted(permission: String): Boolean {
    return ContextCompat.checkSelfPermission(this, permission) == PackageManager.PERMISSION_GRANTED
  }

  private fun isPermissionDeclared(permission: String): Boolean {
    return try {
      val packageInfo = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        packageManager.getPackageInfo(
          packageName,
          PackageManager.PackageInfoFlags.of(PackageManager.GET_PERMISSIONS.toLong())
        )
      } else {
        @Suppress("DEPRECATION")
        packageManager.getPackageInfo(packageName, PackageManager.GET_PERMISSIONS)
      }

      packageInfo.requestedPermissions?.contains(permission) == true
    } catch (_: Exception) {
      false
    }
  }

  private fun isLikelyPrinter(device: BluetoothDevice): Boolean {
    val deviceName = (device.name ?: "").lowercase(Locale.ROOT)
    val printerKeywords = listOf(
      "printer",
      "thermal",
      "receipt",
      "epson",
      "star",
      "sunmi",
      "xprinter",
      "bixolon",
      "pos"
    )

    if (printerKeywords.any { keyword -> deviceName.contains(keyword) }) {
      return true
    }

    val bluetoothClass = device.bluetoothClass ?: return false
    return bluetoothClass.majorDeviceClass == BluetoothClass.Device.Major.IMAGING
  }

  private fun normalizeBluetoothAddress(address: String?): String {
    if (address.isNullOrBlank()) {
      return ""
    }

    val compact = address
      .trim()
      .replace(":", "")
      .replace("-", "")
      .uppercase(Locale.ROOT)

    if (compact.length != 12 || !compact.all { ch -> ch in '0'..'9' || ch in 'A'..'F' }) {
      return ""
    }

    return compact.chunked(2).joinToString(":")
  }

  private fun extractPrinterAddress(printerId: String): String {
    val rawAddress = if (printerId.startsWith("bt:", ignoreCase = true)) {
      printerId.substring(3)
    } else {
      printerId
    }

    return normalizeBluetoothAddress(rawAddress).ifBlank {
      throw IllegalStateException("Invalid Bluetooth printer identifier: $printerId")
    }
  }

  @SuppressLint("MissingPermission")
  private fun resolveTargetDevice(adapter: BluetoothAdapter, normalizedAddress: String): BluetoothDevice {
    val device = adapter.bondedDevices
      .firstOrNull { normalizeBluetoothAddress(it.address) == normalizedAddress }

    return device ?: throw IllegalStateException(
      "Printer $normalizedAddress is not paired. Pair the printer in Android Bluetooth settings first."
    )
  }

  @SuppressLint("MissingPermission")
  private fun printSingleCopy(
    adapter: BluetoothAdapter,
    device: BluetoothDevice,
    payload: ByteArray
  ) {
    adapter.cancelDiscovery()

    val socket = connectToPrinterSocket(device)
    try {
      val output = socket.outputStream
      output.write(payload)
      output.flush()
      Thread.sleep(120)
    } catch (error: Exception) {
      throw IllegalStateException(
        "Failed sending data to ${device.name ?: "Bluetooth printer"}: " +
          (error.message ?: error.javaClass.simpleName)
      )
    } finally {
      closeQuietly(socket)
    }
  }

  @SuppressLint("MissingPermission")
  private fun connectToPrinterSocket(device: BluetoothDevice): BluetoothSocket {
    val attempts = listOf(
      "secure RFCOMM" to { createSocket(device, secure = true) },
      "insecure RFCOMM" to { createSocket(device, secure = false) },
      "legacy RFCOMM channel 1" to { createLegacySocket(device) }
    )

    val failures = mutableListOf<String>()
    for ((label, createSocket) in attempts) {
      var socket: BluetoothSocket? = null
      try {
        socket = createSocket()
        socket.connect()
        return socket
      } catch (error: Exception) {
        failures.add("$label: ${error.message ?: error.javaClass.simpleName}")
        closeQuietly(socket)
      }
    }

    val failureSummary = failures.joinToString(" | ")
    throw IllegalStateException(
      "Failed to connect to ${device.name ?: "Bluetooth printer"}. $failureSummary"
    )
  }

  private fun createSocket(device: BluetoothDevice, secure: Boolean): BluetoothSocket {
    return if (secure) {
      device.createRfcommSocketToServiceRecord(SERIAL_PORT_PROFILE_UUID)
    } else {
      device.createInsecureRfcommSocketToServiceRecord(SERIAL_PORT_PROFILE_UUID)
    }
  }

  private fun createLegacySocket(device: BluetoothDevice): BluetoothSocket {
    val method = device.javaClass.getMethod("createRfcommSocket", Int::class.javaPrimitiveType)
    return method.invoke(device, 1) as BluetoothSocket
  }

  private fun closeQuietly(socket: BluetoothSocket?) {
    try {
      socket?.close()
    } catch (_: Exception) {
    }
  }
}
