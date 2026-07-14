package com.nutsrn.nativecomponents

import com.facebook.react.bridge.ReadableArray
import com.facebook.react.module.annotations.ReactModule
import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.ViewManagerDelegate
import com.facebook.react.viewmanagers.NativeNoteFooterManagerDelegate
import com.facebook.react.viewmanagers.NativeNoteFooterManagerInterface
import com.facebook.react.common.MapBuilder

@ReactModule(name = NativeNoteFooterManager.REACT_CLASS)
class NativeNoteFooterManager :
    SimpleViewManager<NativeNoteFooterView>(),
    NativeNoteFooterManagerInterface<NativeNoteFooterView> {
  private val delegate = NativeNoteFooterManagerDelegate(this)

  override fun getName(): String = REACT_CLASS
  override fun getDelegate(): ViewManagerDelegate<NativeNoteFooterView> = delegate
  override fun createViewInstance(reactContext: ThemedReactContext): NativeNoteFooterView = NativeNoteFooterView(reactContext)
  override fun setNoteBytes(view: NativeNoteFooterView, value: ReadableArray?) = view.setNoteBytes(value)
  override fun setRelays(view: NativeNoteFooterView, value: ReadableArray?) = view.setRelays(value)
  override fun setRelayResolutionPending(view: NativeNoteFooterView, value: Boolean) = view.setRelayResolutionPending(value)
  override fun setCurrentUserPubkey(view: NativeNoteFooterView, value: String?) = view.setCurrentUserPubkey(value)
  override fun setOptimisticReactionNonce(view: NativeNoteFooterView, value: Int) = view.setOptimisticReactionNonce(value)
  override fun setVisible(view: NativeNoteFooterView, value: Boolean) = view.setVisible(value)
  override fun setMain(view: NativeNoteFooterView, value: Boolean) = view.setMain(value)
  override fun setZoom(view: NativeNoteFooterView, value: Boolean) = view.setZoom(value)
  override fun setTintColor(view: NativeNoteFooterView, value: String?) = view.setTintColor(value)
  override fun setPrimaryColor(view: NativeNoteFooterView, value: String?) = view.setPrimaryColor(value)
  override fun setAccentColor(view: NativeNoteFooterView, value: String?) = view.setAccentColor(value)
  override fun setZoomBackgroundColor(view: NativeNoteFooterView, value: String?) = view.setZoomBackgroundColor(value)
  override fun getExportedCustomDirectEventTypeConstants(): MutableMap<String, Any> =
      MapBuilder.of<String, Any>("topNativeAction", MapBuilder.of("registrationName", "onNativeAction")).toMutableMap()

  companion object {
    const val REACT_CLASS = "NativeNoteFooter"
  }
}
