package com.nutsrn.nativecomponents

import com.facebook.react.bridge.ReadableArray
import com.facebook.react.common.MapBuilder
import com.facebook.react.module.annotations.ReactModule
import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.ViewManagerDelegate
import com.facebook.react.viewmanagers.NativeMediaViewerManagerDelegate
import com.facebook.react.viewmanagers.NativeMediaViewerManagerInterface

@ReactModule(name = NativeMediaViewerManager.REACT_CLASS)
class NativeMediaViewerManager : SimpleViewManager<NativeMediaViewerView>(), NativeMediaViewerManagerInterface<NativeMediaViewerView> {
  private val delegate = NativeMediaViewerManagerDelegate(this)
  override fun getName() = REACT_CLASS
  override fun getDelegate(): ViewManagerDelegate<NativeMediaViewerView> = delegate
  override fun createViewInstance(context: ThemedReactContext) = NativeMediaViewerView(context)
  override fun onAfterUpdateTransaction(view:NativeMediaViewerView){super.onAfterUpdateTransaction(view);view.commitMediaProps()}
  override fun setUrls(v:NativeMediaViewerView,x:ReadableArray?)=v.setUrls(x);override fun setTypes(v:NativeMediaViewerView,x:ReadableArray?)=v.setTypes(x);override fun setThumbnails(v:NativeMediaViewerView,x:ReadableArray?)=v.setThumbnails(x);override fun setDims(v:NativeMediaViewerView,x:ReadableArray?)=v.setDims(x);override fun setItemKeys(v:NativeMediaViewerView,x:ReadableArray?)=v.setItemKeys(x)
  override fun setSessionId(v:NativeMediaViewerView,x:String?)=v.setSessionId(x);override fun setNoteBytes(v:NativeMediaViewerView,x:ReadableArray?)=v.setNoteBytes(x);override fun setRelays(v:NativeMediaViewerView,x:ReadableArray?)=v.setRelays(x);override fun setCurrentUserPubkey(v:NativeMediaViewerView,x:String?)=v.setCurrentUserPubkey(x);override fun setOptimisticReactionNonce(v:NativeMediaViewerView,x:Int)=v.setOptimisticReactionNonce(x)
  override fun setPrimaryTextColor(v:NativeMediaViewerView,x:String?)=v.setPrimaryTextColor(x);override fun setSecondaryTextColor(v:NativeMediaViewerView,x:String?)=v.setSecondaryTextColor(x);override fun setAvatarBackgroundColor(v:NativeMediaViewerView,x:String?)=v.setAvatarBackgroundColor(x);override fun setTintColor(v:NativeMediaViewerView,x:String?)=v.setTintColor(x);override fun setPrimaryColor(v:NativeMediaViewerView,x:String?)=v.setPrimaryColor(x);override fun setAccentColor(v:NativeMediaViewerView,x:String?)=v.setAccentColor(x);override fun setZoomBackgroundColor(v:NativeMediaViewerView,x:String?)=v.setZoomBackgroundColor(x)
  override fun getExportedCustomDirectEventTypeConstants():MutableMap<String,Any> = MapBuilder.builder<String,Any>().put("topNativeRoute",MapBuilder.of("registrationName","onNativeRoute")).put("topNativeAction",MapBuilder.of("registrationName","onNativeAction")).build().toMutableMap()
  companion object{const val REACT_CLASS="NativeMediaViewer"}
}
