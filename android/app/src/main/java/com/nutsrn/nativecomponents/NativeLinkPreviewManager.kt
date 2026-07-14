package com.nutsrn.nativecomponents

import com.facebook.react.common.MapBuilder
import com.facebook.react.module.annotations.ReactModule
import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.ViewManagerDelegate
import com.facebook.react.viewmanagers.NativeLinkPreviewManagerDelegate
import com.facebook.react.viewmanagers.NativeLinkPreviewManagerInterface

@ReactModule(name = NativeLinkPreviewManager.REACT_CLASS)
class NativeLinkPreviewManager :
    SimpleViewManager<NativeLinkPreviewView>(),
    NativeLinkPreviewManagerInterface<NativeLinkPreviewView> {
  private val delegate = NativeLinkPreviewManagerDelegate(this)

  override fun getName() = REACT_CLASS
  override fun getDelegate(): ViewManagerDelegate<NativeLinkPreviewView> = delegate
  override fun createViewInstance(context: ThemedReactContext) = NativeLinkPreviewView(context)
  override fun setUrl(view: NativeLinkPreviewView, value: String?) = view.setUrl(value)
  override fun setText(view: NativeLinkPreviewView, value: String?) = view.setText(value)
  override fun setBaseContentColor(view: NativeLinkPreviewView, value: String?) = view.setBaseContentColor(value)
  override fun setSecondaryTextColor(view: NativeLinkPreviewView, value: String?) = view.setSecondaryTextColor(value)
  override fun setCardBackgroundColor(view: NativeLinkPreviewView, value: String?) = view.setCardBackgroundColor(value)
  override fun setBorderColor(view: NativeLinkPreviewView, value: String?) = view.setBorderColor(value)

  override fun getExportedCustomDirectEventTypeConstants(): MutableMap<String, Any> =
      MapBuilder.builder<String, Any>()
          .put("topHeightChange", MapBuilder.of("registrationName", "onHeightChange"))
          .put("topNativeRoute", MapBuilder.of("registrationName", "onNativeRoute"))
          .build()
          .toMutableMap()

  companion object { const val REACT_CLASS = "NativeLinkPreview" }
}
