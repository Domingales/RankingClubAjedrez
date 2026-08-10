USO EN ANDROID STUDIO / APK
===========================

La misma app web puede funcionar dentro de una APK usando WebView.
Los usuarios usarán la misma cuenta Firebase y verán exactamente el mismo Firestore.

RECOMENDACIÓN
-------------
Usar AndroidX WebViewAssetLoader en vez de file:///android_asset/ para cargar la web local con un
origen HTTPS interno.

1. Copia TODO el contenido de la carpeta public de este proyecto en:
   app/src/main/assets/

2. Manifest:
   <uses-permission android:name="android.permission.INTERNET" />

3. Dependencia AndroidX WebKit (elige la versión estable que ofrezca Android Studio):
   implementation("androidx.webkit:webkit:<version-estable>")

4. Configura WebView:
   - JavaScript habilitado.
   - DOM storage habilitado.
   - WebViewAssetLoader.
   - cargar https://appassets.androidplatform.net/assets/index.html

EJEMPLO KOTLIN (orientativo)
----------------------------
val assetLoader = WebViewAssetLoader.Builder()
    .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
    .build()

webView.settings.javaScriptEnabled = true
webView.settings.domStorageEnabled = true
webView.webViewClient = object : WebViewClientCompat() {
    override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
        return assetLoader.shouldInterceptRequest(request.url)
    }
}
webView.loadUrl("https://appassets.androidplatform.net/assets/index.html")

IMPORTANTE
----------
Los SDK web de Firebase se cargan desde gstatic.com, por lo que la APK necesita conexión a Internet.
Firebase Authentication y Firestore seguirán apuntando al proyecto rankingclubajedrez.
