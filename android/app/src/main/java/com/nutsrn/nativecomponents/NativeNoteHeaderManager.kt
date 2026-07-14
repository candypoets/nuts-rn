package com.nutsrn.nativecomponents

import com.facebook.react.bridge.ReadableArray
import com.facebook.react.module.annotations.ReactModule
import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.ViewManagerDelegate
import com.facebook.react.viewmanagers.NativeNoteHeaderManagerDelegate
import com.facebook.react.viewmanagers.NativeNoteHeaderManagerInterface
import com.facebook.react.common.MapBuilder

@ReactModule(name = NativeNoteHeaderManager.REACT_CLASS)
class NativeNoteHeaderManager :
    SimpleViewManager<NativeNoteHeaderView>(),
    NativeNoteHeaderManagerInterface<NativeNoteHeaderView> {
  private val delegate = NativeNoteHeaderManagerDelegate(this)

  override fun getName(): String = REACT_CLASS

  override fun getDelegate(): ViewManagerDelegate<NativeNoteHeaderView> = delegate

  override fun createViewInstance(reactContext: ThemedReactContext): NativeNoteHeaderView =
      NativeNoteHeaderView(reactContext)

  override fun setNoteBytes(view: NativeNoteHeaderView, value: ReadableArray?) {
    view.setNoteBytes(value)
  }

  override fun setRelays(view: NativeNoteHeaderView, value: ReadableArray?) = view.setRelays(value)

  override fun setVisible(view: NativeNoteHeaderView, value: Boolean) = view.setVisible(value)

  override fun setDepth(view: NativeNoteHeaderView, value: Int) {
    view.setDepth(value)
  }

  override fun setMain(view: NativeNoteHeaderView, value: Boolean) {
    view.setMain(value)
  }

  override fun setShowRelays(view: NativeNoteHeaderView, value: Boolean) {
    view.setShowRelays(value)
  }

  override fun setRelayCount(view: NativeNoteHeaderView, value: Int) {
    view.setRelayCount(value)
  }

  override fun setRelayStatuses(view: NativeNoteHeaderView, value: ReadableArray?) {
    val entries = value?.let { array -> (0 until array.size()).mapNotNull(array::getString) }.orEmpty()
    view.setRelayStatuses(entries.chunked(2).mapNotNull { pair ->
      pair.takeIf { it.size == 2 }?.let { it[0] to it[1] }
    }.toMap())
  }

  override fun setAuthorPubkey(view: NativeNoteHeaderView, value: String?) {
    view.setAuthorPubkey(value)
  }

  override fun setReposterPubkey(view: NativeNoteHeaderView, value: String?) {
    view.setReposterPubkey(value)
  }

  override fun setFallbackSubId(view: NativeNoteHeaderView, value: String?) {
    view.setFallbackSubId(value)
  }

  override fun setPrimaryTextColor(view: NativeNoteHeaderView, value: String?) {
    view.setPrimaryTextColor(value)
  }

  override fun setSecondaryTextColor(view: NativeNoteHeaderView, value: String?) {
    view.setSecondaryTextColor(value)
  }

  override fun setAvatarBackgroundColor(view: NativeNoteHeaderView, value: String?) {
    view.setAvatarBackgroundColor(value)
  }

  override fun setAccentColor(view: NativeNoteHeaderView, value: String?) {
    view.setAccentColor(value)
  }

  override fun getExportedCustomDirectEventTypeConstants(): MutableMap<String, Any> =
      MapBuilder.of<String, Any>("topNativeRoute", MapBuilder.of("registrationName", "onNativeRoute")).toMutableMap()

  companion object {
    const val REACT_CLASS = "NativeNoteHeader"
  }
}
