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

class NativeNoteView(context: Context) : View(context) {
  private val borderPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; strokeWidth = 1f }
  private val cardPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL }
  private val avatarPaint = Paint(Paint.ANTI_ALIAS_FLAG)
  private val primaryPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { isFakeBoldText = true }
  private val secondaryPaint = Paint(Paint.ANTI_ALIAS_FLAG)
  private val contentPaint = Paint(Paint.ANTI_ALIAS_FLAG)

  private var noteId = ""
  private var noteBytes: ByteArray? = null
  private var contextBytes: ByteArray? = null
  private var noteEvent: ParsedEvent? = null
  private var visible = true
  private var footer = true
  private var main = false
  private var depth = 0
  private var leading = false
  private var tailing = false

  init {
    setWillNotDraw(false)
    cardPaint.color = Color.rgb(31, 31, 31)
    borderPaint.color = Color.rgb(52, 52, 52)
    avatarPaint.color = Color.rgb(52, 52, 52)
    primaryPaint.color = Color.WHITE
    secondaryPaint.color = Color.rgb(155, 158, 164)
    contentPaint.color = Color.WHITE
  }

  fun setNoteId(value: String?) {
    noteId = value.orEmpty()
    invalidate()
  }

  fun setNoteBytes(value: ReadableArray?) {
    noteBytes = value?.toByteArray()
    noteEvent = parseParsedEvent(noteBytes)
    requestLayout()
    invalidate()
  }

  fun setContextBytes(value: ReadableArray?) {
    contextBytes = value?.toByteArray()
    if (noteEvent == null) noteEvent = parseParsedEvent(contextBytes)
    invalidate()
  }

  fun setRelays(@Suppress("UNUSED_PARAMETER") value: ReadableArray?) {}
  fun setVisible(value: Boolean) { visible = value; invalidate() }
  fun setFooter(value: Boolean) { footer = value; invalidate() }
  fun setMain(value: Boolean) { main = value; requestLayout(); invalidate() }
  fun setShowQuote(@Suppress("UNUSED_PARAMETER") value: Boolean) {}
  fun setShowMedia(@Suppress("UNUSED_PARAMETER") value: Boolean) {}
  fun setShowRoot(@Suppress("UNUSED_PARAMETER") value: Boolean) {}
  fun setThreadCard(@Suppress("UNUSED_PARAMETER") value: Boolean) {}
  fun setDisableOpen(@Suppress("UNUSED_PARAMETER") value: Boolean) {}
  fun setDepth(value: Int) { depth = value; requestLayout(); invalidate() }
  fun setLeading(value: Boolean) { leading = value; invalidate() }
  fun setTailing(value: Boolean) { tailing = value; invalidate() }
  fun setPrimaryTextColor(value: String?) { primaryPaint.color = parseColor(value, primaryPaint.color); invalidate() }
  fun setSecondaryTextColor(value: String?) { secondaryPaint.color = parseColor(value, secondaryPaint.color); invalidate() }
  fun setBaseContentColor(value: String?) { contentPaint.color = parseColor(value, contentPaint.color); invalidate() }
  fun setCardBackgroundColor(value: String?) { cardPaint.color = parseColor(value, cardPaint.color); invalidate() }
  fun setBorderColor(value: String?) { borderPaint.color = parseColor(value, borderPaint.color); avatarPaint.color = borderPaint.color; invalidate() }
  fun setAccentColor(@Suppress("UNUSED_PARAMETER") value: String?) {}

  override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
    val desiredHeight = dp(if (depth > 0) 76f else if (main) 132f else 108f).toInt()
    setMeasuredDimension(MeasureSpec.getSize(widthMeasureSpec), resolveSize(desiredHeight, heightMeasureSpec))
  }

  override fun onDraw(canvas: Canvas) {
    super.onDraw(canvas)
    val inset = dp(if (depth > 0) 8f else 0f)
    val card = RectF(inset, dp(1f), width - inset, height - dp(1f))
    canvas.drawRoundRect(card, dp(if (depth > 0) 8f else 10f), dp(if (depth > 0) 8f else 10f), cardPaint)
    canvas.drawRoundRect(card, dp(if (depth > 0) 8f else 10f), dp(if (depth > 0) 8f else 10f), borderPaint)

    if (leading) canvas.drawRect(dp(28f), card.top, dp(30f), card.top + dp(32f), borderPaint)
    if (tailing) canvas.drawRect(dp(28f), card.bottom - dp(32f), dp(30f), card.bottom, borderPaint)

    val left = card.left + dp(12f)
    val top = card.top + dp(10f)
    val avatar = dp(if (depth > 0) 18f else 34f)
    canvas.drawOval(RectF(left, top, left + avatar, top + avatar), avatarPaint)

    val textLeft = left + avatar + dp(10f)
    val maxWidth = card.right - textLeft - dp(12f)
    val event = noteEvent
    if (event == null) {
      drawText(canvas, if (noteId.isEmpty()) "No note" else "Loading note", textLeft, top + dp(15f), maxWidth, primaryPaint, 14f)
      if (noteId.isNotEmpty()) drawText(canvas, noteId.take(12) + "...", textLeft, top + dp(36f), maxWidth, secondaryPaint, 11f)
      return
    }

    val pubkey = event.pubkey().orEmpty()
    drawText(canvas, shortPubkey(pubkey), textLeft, top + dp(15f), maxWidth, primaryPaint, if (main) 16f else 14f)
    drawText(canvas, "${event.kind()} ${formatTimeShort(event.createdAt())}", textLeft, top + dp(35f), maxWidth, secondaryPaint, 12f)
    drawText(canvas, noteText(event).ifEmpty { "Kind ${event.kind()}" }, textLeft, top + dp(if (main) 64f else 58f), maxWidth, contentPaint, 15f)
    if (footer && depth == 0) {
      drawText(canvas, "reply   repost   like   share", textLeft, height - dp(15f), maxWidth, secondaryPaint, 12f)
    }
  }

  private fun parseParsedEvent(bytes: ByteArray?): ParsedEvent? {
    if (bytes == null || bytes.size < 4) return null
    return try {
      val worker = WorkerMessage.getRootAsWorkerMessage(ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN))
      if (worker.contentType() != Message.ParsedEvent) null else worker.content(ParsedEvent()) as? ParsedEvent
    } catch (_: RuntimeException) {
      null
    }
  }

  private fun noteText(event: ParsedEvent): String {
    return ""
  }

  private fun ReadableArray.toByteArray(): ByteArray {
    val output = ByteArray(size())
    for (index in 0 until size()) output[index] = (getInt(index) and 0xff).toByte()
    return output
  }

  private fun parseColor(value: String?, fallback: Int): Int =
      runCatching { if (value.isNullOrEmpty()) fallback else Color.parseColor(value) }.getOrDefault(fallback)

  private fun drawText(canvas: Canvas, value: String, x: Float, y: Float, maxWidth: Float, paint: Paint, sp: Float) {
    if (maxWidth <= 0f || value.isEmpty()) return
    paint.textSize = sp(sp)
    canvas.drawText(ellipsize(value, paint, maxWidth), x, y, paint)
  }

  private fun ellipsize(value: String, paint: Paint, maxWidth: Float): String {
    if (paint.measureText(value) <= maxWidth) return value
    val ellipsis = "..."
    var end = value.length
    while (end > 0 && paint.measureText(value.substring(0, end) + ellipsis) > maxWidth) end--
    return value.substring(0, end) + ellipsis
  }

  private fun shortPubkey(value: String): String =
      if (value.length <= 12) value else "${value.take(6)}...${value.takeLast(4)}"

  private fun formatTimeShort(timestamp: Long): String {
    if (timestamp <= 0) return ""
    val diff = ((System.currentTimeMillis() / 1000L) - timestamp).coerceAtLeast(0L)
    return when {
      diff < 60 -> "${diff}s"
      diff < 3600 -> "${diff / 60}m"
      diff < 86400 -> "${diff / 3600}h"
      else -> "${diff / 86400}d"
    }
  }

  private fun dp(value: Float): Float = value * resources.displayMetrics.density
  private fun sp(value: Float): Float = value * resources.displayMetrics.scaledDensity
}
