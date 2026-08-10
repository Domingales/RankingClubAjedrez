RANKING CLUB AJEDREZ - V2.0.0
=============================

OBJETIVO
--------
Aplicación web multiusuario para llevar el ranking histórico de los socios de un club de ajedrez.
Todos los usuarios comparten la misma base de datos Firebase y pueden entrar con la misma cuenta
desde ordenador, navegador móvil, tablet o una futura APK Android.

FIREBASE YA CONFIGURADO
-----------------------
Proyecto: rankingclubajedrez
Authentication: Email/Password
Cloud Firestore: base (default), edición Standard, ubicación eur3 (Europe)
Plan: Spark (sin Cloud Functions)

IMPORTANTE: antes de probar esta V2, hay que publicar las reglas incluidas en firestore.rules.

PASO 1 - PUBLICAR LAS REGLAS
----------------------------
1. Firebase Console -> Firestore -> Reglas.
2. Borra las reglas actuales.
3. Copia TODO el contenido del fichero firestore.rules de este ZIP.
4. Pégalo en el editor.
5. Pulsa PUBLICAR.

Estas reglas están deliberadamente pensadas para un club privado de confianza. Permiten que los
socios autenticados participen en las transacciones que actualizan el Glicko-2 de ambos jugadores,
pero reservan el cambio de rol "admin" al administrador.

PASO 2 - PRIMER ADMINISTRADOR
-----------------------------
1. Publica la app o ejecútala desde un servidor web local.
2. Registra tu cuenta normalmente.
3. En Firebase Console -> Firestore -> Datos -> users -> abre tu documento (UID).
4. Cambia solamente:
      role: "member"
   por:
      role: "admin"
5. Guarda.
6. Cierra sesión y vuelve a entrar. Aparecerá "Administración".

Los siguientes administradores ya pueden asignarse desde la propia app.

SISTEMA DE RATING
-----------------
- Glicko-2 estilo Lichess.
- Rating inicial: 1500.
- RD inicial: 350.
- Volatilidad inicial: 0.06.
- Rating provisional cuando RD > 110 (se muestra ?).
- La incertidumbre aumenta con la inactividad.
- Se aplica una pequeña corrección de color (25 puntos equivalentes) para aproximar el criterio
  de Lichess de premiar ligeramente más los resultados con negras.
- Solo una partida CONFIRMADA por el rival modifica el ranking.
- La actualización de ambos jugadores y de la partida se realiza mediante una transacción Firestore.

FUNCIONES PRINCIPALES
---------------------
- Registro e inicio de sesión por email y contraseña.
- Sesión persistente entre dispositivos.
- Clasificación actual y máximos históricos.
- Registro de partidas con blancas/negras, resultado, fecha, ritmo, evento y nota/enlace.
- Confirmar, rechazar o cancelar partidas pendientes.
- Histórico de partidas con rating antes/después y variación.
- Ficha personal y gráfica de evolución.
- Jugadores y fichas resumidas.
- Cara a cara.
- Récords del club.
- Administración de socios (activar/desactivar, socio/admin).
- Herramienta administrativa para recalcular todo el ranking desde el histórico confirmado.
- Interfaz responsive para PC y móvil.

CÓMO PROBAR EN PC
-----------------
NO se recomienda abrir index.html con doble clic.
Usa cualquiera de estas opciones:

A) Firebase Hosting (recomendado)
   Instala Node.js y Firebase CLI:
      npm install -g firebase-tools
   Después, desde esta carpeta:
      firebase login
      firebase deploy --only firestore:rules,hosting

B) Servidor local rápido con Python
   Entra en la carpeta public y ejecuta:
      python -m http.server 8080
   Abre:
      http://localhost:8080

C) Extensión Live Server de Visual Studio Code.

FIREBASE HOSTING
----------------
El fichero firebase.json ya apunta a la carpeta public.
La configuración .firebaserc ya utiliza el proyecto rankingclubajedrez.

ANDROID
-------
Consulta android/README_ANDROID.txt. La misma carpeta public puede copiarse a
app/src/main/assets/ y cargarse con WebViewAssetLoader. La cuenta y Firestore serán los mismos.

ESTRUCTURA
----------
public/index.html
public/css/styles.css
public/js/firebase-config.js
public/js/glicko2.js
public/js/app.js
public/manifest.webmanifest
public/icons/chess.svg
firestore.rules
firestore.indexes.json
firebase.json
.firebaserc
android/README_ANDROID.txt

NOTA DE SEGURIDAD
-----------------
Esta versión NO usa Cloud Functions por decisión del club, para mantenerse en el plan Spark.
El cálculo Glicko-2 se ejecuta en el cliente. Es apropiado para un grupo pequeño y de confianza,
pero no sería el diseño recomendado para una plataforma pública o comercial.

CORRECCIÓN V2.0.1 (10/08/2026)
- Corregida la API key real del proyecto Firebase RankingClubAjedrez.
- El carácter tras "NKDKx" es una F MAYÚSCULA. La versión anterior llevaba f minúscula y Firebase devolvía auth/api-key-not-valid.
- Configuración verificada contra Firebase Console.
