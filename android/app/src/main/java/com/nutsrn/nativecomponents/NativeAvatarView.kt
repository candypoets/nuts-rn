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
import android.os.Build
import android.view.View
import java.util.concurrent.Future

class NativeAvatarView(context: Context) : View(context) {
  private val fillPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL }
  private val strokePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; strokeWidth = dp(1f) }
  private val textPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    textAlign = Paint.Align.CENTER
    typeface = if (Build.VERSION.SDK_INT >= 28) Typeface.create(Typeface.create("sans-serif",Typeface.NORMAL),600,false) else Typeface.create("sans-serif-medium",Typeface.NORMAL)
  }
  private var pubkey = ""
  private var query = true
  private var picture = ""
  private var bitmap: Bitmap? = null
  private var imageTask: Future<*>? = null
  private val profileHook = NativeProfileHook { profile ->
    if (profile.pubkey != pubkey) return@NativeProfileHook
    post { if (profile.pubkey == pubkey) { picture = profile.picture; loadImage() } }
  }

  init {
    setWillNotDraw(false)
    fillPaint.color = Color.rgb(52, 52, 52)
    strokePaint.color = Color.rgb(52, 52, 52)
    textPaint.color = Color.rgb(155, 158, 164)
  }

  fun setPubkey(value: String?) { pubkey = value.orEmpty(); picture = ""; bitmap = null; refreshProfile(); invalidate() }
  fun setQuery(value: Boolean) { query = value; refreshProfile() }
  fun setBackgroundColorString(value: String?) { fillPaint.color = parseColor(value, fillPaint.color); invalidate() }
  fun setBorderColor(value: String?) { strokePaint.color = parseColor(value, strokePaint.color); invalidate() }

  override fun onDraw(canvas: Canvas) {
    super.onDraw(canvas)
    val inset = dp(.5f)
    val rect = RectF(inset, inset, width - inset, height - inset)
    canvas.drawOval(rect, fillPaint)
    val image = bitmap
    if (image != null) {
      val shader = BitmapShader(image, Shader.TileMode.CLAMP, Shader.TileMode.CLAMP)
      // UIImage.draw(in:) is the iOS reference behavior: it fills the avatar
      // bounds exactly rather than preserving the source aspect ratio.
      val matrix = Matrix().apply {
        setScale(rect.width() / image.width, rect.height() / image.height)
        postTranslate(rect.left, rect.top)
      }
      shader.setLocalMatrix(matrix)
      fillPaint.shader = shader
      canvas.drawOval(rect, fillPaint)
      fillPaint.shader = null
    } else if (pubkey.isNotEmpty()) {
      textPaint.textSize = maxOf(10f * resources.displayMetrics.scaledDensity, rect.width() * 0.42f)
      val baseline = rect.centerY() - (textPaint.descent() + textPaint.ascent()) / 2
      canvas.drawText(pubkey.take(1).uppercase(), rect.centerX(), baseline, textPaint)
    }
    canvas.drawOval(rect, strokePaint)
  }

  override fun onAttachedToWindow() { super.onAttachedToWindow(); refreshProfile(); if (bitmap == null && picture.isNotEmpty()) loadImage() }
  override fun onDetachedFromWindow() { imageTask?.cancel(true); imageTask = null; profileHook.cancel(); super.onDetachedFromWindow() }

  private fun refreshProfile() { if (isAttachedToWindow) profileHook.update(pubkey, emptyList(), query) else profileHook.cancel() }
  private fun loadImage() {
    imageTask?.cancel(true); bitmap = null
    val requested = picture
    if (requested.isEmpty() || !isAttachedToWindow) { invalidate(); return }
    // View dimensions are already physical pixels on Android.
    val pixels = minOf(width, height).coerceAtLeast(32)
    imageTask = NativeBitmapLoader.load(requested, pixels) { loaded -> post { if (picture == requested) { bitmap = loaded; invalidate() } } }
  }

  private fun parseColor(value: String?, fallback: Int): Int =
      nativeCssColor(value,fallback)
  private fun dp(value:Float)=value*resources.displayMetrics.density
}
