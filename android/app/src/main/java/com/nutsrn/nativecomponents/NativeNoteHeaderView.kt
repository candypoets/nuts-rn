package com.nutsrn.nativecomponents

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.Bitmap
import android.graphics.BitmapShader
import android.graphics.Matrix
import android.graphics.Shader
import android.graphics.Typeface
import android.graphics.drawable.Drawable
import android.net.Uri
import android.os.Build
import android.view.MotionEvent
import android.view.View
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReadableArray
import com.nutsrn.R
import java.util.concurrent.Future
import java.nio.ByteBuffer
import java.nio.ByteOrder
import nostr.fb.Message
import nostr.fb.ParsedEvent
import nostr.fb.WorkerMessage

class NativeNoteHeaderView(context: Context) : View(context) {
  internal var onRoute: ((String) -> Unit)? = null
  private val avatarPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.rgb(229, 231, 235) }
  private val accentPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.rgb(37, 99, 235) }
  private val primaryTextPaint =
      Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.rgb(17, 24, 39)
        typeface = semiboldTypeface()
      }
  private val secondaryTextPaint =
      Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.rgb(107, 114, 128) }
  private val faintTextPaint =
      Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.argb(90, 107, 114, 128) }
  private val relayDotPaint = Paint(Paint.ANTI_ALIAS_FLAG)
  private val verifiedBadge: Drawable? =
      context.getDrawable(R.drawable.ic_verified)?.mutate()?.apply { setTint(accentPaint.color) }

  private var noteBytes: ByteArray? = null
  private var relays: List<String> = emptyList()
  private var visible = true
  private var depth = 0
  private var main = false
  private var showRelays = true
  private var relayCount = 0
  private var reposterPubkey: String? = null
  private var authorPubkey: String? = null
  private var fallbackSubId: String? = null
  private var nameFallback = ""
  private var relayStatuses: Map<String, String> = emptyMap()

  private var pubkey = ""
  private var createdAt = 0L
  private var subId = ""
  private var name = ""
  private var nip05 = ""
  private var picture = ""
  private var avatarBitmap: Bitmap? = null
  private var reposterPicture = ""
  private var reposterBitmap: Bitmap? = null
  private var avatarTask: Future<*>? = null
  private var reposterTask: Future<*>? = null
  private val profileHook = NativeProfileHook("native_note_author") { profile -> post { if (profile.pubkey == pubkey) { name = profile.bestName; nip05 = profile.nip05; picture = profile.picture; loadAvatar(); invalidate() } } }
  private val reposterProfileHook = NativeProfileHook("native_note_reposter") { profile -> post { if (profile.pubkey == reposterPubkey) { reposterPicture = profile.picture; loadReposter(); invalidate() } } }

  fun setNoteBytes(value: ReadableArray?) {
    setNoteByteArray(value?.toByteArray())
  }
  internal fun setNoteByteArray(value: ByteArray?) {
    noteBytes = value
    parseNote()
    invalidate()
  }
  internal fun setParsedEvent(event: ParsedEvent?) {
    if (event == null) {
      pubkey="";createdAt=0;name="";nip05="";picture="";avatarBitmap=null
      refreshProfiles();invalidate();return
    }
    applyEvent(event)
    invalidate()
  }

  fun setRelays(value: ReadableArray?) {
    setRelayList(value?.toStringList().orEmpty())
  }
  internal fun setRelayList(value: List<String>) {
    relays = value
    refreshProfiles()
  }

  fun setVisible(value: Boolean) {
    visible = value
    refreshProfiles()
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
    reposterPicture = ""; reposterBitmap = null; refreshProfiles()
    invalidate()
  }

  fun setAuthorPubkey(value: String?) {
    val next = value?.trim()?.takeIf { it.isNotEmpty() }
    if (authorPubkey == next) return
    authorPubkey = next
    parseNote()
    invalidate()
  }

  fun setFallbackSubId(value: String?) {
    fallbackSubId = value
    if (subId.isEmpty()) {
      invalidate()
    }
  }

  fun setNameFallback(value: String?) {
    val next = value.orEmpty()
    if (nameFallback == next) return
    nameFallback = next
    if (name.isEmpty()) name = next
    invalidate()
  }

  internal fun setRelayStatuses(value: Map<String, String>) {
    if (relayStatuses == value) return
    relayStatuses = value
    invalidate()
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
    verifiedBadge?.setTint(accentPaint.color)
    invalidate()
  }

  override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
    val desiredHeight = dp(if (depth > 0) 18f else 42f).toInt()
    val measuredWidth = MeasureSpec.getSize(widthMeasureSpec)
    val measuredHeight = resolveSize(desiredHeight, heightMeasureSpec)
    setMeasuredDimension(measuredWidth, measuredHeight)
  }

  override fun onDraw(canvas: Canvas) {
    super.onDraw(canvas)

    val quote = depth > 0
    val avatarSize = dp(if (quote) 16f else 40f)
    val avatarLeft = 0f
    val avatarTop = dp(if (quote) 0f else 2f)
    val textLeft = avatarLeft + avatarSize + dp(if (quote) 2f else 6f)
    val top = 0f

    val avatarRect = RectF(avatarLeft, avatarTop, avatarLeft + avatarSize, avatarTop + avatarSize)
    canvas.drawOval(avatarRect, avatarPaint)
    avatarBitmap?.let { drawBitmapCircle(canvas, it, avatarRect) }

    if (!reposterPubkey.isNullOrEmpty()) {
      val badge = dp(if (quote) 11f else 19f)
      val offset=dp(2f)
      val reposterRect = RectF(avatarRect.right - badge + offset, avatarRect.bottom - badge + offset, avatarRect.right + offset, avatarRect.bottom + offset)
      canvas.drawOval(reposterRect, avatarPaint)
      val reposterImage=reposterBitmap
      if(reposterImage!=null) drawBitmapCircle(canvas,reposterImage,reposterRect) else canvas.drawOval(RectF(reposterRect.left+badge*.28f,reposterRect.top+badge*.28f,reposterRect.right-badge*.28f,reposterRect.bottom-badge*.28f),accentPaint)
    }

    primaryTextPaint.textSize = sp(if (main) 15f else 13f)
    primaryTextPaint.typeface = semiboldTypeface()
    secondaryTextPaint.textSize = sp(12f)
    secondaryTextPaint.typeface = Typeface.create("sans-serif", Typeface.NORMAL)
    faintTextPaint.textSize = sp(9f)

    val displayName = name.ifEmpty { nameFallback.ifEmpty { "unknown" } }
    val contentRight = width - dp(if (showRelays) 48f else 8f)
    val primaryBaseline = -primaryTextPaint.fontMetrics.ascent
    val secondaryBaseline = -secondaryTextPaint.fontMetrics.ascent
    if (main && !quote) {
      canvas.drawText(ellipsize(displayName, primaryTextPaint, contentRight - textLeft), textLeft, top + primaryBaseline, primaryTextPaint)
      drawMetaLine(canvas, textLeft, top + dp(20f), width - dp(8f), secondaryBaseline)
    } else {
      val drawnName = ellipsize(displayName, primaryTextPaint, contentRight - textLeft)
      canvas.drawText(drawnName, textLeft, top + primaryBaseline, primaryTextPaint)
      val metaX = textLeft + primaryTextPaint.measureText(drawnName) + dp(8f)
      val metaTop = top + maxOf(0f, (primaryTextPaint.fontMetrics.descent - primaryTextPaint.fontMetrics.ascent - (secondaryTextPaint.fontMetrics.descent - secondaryTextPaint.fontMetrics.ascent)) / 2f)
      if (metaX < contentRight) drawMetaLine(canvas, metaX, metaTop, contentRight, secondaryBaseline)
    }

    if (showRelays) {
      drawRelayDots(canvas, top + dp(7f))
    }
  }

  private fun parseNote() {
    val event = parseParsedEvent(noteBytes) ?: return
    applyEvent(event)
  }

  private fun applyEvent(event: ParsedEvent) {
    pubkey = authorPubkey ?: event.pubkey() ?: ""
    createdAt = event.createdAt()
    subId = parseWorker(noteBytes)?.subId() ?: ""
    name = nameFallback
    nip05 = ""; picture = ""; avatarBitmap = null
    refreshProfiles()
  }

  override fun onAttachedToWindow() { super.onAttachedToWindow(); refreshProfiles() }
  override fun onDetachedFromWindow() { avatarTask?.cancel(true); reposterTask?.cancel(true); profileHook.cancel(); reposterProfileHook.cancel(); super.onDetachedFromWindow() }

  override fun onTouchEvent(event: MotionEvent): Boolean {
    if (event.action == MotionEvent.ACTION_UP) {
      val route = if (showRelays && relays.isNotEmpty() && event.x >= width - dp(44f)) {
        val relayPayload = Uri.encode(relays.joinToString(","))
        val statusPayload = relayStatuses.entries.sortedBy { it.key }.joinToString(",") { "${it.key}=${it.value}" }
        "relays:${Uri.encode(fallbackSubId ?: subId)}:$relayPayload:${Uri.encode(statusPayload)}"
      } else {
        val avatarSize = dp(if (depth > 0) 16f else 40f)
        val avatarTop = dp(if (depth > 0) 0f else 2f)
        primaryTextPaint.textSize = sp(if (main) 15f else 13f)
        primaryTextPaint.typeface = semiboldTypeface()
        val displayName = name.ifEmpty { nameFallback.ifEmpty { "unknown" } }
        val textLeft = avatarSize + dp(if (depth > 0) 2f else 6f)
        val nameRight = textLeft + primaryTextPaint.measureText(displayName)
        val nameBottom = -primaryTextPaint.fontMetrics.ascent + primaryTextPaint.fontMetrics.descent
        val avatarHit = event.x in 0f..avatarSize && event.y in avatarTop..(avatarTop + avatarSize)
        val nameHit = event.x in textLeft..nameRight && event.y in 0f..nameBottom
        if ((avatarHit || nameHit) && pubkey.isNotEmpty()) "profile:$pubkey" else "note"
      }
      route?.let { emitRoute(it) }
      performClick()
    }
    return true
  }
  override fun performClick(): Boolean { super.performClick(); return true }

  private fun refreshProfiles() {
    if (!isAttachedToWindow || !visible) { profileHook.cancel(); reposterProfileHook.cancel(); return }
    profileHook.update(pubkey, relays, true)
    val reposter = reposterPubkey.orEmpty()
    if (reposter.isEmpty()) reposterProfileHook.cancel() else reposterProfileHook.update(reposter, relays, true)
  }
  private fun loadAvatar() { avatarTask?.cancel(true); val requested = picture; if (requested.isEmpty()) { avatarBitmap = null; return }; avatarTask = NativeBitmapLoader.load(requested, (40 * resources.displayMetrics.density).toInt()) { image -> post { if (picture == requested) { avatarBitmap = image; invalidate() } } } }
  private fun loadReposter() { reposterTask?.cancel(true); val requested = reposterPicture; if (requested.isEmpty()) { reposterBitmap = null; return }; reposterTask = NativeBitmapLoader.load(requested, (20 * resources.displayMetrics.density).toInt()) { image -> post { if (reposterPicture == requested) { reposterBitmap = image; invalidate() } } } }
  private fun drawBitmapCircle(canvas: Canvas, bitmap: Bitmap, rect: RectF) { val shader = BitmapShader(bitmap, Shader.TileMode.CLAMP, Shader.TileMode.CLAMP); shader.setLocalMatrix(Matrix().apply { setScale(rect.width()/bitmap.width,rect.height()/bitmap.height);postTranslate(rect.left,rect.top) }); val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply { this.shader = shader }; canvas.drawOval(rect, paint) }
  private fun drawRelayDots(canvas: Canvas, y: Float) { val display=relays.take(3);if(display.isEmpty())return;val dot=dp(4f);val gap=dp(3f);var x=width-dp(4f)-display.size*dot-(display.size-1)*gap;display.forEach{relay->relayDotPaint.color=statusColor(relayStatuses[normalizeRelay(relay)]);canvas.drawCircle(x+dot/2,y+dot/2,dot/2,relayDotPaint);x+=dot+gap} }
  private fun statusColor(status:String?)=when(status){"EOSE","OK"->Color.rgb(34,197,94);"SUBSCRIBED"->Color.rgb(59,130,246);"FAILED"->Color.rgb(239,68,68);else->avatarPaint.color}
  private fun normalizeRelay(value:String)=value.trim().trimEnd('/')
  private fun drawMetaLine(canvas: Canvas, startX: Float, top: Float, maxX: Float, baseline: Float) {
    var x = startX
    val time = formatTimeShort(createdAt)
    if (nip05.isNotEmpty() && x < maxX) {
      val badgeSize = dp(14f)
      verifiedBadge?.let { badge ->
        badge.setBounds(x.toInt(), (top + dp(1f)).toInt(), (x + badgeSize).toInt(), (top + dp(1f) + badgeSize).toInt())
        badge.draw(canvas)
      }
      x += dp(20f)
      val metadataGap = if (time.isEmpty()) 0f else dp(8f)
      val timeWidth = secondaryTextPaint.measureText(time)
      val nip05MaxWidth = (maxX - x - metadataGap - timeWidth).coerceAtLeast(0f)
      val value = ellipsize(nip05, secondaryTextPaint, nip05MaxWidth)
      if (value.isNotEmpty()) {
        canvas.drawText(value, x, top + baseline, secondaryTextPaint)
        x += secondaryTextPaint.measureText(value)
        if (time.isNotEmpty()) x += metadataGap
      }
    }
    if (time.isNotEmpty() && x < maxX) {
      canvas.drawText(
          ellipsize(time, secondaryTextPaint, maxX - x),
          x,
          top + baseline,
          secondaryTextPaint,
      )
    }
  }
  private fun emitRoute(route: String) { onRoute?.let { it(route); return }; dispatchNativeViewEvent("topNativeRoute", Arguments.createMap().apply { putString("route", route) }) }

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
  private fun semiboldTypeface():Typeface = if(Build.VERSION.SDK_INT>=28) Typeface.create(Typeface.create("sans-serif",Typeface.NORMAL),600,false) else Typeface.create("sans-serif-medium",Typeface.NORMAL)

  private fun parseColor(value: String?, fallback: Int): Int =
      nativeCssColor(value,fallback)

  private fun ellipsize(value: String, paint: Paint, maxWidth: Float): String {
    if (maxWidth <= 0f) {
      return ""
    }
    if (paint.measureText(value) <= maxWidth) {
      return value
    }

    val ellipsis = "..."
    if (paint.measureText(ellipsis) > maxWidth) {
      return ""
    }
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
