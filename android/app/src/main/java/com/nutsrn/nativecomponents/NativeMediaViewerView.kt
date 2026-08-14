package com.nutsrn.nativecomponents

import android.app.Dialog
import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Rect
import android.graphics.drawable.ColorDrawable
import android.graphics.drawable.BitmapDrawable
import android.net.Uri
import android.view.GestureDetector
import android.view.Gravity
import android.view.MotionEvent
import android.view.VelocityTracker
import android.view.ScaleGestureDetector
import android.view.View
import android.view.ViewGroup
import android.view.Window
import android.widget.FrameLayout
import android.widget.HorizontalScrollView
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Button
import android.widget.SeekBar
import android.widget.Space
import android.os.Handler
import android.os.Looper
import android.animation.ArgbEvaluator
import android.animation.ValueAnimator
import android.view.animation.AccelerateDecelerateInterpolator
import android.view.animation.OvershootInterpolator
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.AspectRatioFrameLayout
import androidx.media3.ui.PlayerView
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReadableArray
import java.util.UUID
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.Future
import kotlin.math.abs
import nostr.fb.*

data class AndroidMediaInfo(val url:String,val type:String,val thumbnail:String?,val dim:String?,val key:String)

object NativePlayerRegistry {
  private val players=mutableMapOf<String,ExoPlayer>()
  fun player(context:Context,session:String,item:AndroidMediaInfo):ExoPlayer=players.getOrPut("$session|${item.key}"){
    ExoPlayer.Builder(context.applicationContext).build().apply { setMediaItem(MediaItem.fromUri(Uri.parse(item.url)));repeatMode=Player.REPEAT_MODE_ONE;volume=0f;prepare() }
  }
  fun releaseSession(session:String){players.keys.filter{it.startsWith("$session|")}.forEach{players.remove(it)?.release()}}
}

class NativeMediaViewerView(context:Context):ViewGroup(context){
  internal var onRoute:((String)->Unit)?=null
  internal var onAction:((String)->Unit)?=null
  private var urls=emptyList<String>();private var types=emptyList<String>();private var thumbnails=emptyList<String>();private var dims=emptyList<String>();private var keys=emptyList<String>();private var items=emptyList<AndroidMediaInfo>()
  private var sessionId="";private val defaultSession=UUID.randomUUID().toString();private var noteBytes:ByteArray?=null;private var noteId="";private var relays=emptyList<String>();private var userPubkey="";private var reactionNonce=0
  private var primaryText=Color.WHITE;private var secondaryText=Color.LTGRAY;private var avatarBackground=Color.DKGRAY;private var tint=Color.LTGRAY;private var primary=Color.rgb(21,135,119);private var accent=Color.rgb(109,40,217);private var zoomBackground=Color.argb(117,15,23,42)
  private val cells=mutableListOf<NativeMediaCell>();private var dialog:Dialog?=null
  private var playbackActive=true
  private var mediaPropsDirty=false
  init{clipChildren=true;clipToPadding=true;background=rounded(Color.TRANSPARENT,8f)}
  fun setUrls(v:ReadableArray?){urls=v.strings();mediaPropsDirty=true};fun setTypes(v:ReadableArray?){types=v.strings();mediaPropsDirty=true};fun setThumbnails(v:ReadableArray?){thumbnails=v.strings();mediaPropsDirty=true};fun setDims(v:ReadableArray?){dims=v.strings();mediaPropsDirty=true};fun setItemKeys(v:ReadableArray?){keys=v.strings();mediaPropsDirty=true}
  internal fun commitMediaProps(){if(!mediaPropsDirty)return;mediaPropsDirty=false;rebuild()}
  internal fun setMediaItems(value:List<AndroidMediaInfo>){urls=value.map{it.url};types=value.map{it.type};thumbnails=value.map{it.thumbnail.orEmpty()};dims=value.map{it.dim.orEmpty()};keys=value.map{it.key};mediaPropsDirty=false;rebuild()}
  fun setSessionId(v:String?){val next=v?.trim().orEmpty();if(next!=sessionId){if(sessionId.isNotEmpty())NativePlayerRegistry.releaseSession(sessionId);sessionId=next;mediaPropsDirty=true}}
  fun setNoteBytes(v:ReadableArray?){noteBytes=v?.bytes()};fun setNoteId(v:String?){noteId=v.orEmpty()};fun setRelays(v:ReadableArray?){relays=v.strings()};fun setCurrentUserPubkey(v:String?){userPubkey=v.orEmpty()};fun setOptimisticReactionNonce(v:Int){reactionNonce=v}
  fun setPlaybackActive(v:Boolean){if(playbackActive==v)return;playbackActive=v;cells.forEachIndexed{i,cell->if(v&&items.getOrNull(i)?.type=="video"&&(i==0||items.size==1))cell.play()else cell.pause()}}
  fun setPrimaryTextColor(v:String?){primaryText=color(v,primaryText)};fun setSecondaryTextColor(v:String?){secondaryText=color(v,secondaryText)};fun setAvatarBackgroundColor(v:String?){avatarBackground=color(v,avatarBackground)};fun setTintColor(v:String?){tint=color(v,tint)};fun setPrimaryColor(v:String?){primary=color(v,primary)};fun setAccentColor(v:String?){accent=color(v,accent)};fun setZoomBackgroundColor(v:String?){zoomBackground=color(v,zoomBackground)}
  override fun onDetachedFromWindow(){dialog?.dismiss();dialog=null;cells.forEach{it.pause()};super.onDetachedFromWindow()}
  private fun rebuild(){val next=urls.mapIndexed{i,url->AndroidMediaInfo(url,types.getOrNull(i)?.ifEmpty{"image"}?:"image",thumbnails.getOrNull(i)?.takeIf(String::isNotEmpty),dims.getOrNull(i)?.takeIf(String::isNotEmpty),keys.getOrNull(i)?.takeIf(String::isNotEmpty)?:"$i-$url")};if(next==items)return;items=next;removeAllViews();cells.clear();items.take(6).forEachIndexed{i,item->val cell=NativeMediaCell(context,item,effectiveSession(),true,playbackActive&&(i==0||items.size==1)){present(i)};if(i==5&&items.size>6)cell.showRemaining(items.size-6);cells+=cell;addView(cell)};requestLayout()}
  override fun onMeasure(wSpec:Int,hSpec:Int){val w=MeasureSpec.getSize(wSpec);val h=MeasureSpec.getSize(hSpec);cells.forEachIndexed{i,cell->val f=tile(cells.size,i,w.toFloat(),h.toFloat());cell.measure(exact((f[2]-f[0]).toInt()),exact((f[3]-f[1]).toInt()))};setMeasuredDimension(resolveSize(w,wSpec),resolveSize(h,hSpec))}
  override fun onLayout(changed:Boolean,l:Int,t:Int,r:Int,b:Int){val w=(r-l).toFloat();val h=(b-t).toFloat();cells.forEachIndexed{i,v->val f=tile(cells.size,i,w,h);v.layout(f[0].toInt(),f[1].toInt(),f[2].toInt(),f[3].toInt())}}
  private fun present(index:Int){if(dialog!=null||index !in items.indices)return;val source=cells.getOrNull(index)?:return;val sourceRects=cells.map{cell->val location=IntArray(2);cell.getLocationOnScreen(location);Rect(location[0],location[1],location[0]+cell.width,location[1]+cell.height)};val snapshot=source.transitionBitmap();cells.forEach{it.pause()};val d=Dialog(context,android.R.style.Theme_Black_NoTitleBar_Fullscreen);d.requestWindowFeature(Window.FEATURE_NO_TITLE);val overlay=NativeMediaOverlay(context,items,effectiveSession(),index,noteBytes,noteId,relays,userPubkey,reactionNonce,primaryText,secondaryText,avatarBackground,tint,primary,accent,zoomBackground,sourceRects,snapshot,{route->emitRoute(route)},{action->emitAction(action)}){d.dismiss()};d.setContentView(overlay);d.setOnDismissListener{dialog=null;cells.forEachIndexed{i,c->if(playbackActive&&(i==0||items.size==1))c.play()else c.pause()}};dialog=d;d.show();d.window?.apply{setBackgroundDrawable(ColorDrawable(Color.TRANSPARENT));setLayout(ViewGroup.LayoutParams.MATCH_PARENT,ViewGroup.LayoutParams.MATCH_PARENT)}}
  private fun effectiveSession()=sessionId.ifEmpty{defaultSession}
  private fun emitRoute(route:String){onRoute?.let{it(route);return};dispatchNativeViewEvent("topNativeRoute",Arguments.createMap().apply{putString("route",route)})}
  private fun emitAction(action:String){onAction?.let{it(action);return};dispatchNativeViewEvent("topNativeAction",Arguments.createMap().apply{putString("action",action)})}
  private fun tile(n:Int,i:Int,w:Float,h:Float):FloatArray {
    val g=dp(4f); val hw=(w-g)/2; val hh=(h-g)/2
    return when(n) {
      1 -> floatArrayOf(0f,0f,w,h)
      2 -> if(i==0) floatArrayOf(0f,0f,hw,h) else floatArrayOf(hw+g,0f,w,h)
      3 -> if(i==0) floatArrayOf(0f,0f,hw,h) else if(i==1) floatArrayOf(hw+g,0f,w,hh) else floatArrayOf(hw+g,hh+g,w,h)
      4 -> floatArrayOf(if(i%2==0)0f else hw+g,if(i<2)0f else hh+g,if(i%2==0)hw else w,if(i<2)hh else h)
      5 -> if(i==0) {
        floatArrayOf(0f,0f,hw,h)
      } else {
        val small=(hw-g)/2; val j=i-1; val left=hw+g+(j%2)*(small+g)
        floatArrayOf(left,if(j<2)0f else hh+g,left+small,if(j<2)hh else h)
      }
      else -> {
        val third=(w-g*2)/3; val left=(i%3)*(third+g)
        floatArrayOf(left,if(i<3)0f else hh+g,left+third,if(i<3)hh else h)
      }
    }
  }
  private fun rounded(c:Int,r:Float)=android.graphics.drawable.GradientDrawable().apply{setColor(c);cornerRadius=dp(r)};private fun dp(v:Float)=v*resources.displayMetrics.density;private fun exact(v:Int)=MeasureSpec.makeMeasureSpec(v,MeasureSpec.EXACTLY);private fun color(v:String?,f:Int)=nativeCssColor(v,f);private fun ReadableArray?.strings()=if(this==null)emptyList()else(0 until size()).map{getString(it).orEmpty()};private fun ReadableArray.bytes()=ByteArray(size()){(getInt(it)and 255).toByte()}
}

private class NativeMediaCell(context:Context,val item:AndroidMediaInfo,session:String,grid:Boolean,autoplay:Boolean,val tapped:(()->Unit)?):FrameLayout(context){
  private val image=ImageView(context);private var task:Future<*>?=null;private var player:ExoPlayer?=null;private var playerView:PlayerView?=null;private var gridControls:NativeVideoGridControls?=null
  init{clipChildren=true;setBackgroundColor(if(item.type=="video")Color.BLACK else Color.TRANSPARENT);image.scaleType=if(grid)ImageView.ScaleType.CENTER_CROP else ImageView.ScaleType.FIT_CENTER;addView(image,LayoutParams(-1,-1));val source=if(item.type=="video")item.thumbnail else item.url;if(!source.isNullOrEmpty())task=NativeBitmapLoader.load(source,1080){b->post{if(b!=null)image.setImageBitmap(b)}};if(item.type=="video"){val p=NativePlayerRegistry.player(context,session,item);player=p;val pv=PlayerView(context).apply{useController=false;isClickable=false;isFocusable=false;resizeMode=if(grid)AspectRatioFrameLayout.RESIZE_MODE_ZOOM else AspectRatioFrameLayout.RESIZE_MODE_FIT;this.player=p;setShowBuffering(PlayerView.SHOW_BUFFERING_WHEN_PLAYING)};playerView=pv;addView(pv,LayoutParams(-1,-1));if(autoplay){p.volume=0f;p.play()}else p.pause();if(grid&&tapped!=null){gridControls=NativeVideoGridControls(context,p,!autoplay,tapped).also{addView(it,LayoutParams(-1,-1))}}};if(tapped!=null)setOnClickListener{tapped()};contentDescription=if(item.type=="video")"Open video" else "Open image"}
  fun showRemaining(count:Int){RemainingMediaOverlay(context,count).also{addView(it,LayoutParams(-1,-1));it.bringToFront()}}
  fun transitionBitmap():Bitmap?=(image.drawable as? BitmapDrawable)?.bitmap?:runCatching{Bitmap.createBitmap(width.coerceAtLeast(1),height.coerceAtLeast(1),Bitmap.Config.ARGB_8888).also{draw(Canvas(it))}}.getOrNull()
  fun play(){player?.play()};fun pause(){player?.pause()};fun unmuteAndPlay(){player?.volume=1f;player?.play()};fun muteAndPause(){player?.volume=0f;player?.pause()};fun mediaPlayer()=player;override fun onAttachedToWindow(){super.onAttachedToWindow();gridControls?.attach()};override fun onDetachedFromWindow(){task?.cancel(true);gridControls?.detach();super.onDetachedFromWindow()};private fun dp(v:Int)=(v*resources.displayMetrics.density).toInt()
}

private class RemainingMediaOverlay(context:Context,count:Int):View(context){
  private val label="+$count";private val paint=android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG).apply{color=Color.WHITE;textAlign=android.graphics.Paint.Align.CENTER;textSize=24f*resources.displayMetrics.scaledDensity;typeface=android.graphics.Typeface.create("sans-serif",android.graphics.Typeface.BOLD)}
  init{setWillNotDraw(false);contentDescription=label}
  override fun onDraw(canvas:Canvas){canvas.drawColor(Color.argb(148,0,0,0));val baseline=height/2f-(paint.descent()+paint.ascent())/2f;canvas.drawText(label,width/2f,baseline,paint)}
}

private class NativeVideoGridControls(context:Context,private val player:ExoPlayer,centerVisible:Boolean,open:()->Unit):FrameLayout(context){
  private val handler=Handler(Looper.getMainLooper());private var centerMode=centerVisible;private var ticking=false
  private val center=TextView(context).apply{text="▶";textSize=24f;gravity=Gravity.CENTER;setTextColor(Color.WHITE);background=circle(Color.argb(166,0,0,0));setOnClickListener{open()}}
  private val mute=TextView(context).apply{textSize=16f;gravity=Gravity.CENTER;setTextColor(Color.WHITE);background=circle(Color.argb(179,0,0,0));setOnClickListener{player.volume=if(player.volume<=0f)1f else 0f;player.play();centerMode=false;refresh()}}
  private val remaining=TextView(context).apply{textSize=12f;gravity=Gravity.CENTER;setTextColor(Color.WHITE);typeface=android.graphics.Typeface.create("monospace",android.graphics.Typeface.BOLD);background=rounded(Color.argb(179,0,0,0),12)}
  private val ticker=object:Runnable{override fun run(){refresh();handler.postDelayed(this,250)}}
  init{addView(center,LayoutParams(dp(56),dp(56),Gravity.CENTER));addView(mute,LayoutParams(dp(32),dp(32),Gravity.TOP or Gravity.END).apply{topMargin=dp(8);marginEnd=dp(8)});addView(remaining,LayoutParams(dp(54),dp(24),Gravity.BOTTOM or Gravity.END).apply{bottomMargin=dp(8);marginEnd=dp(8)});refresh()}
  private fun refresh(){center.visibility=if(centerMode)VISIBLE else GONE;mute.visibility=if(centerMode)GONE else VISIBLE;remaining.visibility=if(centerMode)GONE else VISIBLE;mute.text=if(player.volume<=0f)"🔇" else "🔊";val duration=player.duration.coerceAtLeast(0);val left=(duration-player.currentPosition).coerceAtLeast(0);remaining.text=format(left)}
  fun attach(){if(ticking)return;ticking=true;handler.post(ticker)};fun detach(){ticking=false;handler.removeCallbacks(ticker)}
  private fun format(ms:Long):String{val seconds=(ms+999)/1000;return "%d:%02d".format(seconds/60,seconds%60)}
  private fun dp(v:Int)=(v*resources.displayMetrics.density).toInt();private fun circle(c:Int)=android.graphics.drawable.GradientDrawable().apply{shape=android.graphics.drawable.GradientDrawable.OVAL;setColor(c)};private fun rounded(c:Int,r:Int)=android.graphics.drawable.GradientDrawable().apply{setColor(c);cornerRadius=dp(r).toFloat()}
}

private class NativeMediaOverlay(context:Context,private val items:List<AndroidMediaInfo>,private val session:String,start:Int,noteBytes:ByteArray?,noteId:String,relays:List<String>,user:String,nonce:Int,primaryText:Int,secondaryText:Int,avatarBg:Int,tint:Int,primary:Int,accent:Int,zoomBg:Int,private val sourceRects:List<Rect>,private val sourceSnapshot:Bitmap?,onRoute:(String)->Unit,onAction:(String)->Unit,private val dismiss:()->Unit):FrameLayout(context){
  private val dimming=View(context);private val scroll=PagingMediaScrollView(context);private val pages=LinearLayout(context);private val pageViews=mutableListOf<NativeMediaCell>();private var active=start;private var chrome=true;private val note=FrameLayout(context);private val controls=NativeVideoControls(context);private var downX=0f;private var downY=0f;private var draggingVertically=false;private var velocityTracker:VelocityTracker?=null
  init{setBackgroundColor(Color.TRANSPARENT);dimming.setBackgroundColor(if(sourceSnapshot==null)Color.argb(245,0,0,0) else Color.TRANSPARENT);addView(dimming,LayoutParams(-1,-1));scroll.alpha=if(sourceSnapshot==null)1f else 0f;scroll.isHorizontalScrollBarEnabled=false;scroll.isFillViewport=true;pages.orientation=LinearLayout.HORIZONTAL;scroll.addView(pages,LayoutParams(-2,-1));addView(scroll,LayoutParams(-1,-1));post{val w=width;items.forEachIndexed{i,item->val holder=ZoomPage(context,{zoomed->scroll.zoomLocked=zoomed;if(zoomed&&chrome)setChrome(false)},{if(chrome)setChrome(false)},{toggleChrome()});val cell=NativeMediaCell(context,item,session,false,i==start,null);holder.addView(cell,LayoutParams(-1,-1));pages.addView(holder,LinearLayout.LayoutParams(w,-1));pageViews+=cell};scroll.pageWidth=w;scroll.scrollTo(w*start,0);updatePlayback();layoutChrome();animatePresentation()}
    if(noteBytes!=null){val preview=previewText(noteBytes);val noteHeight=dp(42+52+(if(preview.isEmpty())0 else 50));val header=NativeNoteHeaderView(context).apply{setNoteByteArray(noteBytes);setRelayList(relays);setMain(true);setDepth(0);setShowRelays(false);setPrimaryTextColor(argb(primaryText));setSecondaryTextColor(argb(secondaryText));setAvatarBackgroundColor(argb(avatarBg));setAccentColor(argb(accent));this.onRoute=onRoute};val footer=NativeNoteFooterView(context).apply{setNoteByteArray(noteBytes);setNoteId(noteId);setRelayList(relays);setCurrentUserPubkey(user);setOptimisticReactionNonce(nonce);setMain(true);setZoom(true);setTintColor(argb(tint));setPrimaryColor(argb(primary));setAccentColor(argb(accent));setZoomBackgroundColor(argb(zoomBg));this.onAction=onAction};note.setBackgroundColor(Color.TRANSPARENT);note.addView(header,LayoutParams(-1,dp(42),Gravity.TOP).apply{marginStart=dp(16);marginEnd=dp(16)});if(preview.isNotEmpty()){val text=TextView(context).apply{this.text=preview;setTextColor(primaryText);textSize=15f;maxLines=2;ellipsize=android.text.TextUtils.TruncateAt.END;setShadowLayer(2f,0f,1f,Color.argb(190,0,0,0));gravity=Gravity.TOP};note.addView(text,LayoutParams(-1,dp(48),Gravity.TOP).apply{topMargin=dp(42);marginStart=dp(16);marginEnd=dp(16)})};note.addView(footer,LayoutParams(-1,dp(52),Gravity.BOTTOM));addView(note,LayoutParams(-1,noteHeight,Gravity.BOTTOM).apply{bottomMargin=dp(76)})}
    addView(controls,LayoutParams(-1,dp(58),Gravity.BOTTOM))
    scroll.onPageChanged={next->if(next!=active){active=next;updatePlayback()}}
  }
  private fun toggleChrome()=setChrome(!chrome)
  private fun animatePresentation(){val bitmap=sourceSnapshot;if(bitmap==null){dimming.setBackgroundColor(Color.argb(245,0,0,0));scroll.alpha=1f;return};val startRect=localSourceRect(active);val endRect=targetRect(items[active]);val transition=ImageView(context).apply{setImageBitmap(bitmap);scaleType=ImageView.ScaleType.FIT_CENTER;clipToOutline=true;background=roundedDrawable(Color.TRANSPARENT,8f)};addView(transition,LayoutParams(startRect.width(),startRect.height()).apply{leftMargin=startRect.left;topMargin=startRect.top});transition.bringToFront();ValueAnimator.ofFloat(0f,1f).apply{duration=240;interpolator=OvershootInterpolator(.12f);addUpdateListener{anim->val p=anim.animatedValue as Float;applyFrame(transition,startRect,endRect,p);dimming.setBackgroundColor(ArgbEvaluator().evaluate(p.coerceIn(0f,1f),Color.TRANSPARENT,Color.argb(245,0,0,0)) as Int)};doOnEnd{removeView(transition);scroll.alpha=1f};start()}}
  private fun dismissAnimated(){if(pageViews.isEmpty()){dismiss();return};val cell=pageViews[active];val bitmap=cell.transitionBitmap()?:run{dismiss();return};val startRect=Rect(targetRect(items[active])).apply{offset(0,cell.translationY.toInt())};val endRect=localSourceRect(active);val transition=ImageView(context).apply{setImageBitmap(bitmap);scaleType=ImageView.ScaleType.FIT_CENTER};addView(transition,LayoutParams(startRect.width(),startRect.height()).apply{leftMargin=startRect.left;topMargin=startRect.top});transition.bringToFront();scroll.alpha=0f;cell.translationY=0f;note.alpha=0f;controls.alpha=0f;ValueAnimator.ofFloat(0f,1f).apply{duration=180;interpolator=AccelerateDecelerateInterpolator();addUpdateListener{anim->val p=anim.animatedValue as Float;applyFrame(transition,startRect,endRect,p);dimming.setBackgroundColor(ArgbEvaluator().evaluate(p,Color.argb(245,0,0,0),Color.TRANSPARENT) as Int)};doOnEnd{dismiss()};start()}}
  private fun localSourceRect(index:Int):Rect{val origin=IntArray(2);getLocationOnScreen(origin);val fallback=(sourceRects.size-1).coerceAtLeast(0);val source=sourceRects.getOrNull(index)?:sourceRects.getOrNull(fallback)?:Rect(0,0,width,height);return Rect(source).apply{offset(-origin[0],-origin[1])}}
  private fun applyFrame(view:View,from:Rect,to:Rect,p:Float){val lp=view.layoutParams as LayoutParams;lp.width=lerp(from.width(),to.width(),p);lp.height=lerp(from.height(),to.height(),p);lp.leftMargin=lerp(from.left,to.left,p);lp.topMargin=lerp(from.top,to.top,p);view.layoutParams=lp}
  private fun targetRect(item:AndroidMediaInfo):Rect{val initial=sourceRects.firstOrNull()?:Rect(0,0,width,height);val aspect=item.dim?.lowercase()?.split("x")?.mapNotNull{it.toFloatOrNull()}?.takeIf{it.size==2&&it[0]>0&&it[1]>0}?.let{it[0]/it[1]}?:initial.width().toFloat()/initial.height().coerceAtLeast(1);var w=width.toFloat();var h=w/aspect;if(h>height){h=height.toFloat();w=h*aspect};val left=((width-w)/2).toInt();val top=((height-h)/2).toInt();return Rect(left,top,left+w.toInt(),top+h.toInt())}
  private fun setChrome(visible:Boolean){chrome=visible;val a=if(visible)1f else 0f;setEnabledRecursive(note,visible);setEnabledRecursive(controls,visible);note.animate().alpha(a).setDuration(160).start();controls.animate().alpha(a).setDuration(160).start()}
  private fun setEnabledRecursive(view:View,enabled:Boolean){view.isEnabled=enabled;if(view is ViewGroup)for(i in 0 until view.childCount)setEnabledRecursive(view.getChildAt(i),enabled)}
  private fun updatePlayback(){var activePlayer:ExoPlayer?=null;pageViews.forEachIndexed{i,cell->if(i==active&&items[i].type=="video"){cell.unmuteAndPlay();activePlayer=cell.mediaPlayer()}else cell.muteAndPause()};controls.bind(activePlayer);layoutChrome()}
  private fun layoutChrome(){if(width==0||height==0)return;val compact=width>height;val maxWidth=if(compact)dp(720) else width;val chromeWidth=minOf(maxWidth,width-if(compact)dp(56) else 0);val controlsLp=controls.layoutParams as LayoutParams;controlsLp.width=chromeWidth;controlsLp.gravity=Gravity.BOTTOM or Gravity.CENTER_HORIZONTAL;controlsLp.bottomMargin=dp(18);controls.layoutParams=controlsLp;val isVideo=items.getOrNull(active)?.type=="video";controls.visibility=if(isVideo)VISIBLE else GONE;val noteLp=note.layoutParams as? LayoutParams ?: return;noteLp.width=chromeWidth;noteLp.gravity=Gravity.BOTTOM or Gravity.CENTER_HORIZONTAL;noteLp.bottomMargin=if(isVideo)dp(86) else dp(18);note.layoutParams=noteLp}
  override fun onSizeChanged(w:Int,h:Int,oldw:Int,oldh:Int){super.onSizeChanged(w,h,oldw,oldh);post{if(w>0&&pages.childCount>0){for(i in 0 until pages.childCount){val child=pages.getChildAt(i);val lp=child.layoutParams as LinearLayout.LayoutParams;lp.width=w;child.layoutParams=lp;(child as? ZoomPage)?.resetZoom()};scroll.pageWidth=w;scroll.scrollTo(w*active,0)};layoutChrome()}}
  override fun onInterceptTouchEvent(e:MotionEvent):Boolean{if(scroll.zoomLocked)return false;when(e.actionMasked){MotionEvent.ACTION_DOWN->{downX=e.x;downY=e.y;draggingVertically=false;velocityTracker?.recycle();velocityTracker=VelocityTracker.obtain().also{it.addMovement(e)}};MotionEvent.ACTION_MOVE->{velocityTracker?.addMovement(e);val dx=e.x-downX;val dy=e.y-downY;if(abs(dy)>dp(8)&&abs(dy)>abs(dx)){draggingVertically=true;return true}};MotionEvent.ACTION_CANCEL,MotionEvent.ACTION_UP->{velocityTracker?.recycle();velocityTracker=null}};return super.onInterceptTouchEvent(e)}
  override fun onTouchEvent(e:MotionEvent):Boolean{if(!draggingVertically)return super.onTouchEvent(e);velocityTracker?.addMovement(e);val cell=pageViews.getOrNull(active);when(e.actionMasked){MotionEvent.ACTION_MOVE->{val dy=e.y-downY;cell?.translationY=dy;dimming.alpha=maxOf(.18f,1f-abs(dy)/maxOf(dp(280).toFloat(),height*.45f));return true};MotionEvent.ACTION_UP,MotionEvent.ACTION_CANCEL->{val dy=e.y-downY;velocityTracker?.computeCurrentVelocity(1000);val velocity=velocityTracker?.yVelocity?:0f;velocityTracker?.recycle();velocityTracker=null;if(abs(dy)>dp(110)||abs(velocity)>dp(850)){dismissAnimated()}else{dimming.animate().alpha(1f).setDuration(160).start();cell?.animate()?.translationY(0f)?.setDuration(160)?.start()};draggingVertically=false;return true}};return true}
  override fun onDetachedFromWindow(){controls.bind(null);pageViews.forEach{it.pause()};super.onDetachedFromWindow()};private fun dp(v:Int)=(v*resources.displayMetrics.density).toInt();private fun argb(v:Int)=String.format("#%08X",v)
  private fun lerp(a:Int,b:Int,p:Float)=(a+(b-a)*p).toInt();private fun roundedDrawable(c:Int,r:Float)=android.graphics.drawable.GradientDrawable().apply{setColor(c);cornerRadius=r*resources.displayMetrics.density};private fun ValueAnimator.doOnEnd(block:()->Unit){addListener(object:android.animation.AnimatorListenerAdapter(){override fun onAnimationEnd(animation:android.animation.Animator){block()}})}
  private fun previewText(bytes:ByteArray):String{val worker=runCatching{WorkerMessage.getRootAsWorkerMessage(ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN))}.getOrNull()?:return "";if(worker.contentType()!=Message.ParsedEvent)return "";val event=worker.content(ParsedEvent()) as? ParsedEvent?:return "";if(event.kind()!=1||event.parsedType()!=ParsedData.Kind1Parsed)return "";val kind1=event.parsed(Kind1Parsed()) as? Kind1Parsed?:return "";return (0 until kind1.parsedContentLength()).mapNotNull{i->val block=kind1.parsedContent(i)?:return@mapNotNull null;when(block.dataType()){ContentData.ImageData,ContentData.VideoData,ContentData.MediaGroupData->null;else->block.text()?.replace("\\n","\n")?.trim()?.takeIf(String::isNotEmpty)}}.joinToString(" ").replace(Regex("\\s+")," ").trim()}
}

private class ZoomPage(context:Context,private val zoomChanged:(Boolean)->Unit,private val zoomBegin:()->Unit,private val singleTap:()->Unit):FrameLayout(context){private var scale=1f;private val scaler=ScaleGestureDetector(context,object:ScaleGestureDetector.SimpleOnScaleGestureListener(){override fun onScaleBegin(d:ScaleGestureDetector):Boolean{zoomBegin();return true};override fun onScale(d:ScaleGestureDetector):Boolean{scale=(scale*d.scaleFactor).coerceIn(1f,4f);getChildAt(0)?.apply{scaleX=scale;scaleY=scale};zoomChanged(scale>1.02f);return true};override fun onScaleEnd(d:ScaleGestureDetector){if(scale<1.02f){scale=1f;getChildAt(0)?.animate()?.scaleX(1f)?.scaleY(1f)?.setDuration(180)?.start();zoomChanged(false)}}});private val gestures=GestureDetector(context,object:GestureDetector.SimpleOnGestureListener(){override fun onDown(e:MotionEvent)=true;override fun onSingleTapConfirmed(e:MotionEvent):Boolean{singleTap();return true};override fun onDoubleTap(e:MotionEvent):Boolean{scale=if(scale>1.02f)1f else 2.5f;getChildAt(0)?.animate()?.scaleX(scale)?.scaleY(scale)?.setDuration(180)?.start();zoomChanged(scale>1.02f);return true}});fun resetZoom(){scale=1f;getChildAt(0)?.apply{animate().cancel();scaleX=1f;scaleY=1f};zoomChanged(false)};override fun onTouchEvent(e:MotionEvent):Boolean{scaler.onTouchEvent(e);gestures.onTouchEvent(e);return true}}

private class PagingMediaScrollView(context:Context):HorizontalScrollView(context){var pageWidth=1;var onPageChanged:((Int)->Unit)?=null;var zoomLocked=false;private var downX=0f;private var downPage=0;override fun onInterceptTouchEvent(e:MotionEvent)=!zoomLocked&&e.pointerCount<2&&super.onInterceptTouchEvent(e);override fun onTouchEvent(e:MotionEvent):Boolean{if(zoomLocked||e.pointerCount>=2)return false;if(e.action==MotionEvent.ACTION_DOWN){downX=e.x;downPage=(scrollX+pageWidth/2)/pageWidth};val handled=super.onTouchEvent(e);if(e.action==MotionEvent.ACTION_UP||e.action==MotionEvent.ACTION_CANCEL){val dx=e.x-downX;val nearest=(scrollX+pageWidth/2)/pageWidth;val target=if(abs(dx)>pageWidth*.12f)downPage+(if(dx<0)1 else -1)else nearest;val last=maxOf(0,itemsCount()-1);val page=target.coerceIn(0,last);smoothScrollTo(page*pageWidth,0);postDelayed({onPageChanged?.invoke(page)},220)};return handled};private fun itemsCount()=(getChildAt(0) as? ViewGroup)?.childCount?:0}

private class NativeVideoControls(context:Context):LinearLayout(context){private var player:ExoPlayer?=null;private var rate=1f;private val handler=Handler(Looper.getMainLooper());private val seek=SeekBar(context);private val play=Button(context);private val remaining=TextView(context);private val speed=Button(context);private val mute=Button(context);private val replay=Button(context);private val ticker=object:Runnable{override fun run(){refresh();handler.postDelayed(this,250)}}
  init{orientation=VERTICAL;setPadding(0,0,0,0);seek.max=1000;seek.progressDrawable.setTint(Color.WHITE);seek.thumb.setTint(Color.WHITE);seek.setPadding(dp(16),0,dp(16),0);addView(seek,LayoutParams(-1,dp(10)));val row=LinearLayout(context).apply{orientation=HORIZONTAL;gravity=Gravity.CENTER_VERTICAL;setPadding(dp(16),0,dp(16),0)};fun addControl(v:TextView,width:Int){v.setTextColor(Color.WHITE);v.gravity=Gravity.CENTER;v.textSize=16f;v.includeFontPadding=false;if(v is Button){v.background=null;v.stateListAnimator=null;v.minWidth=0;v.minHeight=0;v.setPadding(0,0,0,0);v.isAllCaps=false};row.addView(v,LayoutParams(dp(width),dp(34)))};fun gap(){row.addView(Space(context),LayoutParams(0,1,1f))};addControl(play,44);gap();addControl(remaining,62);gap();addControl(speed,52);gap();addControl(mute,44);gap();addControl(replay,44);addView(row,LayoutParams(-1,dp(48)));play.setOnClickListener{player?.let{if(it.isPlaying)it.pause()else it.play()};refresh()};speed.setOnClickListener{rate=if(rate>=2f)1f else if(rate>=1.5f)2f else 1.5f;player?.setPlaybackSpeed(rate);player?.play();refresh()};mute.setOnClickListener{player?.let{it.volume=if(it.volume<=0f)1f else 0f};refresh()};replay.setOnClickListener{player?.seekTo(0);player?.play();refresh()};seek.setOnSeekBarChangeListener(object:SeekBar.OnSeekBarChangeListener{var user=false;override fun onStartTrackingTouch(s:SeekBar){user=true};override fun onStopTrackingTouch(s:SeekBar){player?.let{if(it.duration>0)it.seekTo(it.duration*s.progress/1000)};user=false};override fun onProgressChanged(s:SeekBar,p:Int,from:Boolean){}})}
  fun bind(next:ExoPlayer?){handler.removeCallbacks(ticker);player=next;if(next!=null){handler.post(ticker);visibility=VISIBLE}else visibility=GONE;refresh()};private fun refresh(){val p=player?:return;play.text=if(p.isPlaying)"Ⅱ" else "▶";val duration=p.duration.coerceAtLeast(0);val pos=p.currentPosition.coerceAtLeast(0);if(duration>0)seek.progress=(pos*1000/duration).toInt();remaining.text="-${format((duration-pos).coerceAtLeast(0))}";speed.text=if(rate%1f==0f)"${rate.toInt()}x" else "${rate}x";mute.text=if(p.volume<=0f)"🔇" else "🔊";replay.text="↶"};private fun format(ms:Long):String{val s=ms/1000;return "%d:%02d".format(s/60,s%60)};private fun dp(v:Int)=(v*resources.displayMetrics.density).toInt()}
