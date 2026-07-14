package com.nutsrn.nativecomponents

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.text.Html
import android.text.TextUtils
import android.graphics.Typeface
import android.os.Build
import android.util.LruCache
import android.view.Gravity
import android.view.View
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.TextView
import com.facebook.react.bridge.Arguments
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors
import java.util.concurrent.Future
import kotlin.math.abs
import kotlin.math.floor

class NativeLinkPreviewView(context: Context) : FrameLayout(context) {
  internal var onHeightChanged: ((Int) -> Unit)? = null
  internal var onRoute: ((String) -> Unit)? = null
  private data class Metadata(val title: String?, val description: String?, val image: String?, val siteName: String?)

  private val imageView = ImageView(context)
  private val playOverlay = PlayOverlayView(context)
  private val siteLabel = label(12f, true)
  private val externalLabel = label(12f, true)
  private val titleLabel = label(15f, true)
  private val descriptionLabel = label(12f, false)
  private val cardDrawable = GradientDrawable()
  private var url = ""
  private var text = ""
  private var metadata: Metadata? = null
  private var metadataTask: Future<*>? = null
  private var imageTask: Future<*>? = null
  private var thumbnailFallback = 0
  private var lastReportedHeight = 0.0
  private var baseContentColor = Color.rgb(0x1c, 0x1c, 0x1e)
  private var secondaryTextColor = Color.rgb(0x8e, 0x8e, 0x93)
  private var cardBackgroundColor = Color.rgb(0xf2, 0xf2, 0xf7)
  private var borderColor = Color.rgb(0xc6, 0xc6, 0xc8)

  init {
    clipToOutline = true
    cardDrawable.cornerRadius = dp(8f).toFloat()
    this.background = cardDrawable
    isClickable = true
    setOnClickListener { if (url.isNotEmpty()) emit("topNativeRoute", "route", "url:${normalizedUrl(url)}") }
    imageView.scaleType = ImageView.ScaleType.CENTER_CROP
    addView(imageView)
    addView(playOverlay)
    siteLabel.ellipsize = TextUtils.TruncateAt.END
    siteLabel.maxLines = 1
    externalLabel.text = ">"
    externalLabel.typeface = if(Build.VERSION.SDK_INT>=28)Typeface.create(Typeface.create("sans-serif",Typeface.NORMAL),600,false)else Typeface.create("sans-serif-medium",Typeface.BOLD)
    externalLabel.gravity = Gravity.END
    titleLabel.maxLines = 2
    titleLabel.ellipsize = TextUtils.TruncateAt.END
    descriptionLabel.maxLines = 2
    descriptionLabel.ellipsize = TextUtils.TruncateAt.END
    addView(siteLabel); addView(externalLabel); addView(titleLabel); addView(descriptionLabel)
    applyColors()
  }

  fun setUrl(value: String?) { val next = value?.trim().orEmpty(); if (next != url) { url = next; reload() } }
  fun setText(value: String?) { val next = value.orEmpty(); if (next != text) { text = next; refreshText(); requestLayout() } }
  fun setBaseContentColor(value: String?) { baseContentColor = parseColor(value, baseContentColor); applyColors() }
  fun setSecondaryTextColor(value: String?) { secondaryTextColor = parseColor(value, secondaryTextColor); applyColors() }
  fun setCardBackgroundColor(value: String?) { cardBackgroundColor = parseColor(value, cardBackgroundColor); applyColors() }
  fun setBorderColor(value: String?) { borderColor = parseColor(value, borderColor); applyColors() }

  override fun onDetachedFromWindow() { metadataTask?.cancel(true); imageTask?.cancel(true); super.onDetachedFromWindow() }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    if (url.isNotEmpty()) {
      loadMetadata()
      loadThumbnail()
    }
  }

  override fun onMeasure(widthSpec: Int, heightSpec: Int) {
    val width = MeasureSpec.getSize(widthSpec)
    val desired = preferredHeight(width)
    setMeasuredDimension(resolveSize(width, widthSpec), resolveSize(desired, heightSpec))
    val thumb = thumbnailHeight(width)
    imageView.measure(exact(width), exact(thumb)); playOverlay.measure(exact(width), exact(thumb))
    siteLabel.measure(exact((width - dp(48f)).coerceAtLeast(0)), exact(dp(16f)))
    externalLabel.measure(exact(dp(16f)), exact(dp(16f)))
    titleLabel.measure(exact((width - dp(24f)).coerceAtLeast(0)), exact(dp(if (descriptionText().isEmpty()) 40f else 38f)))
    descriptionLabel.measure(exact((width - dp(24f)).coerceAtLeast(0)), exact(if (descriptionText().isEmpty()) 0 else dp(34f)))
    reportHeight(desired)
  }

  override fun onLayout(changed: Boolean, l: Int, t: Int, r: Int, b: Int) {
    val width = r - l; val thumb = thumbnailHeight(width); val pad = dp(12f); val top = thumb + dp(10f)
    imageView.layout(0, 0, width, thumb); playOverlay.layout(0, 0, width, thumb)
    siteLabel.layout(pad, top, width - dp(36f), top + dp(16f))
    externalLabel.layout(width - dp(28f), top, width - dp(12f), top + dp(16f))
    val titleTop = top + dp(20f); val titleHeight = dp(if (descriptionText().isEmpty()) 40f else 38f)
    titleLabel.layout(pad, titleTop, width - pad, titleTop + titleHeight)
    descriptionLabel.layout(pad, titleTop + titleHeight + dp(2f), width - pad, titleTop + titleHeight + dp(2f) + dp(34f))
  }

  private fun reload() {
    metadataTask?.cancel(true); imageTask?.cancel(true); metadata = metadataCache.get(url); thumbnailFallback = 0
    imageView.setImageDrawable(null); refreshText(); requestLayout(); loadMetadata(); loadThumbnail()
  }

  private fun refreshText() {
    if (url.isEmpty()) return
    val uri = Uri.parse(normalizedUrl(url)); val host = uri.host.orEmpty().removePrefix("www.")
    siteLabel.text = (metadata?.siteName ?: if (youtubeId(url) != null) "YouTube" else host.ifEmpty { url }).uppercase()
    val path = host + if (uri.path == "/") "" else uri.path.orEmpty()
    val display = if (text.isNotEmpty() && text != url) text else path
    titleLabel.text = metadata?.title ?: display.replace(Regex("^https?://(www\\.)?", RegexOption.IGNORE_CASE), "")
    descriptionLabel.text = descriptionText(); descriptionLabel.visibility = if (descriptionText().isEmpty()) GONE else VISIBLE
    val youtube = youtubeId(url) != null
    playOverlay.visibility = if (youtube) VISIBLE else GONE
    imageView.visibility = if (thumbnailUrl() != null) VISIBLE else GONE
    contentDescription = "Open link: ${titleLabel.text}"
  }

  private fun descriptionText(): String = metadata?.description?.trim()?.takeIf { it.isNotEmpty() }
      ?: if (youtubeId(url) != null) "" else truncateMiddle(normalizedUrl(url), 72)

  private fun loadMetadata() {
    if (url.isEmpty() || metadata != null || youtubeId(url) != null) return
    val requested = url
    metadataTask = executor.submit {
      val html = fetch(normalizedUrl(requested), 256 * 1024)?.toString(Charsets.UTF_8) ?: return@submit
      val parsed = parseMetadata(html, normalizedUrl(requested)) ?: return@submit
      metadataCache.put(requested, parsed)
      post { if (url == requested) { metadata = parsed; refreshText(); loadThumbnail(); requestLayout() } }
    }
  }

  private fun loadThumbnail() {
    val source = thumbnailUrl() ?: return
    imageCache.get(source)?.let { imageView.setImageBitmap(it); requestLayout(); return }
    imageTask?.cancel(true)
    imageTask = executor.submit {
      val bitmap = fetch(source, 8 * 1024 * 1024)?.let { bytes ->
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
      }
      post {
        if (source != thumbnailUrl()) return@post
        if (bitmap != null) { imageCache.put(source, bitmap); imageView.setImageBitmap(bitmap); requestLayout() }
        else if (youtubeId(url) != null) { thumbnailFallback++; loadThumbnail() }
      }
    }
  }

  private fun thumbnailUrl(): String? = youtubeId(url)?.let { id -> youtubeThumbs.getOrNull(thumbnailFallback)?.let { "https://i.ytimg.com/vi/$id/$it" } } ?: metadata?.image
  private fun thumbnailHeight(width: Int) = if (thumbnailUrl() != null) floor(width * 9.0 / 16.0).toInt() else 0
  private fun preferredHeight(width: Int) = thumbnailHeight(width) + dp(if (descriptionText().isEmpty()) 86f else 110f)
  private fun reportHeight(height: Int) { if (height > 0 && abs(height - lastReportedHeight) >= 1) { lastReportedHeight = height.toDouble();onHeightChanged?.let{it(height);return};emit("topHeightChange", "height", height / resources.displayMetrics.density) } }
  private fun emit(event: String, key: String, value: Any) { if(event=="topNativeRoute"&&value is String){onRoute?.let{it(value);return}};val map = Arguments.createMap(); if (value is String) map.putString(key, value) else map.putDouble(key, (value as Number).toDouble()); dispatchNativeViewEvent(event, map) }
  private fun applyColors() { cardDrawable.setColor(cardBackgroundColor); cardDrawable.setStroke(dp(1f), borderColor); imageView.setBackgroundColor(borderColor); siteLabel.setTextColor(secondaryTextColor); externalLabel.setTextColor(secondaryTextColor); titleLabel.setTextColor(baseContentColor); descriptionLabel.setTextColor(secondaryTextColor); invalidate() }
  private fun label(size: Float, medium: Boolean) = TextView(context).apply {
    textSize = size
    includeFontPadding = false
    typeface = Typeface.create(if (medium) "sans-serif-medium" else "sans-serif", Typeface.NORMAL)
  }
  private fun dp(v: Float) = (v * resources.displayMetrics.density).toInt()
  private fun exact(v: Int) = MeasureSpec.makeMeasureSpec(v, MeasureSpec.EXACTLY)
  private fun parseColor(v: String?, fallback: Int) = nativeCssColor(v,fallback)

  companion object {
    private val executor = Executors.newFixedThreadPool(3)
    private val metadataCache = LruCache<String, Metadata>(100)
    private val imageCache = object : LruCache<String, Bitmap>(32 * 1024) { override fun sizeOf(k: String, v: Bitmap) = v.byteCount / 1024 }
    private val youtubeThumbs = listOf("maxresdefault.jpg", "hqdefault.jpg", "mqdefault.jpg", "default.jpg")
    private fun normalizedUrl(v: String) = if (v.matches(Regex("^https?://.*", RegexOption.IGNORE_CASE))) v else "https://$v"
    private fun youtubeId(v: String): String? { val u = runCatching { Uri.parse(normalizedUrl(v)) }.getOrNull() ?: return null; val h = u.host?.removePrefix("www.")?.lowercase() ?: return null; if (h == "youtu.be") return u.pathSegments.firstOrNull(); if (h in listOf("youtube.com", "m.youtube.com", "music.youtube.com")) { if (u.path == "/watch") return u.getQueryParameter("v"); val p = u.pathSegments; if (p.firstOrNull() in listOf("shorts", "embed", "live")) return p.getOrNull(1) }; return null }
    private fun truncateMiddle(v: String, n: Int): String { if (v.length <= n || n <= 3) return v; val keep = (n - 3) / 2; return v.take(keep) + "..." + v.takeLast(keep) }
    private fun fetch(source: String, limit: Int): ByteArray? = runCatching { val c = URL(source).openConnection() as HttpURLConnection; c.connectTimeout = 8000; c.readTimeout = 8000; c.instanceFollowRedirects = true; if (c.responseCode !in 200..299) return null; c.inputStream.use { it.readNBytes(limit) } }.getOrNull()
    private fun parseMetadata(html: String, page: String): Metadata? {
      fun match(vararg patterns: String): String? {
        for (pattern in patterns) {
          val raw = Regex(pattern, setOf(RegexOption.IGNORE_CASE, RegexOption.DOT_MATCHES_ALL))
              .find(html)?.groupValues?.getOrNull(1) ?: continue
          val decoded = Html.fromHtml(raw, Html.FROM_HTML_MODE_LEGACY).toString().trim()
          if (decoded.isNotEmpty()) return decoded
        }
        return null
      }
      val title = match("<meta[^>]+property=[\"']og:title[\"'][^>]+content=[\"']([^\"']*)", "<title[^>]*>([^<]+)</title>")
      val desc = match("<meta[^>]+property=[\"']og:description[\"'][^>]+content=[\"']([^\"']*)", "<meta[^>]+name=[\"']description[\"'][^>]+content=[\"']([^\"']*)")
      val rawImage = match("<meta[^>]+property=[\"']og:image[\"'][^>]+content=[\"']([^\"']*)")
      val image = rawImage?.let { runCatching { URL(URL(page), it).toString() }.getOrDefault(it) }
      val site = match("<meta[^>]+property=[\"']og:site_name[\"'][^>]+content=[\"']([^\"']*)")
      return if (listOf(title, desc, image, site).all { it == null }) null else Metadata(title, desc, image, site)
    }
  }
}

private class PlayOverlayView(context: Context) : View(context) {
  private val paint = android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG)
  override fun onDraw(canvas: android.graphics.Canvas) { if (visibility != VISIBLE) return; val cx = width / 2f; val cy = height / 2f; paint.color = Color.argb(179, 0, 0, 0); canvas.drawCircle(cx, cy, resources.displayMetrics.density * 24, paint); paint.color = Color.WHITE; val p = android.graphics.Path(); val d = resources.displayMetrics.density; p.moveTo(cx - 6*d, cy - 11*d); p.lineTo(cx - 6*d, cy + 11*d); p.lineTo(cx + 12*d, cy); p.close(); canvas.drawPath(p, paint) }
}
