package com.nutsrn.nativecomponents

import com.facebook.react.module.annotations.ReactModule
import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.ViewManagerDelegate
import com.facebook.react.viewmanagers.NativeAvatarManagerDelegate
import com.facebook.react.viewmanagers.NativeAvatarManagerInterface

@ReactModule(name = NativeAvatarManager.REACT_CLASS)
class NativeAvatarManager :
    SimpleViewManager<NativeAvatarView>(),
    NativeAvatarManagerInterface<NativeAvatarView> {
  private val delegate = NativeAvatarManagerDelegate(this)

  override fun getName(): String = REACT_CLASS
  override fun getDelegate(): ViewManagerDelegate<NativeAvatarView> = delegate
  override fun createViewInstance(reactContext: ThemedReactContext): NativeAvatarView = NativeAvatarView(reactContext)
  override fun setPubkey(view: NativeAvatarView, value: String?) = view.setPubkey(value)
  override fun setQuery(view: NativeAvatarView, value: Boolean) = view.setQuery(value)
  override fun setBackgroundColor(view: NativeAvatarView, value: String?) = view.setBackgroundColorString(value)
  override fun setBorderColor(view: NativeAvatarView, value: String?) = view.setBorderColor(value)
  override fun setInitials(view: NativeAvatarView, value: String?) = view.setInitials(value)
  override fun setAvatarColor(view: NativeAvatarView, value: String?) = view.setAvatarColor(value)

  companion object {
    const val REACT_CLASS = "NativeAvatar"
  }
}
