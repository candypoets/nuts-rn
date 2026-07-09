package com.nutsrn.nativecomponents

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.view.View
import com.facebook.react.bridge.ReadableArray

class NativeNoteFooterView(context: Context) : View(context) {
  private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
  private var main = false
  private var zoom = false
  private var tintColor = Color.rgb(155, 158, 164)

  init {
    setWillNotDraw(false)
  }

  fun setNoteBytes(@Suppress("UNUSED_PARAMETER") value: ReadableArray?) {}
  fun setRelays(@Suppress("UNUSED_PARAMETER") value: ReadableArray?) {}
  fun setCurrentUserPubkey(@Suppress("UNUSED_PARAMETER") value: String?) {}
  fun setOptimisticReactionNonce(@Suppress("UNUSED_PARAMETER") value: Int) {}
  fun setVisible(value: Boolean) { visibility = if (value) VISIBLE else INVISIBLE }
  fun setMain(value: Boolean) { main = value; invalidate() }
  fun setZoom(value: Boolean) { zoom = value; invalidate() }
  fun setTintColor(value: String?) { tintColor = parseColor(value, tintColor); invalidate() }
  fun setPrimaryColor(@Suppress("UNUSED_PARAMETER") value: String?) {}
  fun setAccentColor(@Suppress("UNUSED_PARAMETER") value: String?) {}
  fun setZoomBackgroundColor(@Suppress("UNUSED_PARAMETER") value: String?) {}

  override fun onDraw(canvas: Canvas) {
    super.onDraw(canvas)
    paint.color = tintColor
    paint.style = Paint.Style.STROKE
    paint.strokeWidth = dp(1.8f)
    paint.strokeCap = Paint.Cap.ROUND
    paint.textSize = sp(if (zoom) 16f else 12f)
    val y = height / 2f
    val left = dp(if (main || zoom) 8f else 40f)
    val gap = if (zoom) width / 4f else dp(56f)
    drawGlyph(canvas, left, y)
    drawGlyph(canvas, left + gap, y)
    drawGlyph(canvas, left + gap * 2, y)
    drawGlyph(canvas, left + gap * 3, y)
  }

  private fun drawGlyph(canvas: Canvas, x: Float, y: Float) {
    canvas.drawCircle(x + dp(8f), y, dp(7f), paint)
  }

  private fun dp(value: Float): Float = value * resources.displayMetrics.density
  private fun sp(value: Float): Float = value * resources.displayMetrics.scaledDensity
  private fun parseColor(value: String?, fallback: Int): Int =
      runCatching { if (value.isNullOrEmpty()) fallback else Color.parseColor(value) }.getOrDefault(fallback)
}
