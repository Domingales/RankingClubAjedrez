window.RANKING_FIREBASE_CONFIG = {

  apiKey:  "AIzaSyDOPvvZ4JTEDnnBRuyoqd0nh859HAol5y8", 

  authDomain: "rankingclubajedrez.firebaseapp.com",

  projectId: "rankingclubajedrez",

  storageBucket: "rankingclubajedrez.firebasestorage.app",

  messagingSenderId: "276229558439",

  appId: "1:276229558439:web:4ebe172a221e4866c38b82"

};



window.RANKING_APP_CONFIG = {

  clubName: "Ranking Club Ajedrez",

  version: "2.0.1",

  initialRating: 1500,

  initialRD: 350,

  initialVolatility: 0.06,

  provisionalRD: 110,

  tau: 0.5,

  ratingPeriodDays: 1,

  // Ajuste de color inspirado en Lichess: las negras reciben algo más de premio

  // al superar una expectativa ligeramente inferior. Puede ponerse a 0 si el club

  // prefiere Glicko-2 puro.

  whiteAdvantageRating: 25

};





