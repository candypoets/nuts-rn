package com.nutsrn.nativecomponents

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
import android.view.View
import com.facebook.react.bridge.ReadableArray
import java.nio.ByteBuffer
import java.nio.ByteOrder
import nostr.fb.Message
import nostr.fb.ParsedEvent
import nostr.fb.WorkerMessage

class NativeNoteHeaderView(context: Context) : View(context) {
  private val avatarPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.rgb(229, 231, 235) }
  private val accentPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.rgb(37, 99, 235) }
  private val primaryTextPaint =
      Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.rgb(17, 24, 39)
        isFakeBoldText = true
      }
  private val secondaryTextPaint =
      Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.rgb(107, 114, 128) }
  private val faintTextPaint =
      Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.argb(90, 107, 114, 128) }

  private var noteBytes: ByteArray? = null
  private var relays: List<String> = emptyList()
  private var visible = true
  private var depth = 0
  private var main = false
  private var showRelays = true
  private var relayCount = 0
  private var reposterPubkey: String? = null
  private var fallbackSubId: String? = null

  private var pubkey = ""
  private var createdAt = 0L
  private var subId = ""
  private var name = ""
  private var nip05 = ""
  private var picture = ""

  fun setNoteBytes(value: ReadableArray?) {
    noteBytes = value?.toByteArray()
    parseNote()
    invalidate()
  }

  fun setRelays(value: ReadableArray?) {
    relays = value?.toStringList().orEmpty()
  }

  fun setVisible(value: Boolean) {
    visible = value
    invalidate()
  }

  fun setDepth(value: Int) {
    depth = value
    requestLayout()
    invalidate()
  }

  fun setMain(value: Boolean) {
    main = value
    requestLayout()
    invalidate()
  }

  fun setShowRelays(value: Boolean) {
    showRelays = value
    invalidate()
  }

  fun setRelayCount(value: Int) {
    relayCount = value
    invalidate()
  }

  fun setReposterPubkey(value: String?) {
    reposterPubkey = value
    invalidate()
  }

  fun setFallbackSubId(value: String?) {
    fallbackSubId = value
    if (subId.isEmpty()) {
      invalidate()
    }
  }

  fun setPrimaryTextColor(value: String?) {
    primaryTextPaint.color = parseColor(value, primaryTextPaint.color)
    invalidate()
  }

  fun setSecondaryTextColor(value: String?) {
    secondaryTextPaint.color = parseColor(value, secondaryTextPaint.color)
    faintTextPaint.color = parseColor(value, faintTextPaint.color)
    invalidate()
  }

  fun setAvatarBackgroundColor(value: String?) {
    avatarPaint.color = parseColor(value, avatarPaint.color)
    invalidate()
  }

  fun setAccentColor(value: String?) {
    accentPaint.color = parseColor(value, accentPaint.color)
    invalidate()
  }

  override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
    val desiredHeight = dp(if (depth > 0) 30f else 48f).toInt()
    val measuredWidth = MeasureSpec.getSize(widthMeasureSpec)
    val measuredHeight = resolveSize(desiredHeight, heightMeasureSpec)
    setMeasuredDimension(measuredWidth, measuredHeight)
  }

  override fun onDraw(canvas: Canvas) {
    super.onDraw(canvas)

    val quote = depth > 0
    val avatarSize = dp(if (quote) 16f else 32f)
    val avatarLeft = dp(if (quote) 0f else 4f)
    val avatarTop = dp(if (quote) 3f else 2f)
    val textLeft = avatarLeft + avatarSize + dp(8f)
    val top = dp(if (quote) 1f else 2f)
    val lineHeight = dp(if (main) 20f else 17f)

    canvas.drawOval(
        RectF(avatarLeft, avatarTop, avatarLeft + avatarSize, avatarTop + avatarSize), avatarPaint)

    if (!reposterPubkey.isNullOrEmpty()) {
      val badge = dp(if (quote) 7f else 11f)
      canvas.drawOval(
          RectF(
              avatarLeft + avatarSize - badge,
              avatarTop + avatarSize - badge,
              avatarLeft + avatarSize,
              avatarTop + avatarSize),
          accentPaint)
    }

    primaryTextPaint.textSize = sp(if (main) 16f else 14f)
    secondaryTextPaint.textSize = sp(12f)
    faintTextPaint.textSize = sp(9f)

    val displayName = name.ifEmpty { shortPubkey(pubkey).ifEmpty { "unknown" } }
    val nameWidthLimit = width - textLeft - dp(if (showRelays) 48f else 8f)
    val firstLine = listOf(displayName, nip05, formatTimeShort(createdAt)).filter { it.isNotEmpty() }.joinToString("  ")
    canvas.drawText(ellipsize(firstLine, primaryTextPaint, nameWidthLimit), textLeft, top + lineHeight, primaryTextPaint)

    if (showRelays) {
      val relayText = relayCount.toString()
      canvas.drawText(relayText, width - dp(18f), top + lineHeight, faintTextPaint)
    }

    val detail = picture.ifEmpty { subId.ifEmpty { fallbackSubId.orEmpty() } }
    if (detail.isNotEmpty() && !quote) {
      canvas.drawText(
          ellipsize(detail, faintTextPaint, width - textLeft - dp(8f)),
          textLeft,
          top + lineHeight + dp(13f),
          faintTextPaint)
    }
  }

  private fun parseNote() {
    val event = parseParsedEvent(noteBytes) ?: return
    pubkey = event.pubkey() ?: ""
    createdAt = event.createdAt()
    subId = parseWorker(noteBytes)?.subId() ?: ""
    if (name.isEmpty()) {
      name = shortPubkey(pubkey)
    }
  }

  private fun parseParsedEvent(bytes: ByteArray?): ParsedEvent? {
    val worker = parseWorker(bytes) ?: return null
    if (worker.contentType() != Message.ParsedEvent) {
      return null
    }

    return worker.content(ParsedEvent()) as? ParsedEvent
  }

  private fun parseWorker(bytes: ByteArray?): WorkerMessage? {
    if (bytes == null || bytes.size < 4) {
      return null
    }

    return try {
      WorkerMessage.getRootAsWorkerMessage(ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN))
    } catch (_: RuntimeException) {
      null
    }
  }

  private fun ReadableArray.toByteArray(): ByteArray {
    val output = ByteArray(size())
    for (index in 0 until size()) {
      output[index] = (getInt(index) and 0xff).toByte()
    }
    return output
  }

  private fun ReadableArray.toStringList(): List<String> =
      (0 until size()).mapNotNull { getString(it) }

  private fun dp(value: Float): Float = value * resources.displayMetrics.density
  private fun sp(value: Float): Float = value * resources.displayMetrics.scaledDensity

  private fun parseColor(value: String?, fallback: Int): Int =
      runCatching { if (value.isNullOrEmpty()) fallback else Color.parseColor(value) }.getOrDefault(fallback)

  private fun shortPubkey(value: String): String =
      if (value.length <= 12) value else "${value.take(6)}...${value.takeLast(4)}"

  private fun ellipsize(value: String, paint: Paint, maxWidth: Float): String {
    if (maxWidth <= 0f || paint.measureText(value) <= maxWidth) {
      return value
    }

    val ellipsis = "..."
    var end = value.length
    while (end > 0 && paint.measureText(value.substring(0, end) + ellipsis) > maxWidth) {
      end--
    }
    return value.substring(0, end) + ellipsis
  }

  private fun formatTimeShort(timestamp: Long): String {
    if (timestamp <= 0) {
      return ""
    }

    val diff = ((System.currentTimeMillis() / 1000L) - timestamp).coerceAtLeast(0L)
    return when {
      diff < 60 -> "${diff}s"
      diff < 3600 -> "${diff / 60}m"
      diff < 86400 -> "${diff / 3600}h"
      else -> "${diff / 86400}d"
    }
  }
}
