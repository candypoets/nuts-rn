package com.nutsrn.nativecomponents

import com.facebook.react.bridge.ReadableArray
import com.facebook.react.module.annotations.ReactModule
import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.ViewManagerDelegate
import com.facebook.react.viewmanagers.NativeNoteManagerDelegate
import com.facebook.react.viewmanagers.NativeNoteManagerInterface

@ReactModule(name = NativeNoteManager.REACT_CLASS)
class NativeNoteManager :
    SimpleViewManager<NativeNoteView>(),
    NativeNoteManagerInterface<NativeNoteView> {
  private val delegate = NativeNoteManagerDelegate(this)

  override fun getName(): String = REACT_CLASS
  override fun getDelegate(): ViewManagerDelegate<NativeNoteView> = delegate
  override fun createViewInstance(reactContext: ThemedReactContext): NativeNoteView = NativeNoteView(reactContext)

  override fun setNoteId(view: NativeNoteView, value: String?) = view.setNoteId(value)
  override fun setNoteBytes(view: NativeNoteView, value: ReadableArray?) = view.setNoteBytes(value)
  override fun setContextBytes(view: NativeNoteView, value: ReadableArray?) = view.setContextBytes(value)
  override fun setRelays(view: NativeNoteView, value: ReadableArray?) = view.setRelays(value)
  override fun setVisible(view: NativeNoteView, value: Boolean) = view.setVisible(value)
  override fun setFooter(view: NativeNoteView, value: Boolean) = view.setFooter(value)
  override fun setMain(view: NativeNoteView, value: Boolean) = view.setMain(value)
  override fun setShowQuote(view: NativeNoteView, value: Boolean) = view.setShowQuote(value)
  override fun setShowMedia(view: NativeNoteView, value: Boolean) = view.setShowMedia(value)
  override fun setShowRoot(view: NativeNoteView, value: Boolean) = view.setShowRoot(value)
  override fun setThreadCard(view: NativeNoteView, value: Boolean) = view.setThreadCard(value)
  override fun setDisableOpen(view: NativeNoteView, value: Boolean) = view.setDisableOpen(value)
  override fun setDepth(view: NativeNoteView, value: Int) = view.setDepth(value)
  override fun setLeading(view: NativeNoteView, value: Boolean) = view.setLeading(value)
  override fun setTailing(view: NativeNoteView, value: Boolean) = view.setTailing(value)
  override fun setPrimaryTextColor(view: NativeNoteView, value: String?) = view.setPrimaryTextColor(value)
  override fun setSecondaryTextColor(view: NativeNoteView, value: String?) = view.setSecondaryTextColor(value)
  override fun setBaseContentColor(view: NativeNoteView, value: String?) = view.setBaseContentColor(value)
  override fun setCardBackgroundColor(view: NativeNoteView, value: String?) = view.setCardBackgroundColor(value)
  override fun setBorderColor(view: NativeNoteView, value: String?) = view.setBorderColor(value)
  override fun setAccentColor(view: NativeNoteView, value: String?) = view.setAccentColor(value)

  companion object {
    const val REACT_CLASS = "NativeNote"
  }
}
