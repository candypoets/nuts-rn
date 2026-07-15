package com.nutsrn.nativecomponents

import android.content.Context
import android.graphics.Canvas
import android.graphics.BitmapFactory
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.view.MotionEvent
import android.view.View
import android.os.Build
import android.os.Bundle
import androidx.core.view.AccessibilityDelegateCompat
import androidx.core.view.ViewCompat
import androidx.core.view.accessibility.AccessibilityNodeInfoCompat
import com.candypoets.nipworker.reactnative.NipworkerHookHandle
import com.candypoets.nipworker.reactnative.NipworkerRequest
import com.candypoets.nipworker.reactnative.NipworkerRuntime
import com.candypoets.nipworker.reactnative.NipworkerSubscriptionOptions
import com.candypoets.nipworker.reactnative.NipworkerWorkerMessage
import com.candypoets.nipworker.reactnative.useSubscription
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReadableArray
import com.nutsrn.R
import java.nio.ByteBuffer
import java.nio.ByteOrder
import nostr.fb.CountResponse
import nostr.fb.ConnectionStatus
import nostr.fb.Message
import nostr.fb.ParsedEvent
import nostr.fb.WorkerMessage

class NativeNoteFooterView(context: Context) : View(context) {
  internal var onAction: ((String) -> Unit)? = null
  private enum class Icon { REPLY, COMMENT, REPOST, LIKE, SHARE }
  private val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply { strokeCap = Paint.Cap.ROUND; strokeJoin = Paint.Join.ROUND }
  private val zapIcon by lazy { BitmapFactory.decodeResource(resources, R.drawable.nuts_zap) }
  private var noteBytes: ByteArray? = null
  private var relays = emptyList<String>()
  private var relayResolutionPending = false
  private var currentUserPubkey = ""
  private var noteId = ""
  private var noteKind = 0
  private var supportsComments = true
  private var visible = true
  private var main = false
  private var zoom = false
  private var tint = Color.rgb(155, 158, 164)
  private var primary = Color.rgb(21, 135, 119)
  private var accent = Color.rgb(109, 40, 217)
  private var zoomBackground = Color.argb(117, 15, 23, 42)
  private var optimisticNonce = 0
  private var comments = 0; private var replies = 0; private var reposts = 0; private var quotes = 0; private var reactions = 0
  private var replied = false; private var reposted = false; private var reacted = false
  private var mainSub: NipworkerHookHandle? = null; private var quoteSub: NipworkerHookHandle? = null; private var subscriptionKey = ""

  init {
    setWillNotDraw(false)
    isClickable = true
    importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_YES
    contentDescription = "Note actions"
    ViewCompat.setAccessibilityDelegate(this, object:AccessibilityDelegateCompat(){
      override fun onInitializeAccessibilityNodeInfo(host:View,info:AccessibilityNodeInfoCompat){
        super.onInitializeAccessibilityNodeInfo(host,info)
        info.className=android.widget.Button::class.java.name
        info.addAction(AccessibilityNodeInfoCompat.AccessibilityActionCompat(A11Y_REPLY,if(supportsComments)"Comments" else "Reply"))
        info.addAction(AccessibilityNodeInfoCompat.AccessibilityActionCompat(A11Y_REPOST,"Repost"))
        info.addAction(AccessibilityNodeInfoCompat.AccessibilityActionCompat(A11Y_LIKE,"Like"))
        info.addAction(AccessibilityNodeInfoCompat.AccessibilityActionCompat(A11Y_SHARE,"Share"))
        if(!zoom)info.addAction(AccessibilityNodeInfoCompat.AccessibilityActionCompat(A11Y_ZAP,"Zap"))
      }
      override fun performAccessibilityAction(host:View,action:Int,args:Bundle?):Boolean{
        val value=when(action){A11Y_REPLY->if(supportsComments)"comments" else "reply";A11Y_REPOST->"repost";A11Y_LIKE->"like";A11Y_SHARE->"share";A11Y_ZAP->"zap";else->null}
        if(value!=null){emitAction(value);return true}
        return super.performAccessibilityAction(host,action,args)
      }
    })
  }

  fun setNoteBytes(value: ReadableArray?) { setNoteByteArray(value?.toBytes()) }
  internal fun setNoteByteArray(next:ByteArray?) { if (next?.contentEquals(noteBytes) == true) return; noteBytes = next; val old = noteId; parseNote(); if (old != noteId) resetCounts(); refreshSubscriptions() }
  fun setRelays(value: ReadableArray?) { setRelayList(value?.toStrings().orEmpty()) }
  internal fun setRelayList(value:List<String>) { relays=value;refreshSubscriptions() }
  fun setRelayResolutionPending(value:Boolean) { if (relayResolutionPending == value) return; relayResolutionPending=value;refreshSubscriptions() }
  fun setCurrentUserPubkey(value: String?) { currentUserPubkey = value.orEmpty(); refreshSubscriptions() }
  fun setOptimisticReactionNonce(value: Int) { if (value == optimisticNonce) return; optimisticNonce = value; if (value > 0 && !reacted) { reacted = true; reactions++; invalidate() } }
  fun setVisible(value: Boolean) { visible = value; refreshSubscriptions() }
  fun setMain(value: Boolean) { main = value; invalidate() }
  fun setZoom(value: Boolean) { zoom = value; invalidate() }
  fun setTintColor(value: String?) { tint = cssColor(value, tint); invalidate() }
  fun setPrimaryColor(value: String?) { primary = cssColor(value, primary); invalidate() }
  fun setAccentColor(value: String?) { accent = cssColor(value, accent); invalidate() }
  fun setZoomBackgroundColor(value: String?) { zoomBackground = cssColor(value, zoomBackground); invalidate() }

  override fun onAttachedToWindow() { super.onAttachedToWindow(); refreshSubscriptions() }
  override fun onDetachedFromWindow() { cancelSubscriptions(); super.onDetachedFromWindow() }

  override fun onDraw(canvas: Canvas) { super.onDraw(canvas); if (zoom) drawZoom(canvas) else drawInline(canvas) }

  override fun onTouchEvent(event: MotionEvent): Boolean {
    if (event.action == MotionEvent.ACTION_UP) { actionAt(event.x, event.y)?.let(::emitAction); performClick() }
    return true
  }
  override fun performClick(): Boolean { super.performClick(); return true }

  private fun parseNote() {
    val bytes = noteBytes ?: run { noteId = ""; noteKind = 0; supportsComments = true; return }
    val worker = runCatching { WorkerMessage.getRootAsWorkerMessage(ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN)) }.getOrNull()
    val event = if (worker?.contentType() == Message.ParsedEvent) worker.content(ParsedEvent()) as? ParsedEvent else null
    noteId = event?.id().orEmpty(); noteKind = event?.kind() ?: 0; supportsComments = noteKind != 1 && noteKind != 6
  }

  private fun resetCounts() { comments = 0; replies = 0; reposts = 0; quotes = 0; reactions = 0; replied = false; reposted = false; reacted = false; subscriptionKey = ""; invalidate() }

  private fun refreshSubscriptions() {
    if (relayResolutionPending) { cancelSubscriptions(); return }
    if (!isAttachedToWindow || !visible || noteId.isEmpty() || NipworkerRuntime.handle == 0L) { cancelSubscriptions(); return }
    val lookup = if (relays.isEmpty()) DEFAULT_RELAYS else relays
    val key = "$noteId|${lookup.joinToString(",")}|$currentUserPubkey|$supportsComments"
    if (key == subscriptionKey) return
    cancelSubscriptions(); subscriptionKey = key
    val kinds = if (supportsComments) listOf(6, 7, 1111) else listOf(1, 6, 7)
    val requests = mutableListOf(NipworkerRequest(kinds = if (supportsComments) listOf(6, 7) else kinds, tags = mapOf("#e" to listOf(noteId)), relays = lookup))
    if (supportsComments) requests += NipworkerRequest(kinds = listOf(1111), tags = mapOf("#E" to listOf(noteId)), relays = lookup)
    mainSub = NipworkerRuntime.useSubscription("f_${noteId}_${lookup.joinToString(",")}", requests, NipworkerSubscriptionOptions(cacheFirst = true, bytesPerEvent = 1024, counterKinds = kinds, counterPubkey = currentUserPubkey)) { messages ->
      var changed = false
      for (message in messages) { if (forwardRelayStatus(message)) continue; if (message.contentType != Message.CountResponse) continue; val c = message.message.content(CountResponse()) as? CountResponse ?: continue; when (c.kind()) { 1 -> { replies = c.count().toInt(); replied = replied || c.you() }; 1111 -> comments = c.count().toInt(); 6 -> { reposts = c.count().toInt(); reposted = reposted || c.you() }; 7 -> { reactions = if (reacted) maxOf(reactions, c.count().toInt()) else c.count().toInt(); reacted = reacted || c.you() }; else -> continue }; changed = true }
      if (changed) postInvalidate()
    }
    quoteSub = NipworkerRuntime.useSubscription("fq_${noteId}_${lookup.joinToString(",")}", listOf(NipworkerRequest(kinds = listOf(1), tags = mapOf("#q" to listOf(noteId)), relays = lookup)), NipworkerSubscriptionOptions(cacheFirst = true, bytesPerEvent = 1024, counterKinds = listOf(1), counterPubkey = currentUserPubkey)) { messages ->
      for (message in messages) { if (forwardRelayStatus(message)) continue; if (message.contentType != Message.CountResponse) continue; val c = message.message.content(CountResponse()) as? CountResponse ?: continue; if (c.kind() == 1) { quotes = c.count().toInt(); reposted = reposted || c.you(); postInvalidate() } }
    }
  }
  private fun cancelSubscriptions() { mainSub?.cancel(); quoteSub?.cancel(); mainSub = null; quoteSub = null; subscriptionKey = "" }

  private fun drawInline(canvas: Canvas) {
    val maxX = width - dp(32f); val y = (height - dp(20f)) / 2f; var x = dp(if (main) 8f else 48f); val gap = dp(8f)
    x = drawAction(canvas, if (supportsComments) Icon.COMMENT else Icon.REPLY, x, y, count(if (supportsComments) comments else replies), if (!supportsComments && replied) accent else tint, false, maxX) + gap
    x = drawAction(canvas, Icon.REPOST, x, y, count(reposts + quotes), if (reposted) primary else tint, false, maxX) + gap
    x = drawAction(canvas, Icon.LIKE, x, y, count(reactions), if (reacted) accent else tint, reacted, maxX) + gap
    drawAction(canvas, Icon.SHARE, x, y, null, tint, false, maxX)
    drawZap(canvas, RectF(width - dp(32f), (height - dp(24f)) / 2f, width - dp(8f), (height + dp(24f)) / 2f))
  }

  private fun drawZoom(canvas: Canvas) {
    val itemWidth = maxOf(dp(72f), width / 4f - dp(9f)); val gap = dp(12f); val y = (height - dp(48f)) / 2f; var x = 0f
    val values = listOf(Triple(if (supportsComments) Icon.COMMENT else Icon.REPLY, count(if (supportsComments) comments else replies), false), Triple(Icon.REPOST, count(reposts + quotes), false), Triple(Icon.LIKE, count(reactions), reacted), Triple(Icon.SHARE, null, false))
    for ((icon, label, filled) in values) { val rect = RectF(x, y, x + itemWidth, y + dp(48f)); paint.style = Paint.Style.FILL; paint.color = zoomBackground; canvas.drawRoundRect(rect, dp(24f), dp(24f), paint); val iconX = if (label == null) rect.centerX() - dp(10f) else rect.centerX() - dp(22f); drawIcon(canvas, icon, RectF(iconX, rect.centerY() - dp(10f), iconX + dp(20f), rect.centerY() + dp(10f)), Color.WHITE, filled); if (label != null) drawLabel(canvas, label, iconX + dp(26f), rect.centerY() + dp(6f), 16f, Color.WHITE, filled); x += itemWidth + gap }
  }

  private fun drawAction(canvas: Canvas, icon: Icon, x: Float, y: Float, label: String?, color: Int, filled: Boolean, maxX: Float): Float { if (x >= maxX) return x; drawIcon(canvas, icon, RectF(x + dp(2f), y, x + dp(22f), y + dp(20f)), color, filled); var next = x + dp(22f); if (label != null) next += dp(4f) + drawLabel(canvas, label, next + dp(4f), y + dp(13f), 12f, color, filled); return minOf(next + dp(2f), maxX) }
  private fun drawLabel(canvas: Canvas, value: String, x: Float, baseline: Float, size: Float, color: Int, bold: Boolean): Float { paint.style = Paint.Style.FILL; paint.color = color; paint.textSize = sp(size); paint.typeface = if (bold) semiboldTypeface() else android.graphics.Typeface.create("sans-serif",android.graphics.Typeface.NORMAL); canvas.drawText(value, x, baseline, paint); return kotlin.math.ceil(paint.measureText(value).toDouble()).toFloat() }
  private fun count(value: Int) = value.takeIf { it > 0 }?.toString()

  private fun actionAt(px: Float, py: Float): String? {
    if (zoom) { val item = maxOf(dp(72f), width / 4f - dp(9f)); val step = item + dp(12f); val index = (px / step).toInt(); return listOf(if (supportsComments) "comments" else "reply", "repost", "like", "share").getOrNull(index)?.takeIf { px - index * step <= item } }
    if (px >= width - dp(40f)) return "zap"
    val maxX=width-dp(32f);val gap=dp(8f);var x=dp(if(main)8f else 48f)
    val entries=listOf(Pair(if(supportsComments)"comments" else "reply",count(if(supportsComments)comments else replies)),Pair("repost",count(reposts+quotes)),Pair("like",count(reactions)),Pair<String,String?>("share",null))
    for((index,entry) in entries.withIndex()){val end=inlineActionEnd(x,entry.second,maxX);val width=if(index==entries.lastIndex)maxOf(dp(34f),end-x)else maxOf(dp(34f),end-x+gap);if(px>=x&&px<x+width)return entry.first;x=end+gap}
    return null
  }
  private fun inlineActionEnd(x:Float,label:String?,maxX:Float):Float{if(x>=maxX)return x;var next=x+dp(22f);if(label!=null)next+=dp(4f)+labelWidth(label,12f,false);return minOf(next+dp(2f),maxX)}
  private fun labelWidth(value:String,size:Float,bold:Boolean):Float{paint.textSize=sp(size);paint.typeface=if(bold)semiboldTypeface()else android.graphics.Typeface.create("sans-serif",android.graphics.Typeface.NORMAL);return kotlin.math.ceil(paint.measureText(value).toDouble()).toFloat()}
  private fun emitAction(action: String) { onAction?.let { it(action); return }; dispatchNativeViewEvent("topNativeAction", Arguments.createMap().apply { putString("action", action) }) }
  private fun forwardRelayStatus(message: NipworkerWorkerMessage): Boolean {
    if (message.contentType != Message.ConnectionStatus) return false
    val connection = message.message.content(ConnectionStatus()) as? ConnectionStatus ?: return true
    val relayUrl = connection.relayUrl()?.trim()?.trimEnd('/').orEmpty()
    val status = connection.status().orEmpty()
    if (relayUrl.isNotEmpty() && status.isNotEmpty()) {
      dispatchNativeViewEvent("topRelayStatus", Arguments.createMap().apply {
        putString("relayUrl", relayUrl)
        putString("status", status)
      })
    }
    return true
  }

  private fun drawIcon(canvas: Canvas, icon: Icon, rect: RectF, color: Int, filled: Boolean) { when (icon) { Icon.REPLY -> drawReply(canvas, rect, color); Icon.COMMENT -> drawComment(canvas, rect, color); Icon.REPOST -> drawRepost(canvas, rect, color); Icon.LIKE -> drawLike(canvas, rect, color, filled); Icon.SHARE -> drawShare(canvas, rect, color) } }
  private fun path(rect: RectF, build: Path.() -> Unit): Path = Path().apply(build).also { it.transform(android.graphics.Matrix().apply { setScale(rect.width()/24f, rect.height()/24f); postTranslate(rect.left, rect.top) }) }
  private fun stroke(canvas: Canvas, p: Path, color: Int, width: Float = 1.5f) { paint.style = Paint.Style.STROKE; paint.color = color; paint.strokeWidth = dp(width); canvas.drawPath(p, paint) }
  private fun drawReply(c: Canvas, r: RectF, color: Int) { stroke(c, path(r) { moveTo(21f,11.5f); cubicTo(21f,16.2f,17.4f,20f,12.5f,20f); cubicTo(11.2f,20f,9.9f,19.7f,8.7f,19.1f); lineTo(3f,21f); lineTo(4.9f,15.3f); cubicTo(4.3f,14.1f,4f,12.8f,4f,11.5f); cubicTo(4f,6.8f,7.8f,3f,12.5f,3f); cubicTo(17.2f,3f,21f,6.8f,21f,11.5f) }, color) }
  private fun drawComment(c: Canvas, r: RectF, color: Int) { stroke(c, path(r) { moveTo(21f,15f); cubicTo(21f,16.1f,20.1f,17f,19f,17f); lineTo(7f,17f); lineTo(3f,21f); lineTo(3f,5f); cubicTo(3f,3.9f,3.9f,3f,5f,3f); lineTo(19f,3f); cubicTo(20.1f,3f,21f,3.9f,21f,5f); close() }, color, 2f) }
  private fun drawRepost(c: Canvas, r: RectF, color: Int) { stroke(c, path(r) { moveTo(4f,4f); lineTo(4f,9f); lineTo(9f,9f); moveTo(4.6f,9f); cubicTo(9.8f,4.8f,17.2f,5.8f,19.9f,11f); moveTo(20f,20f); lineTo(20f,15f); lineTo(15f,15f); moveTo(19.4f,15f); cubicTo(16.7f,20.2f,9.3f,21.2f,4.1f,13f) }, color) }
  private fun drawShare(c: Canvas, r: RectF, color: Int) { stroke(c, path(r) { moveTo(22f,2f); lineTo(11f,13f); moveTo(22f,2f); lineTo(15f,22f); lineTo(11f,13f); lineTo(2f,9f); close() }, color) }
  private fun drawLike(c: Canvas, r: RectF, color: Int, filled: Boolean) { val p = path(r) { moveTo(12f,21.35f); cubicTo(5.4f,15.36f,2f,12.28f,2f,8.5f); cubicTo(2f,5.42f,4.42f,3f,7.5f,3f); cubicTo(9.24f,3f,10.91f,3.81f,12f,5.09f); cubicTo(13.09f,3.81f,14.76f,3f,16.5f,3f); cubicTo(19.58f,3f,22f,5.42f,22f,8.5f); cubicTo(22f,12.28f,18.6f,15.36f,12f,21.35f); close() }; paint.color = color; paint.strokeWidth = dp(2f); paint.style = if (filled) Paint.Style.FILL else Paint.Style.STROKE; c.drawPath(p, paint) }
  private fun drawZap(c: Canvas, r: RectF) {
    paint.alpha = 255
    paint.isFilterBitmap = true
    c.drawBitmap(zapIcon, null, r, paint)
  }

  private fun dp(v: Float) = v * resources.displayMetrics.density
  private fun sp(v: Float) = v * resources.displayMetrics.scaledDensity
  private fun semiboldTypeface()=if(Build.VERSION.SDK_INT>=28)android.graphics.Typeface.create(android.graphics.Typeface.create("sans-serif",android.graphics.Typeface.NORMAL),600,false)else android.graphics.Typeface.create("sans-serif-medium",android.graphics.Typeface.NORMAL)
  private fun cssColor(value: String?, fallback: Int): Int { if (value.isNullOrBlank()) return fallback; val rgba = Regex("rgba\\(([^)]+)\\)").matchEntire(value.trim()); if (rgba != null) { val p = rgba.groupValues[1].split(',').map { it.trim().toFloatOrNull() ?: return fallback }; if (p.size == 4) return Color.argb((p[3]*255).toInt(), p[0].toInt(), p[1].toInt(), p[2].toInt()) }; return runCatching { Color.parseColor(value) }.getOrDefault(fallback) }
  private fun ReadableArray.toBytes() = ByteArray(size()) { (getInt(it) and 0xff).toByte() }
  private fun ReadableArray.toStrings() = (0 until size()).mapNotNull(::getString)

  companion object {
    private const val A11Y_REPLY=0x02010001;private const val A11Y_REPOST=0x02010002;private const val A11Y_LIKE=0x02010003;private const val A11Y_SHARE=0x02010004;private const val A11Y_ZAP=0x02010005
    private val DEFAULT_RELAYS = listOf("wss://relay.damus.io", "wss://nos.lol", "wss://relay.nuts.cash")
  }
}
