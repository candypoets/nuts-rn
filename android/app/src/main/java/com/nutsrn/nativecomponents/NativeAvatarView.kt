package com.nutsrn.nativecomponents

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
import android.view.View

class NativeAvatarView(context: Context) : View(context) {
  private val fillPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL }
  private val strokePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; strokeWidth = 1f }
  private val textPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { textAlign = Paint.Align.CENTER; isFakeBoldText = true }
  private var pubkey = ""

  init {
    setWillNotDraw(false)
    fillPaint.color = Color.rgb(52, 52, 52)
    strokePaint.color = Color.rgb(52, 52, 52)
    textPaint.color = Color.rgb(155, 158, 164)
  }

  fun setPubkey(value: String?) { pubkey = value.orEmpty(); invalidate() }
  fun setQuery(@Suppress("UNUSED_PARAMETER") value: Boolean) {}
  fun setBackgroundColorString(value: String?) { fillPaint.color = parseColor(value, fillPaint.color); invalidate() }
  fun setBorderColor(value: String?) { strokePaint.color = parseColor(value, strokePaint.color); invalidate() }

  override fun onDraw(canvas: Canvas) {
    super.onDraw(canvas)
    val rect = RectF(0.5f, 0.5f, width - 0.5f, height - 0.5f)
    canvas.drawOval(rect, fillPaint)
    if (pubkey.isNotEmpty()) {
      textPaint.textSize = width.coerceAtMost(height) * 0.42f
      val baseline = rect.centerY() - (textPaint.descent() + textPaint.ascent()) / 2
      canvas.drawText(pubkey.take(1).uppercase(), rect.centerX(), baseline, textPaint)
    }
    canvas.drawOval(rect, strokePaint)
  }

  private fun parseColor(value: String?, fallback: Int): Int =
      runCatching { if (value.isNullOrEmpty()) fallback else Color.parseColor(value) }.getOrDefault(fallback)
}
