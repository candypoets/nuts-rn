package com.nutsrn.nativecomponents

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.LruCache
import android.os.Handler
import android.os.Looper
import com.candypoets.nipworker.reactnative.NipworkerHookHandle
import com.candypoets.nipworker.reactnative.NipworkerRequest
import com.candypoets.nipworker.reactnative.NipworkerRuntime
import com.candypoets.nipworker.reactnative.NipworkerSubscriptionOptions
import com.candypoets.nipworker.reactnative.useSubscription
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors
import java.util.concurrent.Future
import nostr.fb.Kind0Parsed
import nostr.fb.Kind10002Parsed
import nostr.fb.Message
import nostr.fb.ParsedData
import nostr.fb.ParsedEvent

data class NativeProfileSnapshot(
    val pubkey: String,
    val name: String,
    val displayName: String,
    val nip05: String,
    val picture: String,
) {
  val bestName: String get() = name.ifEmpty { displayName.ifEmpty { NativeProfileHook.shortPubkey(pubkey) } }
}

class NativeProfileHook(
    private val subscriptionNamespace: String = "native_profile",
    private val onProfile: (NativeProfileSnapshot) -> Unit,
) {
  private var handle: NipworkerHookHandle? = null
  private var subscriptionKey = ""

  fun update(pubkey: String, relays: List<String>, visible: Boolean) {
    val cleanPubkey = pubkey.trim()
    if (!visible || cleanPubkey.isEmpty() || NipworkerRuntime.handle == 0L) { cancel(); return }
    val lookupRelays = normalizedRelays(relays)
    val relayKey = relayKey(lookupRelays)
    val nextKey = "$cleanPubkey|$relayKey"
    if (subscriptionKey == nextKey) return
    cancel()
    subscriptionKey = nextKey
    handle = NipworkerRuntime.useSubscription(
        subscriptionId = "${subscriptionNamespace}_${cleanPubkey}_$relayKey",
        requests = listOf(NipworkerRequest(authors = listOf(cleanPubkey), kinds = listOf(0), limit = 1, relays = lookupRelays, closeOnEose = true, cacheFirst = true)),
        options = NipworkerSubscriptionOptions(closeOnEose = true, cacheFirst = true),
    ) { messages ->
      for (message in messages) {
        if (message.contentType != Message.ParsedEvent) continue
        val event = message.message.content(ParsedEvent()) as? ParsedEvent ?: continue
        if (event.pubkey() != cleanPubkey || event.parsedType() != ParsedData.Kind0Parsed) continue
        val profile = event.parsed(Kind0Parsed()) as? Kind0Parsed ?: continue
        onProfile(NativeProfileSnapshot(cleanPubkey, profile.name()?.trim().orEmpty(), profile.displayName()?.trim().orEmpty(), profile.nip05()?.trim().orEmpty(), profile.picture()?.trim().orEmpty()))
        break
      }
    }
  }

  fun cancel() { handle?.cancel(); handle = null; subscriptionKey = "" }

  companion object {
    fun shortPubkey(value: String): String = if (value.isEmpty()) "unknown" else "${value.take(12)}..."
    private fun normalizedRelays(values: List<String>): List<String> { val seen = mutableSetOf<String>(); return values.map { it.trim().trimEnd('/') }.filter { (it.startsWith("ws://") || it.startsWith("wss://")) && seen.add(it) } }
    private fun relayKey(values: List<String>) = values.joinToString("") { it.replace(Regex("[^A-Za-z0-9]"), "") }.take(24)
  }
}

class NativeAuthorReadRelaysHook(private val onRelays:(List<String>)->Unit) {
  private val handler=Handler(Looper.getMainLooper())
  private var handle:NipworkerHookHandle?=null
  private var subscriptionKey=""
  private val timeout=Runnable { handle?.cancel();handle=null;onRelays(emptyList()) }

  fun update(pubkey:String,discoveryRelays:List<String>,visible:Boolean){
    val clean=pubkey.trim()
    if(!visible||clean.isEmpty()||NipworkerRuntime.handle==0L){cancel();return}
    val lookup=normalize(discoveryRelays+DEFAULT_RELAYS)
    val key="$clean|${relayKey(lookup)}"
    if(key==subscriptionKey)return
    cancel();subscriptionKey=key;handler.postDelayed(timeout,1_000)
    handle=NipworkerRuntime.useSubscription(
      "native_author_relays_${clean}_${relayKey(lookup)}",
      listOf(NipworkerRequest(authors=listOf(clean),kinds=listOf(10002),limit=1,relays=lookup,closeOnEose=true,cacheFirst=true)),
      NipworkerSubscriptionOptions(closeOnEose=true,cacheFirst=true),
    ){messages->
      for(message in messages){
        if(message.contentType!=Message.ParsedEvent)continue
        val event=message.message.content(ParsedEvent()) as? ParsedEvent?:continue
        if(event.pubkey()!=clean||event.parsedType()!=ParsedData.Kind10002Parsed)continue
        val parsed=event.parsed(Kind10002Parsed()) as? Kind10002Parsed?:continue
        val result=normalize((0 until parsed.relaysLength()).mapNotNull{i->parsed.relays(i)?.takeIf{it.read()}?.url()}).take(5)
        handler.post{handler.removeCallbacks(timeout);handle?.cancel();handle=null;onRelays(result)}
        break
      }
    }
  }

  fun cancel(){handler.removeCallbacks(timeout);handle?.cancel();handle=null;subscriptionKey=""}
  companion object {
    private val DEFAULT_RELAYS=listOf("wss://relay.damus.io","wss://nos.lol","wss://relay.nuts.cash")
    fun normalize(values:List<String>):List<String>{val seen=mutableSetOf<String>();return values.map{it.trim().trimEnd('/')}.filter{(it.startsWith("ws://")||it.startsWith("wss://"))&&seen.add(it)}}
    private fun relayKey(values:List<String>)=values.joinToString(""){it.replace(Regex("[^A-Za-z0-9]"),"")}.take(24)
  }
}

object NativeBitmapLoader {
  private val executor = Executors.newFixedThreadPool(4)
  private val cache = object : LruCache<String, Bitmap>(32 * 1024) { override fun sizeOf(key: String, value: Bitmap) = value.byteCount / 1024 }

  fun load(source: String, targetPixels: Int, completion: (Bitmap?) -> Unit): Future<*>? {
    if (source.isBlank() || targetPixels <= 0) return null
    cache.get(source)?.let { completion(it); return null }
    return executor.submit {
      val bitmap = runCatching {
        val connection = URL(source).openConnection() as HttpURLConnection
        connection.connectTimeout = 8_000; connection.readTimeout = 8_000; connection.instanceFollowRedirects = true
        if (connection.responseCode !in 200..299) return@runCatching null
        val bytes = connection.inputStream.use { it.readBytes() }
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
        var sample = 1
        while (bounds.outWidth / sample > targetPixels * 2 || bounds.outHeight / sample > targetPixels * 2) sample *= 2
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, BitmapFactory.Options().apply { inSampleSize = sample })
      }.getOrNull()
      if (bitmap != null) cache.put(source, bitmap)
      completion(bitmap)
    }
  }
}
