package com.nutsrn.nativecomponents

import android.view.View
import com.facebook.react.bridge.WritableMap
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.UIManagerHelper
import com.facebook.react.uimanager.events.Event

internal fun View.dispatchNativeViewEvent(name: String, payload: WritableMap) {
  val reactContext = context as? ThemedReactContext ?: return
  UIManagerHelper.getEventDispatcher(reactContext)?.dispatchEvent(
      NativeViewEvent(UIManagerHelper.getSurfaceId(this), id, name, payload),
  )
}

private class NativeViewEvent(
    surfaceId: Int,
    viewTag: Int,
    private val name: String,
    private val payload: WritableMap,
) : Event<NativeViewEvent>(surfaceId, viewTag) {
  override fun getEventName(): String = name
  override fun getEventData(): WritableMap = payload
}
