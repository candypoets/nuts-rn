package com.nutsrn.nativecomponents

import android.graphics.Color

internal fun nativeCssColor(value:String?,fallback:Int):Int {
  val clean=value?.trim().orEmpty()
  if(clean.isEmpty())return fallback
  val rgba=Regex("rgba\\(([^)]+)\\)",RegexOption.IGNORE_CASE).matchEntire(clean)
  if(rgba!=null){
    val parts=rgba.groupValues[1].split(',').map{it.trim().toDoubleOrNull()?:return fallback}
    if(parts.size!=4)return fallback
    return Color.argb(
      (parts[3].coerceIn(0.0,1.0)*255.0).toInt(),
      parts[0].coerceIn(0.0,255.0).toInt(),
      parts[1].coerceIn(0.0,255.0).toInt(),
      parts[2].coerceIn(0.0,255.0).toInt(),
    )
  }
  return runCatching{Color.parseColor(clean)}.getOrDefault(fallback)
}
