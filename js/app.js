(function () {
  'use strict';

  const CFG = window.RANKING_APP_CONFIG;
  const FB = window.RANKING_FIREBASE_CONFIG;
  const state = {
    authUser: null,
    me: null,
    users: [],
    games: [],
    externalGames: [],
    unsubUsers: null,
    unsubGames: null,
    unsubExternalGames: null,
    gameType: 'club',
    rankingMode: 'current',
    currentView: 'dashboard',
    engineMigrationRunning: false,
    engineMigrationDone: false,
    ratingRecalcRunning: false
  };

  const clockState = {
    initialMs: 10 * 60 * 1000,
    incrementMs: 0,
    whiteMs: 10 * 60 * 1000,
    blackMs: 10 * 60 * 1000,
    activeSide: null,
    running: false,
    lastTickAt: 0,
    flagged: null,
    intervalId: null,
    wakeLock: null
  };


  const annotationState = {
    gameId: null,
    engine: null,
    selected: null,
    legalMoves: [],
    finished: false,
    orientation: 'white',
    pendingPromotion: null,
    external: false
  };

  const pgnViewerState = { gameId: null, index: 0, fens: [] };
  const $ = id => document.getElementById(id);
  const fmtDate = d => new Intl.DateTimeFormat('es-ES', { dateStyle: 'short', timeStyle: 'short' }).format(d);
  const fmtDay = d => new Intl.DateTimeFormat('es-ES', { dateStyle: 'medium' }).format(d);
  const esc = s => String(s ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  const asDate = v => !v ? null : (v instanceof Date ? v : (v.toDate ? v.toDate() : new Date(v)));
  const round = n => Math.round(Number(n || 0));
  const one = n => Number(n || 0).toFixed(1);
  const pct = (a,b) => b ? (100*a/b).toFixed(1) : '0.0';

  let auth, db;

  function showMessage(text, type='') {
    const box = $('globalMessage');
    box.textContent = text;
    box.className = 'message' + (type ? ' ' + type : '');
    box.classList.remove('hidden');
    setTimeout(() => box.classList.add('hidden'), 5000);
  }

  function authMessage(text, type='') {
    const box = $('authMessage');
    box.textContent = text;
    box.className = 'message' + (type ? ' ' + type : '');
    box.classList.remove('hidden');
  }

  function setSync(text, type='') {
    const chip = $('syncStatus');
    chip.textContent = text;
    chip.className = 'status-chip' + (type ? ' ' + type : '');
  }

  function userById(uid) { return state.users.find(u => u.id === uid); }
  function playerName(uid) { const u = userById(uid); return u ? u.name : 'Jugador'; }
  function isAdmin() { return state.me && state.me.role === 'admin'; }
  function provisional(u) { return window.Glicko2Club.isProvisional(u, CFG); }
  function ratingLabel(u, field='rating') {
    const value = round(u?.[field] ?? CFG.initialRating);
    return `${value}${field === 'rating' && provisional(u) ? '?' : ''}`;
  }

  function defaultProfile(user, name) {
    return {
      name: name || (user.email ? user.email.split('@')[0] : 'Socio'),
      email: user.email || '',
      role: 'member',
      active: true,
      rating: CFG.initialRating,
      rd: CFG.initialRD,
      volatility: CFG.initialVolatility,
      maxRating: CFG.initialRating,
      minRating: CFG.initialRating,
      gamesPlayed: 0,
      wins: 0,
      draws: 0,
      losses: 0,
      score: 0,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      lastGameAt: null
    };
  }

  async function boot() {
    try {
      $('bootStatus').textContent = 'Comprobando Firebase…';
      if (!window.firebase || !FB || !FB.apiKey) throw new Error('Firebase no está disponible o falta configuración.');
      firebase.initializeApp(FB);
      auth = firebase.auth();
      auth.languageCode = 'es';
      db = firebase.firestore();
      await auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);
      try { await db.enablePersistence({ synchronizeTabs: true }); } catch (_) {}
      bindUI();
      $('appVersion').textContent = CFG.version;
      auth.onAuthStateChanged(handleAuthState);
      $('bootStatus').textContent = 'Firebase conectado.';
      setTimeout(() => $('bootScreen').classList.add('hidden'), 300);
    } catch (err) {
      console.error(err);
      $('bootStatus').textContent = 'ERROR: ' + err.message;
    }
  }

  function bindUI() {
    $('tabLogin').addEventListener('click', () => switchAuth('login'));
    $('tabRegister').addEventListener('click', () => switchAuth('register'));
    $('loginForm').addEventListener('submit', onLogin);
    $('registerForm').addEventListener('submit', onRegister);
    $('forgotPassword').addEventListener('click', onForgotPassword);
    $('editProfileBtn').addEventListener('click', openEditProfile);
    $('topUserName').addEventListener('click', () => showView('profile'));
    $('logoutButton').addEventListener('click', () => auth.signOut());
    $('menuButton').addEventListener('click', () => $('sidebar').classList.toggle('open'));
    document.querySelectorAll('.nav-item').forEach(btn => btn.addEventListener('click', () => showView(btn.dataset.view)));
    $('gameForm').addEventListener('submit', onCreateGame);
    $('clubGameTypeBtn').addEventListener('click', () => setGameType('club'));
    $('externalGameTypeBtn').addEventListener('click', () => setGameType('external'));
    $('startAnnotationBtn').addEventListener('click', startAnnotation);
    $('annotationUndoBtn').addEventListener('click', undoAnnotationMove);
    $('annotationFinishBtn').addEventListener('click', finishAnnotation);
    $('annotationCancelBtn').addEventListener('click', cancelAnnotation);
    $('annotationContinueBtn').addEventListener('click', continueAnnotation);
    $('annotationSendBtn').addEventListener('click', sendAnnotatedGame);
    $('importPgnForm').addEventListener('submit', onImportPgn);
    $('analyzePgnBtn').addEventListener('click', () => analyzeImportPgn({ fill:true, showStatus:true }));
    $('rankCurrentBtn').addEventListener('click', () => { state.rankingMode='current'; renderDashboard(); });
    $('rankPeakBtn').addEventListener('click', () => { state.rankingMode='peak'; renderDashboard(); });
    $('gamesYear').addEventListener('change', renderGames);
    $('gamesPlayer').addEventListener('change', renderGames);
    $('h2hA').addEventListener('change', renderH2H);
    $('h2hB').addEventListener('change', renderH2H);
    $('modalClose').addEventListener('click', closeModal);
    $('modal').addEventListener('click', e => { if (e.target === $('modal')) closeModal(); });
    $('adminRebuildBtn').addEventListener('click', rebuildRatings);
    const now = new Date(); now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
    $('gameDate').value = now.toISOString().slice(0,16);
    $('importGameDate').value = now.toISOString().slice(0,16);
    initClockUI();
    setGameType('club');
  }

  function switchAuth(mode) {
    const login = mode === 'login';
    $('tabLogin').classList.toggle('active', login);
    $('tabRegister').classList.toggle('active', !login);
    $('loginForm').classList.toggle('hidden', !login);
    $('registerForm').classList.toggle('hidden', login);
    $('authMessage').classList.add('hidden');
  }

  async function onLogin(e) {
    e.preventDefault();
    authMessage('Iniciando sesión…');
    try {
      await auth.signInWithEmailAndPassword($('loginEmail').value.trim(), $('loginPassword').value);
    } catch (err) { authMessage(friendlyError(err), 'error'); }
  }

  async function onRegister(e) {
    e.preventDefault();
    const name = $('registerName').value.trim();
    const email = $('registerEmail').value.trim();
    const p1 = $('registerPassword').value;
    const p2 = $('registerPassword2').value;
    if (p1 !== p2) return authMessage('Las contraseñas no coinciden.', 'error');
    authMessage('Creando cuenta…');
    try {
      const cred = await auth.createUserWithEmailAndPassword(email, p1);
      try { await cred.user.updateProfile({ displayName: name }); } catch (profileErr) { console.warn('No se pudo guardar displayName inicial:', profileErr); }
      await db.collection('users').doc(cred.user.uid).set(defaultProfile(cred.user, name));
      authMessage('Cuenta creada correctamente.', 'success');
    } catch (err) { authMessage(friendlyError(err), 'error'); }
  }

  async function onForgotPassword() {
    const email = $('loginEmail').value.trim();
    if (!email) return authMessage('Escribe primero tu email.', 'error');
    authMessage('Enviando enlace de recuperación…');
    try {
      await auth.sendPasswordResetEmail(email);
      authMessage('Te hemos enviado un correo. Abre el enlace más reciente para crear una contraseña nueva.', 'success');
    } catch (err) { authMessage(friendlyError(err), 'error'); }
  }

  function friendlyError(err) {
    const map = {
      'auth/invalid-credential':'Email o contraseña incorrectos.',
      'auth/user-not-found':'No existe una cuenta con ese email.',
      'auth/wrong-password':'Contraseña incorrecta.',
      'auth/email-already-in-use':'Ese email ya está registrado.',
      'auth/weak-password':'La contraseña debe tener al menos 6 caracteres.',
      'auth/invalid-email':'El email no es válido.',
      'auth/expired-action-code':'El enlace de recuperación ha caducado. Solicita uno nuevo.',
      'auth/invalid-action-code':'El enlace de recuperación no es válido o ya fue utilizado.',
      'permission-denied':'Firebase ha rechazado la operación por las reglas de seguridad.'
    };
    return map[err.code] || err.message || 'Se ha producido un error.';
  }

  async function handleAuthState(user) {
    state.authUser = user;
    if (!user) {
      stopListeners();
      state.me = null; state.users=[]; state.games=[]; state.externalGames=[];
      $('appShell').classList.add('hidden');
      $('authScreen').classList.remove('hidden');
      switchAuth('login');
      return;
    }
    $('authScreen').classList.add('hidden');
    $('appShell').classList.remove('hidden');
    setSync('Sincronizando…');
    try {
      const ref = db.collection('users').doc(user.uid);
      const snap = await ref.get();
      if (!snap.exists) await ref.set(defaultProfile(user, user.displayName));
      startListeners();
    } catch (err) {
      console.error(err); setSync('Error Firebase','error'); showMessage(friendlyError(err),'error');
    }
  }

  function stopListeners() {
    if (state.unsubUsers) state.unsubUsers();
    if (state.unsubGames) state.unsubGames();
    if (state.unsubExternalGames) state.unsubExternalGames();
    state.unsubUsers = state.unsubGames = state.unsubExternalGames = null;
  }

  function startListeners() {
    stopListeners();
    state.unsubUsers = db.collection('users').onSnapshot(snap => {
      state.users = snap.docs.map(d => ({ id:d.id, ...d.data() }));
      state.me = userById(state.authUser.uid);
      if (!state.me) return;
      if (state.me.active === false) {
        alert('Tu cuenta está desactivada por un administrador del club.');
        auth.signOut();
        return;
      }
      const visibleName = state.me.name || state.authUser.displayName || state.authUser.email || 'Socio';
      $('topUserName').textContent = `👤 ${visibleName}`;
      $('topUserName').title = visibleName;
      $('sidebarUserName').textContent = visibleName;
      $('sidebarUserName').title = visibleName;
      $('sidebarUserEmail').textContent = state.me.email || state.authUser.email || '';
      $('sidebarUserEmail').title = state.me.email || state.authUser.email || '';
      $('adminNav').classList.toggle('hidden', !isAdmin());
      setSync('Firebase conectado','ok');
      refreshAll();
    }, err => { console.error(err); setSync('Error usuarios','error'); showMessage(friendlyError(err),'error'); });

    state.unsubGames = db.collection('games').orderBy('playedAt','desc').onSnapshot(snap => {
      state.games = snap.docs.map(d => ({ id:d.id, ...d.data() }));
      refreshAll();
    }, err => { console.error(err); setSync('Error partidas','error'); showMessage(friendlyError(err),'error'); });

    state.unsubExternalGames = db.collection('externalGames').where('ownerUid','==',state.authUser.uid).onSnapshot(snap => {
      state.externalGames = snap.docs.map(d => ({ id:d.id, ...d.data() })).sort((a,b)=>(asDate(b.playedAt)||0)-(asDate(a.playedAt)||0));
      renderExternalGames();
    }, err => { console.error(err); showMessage('No se han podido cargar las partidas externas. '+friendlyError(err),'error'); });
  }

  function refreshAll() {
    if (!state.me) return;
    populateSelectors();
    renderDashboard(); renderPending(); renderGames(); renderExternalGames(); renderProfile(); renderPlayers(); renderH2H(); renderRecords(); renderAdmin(); renderGameDraftBanner();
    maybeMigrateDailyGlicko();
  }

  function gameRatingDataComplete(g) {
    return g.status !== 'confirmed' || (
      !!g.ratingPeriodKey
      && g.whiteRatingBefore != null && g.blackRatingBefore != null
      && g.whiteRatingAfter != null && g.blackRatingAfter != null
      && g.whiteRDBefore != null && g.blackRDBefore != null
      && g.whiteRDAfter != null && g.blackRDAfter != null
      && g.whiteDelta != null && g.blackDelta != null
    );
  }

  async function maybeMigrateDailyGlicko() {
    if (state.engineMigrationRunning || state.ratingRecalcRunning || !state.authUser) return;
    const incomplete = state.games.some(g => !gameRatingDataComplete(g));
    if (!incomplete) { state.engineMigrationDone = true; return; }
    state.engineMigrationRunning = true;
    try {
      setSync('Comprobando Glicko-2 diario…');
      await rebuildRatingsCore(true);
      state.engineMigrationDone = true;
      setSync('Firebase conectado','ok');
      showMessage('Datos Glicko-2 diarios verificados y actualizados.','success');
    } catch (err) {
      console.error(err);
      setSync('Recálculo pendiente','error');
      showMessage('Hay una partida confirmada pendiente de recálculo. Vuelve a intentarlo o pide al administrador que use “Recalcular ranking”.','error');
    } finally {
      state.engineMigrationRunning = false;
    }
  }

  function showView(view) {
    state.currentView = view;
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    const target = $('view-' + view); if (target) target.classList.add('active');
    document.querySelectorAll('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.view === view));
    $('sidebar').classList.remove('open');
    if (view === 'profile') setTimeout(drawRatingChart, 30);
    if (view === 'clock') renderChessClock();
  }

  function initClockUI() {
    const saved = (() => {
      try { return JSON.parse(localStorage.getItem('rankingClubChessClock') || '{}'); }
      catch (_) { return {}; }
    })();
    if (Number.isFinite(Number(saved.minutes))) $('clockMinutes').value = String(saved.minutes);
    if (Number.isFinite(Number(saved.increment))) $('clockIncrement').value = String(saved.increment);
    $('clockTableMode').checked = Boolean(saved.tableMode);

    document.querySelectorAll('.clock-preset').forEach(btn => btn.addEventListener('click', () => {
      $('clockMinutes').value = btn.dataset.minutes;
      $('clockIncrement').value = btn.dataset.increment;
      applyClockConfig();
    }));
    $('clockMinutes').addEventListener('input', updateClockCategory);
    $('clockIncrement').addEventListener('input', updateClockCategory);
    $('clockTableMode').addEventListener('change', () => {
      applyClockTableMode();
      saveClockPreferences();
    });
    $('clockApplyBtn').addEventListener('click', applyClockConfig);
    $('clockStartBtn').addEventListener('click', toggleChessClock);
    $('clockResetBtn').addEventListener('click', resetChessClock);
    $('clockFullscreenBtn').addEventListener('click', toggleClockFullscreen);
    $('clockStagePauseBtn').addEventListener('click', toggleChessClock);
    $('clockStageResetBtn').addEventListener('click', resetChessClock);
    $('clockStageFullscreenBtn').addEventListener('click', toggleClockFullscreen);
    $('clockWhiteFace').addEventListener('click', () => pressChessClock('white'));
    $('clockBlackFace').addEventListener('click', () => pressChessClock('black'));
    document.addEventListener('fullscreenchange', updateClockFullscreenButtons);
    document.addEventListener('visibilitychange', () => {
      if (clockState.running && document.visibilityState === 'visible') requestClockWakeLock();
    });
    window.addEventListener('keydown', e => {
      if (state.currentView !== 'clock' || e.code !== 'Space' || ['INPUT','SELECT','TEXTAREA','BUTTON'].includes(document.activeElement?.tagName)) return;
      e.preventDefault();
      if (!clockState.running) toggleChessClock();
      else pressChessClock(clockState.activeSide);
    });
    if (!clockState.intervalId) clockState.intervalId = window.setInterval(tickChessClock, 100);
    applyClockConfig(true);
  }

  function saveClockPreferences() {
    try {
      localStorage.setItem('rankingClubChessClock', JSON.stringify({
        minutes: Number($('clockMinutes').value || 0),
        increment: Number($('clockIncrement').value || 0),
        tableMode: $('clockTableMode').checked
      }));
    } catch (_) {}
  }

  function clockCategory(minutes, increment) {
    // Mismo criterio público que Lichess: tiempo inicial (s) + 40 × incremento.
    const estimate = Math.max(0, Number(minutes) * 60) + 40 * Math.max(0, Number(increment));
    if (estimate <= 29) return 'UltraBullet';
    if (estimate <= 179) return 'Bullet';
    if (estimate <= 479) return 'Blitz';
    if (estimate <= 1499) return 'Rápida';
    return 'Clásica';
  }

  function updateClockCategory() {
    const minutes = Math.max(0, Number($('clockMinutes').value || 0));
    const increment = Math.max(0, Number($('clockIncrement').value || 0));
    $('clockCategory').textContent = `${clockCategory(minutes, increment)} · ${minutes}+${increment}`;
    document.querySelectorAll('.clock-preset').forEach(btn => {
      btn.classList.toggle('active', Number(btn.dataset.minutes) === minutes && Number(btn.dataset.increment) === increment);
    });
  }

  function applyClockConfig(silent=false) {
    const minutes = Math.max(0, Math.min(300, Number($('clockMinutes').value || 0)));
    const increment = Math.max(0, Math.min(120, Number($('clockIncrement').value || 0)));
    if (minutes <= 0 && increment <= 0) {
      if (!silent) showMessage('Configura algún tiempo inicial o incremento.','error');
      return false;
    }
    pauseChessClock(false);
    clockState.initialMs = minutes * 60 * 1000;
    clockState.incrementMs = increment * 1000;
    clockState.whiteMs = clockState.initialMs;
    clockState.blackMs = clockState.initialMs;
    clockState.activeSide = null;
    clockState.flagged = null;
    saveClockPreferences();
    applyClockTableMode();
    updateClockCategory();
    renderChessClock();
    if (!silent) showMessage(`Reloj configurado: ${minutes}+${increment}.`,'success');
    return true;
  }

  function applyClockTableMode() {
    $('chessClockStage').classList.toggle('table-mode', $('clockTableMode').checked);
  }

  function formatClockTime(ms) {
    const safe = Math.max(0, Number(ms || 0));
    if (safe < 10000) {
      const seconds = safe / 1000;
      return `0:${seconds.toFixed(1).padStart(4,'0')}`;
    }
    const total = Math.ceil(safe / 1000);
    const minutes = Math.floor(total / 60);
    const seconds = total % 60;
    return `${minutes}:${String(seconds).padStart(2,'0')}`;
  }

  function renderChessClock() {
    if (!$('clockWhiteTime')) return;
    $('clockWhiteTime').textContent = formatClockTime(clockState.whiteMs);
    $('clockBlackTime').textContent = formatClockTime(clockState.blackMs);
    const incText = `+${Math.round(clockState.incrementMs / 1000)} s`;
    $('clockWhiteIncrement').textContent = incText;
    $('clockBlackIncrement').textContent = incText;
    $('clockWhiteFace').classList.toggle('active', clockState.running && clockState.activeSide === 'white');
    $('clockBlackFace').classList.toggle('active', clockState.running && clockState.activeSide === 'black');
    $('clockWhiteFace').classList.toggle('flagged', clockState.flagged === 'white');
    $('clockBlackFace').classList.toggle('flagged', clockState.flagged === 'black');

    let status = 'Listo · empiezan Blancas';
    if (clockState.flagged) status = `${clockState.flagged === 'white' ? 'Blancas' : 'Negras'} sin tiempo`;
    else if (clockState.activeSide) status = `${clockState.running ? 'Turno' : 'Pausado'} · ${clockState.activeSide === 'white' ? 'Blancas' : 'Negras'}`;
    $('clockStatus').textContent = status;
    const icon = clockState.running ? '⏸' : '▶';
    $('clockStartBtn').textContent = clockState.running ? '⏸ Pausar' : (clockState.activeSide ? '▶ Continuar' : '▶ Iniciar');
    $('clockStagePauseBtn').textContent = icon;
    $('clockStagePauseBtn').title = clockState.running ? 'Pausar' : 'Continuar';
  }

  function consumeClockElapsed() {
    if (!clockState.running || !clockState.activeSide) return;
    const now = Date.now();
    const elapsed = Math.max(0, now - clockState.lastTickAt);
    clockState.lastTickAt = now;
    const key = clockState.activeSide === 'white' ? 'whiteMs' : 'blackMs';
    clockState[key] = Math.max(0, clockState[key] - elapsed);
    if (clockState[key] <= 0) flagChessClock(clockState.activeSide);
  }

  function tickChessClock() {
    if (!clockState.running) return;
    consumeClockElapsed();
    renderChessClock();
  }

  async function requestClockWakeLock() {
    if (!clockState.running || document.visibilityState !== 'visible' || !('wakeLock' in navigator)) return;
    try {
      if (!clockState.wakeLock) {
        clockState.wakeLock = await navigator.wakeLock.request('screen');
        clockState.wakeLock.addEventListener('release', () => { clockState.wakeLock = null; });
      }
    } catch (_) {}
  }

  async function releaseClockWakeLock() {
    try { if (clockState.wakeLock) await clockState.wakeLock.release(); }
    catch (_) {}
    clockState.wakeLock = null;
  }

  function startChessClock() {
    if (clockState.flagged) resetChessClock();
    if (!clockState.activeSide) clockState.activeSide = 'white';
    clockState.running = true;
    clockState.lastTickAt = Date.now();
    requestClockWakeLock();
    renderChessClock();
  }

  function pauseChessClock(render=true) {
    if (clockState.running) consumeClockElapsed();
    clockState.running = false;
    clockState.lastTickAt = 0;
    releaseClockWakeLock();
    if (render) renderChessClock();
  }

  function toggleChessClock() {
    if (clockState.running) pauseChessClock();
    else startChessClock();
  }

  function pressChessClock(side) {
    if (!clockState.running || clockState.activeSide !== side || clockState.flagged) return;
    consumeClockElapsed();
    if (clockState.flagged) { renderChessClock(); return; }
    const key = side === 'white' ? 'whiteMs' : 'blackMs';
    clockState[key] += clockState.incrementMs;
    clockState.activeSide = side === 'white' ? 'black' : 'white';
    clockState.lastTickAt = Date.now();
    const face = side === 'white' ? $('clockWhiteFace') : $('clockBlackFace');
    face.classList.remove('pulse');
    void face.offsetWidth;
    face.classList.add('pulse');
    renderChessClock();
  }

  function resetChessClock() {
    pauseChessClock(false);
    clockState.whiteMs = clockState.initialMs;
    clockState.blackMs = clockState.initialMs;
    clockState.activeSide = null;
    clockState.flagged = null;
    renderChessClock();
  }

  function flagChessClock(side) {
    clockState.flagged = side;
    clockState.running = false;
    clockState.lastTickAt = 0;
    releaseClockWakeLock();
    playClockFlagSound();
  }

  function playClockFlagSound() {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      [0,0.16,0.32].forEach((delay,idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.frequency.value = idx === 2 ? 880 : 660;
        gain.gain.setValueAtTime(0.0001, ctx.currentTime + delay);
        gain.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + delay + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + delay + 0.11);
        osc.connect(gain); gain.connect(ctx.destination);
        osc.start(ctx.currentTime + delay); osc.stop(ctx.currentTime + delay + 0.12);
      });
      setTimeout(() => ctx.close().catch(()=>{}), 900);
    } catch (_) {}
  }

  async function toggleClockFullscreen() {
    const stage = $('chessClockStage');
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (stage.requestFullscreen) await stage.requestFullscreen();
    } catch (_) { showMessage('El navegador no ha permitido activar la pantalla completa.','error'); }
  }

  function updateClockFullscreenButtons() {
    const full = document.fullscreenElement === $('chessClockStage');
    $('clockFullscreenBtn').textContent = full ? 'Salir de pantalla completa' : '⛶ Pantalla completa';
    $('clockStageFullscreenBtn').textContent = full ? '×' : '⛶';
    $('clockStageFullscreenBtn').title = full ? 'Salir de pantalla completa' : 'Pantalla completa';
  }

  function activeUsers() { return state.users.filter(u => u.active !== false); }
  function confirmedGames() { return state.games.filter(g => g.status === 'confirmed'); }
  function scorePct(u) { return u.gamesPlayed ? (100 * Number(u.score||0) / Number(u.gamesPlayed)).toFixed(1) : '0.0'; }

  function renderDashboard() {
    if (!state.me) return;
    $('rankCurrentBtn').classList.toggle('active', state.rankingMode==='current');
    $('rankPeakBtn').classList.toggle('active', state.rankingMode==='peak');
    const users = activeUsers().slice().sort((a,b) => Number(state.rankingMode==='current'?b.rating:b.maxRating)-Number(state.rankingMode==='current'?a.rating:a.maxRating));
    const games = confirmedGames();
    const avg = users.length ? users.reduce((s,u)=>s+Number(u.rating||1500),0)/users.length : 0;
    $('clubSummary').innerHTML = [
      stat('Socios activos', users.length, 'Jugadores del ranking'),
      stat('Partidas', games.length, 'Confirmadas'),
      stat('Rating medio', round(avg), 'Glicko‑2 del club'),
      stat('Última actividad', games[0]?.playedAt ? fmtDay(asDate(games[0].playedAt)) : '—', 'Partida más reciente')
    ].join('');

    $('rankingTable').innerHTML = `<table><thead><tr><th>Pos.</th><th>Jugador</th><th>${state.rankingMode==='current'?'Rating':'Máx. histórico'}</th><th>RD</th><th>PJ</th><th>G</th><th>T</th><th>P</th><th>%</th></tr></thead><tbody>${users.map((u,i)=>`<tr><td class="rank-pos top${i+1}">${i+1}</td><td><strong>${esc(u.name)}</strong>${provisional(u)?' <span class="provisional">PROV.</span>':''}</td><td class="rating">${state.rankingMode==='current'?ratingLabel(u):round(u.maxRating)}</td><td>${one(u.rd)}</td><td>${u.gamesPlayed||0}</td><td>${u.wins||0}</td><td>${u.draws||0}</td><td>${u.losses||0}</td><td>${scorePct(u)}%</td></tr>`).join('')}</tbody></table>`;

    $('recentGames').innerHTML = games.slice(0,6).map(gameRow).join('') || empty('Aún no hay partidas confirmadas.');
    const pos = users.findIndex(u=>u.id===state.me.id)+1;
    $('myQuickStats').innerHTML = `<div class="stat"><span class="label">Tu posición</span><span class="value">#${pos||'—'}</span><span class="sub">de ${users.length}</span></div><div class="stat" style="margin-top:10px"><span class="label">Tu rating</span><span class="value">${ratingLabel(state.me)}</span><span class="sub">RD ${one(state.me.rd)} · ${provisional(state.me)?'Provisional':'Consolidado'}</span></div>`;
  }

  function stat(label,value,sub='') { return `<div class="stat"><span class="label">${esc(label)}</span><span class="value">${esc(value)}</span>${sub?`<span class="sub">${esc(sub)}</span>`:''}</div>`; }
  function empty(text) { return `<p class="muted">${esc(text)}</p>`; }

  function gameResultText(g) {
    return g.result === '1-0' ? '1–0' : g.result === '0-1' ? '0–1' : '½–½';
  }

  function resultClassFor(g, uid) {
    if (g.result === '1/2-1/2') return 'draw';
    const won = (g.result==='1-0' && g.whiteUid===uid) || (g.result==='0-1' && g.blackUid===uid);
    return won ? 'win' : 'loss';
  }

  function gameRow(g) {
    const d = asDate(g.playedAt);
    return `<div class="game-row"><div class="game-main"><strong>${esc(g.external?g.whiteName:playerName(g.whiteUid))} ${gameResultText(g)} ${esc(g.external?g.blackName:playerName(g.blackUid))}</strong><div class="game-meta">${d?fmtDate(d):''} · ${esc(g.timeControl||'')} ${g.event?'· '+esc(g.event):''}</div></div>${hasPgn(g)?pgnButton(g,'PGN'):''}<span class="result-pill draw">${gameResultText(g)}</span></div>`;
  }

  function populateSelectors() {
    const others = activeUsers().filter(u=>u.id!==state.authUser.uid).sort((a,b)=>a.name.localeCompare(b.name,'es'));
    const currentOpponent = $('gameOpponent').value;
    $('gameOpponent').innerHTML = `<option value="">Selecciona rival…</option>` + others.map(u=>`<option value="${u.id}">${esc(u.name)} · ${ratingLabel(u)}</option>`).join('');
    if (others.some(u=>u.id===currentOpponent)) $('gameOpponent').value = currentOpponent;

    const all = activeUsers().slice().sort((a,b)=>a.name.localeCompare(b.name,'es'));
    ['gamesPlayer','h2hA','h2hB'].forEach(id => {
      const el=$(id), old=el.value;
      if (id==='gamesPlayer') el.innerHTML='<option value="all">Todos los jugadores</option>'+all.map(u=>`<option value="${u.id}">${esc(u.name)}</option>`).join('');
      else el.innerHTML=all.map(u=>`<option value="${u.id}">${esc(u.name)}</option>`).join('');
      if ([...el.options].some(o=>o.value===old)) el.value=old;
    });
    if (!$('h2hA').value && all[0]) $('h2hA').value=all[0].id;
    if (!$('h2hB').value && all[1]) $('h2hB').value=all[1].id;
  }

  function resultFromMyPerspective(myResult, myColor) {
    if (myResult === 'draw') return '1/2-1/2';
    if (myColor === 'white') return myResult === 'win' ? '1-0' : '0-1';
    return myResult === 'win' ? '0-1' : '1-0';
  }

  function myDraftGame() {
    if (!state.authUser) return null;
    return state.games.find(g => g.status === 'draft' && g.creatorUid === state.authUser.uid) || state.externalGames.find(g => g.status === 'draft' && g.ownerUid === state.authUser.uid) || null;
  }

  function gameAnnotationMeta(g) {
    return {
      event: g.event || 'Partida del club',
      site: 'Ranking Club Ajedrez',
      date: asDate(g.playedAt) || new Date(),
      white: g.whiteName || playerName(g.whiteUid),
      black: g.blackName || playerName(g.blackUid),
      whiteElo: g.external ? null : (g.whiteRatingAtStart ?? userById(g.whiteUid)?.rating),
      blackElo: g.external ? null : (g.blackRatingAtStart ?? userById(g.blackUid)?.rating),
      annotator: g.annotatorName || state.me?.name || '',
      timeControl: g.timeControl || ''
    };
  }

  function setGameType(type) {
    state.gameType = type === 'external' ? 'external' : 'club';
    const external = state.gameType === 'external';
    $('clubGameTypeBtn').classList.toggle('active', !external);
    $('externalGameTypeBtn').classList.toggle('active', external);
    $('clubGameFields').classList.toggle('hidden', external);
    $('externalGameFields').classList.toggle('hidden', !external);
    $('manualFinishBox').classList.toggle('hidden', external);
    $('gameForm').querySelector('button[type=submit]').classList.toggle('hidden', external);
    $('startAnnotationBtn').textContent = external ? '♟ ANOTAR PARTIDA EXTERNA' : '♟ ANOTAR PARTIDA';
  }

  function readGameForm() {
    if (state.gameType === 'external') {
      const whiteName=$('externalWhiteName').value.trim(), blackName=$('externalBlackName').value.trim();
      if(!whiteName || !blackName) throw new Error('Escribe los nombres de Blancas y Negras.');
      const rawDate=$('gameDate').value, playedAt=new Date(rawDate);
      if(!rawDate || Number.isNaN(playedAt.getTime())) throw new Error('Indica una fecha y hora válidas.');
      return { external:true, myColor:'white', whiteName, blackName, playedAt, timeControl:$('gameTimeControl').value, event:$('gameEvent').value.trim(), link:$('gameLink').value.trim(), annotatorName:state.me?.name||'' };
    }
    const opponentUid = $('gameOpponent').value;
    if (!opponentUid) throw new Error('Selecciona un rival.');
    const rawDate = $('gameDate').value;
    const playedAt = new Date(rawDate);
    if (!rawDate || Number.isNaN(playedAt.getTime())) throw new Error('Indica una fecha y hora válidas.');
    const myColor = $('gameMyColor').value;
    const whiteUid = myColor === 'white' ? state.authUser.uid : opponentUid;
    const blackUid = myColor === 'black' ? state.authUser.uid : opponentUid;
    return {
      opponentUid, myColor, whiteUid, blackUid, playedAt,
      timeControl: $('gameTimeControl').value,
      event: $('gameEvent').value.trim(),
      link: $('gameLink').value.trim(),
      whiteName: playerName(whiteUid), blackName: playerName(blackUid),
      whiteRatingAtStart: Number(userById(whiteUid)?.rating ?? CFG.initialRating),
      blackRatingAtStart: Number(userById(blackUid)?.rating ?? CFG.initialRating),
      annotatorName: state.me?.name || playerName(state.authUser.uid)
    };
  }

  function renderGameDraftBanner() {
    const box = $('gameDraftBanner');
    if (!box || !state.authUser) return;
    const g = myDraftGame();
    if (!g || annotationState.gameId === g.id) {
      box.classList.add('hidden'); box.innerHTML = ''; return;
    }
    const count = Number(g.moveCount || (Array.isArray(g.moves) ? g.moves.length : 0));
    box.innerHTML = `<div class="draft-banner-info"><strong>♟ Tienes una partida en curso</strong><span class="small-note">${esc(g.whiteName || playerName(g.whiteUid))} – ${esc(g.blackName || playerName(g.blackUid))} · ${count} ${count===1?'movimiento':'movimientos'} guardados.</span></div><div class="draft-banner-actions"><button class="primary" type="button" onclick="ClubApp.resumeDraft('${g.id}')">Continuar anotación</button><button class="danger-outline" type="button" onclick="ClubApp.discardDraft('${g.id}')">Descartar</button></div>`;
    box.classList.remove('hidden');
  }

  async function startAnnotation() {
    const existing = myDraftGame();
    if (existing) {
      showMessage('Ya tienes una partida en curso. Continúa esa anotación o descártala antes de iniciar otra.','error');
      return resumeDraft(existing.id);
    }
    if (!window.ClubChessRecorder) return showMessage('El anotador de ajedrez no se ha cargado correctamente.','error');
    let form;
    try { form = readGameForm(); }
    catch (err) { return showMessage(err.message,'error'); }

    const engine = new window.ClubChessRecorder();
    const draftData = form.external ? {
      external:true, ownerUid:state.authUser.uid, creatorUid:state.authUser.uid, status:'draft', result:null,
      timeControl:form.timeControl,event:form.event,link:form.link,playedAt:firebase.firestore.Timestamp.fromDate(form.playedAt),
      annotationEnabled:true,annotationFinished:false,moves:[],moveCount:0,currentFen:engine.fen(),whiteName:form.whiteName,blackName:form.blackName,annotatorName:form.annotatorName,
      pgn:engine.pgn({event:form.event||'Partida externa',site:'Ranking Club Ajedrez',date:form.playedAt,white:form.whiteName,black:form.blackName,annotator:form.annotatorName,timeControl:form.timeControl},'*'),
      createdAt:firebase.firestore.FieldValue.serverTimestamp(),updatedAt:firebase.firestore.FieldValue.serverTimestamp()
    } : {
      whiteUid: form.whiteUid, blackUid: form.blackUid,
      creatorUid: state.authUser.uid, opponentUid: form.opponentUid,
      status: 'draft', result: null,
      timeControl: form.timeControl, event: form.event, link: form.link,
      playedAt: firebase.firestore.Timestamp.fromDate(form.playedAt),
      annotationEnabled: true, annotationFinished: false,
      moves: [], moveCount: 0, currentFen: engine.fen(),
      whiteName: form.whiteName, blackName: form.blackName,
      whiteRatingAtStart: form.whiteRatingAtStart, blackRatingAtStart: form.blackRatingAtStart,
      annotatorName: form.annotatorName,
      pgn: engine.pgn({ event: form.event || 'Partida del club', site:'Ranking Club Ajedrez', date:form.playedAt, white:form.whiteName, black:form.blackName, whiteElo:form.whiteRatingAtStart, blackElo:form.blackRatingAtStart, annotator:form.annotatorName, timeControl:form.timeControl }, '*'),
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };
    try {
      const ref = await db.collection(form.external ? 'externalGames' : 'games').add(draftData);
      annotationState.gameId = ref.id;
      annotationState.engine = engine;
      annotationState.selected = null;
      annotationState.legalMoves = [];
      annotationState.finished = false;
      annotationState.orientation = form.external ? 'white' : form.myColor;
      annotationState.external = Boolean(form.external);
      showAnnotationPanel({ id:ref.id, ...draftData });
      showMessage('Anotación iniciada. El borrador se guardará jugada a jugada.','success');
    } catch (err) { showMessage(friendlyError(err),'error'); }
  }

  async function getGameById(id) {
    const local = state.games.find(g => g.id === id) || state.externalGames.find(g=>g.id===id);
    if (local) return local;
    let snap = await db.collection('games').doc(id).get();
    if (snap.exists) return {id:snap.id,...snap.data()};
    snap = await db.collection('externalGames').doc(id).get();
    return snap.exists ? { id:snap.id, ...snap.data(), external:true } : null;
  }

  function gameCollection(g){ return g?.external ? 'externalGames' : 'games'; }

  async function resumeDraft(id) {
    try {
      const g = await getGameById(id);
      if (!g || g.status !== 'draft' || (g.external ? g.ownerUid : g.creatorUid) !== state.authUser.uid) return showMessage('Ese borrador ya no está disponible.','error');
      const engine = new window.ClubChessRecorder();
      engine.loadMoves(Array.isArray(g.moves) ? g.moves : []);
      annotationState.gameId = g.id;
      annotationState.engine = engine;
      annotationState.selected = null;
      annotationState.legalMoves = [];
      annotationState.finished = Boolean(g.annotationFinished);
      annotationState.orientation = g.external ? 'white' : (g.whiteUid === state.authUser.uid ? 'white' : 'black');
      annotationState.external = Boolean(g.external);
      populateFormFromDraft(g);
      showAnnotationPanel(g);
      showMessage('Borrador recuperado.','success');
    } catch (err) { console.error(err); showMessage(friendlyError(err),'error'); }
  }

  function populateFormFromDraft(g) {
    setGameType(g.external ? 'external' : 'club');
    if(g.external){ $('externalWhiteName').value=g.whiteName||''; $('externalBlackName').value=g.blackName||''; }
    $('gameOpponent').value = g.opponentUid || '';
    $('gameMyColor').value = g.external ? 'white' : (g.whiteUid === state.authUser.uid ? 'white' : 'black');
    const d=asDate(g.playedAt); if(d){const local=new Date(d);local.setMinutes(local.getMinutes()-local.getTimezoneOffset());$('gameDate').value=local.toISOString().slice(0,16);}
    $('gameTimeControl').value = g.timeControl || 'Rápida';
    $('gameEvent').value = g.event || '';
    $('gameLink').value = g.link || '';
  }

  function showAnnotationPanel(g) {
    $('gameFormCard').classList.add('hidden');
    $('gameDraftBanner').classList.add('hidden');
    $('annotationPanel').classList.remove('hidden');
    $('annotationSummary').textContent = `${g.whiteName || playerName(g.whiteUid)} – ${g.blackName || playerName(g.blackUid)} · ${g.timeControl || ''}`;
    $('annotationFinishBox').classList.toggle('hidden', !annotationState.finished);
    const finishText=$('annotationFinishBox').querySelector('span');
    if(finishText) finishText.textContent=g.external?'Selecciona el resultado para archivarla. No se calculará rating.':'Selecciona el resultado y guarda la partida para enviarla al rival.';
    $('annotationSendBtn').textContent=g.external?'Guardar en archivo':'Guardar y enviar para confirmar';
    $('annotationBoard').classList.toggle('finished', annotationState.finished);
    $('annotationFinishBtn').disabled = annotationState.finished;
    renderAnnotation();
    showView('newGame');
  }

  function resetAnnotationUI() {
    annotationState.external=false;
    annotationState.gameId = null;
    annotationState.engine = null;
    annotationState.selected = null;
    annotationState.legalMoves = [];
    annotationState.finished = false;
    annotationState.pendingPromotion = null;
    $('annotationPanel').classList.add('hidden');
    $('annotationFinishBox').classList.add('hidden');
    $('annotationBoard').classList.remove('finished');
    $('gameFormCard').classList.remove('hidden');
    renderGameDraftBanner();
  }

  function renderAnnotation() {
    const engine = annotationState.engine;
    if (!engine) return;
    const board = $('annotationBoard');
    const glyph = { wp:'♙',wn:'♘',wb:'♗',wr:'♖',wq:'♕',wk:'♔',bp:'♟',bn:'♞',bb:'♝',br:'♜',bq:'♛',bk:'♚' };
    const files = annotationState.orientation === 'black' ? [...'hgfedcba'] : [...'abcdefgh'];
    const ranks = annotationState.orientation === 'black' ? [1,2,3,4,5,6,7,8] : [8,7,6,5,4,3,2,1];
    const legalByTo = new Map();
    annotationState.legalMoves.forEach(m => { if(!legalByTo.has(m.to))legalByTo.set(m.to,[]); legalByTo.get(m.to).push(m); });
    const hist=engine.history(), last=hist[hist.length-1];
    let html='';
    ranks.forEach((rank,ri)=>files.forEach((file,fi)=>{
      const sq=file+rank,p=engine.piece(sq),c=coordsForBoard(sq),classes=['annotation-square',((c.f+c.r)%2===0?'dark':'light')];
      if(annotationState.selected===sq)classes.push('selected');
      if(legalByTo.has(sq))classes.push(engine.piece(sq)?'capture':'legal');
      if(last&&(last.from===sq||last.to===sq))classes.push('last');
      const showFile=ri===ranks.length-1,showRank=fi===0;
      html+=`<button class="${classes.join(' ')}" type="button" data-square="${sq}" aria-label="${sq}">${p?glyph[p.color+p.type]:''}${showFile?`<span class="annotation-coord-file">${file}</span>`:''}${showRank?`<span class="annotation-coord-rank">${rank}</span>`:''}</button>`;
    }));
    board.innerHTML=html;
    board.querySelectorAll('.annotation-square').forEach(btn=>btn.addEventListener('click',()=>onAnnotationSquare(btn.dataset.square)));

    const moves=engine.history();
    $('annotationMoveCount').textContent=`${moves.length} ${moves.length===1?'movimiento':'movimientos'}`;
    $('annotationMoves').innerHTML = moves.length ? Array.from({length:Math.ceil(moves.length/2)},(_,i)=>`<div class="move-row"><span class="move-number">${i+1}.</span><span class="move-san">${esc(moves[i*2]?.san||'')}</span><span class="move-san">${esc(moves[i*2+1]?.san||'')}</span></div>`).join('') : '<p class="muted">La anotación aparecerá aquí.</p>';
    $('annotationMoves').scrollTop=$('annotationMoves').scrollHeight;
    $('annotationTurn').textContent = engine.turn === 'w' ? 'Juegan blancas' : 'Juegan negras';
    $('annotationHint').textContent = annotationState.finished ? 'Partida terminada. Selecciona el resultado para enviarla.' : (last ? `Último movimiento: ${last.san}` : 'Pulsa una pieza y después la casilla de destino.');
    $('annotationUndoBtn').disabled = annotationState.finished || !moves.length;
  }

  function coordsForBoard(sq){return {f:'abcdefgh'.indexOf(sq[0]),r:Number(sq[1])-1};}

  function onAnnotationSquare(sq) {
    if (!annotationState.engine || annotationState.finished) return;
    const engine=annotationState.engine,piece=engine.piece(sq);
    if (!annotationState.selected) {
      if (piece && piece.color===engine.turn) selectAnnotationPiece(sq);
      return;
    }
    const candidates=annotationState.legalMoves.filter(m=>m.to===sq);
    if (candidates.length) {
      if (candidates.some(m=>m.promotion)) return askPromotion(annotationState.selected,sq);
      return makeAnnotationMove(annotationState.selected,sq);
    }
    if (piece && piece.color===engine.turn) selectAnnotationPiece(sq);
    else { annotationState.selected=null; annotationState.legalMoves=[]; renderAnnotation(); }
  }

  function selectAnnotationPiece(sq) {
    annotationState.selected=sq;
    annotationState.legalMoves=annotationState.engine.legalMovesFrom(sq);
    renderAnnotation();
  }

  function askPromotion(from,to) {
    annotationState.pendingPromotion={from,to};
    const white=annotationState.engine.turn==='w';
    const pieces=white?{q:'♕',r:'♖',b:'♗',n:'♘'}:{q:'♛',r:'♜',b:'♝',n:'♞'};
    openModal(`<h2>Promoción</h2><p>Elige la pieza en la que se convierte el peón.</p><div class="promotion-choices">${['q','r','b','n'].map(x=>`<button type="button" class="promotion-choice" onclick="ClubApp.choosePromotion('${x}')">${pieces[x]}</button>`).join('')}</div>`);
  }

  function choosePromotion(piece) {
    const p=annotationState.pendingPromotion; if(!p)return;
    annotationState.pendingPromotion=null; closeModal(); makeAnnotationMove(p.from,p.to,piece);
  }

  async function makeAnnotationMove(from,to,promotion) {
    try {
      annotationState.engine.move(from,to,promotion);
      annotationState.selected=null; annotationState.legalMoves=[];
      renderAnnotation();
      await saveAnnotationDraft(false);
    } catch(err){console.error(err);showMessage(err.message==='PROMOTION_REQUIRED'?'Selecciona la pieza de promoción.':err.message,'error');}
  }

  async function saveAnnotationDraft(showSuccess) {
    if(!annotationState.gameId||!annotationState.engine)return;
    const g=await getGameById(annotationState.gameId); if(!g)return;
    const moves=annotationState.engine.history();
    try{
      setSync('Guardando anotación…');
      await db.collection(gameCollection(g)).doc(annotationState.gameId).update({
        moves, moveCount:moves.length, currentFen:annotationState.engine.fen(),
        pgn:annotationState.engine.pgn(gameAnnotationMeta(g),'*'),
        annotationFinished:annotationState.finished,
        updatedAt:firebase.firestore.FieldValue.serverTimestamp()
      });
      setSync('Firebase conectado','ok');
      if(showSuccess)showMessage('Borrador guardado.','success');
    }catch(err){setSync('Error al guardar','error');showMessage('No se ha podido guardar la última jugada. '+friendlyError(err),'error');}
  }

  async function undoAnnotationMove() {
    if(!annotationState.engine||annotationState.finished)return;
    if(!annotationState.engine.undo())return;
    annotationState.selected=null;annotationState.legalMoves=[];renderAnnotation();
    await saveAnnotationDraft(false);
  }

  async function finishAnnotation() {
    if(!annotationState.engine)return;
    annotationState.finished=true; annotationState.selected=null; annotationState.legalMoves=[];
    $('annotationFinishBox').classList.remove('hidden'); $('annotationBoard').classList.add('finished'); $('annotationFinishBtn').disabled=true;
    renderAnnotation(); await saveAnnotationDraft(false);
    setTimeout(()=>$('annotationFinishBox').scrollIntoView({behavior:'smooth',block:'nearest'}),30);
  }

  async function continueAnnotation() {
    annotationState.finished=false;
    $('annotationFinishBox').classList.add('hidden'); $('annotationBoard').classList.remove('finished'); $('annotationFinishBtn').disabled=false;
    renderAnnotation(); await saveAnnotationDraft(false);
  }

  async function sendAnnotatedGame() {
    if(!annotationState.gameId||!annotationState.engine)return;
    try{
      const g=await getGameById(annotationState.gameId); if(!g)throw new Error('No se encuentra el borrador.');
      const myColor=g.external?'white':(g.whiteUid===state.authUser.uid?'white':'black');
      const result=g.external ? ({win:'1-0',draw:'1/2-1/2',loss:'0-1'}[$('annotationResult').value]||'*') : resultFromMyPerspective($('annotationResult').value,myColor);
      const moves=annotationState.engine.history();
      const pgn=annotationState.engine.pgn(gameAnnotationMeta(g),result);
      await db.collection(gameCollection(g)).doc(g.id).update({
        status:g.external?'archived':'pending',result,annotationFinished:true,moves,moveCount:moves.length,
        currentFen:annotationState.engine.fen(),finalFen:annotationState.engine.fen(),pgn,
        updatedAt:firebase.firestore.FieldValue.serverTimestamp()
      });
      resetAnnotationUI();
      $('gameEvent').value='';$('gameLink').value='';
      showMessage(g.external?'Partida externa archivada. No afecta al ranking.':'Partida guardada con su PGN. El rival debe confirmarla.','success');
      showView(g.external?'externalGames':'pending');
    }catch(err){console.error(err);showMessage(friendlyError(err),'error');}
  }

  async function cancelAnnotation() {
    if(!annotationState.gameId)return resetAnnotationUI();
    if(!confirm('¿Cancelar esta anotación? El borrador y sus movimientos se eliminarán.'))return;
    await discardDraft(annotationState.gameId,true);
  }

  async function discardDraft(id,fromActive) {
    if(!fromActive&&!confirm('¿Descartar esta partida en curso y borrar su anotación?'))return;
    try{
      const g=await getGameById(id);
      if(!g||g.status!=='draft'||(g.external?g.ownerUid:g.creatorUid)!==state.authUser.uid)throw new Error('No puedes borrar este borrador.');
      await db.collection(gameCollection(g)).doc(id).delete();
      if(annotationState.gameId===id)resetAnnotationUI();
      showMessage('Borrador descartado.');
    }catch(err){showMessage(friendlyError(err),'error');}
  }

  function hasPgn(g){return Boolean(g&&g.annotationEnabled&&g.pgn&&String(g.pgn).trim());}
  function pgnButton(g,label='Ver PGN'){return hasPgn(g)?`<button class="pgn-button" type="button" onclick="ClubApp.openPgn('${g.id}')">${label}</button>`:'<span class="muted">—</span>';}

  function renderFenBoard(containerId,fen) {
    const el=$(containerId); if(!el)return;
    let parsed; try{parsed=window.ClubChessRecorder.parseFen(fen);}catch(_){return;}
    const glyph={wp:'♙',wn:'♘',wb:'♗',wr:'♖',wq:'♕',wk:'♔',bp:'♟',bn:'♞',bb:'♝',br:'♜',bq:'♛',bk:'♚'};
    let html='';
    for(let rank=8;rank>=1;rank--)for(const file of 'abcdefgh'){
      const sq=file+rank,c=coordsForBoard(sq),p=parsed.board[sq];
      html+=`<div class="annotation-square ${(c.f+c.r)%2===0?'dark':'light'}">${p?glyph[p.color+p.type]:''}</div>`;
    }
    el.innerHTML=html;
  }

  function openPgn(id) {
    const g=state.games.find(x=>x.id===id)||state.externalGames.find(x=>x.id===id); if(!g||!hasPgn(g))return showMessage('Esta partida no tiene PGN guardado.','error');
    const moves=Array.isArray(g.moves)?g.moves:[];
    pgnViewerState.gameId=id;pgnViewerState.index=0;pgnViewerState.fens=[g.initialFen || window.ClubChessRecorder.START_FEN,...moves.map(m=>m.fen).filter(Boolean)];
    const whiteLabel=g.whiteName||playerName(g.whiteUid), blackLabel=g.blackName||playerName(g.blackUid);
    openModal(`<div class="pgn-viewer"><h2>${esc(whiteLabel)} ${gameResultText(g)} ${esc(blackLabel)}</h2><div id="pgnViewerBoard" class="pgn-viewer-board"></div><div id="pgnViewerMeta" class="pgn-meta"></div><div class="pgn-controls"><button class="outline" type="button" onclick="ClubApp.pgnJump('start')">|◀</button><button class="outline" type="button" onclick="ClubApp.pgnJump('prev')">◀</button><button class="outline" type="button" onclick="ClubApp.pgnJump('next')">▶</button><button class="outline" type="button" onclick="ClubApp.pgnJump('end')">▶|</button></div><textarea id="pgnViewerText" class="pgn-text" readonly>${esc(g.pgn)}</textarea><button class="primary" type="button" onclick="ClubApp.copyPgn('${g.id}')">Copiar PGN</button></div>`);
    renderPgnViewer();
  }

  function renderPgnViewer(){
    if(!pgnViewerState.fens.length)return;
    const i=Math.max(0,Math.min(pgnViewerState.index,pgnViewerState.fens.length-1));pgnViewerState.index=i;
    renderFenBoard('pgnViewerBoard',pgnViewerState.fens[i]);
    const g=state.games.find(x=>x.id===pgnViewerState.gameId)||state.externalGames.find(x=>x.id===pgnViewerState.gameId),move=i>0?(g?.moves||[])[i-1]:null;
    if($('pgnViewerMeta'))$('pgnViewerMeta').textContent=i===0?'Posición inicial':`Jugada ${i}: ${move?.san||''}`;
  }

  function pgnJump(where){
    if(where==='start')pgnViewerState.index=0;
    else if(where==='prev')pgnViewerState.index--;
    else if(where==='next')pgnViewerState.index++;
    else if(where==='end')pgnViewerState.index=pgnViewerState.fens.length-1;
    renderPgnViewer();
  }

  async function copyPgn(id){
    const g=state.games.find(x=>x.id===id)||state.externalGames.find(x=>x.id===id);if(!g||!g.pgn)return;
    const text=String(g.pgn);
    try{if(navigator.clipboard&&window.isSecureContext)await navigator.clipboard.writeText(text);else throw new Error('fallback');showMessage('PGN copiado al portapapeles.','success');}
    catch(_){const ta=document.createElement('textarea');ta.value=text;ta.style.position='fixed';ta.style.opacity='0';document.body.appendChild(ta);ta.focus();ta.select();document.execCommand('copy');ta.remove();showMessage('PGN copiado al portapapeles.','success');}
  }

  async function onCreateGame(e) {
    e.preventDefault();
    const opponentUid = $('gameOpponent').value;
    if (!opponentUid) return showMessage('Selecciona un rival.','error');
    const myColor = $('gameMyColor').value;
    const myResult = $('gameMyResult').value;
    const result = resultFromMyPerspective(myResult, myColor);
    const playedAt = new Date($('gameDate').value);
    const whiteUid = myColor==='white'?state.authUser.uid:opponentUid;
    const blackUid = myColor==='black'?state.authUser.uid:opponentUid;
    try {
      await db.collection('games').add({
        whiteUid, blackUid, result,
        creatorUid: state.authUser.uid,
        opponentUid,
        status:'pending',
        annotationEnabled:false,
        timeControl:$('gameTimeControl').value,
        event:$('gameEvent').value.trim(),
        link:$('gameLink').value.trim(),
        playedAt: firebase.firestore.Timestamp.fromDate(playedAt),
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      showMessage('Partida registrada. El rival debe confirmarla.','success');
      $('gameEvent').value=''; $('gameLink').value='';
      showView('pending');
    } catch (err) { showMessage(friendlyError(err),'error'); }
  }

  function renderPending() {
    if (!state.authUser) return;
    const uid=state.authUser.uid;
    const pending=state.games.filter(g=>g.status==='pending'&&(g.whiteUid===uid||g.blackUid===uid));
    const mineToConfirm=pending.filter(g=>g.opponentUid===uid).length;
    $('pendingBadge').textContent=mineToConfirm;
    $('pendingBadge').classList.toggle('hidden',mineToConfirm===0);
    $('pendingGames').innerHTML = pending.map(g=>{
      const mustConfirm=g.opponentUid===uid;
      return `<div class="pending-card"><div class="pending-head"><div><strong>${esc(playerName(g.whiteUid))} ${gameResultText(g)} ${esc(playerName(g.blackUid))}</strong><div class="game-meta">${fmtDate(asDate(g.playedAt))} · ${esc(g.timeControl||'')}</div></div><span class="status-chip">${mustConfirm?'Debes confirmar':'Esperando rival'}</span></div><div class="pending-actions">${hasPgn(g)?pgnButton(g,'Ver PGN'):''}${mustConfirm?`<button class="success-btn" onclick="ClubApp.confirmGame('${g.id}')">Confirmar</button><button class="danger-btn" onclick="ClubApp.rejectGame('${g.id}')">Rechazar</button>`:`<button class="danger-outline" onclick="ClubApp.cancelGame('${g.id}')">Cancelar</button>`}</div></div>`;
    }).join('') || empty('No tienes partidas pendientes.');
  }

  function ratingPeriodKey(value) {
    const d = asDate(value) || value;
    if (!(d instanceof Date) || Number.isNaN(d.getTime())) return '';
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  function periodDayNumber(key) {
    if (!key) return null;
    const [y,m,d] = key.split('-').map(Number);
    return Math.floor(Date.UTC(y, m - 1, d) / 86400000);
  }

  function daysBetweenPeriods(a, b) {
    const aa = periodDayNumber(a), bb = periodDayNumber(b);
    return aa == null || bb == null ? 0 : bb - aa;
  }

  function scoreForGame(g, uid) {
    if (g.result === '1/2-1/2') return 0.5;
    if (g.result === '1-0') return g.whiteUid === uid ? 1 : 0;
    return g.blackUid === uid ? 1 : 0;
  }

  function playerStatsFromGames(uid, games) {
    let wins=0, draws=0, losses=0, score=0;
    let lastGameAt=null;
    games.forEach(g => {
      if (g.whiteUid!==uid && g.blackUid!==uid) return;
      const sc=scoreForGame(g,uid);
      if(sc===1) wins++; else if(sc===0.5) draws++; else losses++;
      score += sc;
      const d=asDate(g.playedAt);
      if(d && (!lastGameAt || d>lastGameAt)) lastGameAt=d;
    });
    return {gamesPlayed:wins+draws+losses,wins,draws,losses,score,lastGameAt};
  }

  function periodBaseline(user, key) {
    if (user.ratingPeriodKey === key && user.periodStartRating != null) {
      return {
        rating:Number(user.periodStartRating),
        rd:Number(user.periodStartRD),
        volatility:Number(user.periodStartVolatility),
        maxRating:Number(user.periodStartMaxRating ?? user.maxRating ?? CFG.initialRating),
        minRating:Number(user.periodStartMinRating ?? user.minRating ?? CFG.initialRating)
      };
    }
    if (user.ratingPeriodKey && user.ratingPeriodKey > key) return null;
    const gap = user.ratingPeriodKey ? Math.max(0, daysBetweenPeriods(user.ratingPeriodKey,key)-1) : 0;
    return {
      rating:Number(user.rating ?? CFG.initialRating),
      rd:Glicko2Club.inflateForInactivePeriods(user,gap,CFG),
      volatility:Number(user.volatility ?? CFG.initialVolatility),
      maxRating:Number(user.maxRating ?? CFG.initialRating),
      minRating:Number(user.minRating ?? CFG.initialRating)
    };
  }

  async function recalculateRatingPeriod(key) {
    const usersSnap=await db.collection('users').get();
    const gamesSnap=await db.collection('games').where('status','==','confirmed').get();
    const users=new Map(usersSnap.docs.map(d=>[d.id,{id:d.id,...d.data()}]));
    const allGames=gamesSnap.docs.map(d=>({id:d.id,...d.data()}));
    const dayGames=allGames.filter(g=>ratingPeriodKey(g.playedAt)===key);
    const participantIds=[...new Set(dayGames.flatMap(g=>[g.whiteUid,g.blackUid]))];
    const baselines=new Map();

    for(const uid of participantIds){
      const u=users.get(uid); if(!u) continue;
      const base=periodBaseline(u,key);
      if(!base) return rebuildRatingsCore(true);
      baselines.set(uid,base);
    }

    const periodResults=new Map(participantIds.map(uid=>[uid,[]]));
    dayGames.forEach(g=>{
      const wBase=baselines.get(g.whiteUid), bBase=baselines.get(g.blackUid);
      if(!wBase||!bBase)return;
      const sw=g.result==='1-0'?1:g.result==='0-1'?0:0.5;
      periodResults.get(g.whiteUid).push({opponent:bBase,score:sw});
      periodResults.get(g.blackUid).push({opponent:wBase,score:1-sw});
    });

    const ends=new Map();
    participantIds.forEach(uid=>{
      const base=baselines.get(uid); if(!base)return;
      ends.set(uid,Glicko2Club.updatePeriod(base,periodResults.get(uid)||[],CFG));
    });

    const writes=[];
    for(const uid of participantIds){
      const u=users.get(uid), base=baselines.get(uid), end=ends.get(uid);
      if(!u||!base||!end)continue;
      const st=playerStatsFromGames(uid,allGames);
      writes.push({ref:db.collection('users').doc(uid),data:{
        rating:end.rating,rd:end.rd,volatility:end.volatility,
        maxRating:Math.max(base.maxRating,end.rating),minRating:Math.min(base.minRating,end.rating),
        gamesPlayed:st.gamesPlayed,wins:st.wins,draws:st.draws,losses:st.losses,score:st.score,
        lastGameAt:st.lastGameAt?firebase.firestore.Timestamp.fromDate(st.lastGameAt):null,
        ratingPeriodKey:key,periodStartRating:base.rating,periodStartRD:base.rd,
        periodStartVolatility:base.volatility,periodStartMaxRating:base.maxRating,periodStartMinRating:base.minRating,
        updatedAt:firebase.firestore.FieldValue.serverTimestamp()
      }});
    }

    dayGames.forEach(g=>{
      const wb=baselines.get(g.whiteUid),bb=baselines.get(g.blackUid),we=ends.get(g.whiteUid),be=ends.get(g.blackUid);
      if(!wb||!bb||!we||!be)return;
      writes.push({ref:db.collection('games').doc(g.id),data:{
        ratingPeriodKey:key,ratingPeriodGameCountWhite:(periodResults.get(g.whiteUid)||[]).length,ratingPeriodGameCountBlack:(periodResults.get(g.blackUid)||[]).length,
        whiteRatingBefore:wb.rating,blackRatingBefore:bb.rating,whiteRatingAfter:we.rating,blackRatingAfter:be.rating,
        whiteRDBefore:wb.rd,blackRDBefore:bb.rd,whiteRDAfter:we.rd,blackRDAfter:be.rd,
        whiteDelta:we.rating-wb.rating,blackDelta:be.rating-bb.rating,
        whiteExpected:Glicko2Club.expectedScore(wb,bb,CFG),blackExpected:Glicko2Club.expectedScore(bb,wb,CFG),
        updatedAt:firebase.firestore.FieldValue.serverTimestamp()
      }});
    });

    for(let i=0;i<writes.length;i+=450){const batch=db.batch();writes.slice(i,i+450).forEach(w=>batch.update(w.ref,w.data));await batch.commit();}
  }

  async function confirmGame(id) {
    if (state.ratingRecalcRunning) return showMessage('Hay otro recálculo Glicko-2 en curso. Espera un momento.','error');
    state.ratingRecalcRunning = true;
    let confirmed = false;
    try {
      let periodKey='';
      await db.runTransaction(async tx => {
        const gameRef=db.collection('games').doc(id);
        const gameSnap=await tx.get(gameRef);
        if (!gameSnap.exists) throw new Error('La partida ya no existe.');
        const game=gameSnap.data();
        if (game.status!=='pending') throw new Error('La partida ya fue procesada.');
        if (game.opponentUid!==state.authUser.uid) throw new Error('Solo el rival puede confirmar esta partida.');
        periodKey=ratingPeriodKey(game.playedAt);
        tx.update(gameRef,{status:'confirmed',confirmedBy:state.authUser.uid,confirmedAt:firebase.firestore.FieldValue.serverTimestamp(),ratingPeriodKey:periodKey,updatedAt:firebase.firestore.FieldValue.serverTimestamp()});
      });
      confirmed = true;
      await recalculateRatingPeriod(periodKey);
      state.engineMigrationDone = true;
      showMessage('Partida confirmada. Periodo Glicko-2 diario recalculado.','success');
    } catch(err){
      console.error(err);
      if (confirmed) {
        state.engineMigrationDone = false;
        showMessage('La partida ha quedado confirmada, pero el recálculo Glicko-2 no se ha completado. La app volverá a intentarlo automáticamente.','error');
      } else {
        showMessage(friendlyError(err),'error');
      }
    } finally {
      state.ratingRecalcRunning = false;
      if (confirmed && !state.engineMigrationDone) setTimeout(() => maybeMigrateDailyGlicko(), 800);
    }
  }

  async function rejectGame(id) {
    if (!confirm('¿Rechazar esta partida?')) return;
    try { await db.collection('games').doc(id).update({status:'rejected',rejectedBy:state.authUser.uid,updatedAt:firebase.firestore.FieldValue.serverTimestamp()}); showMessage('Partida rechazada.'); }
    catch(err){showMessage(friendlyError(err),'error');}
  }
  async function cancelGame(id) {
    if (!confirm('¿Cancelar esta partida pendiente?')) return;
    try { await db.collection('games').doc(id).update({status:'cancelled',updatedAt:firebase.firestore.FieldValue.serverTimestamp()}); showMessage('Partida cancelada.'); }
    catch(err){showMessage(friendlyError(err),'error');}
  }

  function setImportPgnStatus(text, type='') {
    const el = $('importPgnStatus');
    if (!el) return;
    el.textContent = text;
    el.className = 'full import-pgn-status' + (type ? ' ' + type : ' muted');
  }

  function meaningfulPgnTag(value) {
    const v = String(value || '').trim();
    return v && v !== '?' && v !== '-';
  }

  function pgnDateToLocalInput(dateTag) {
    const m = String(dateTag || '').trim().match(/^(\d{4})[.\/-](\d{2})[.\/-](\d{2})$/);
    if (!m || m[2] === '??' || m[3] === '??') return null;
    const year = Number(m[1]), month = Number(m[2]), day = Number(m[3]);
    const current = $('importGameDate').value ? new Date($('importGameDate').value) : new Date();
    const d = new Date(year, month - 1, day, current.getHours(), current.getMinutes(), 0, 0);
    if (Number.isNaN(d.getTime()) || d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return null;
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0,16);
  }

  function classifyPgnTimeControl(tags) {
    const ritmo = String(tags?.Ritmo || '').trim();
    if (['Clásica','Rápida','Blitz','Bullet','Amistosa'].includes(ritmo)) return ritmo;
    const tc = String(tags?.TimeControl || '').trim();
    const m = tc.match(/^(\d+)(?:\+\d+)?$/);
    if (!m) return null;
    const seconds = Number(m[1]);
    if (!Number.isFinite(seconds) || seconds <= 0) return null;
    if (seconds < 180) return 'Bullet';
    if (seconds < 600) return 'Blitz';
    if (seconds <= 1800) return 'Rápida';
    return 'Clásica';
  }

  function analyzeImportPgn(options={}) {
    const fill = options.fill !== false;
    const showStatus = options.showStatus !== false;
    try {
      if (!window.ClubChessRecorder?.parsePgn) throw new Error('El analizador PGN no se ha cargado correctamente.');
      const raw = $('importPgnText').value.trim();
      if (!raw) throw new Error('Pega primero el PGN de la partida.');
      if (raw.length > 700000) throw new Error('El PGN es demasiado grande para archivarlo de forma segura.');
      const parsed = window.ClubChessRecorder.parsePgn(raw);
      if (!parsed.moves.length) throw new Error('El PGN no contiene movimientos de una partida.');

      if (fill) {
        const t = parsed.tags || {};
        if (meaningfulPgnTag(t.White)) $('importWhiteName').value = t.White.trim();
        if (meaningfulPgnTag(t.Black)) $('importBlackName').value = t.Black.trim();
        if (['1-0','0-1','1/2-1/2'].includes(parsed.result)) $('importResult').value = parsed.result;
        const dateValue = pgnDateToLocalInput(t.Date);
        if (dateValue) $('importGameDate').value = dateValue;
        const pace = classifyPgnTimeControl(t);
        if (pace) $('importTimeControl').value = pace;
        if (meaningfulPgnTag(t.Event)) $('importEvent').value = t.Event.trim();
        else if (meaningfulPgnTag(t.Site) && !/^https?:\/\//i.test(t.Site.trim())) $('importEvent').value = t.Site.trim();
        if (meaningfulPgnTag(t.Site) && /^https?:\/\//i.test(t.Site.trim())) $('importLink').value = t.Site.trim();
      }

      if (showStatus) {
        const fullMoves = Math.floor(parsed.moves.length / 2);
        const extra = parsed.moves.length % 2 ? ' + 1 movimiento de blancas' : '';
        setImportPgnStatus(`PGN válido · ${parsed.moves.length} movimientos · ${fullMoves} jugadas completas${extra}.`, 'ok');
      }
      return parsed;
    } catch (err) {
      if (showStatus) setImportPgnStatus(err.message || 'PGN no válido.', 'error');
      throw err;
    }
  }

  async function onImportPgn(e) {
    e.preventDefault();
    let parsed;
    try {
      parsed = analyzeImportPgn({ fill:false, showStatus:true });
      const whiteName = $('importWhiteName').value.trim();
      const blackName = $('importBlackName').value.trim();
      const result = $('importResult').value;
      const rawDate = $('importGameDate').value;
      const playedAt = new Date(rawDate);
      if (!whiteName || !blackName) throw new Error('Escribe los nombres de Blancas y Negras.');
      if (!['1-0','0-1','1/2-1/2'].includes(result)) throw new Error('Selecciona el resultado de la partida.');
      if (!rawDate || Number.isNaN(playedAt.getTime())) throw new Error('Indica una fecha y hora válidas.');

      const timeControl = $('importTimeControl').value;
      const event = $('importEvent').value.trim();
      const link = $('importLink').value.trim();
      const moves = parsed.moves;
      const pgn = parsed.engine.pgn({
        event: event || 'Partida externa importada',
        site: 'Ranking Club Ajedrez',
        date: playedAt,
        white: whiteName,
        black: blackName,
        annotator: state.me?.name || '',
        timeControl,
        initialFen: parsed.initialFen
      }, result);

      setImportPgnStatus('Guardando la partida importada…');
      await db.collection('externalGames').add({
        external: true,
        imported: true,
        importSource: 'PGN',
        ownerUid: state.authUser.uid,
        creatorUid: state.authUser.uid,
        status: 'archived',
        result,
        timeControl,
        event,
        link,
        playedAt: firebase.firestore.Timestamp.fromDate(playedAt),
        annotationEnabled: true,
        annotationFinished: true,
        moves,
        moveCount: moves.length,
        initialFen: parsed.initialFen,
        currentFen: parsed.finalFen,
        finalFen: parsed.finalFen,
        whiteName,
        blackName,
        annotatorName: state.me?.name || '',
        pgn,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      });

      $('importPgnForm').reset();
      const now = new Date(); now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
      $('importGameDate').value = now.toISOString().slice(0,16);
      $('importTimeControl').value = 'Rápida';
      setImportPgnStatus('Partida importada y archivada correctamente.', 'ok');
      showMessage('Partida importada y archivada en Partidas externas. No afecta al ranking.','success');
      showView('externalGames');
    } catch (err) {
      console.error(err);
      setImportPgnStatus(err.message || friendlyError(err), 'error');
      showMessage(err.message || friendlyError(err), 'error');
    }
  }

  function renderExternalGames(){
    const el=$('externalGamesTable'); if(!el)return;
    const games=state.externalGames.filter(g=>g.status==='archived');
    if(!games.length){el.innerHTML='<p class="muted">Todavía no has archivado ninguna partida externa.</p>';return;}
    el.innerHTML=`<table><thead><tr><th>Fecha</th><th>Blancas</th><th>Resultado</th><th>Negras</th><th>Ritmo</th><th>Evento / lugar</th><th>Origen</th><th>PGN</th><th></th></tr></thead><tbody>${games.map(g=>`<tr><td>${fmtDate(asDate(g.playedAt))}</td><td>${esc(g.whiteName)}</td><td><strong>${esc(g.result||'*')}</strong></td><td>${esc(g.blackName)}</td><td>${esc(g.timeControl||'')}</td><td>${esc(g.event||'—')}</td><td><span class="external-origin ${g.imported?'imported':''}">${g.imported?'Importada':'Anotada'}</span></td><td>${pgnButton(g,'PGN')}</td><td><button class="danger-outline small" onclick="ClubApp.deleteExternalGame('${g.id}')">Eliminar</button></td></tr>`).join('')}</tbody></table>`;
  }

  async function deleteExternalGame(id){
    const g=state.externalGames.find(x=>x.id===id); if(!g||g.ownerUid!==state.authUser.uid)return;
    if(!confirm('¿Eliminar definitivamente esta partida externa archivada?'))return;
    try{await db.collection('externalGames').doc(id).delete();showMessage('Partida externa eliminada.','success');}catch(err){showMessage(friendlyError(err),'error');}
  }

  function renderGames() {
    const years=[...new Set(confirmedGames().map(g=>asDate(g.playedAt)?.getFullYear()).filter(Boolean))].sort((a,b)=>b-a);
    const yEl=$('gamesYear'), oldY=yEl.value;
    yEl.innerHTML='<option value="all">Todos los años</option>'+years.map(y=>`<option>${y}</option>`).join('');
    if ([...yEl.options].some(o=>o.value===oldY)) yEl.value=oldY;
    const y=yEl.value, p=$('gamesPlayer').value;
    const games=confirmedGames().filter(g=>(y==='all'||String(asDate(g.playedAt)?.getFullYear())===y)&&(p==='all'||g.whiteUid===p||g.blackUid===p));
    $('gamesTable').innerHTML=`<table><thead><tr><th>Fecha</th><th>Blancas</th><th>Resultado</th><th>Negras</th><th>Variación periodo</th><th>Ritmo</th><th>Evento</th><th>PGN</th></tr></thead><tbody>${games.map(g=>`<tr><td>${fmtDate(asDate(g.playedAt))}</td><td>${esc(playerName(g.whiteUid))} <span class="muted">${round(g.whiteRatingBefore)}→${round(g.whiteRatingAfter)}</span></td><td><strong>${gameResultText(g)}</strong></td><td>${esc(playerName(g.blackUid))} <span class="muted">${round(g.blackRatingBefore)}→${round(g.blackRatingAfter)}</span></td><td><span class="delta ${Number(g.whiteDelta)>=0?'pos':'neg'}">${signed(g.whiteDelta)}</span> / <span class="delta ${Number(g.blackDelta)>=0?'pos':'neg'}">${signed(g.blackDelta)}</span></td><td>${esc(g.timeControl||'')}</td><td>${esc(g.event||'—')}</td><td>${pgnButton(g,'PGN')}</td></tr>`).join('')}</tbody></table>`;
  }

  function signed(n){ n=Math.round(Number(n||0)); return (n>0?'+':'')+n; }

  function myGames(){const uid=state.authUser.uid;return confirmedGames().filter(g=>g.whiteUid===uid||g.blackUid===uid);}

  function openEditProfile() {
    if (!state.me || !state.authUser) return;
    const currentName = state.me.name || state.authUser.displayName || '';
    const email = state.authUser.email || state.me.email || '';
    openModal(`
      <h2>Editar mis datos</h2>
      <p class="small-note">Puedes cambiar el nombre con el que apareces en el club. El correo de acceso se muestra como referencia y no se modifica desde esta pantalla.</p>
      <form id="editProfileForm" class="profile-edit-form">
        <label>Nombre y apellidos
          <input id="editProfileName" type="text" maxlength="60" minlength="2" required value="${esc(currentName)}" autocomplete="name">
        </label>
        <label>Correo de acceso
          <input id="editProfileEmail" type="email" value="${esc(email)}" readonly aria-readonly="true">
        </label>
        <div class="profile-locked-note"><span>🔒</span><span>El rating, RD, volatilidad, partidas y estadísticas se calculan automáticamente y no pueden editarse desde el perfil.</span></div>
        <div class="profile-edit-actions">
          <button id="saveProfileBtn" class="primary" type="submit">Guardar cambios</button>
          <button id="cancelProfileEditBtn" class="outline" type="button">Cancelar</button>
        </div>
      </form>
      <div class="profile-security-box">
        <h3>Seguridad de la cuenta</h3>
        <p class="small-note">Puedes cambiar la contraseña directamente desde la app. Para proteger la cuenta, primero debes confirmar tu contraseña actual.</p>
        <button id="profilePasswordChangeBtn" class="outline" type="button">🔑 Cambiar contraseña</button>
        <form id="profilePasswordForm" class="profile-edit-form hidden" autocomplete="off">
          <label>Contraseña actual
            <input id="profileCurrentPassword" type="password" autocomplete="current-password" minlength="6" required>
          </label>
          <label>Nueva contraseña
            <input id="profileNewPassword" type="password" autocomplete="new-password" minlength="6" required>
          </label>
          <label>Repetir nueva contraseña
            <input id="profileNewPassword2" type="password" autocomplete="new-password" minlength="6" required>
          </label>
          <div class="profile-edit-actions">
            <button id="profilePasswordSaveBtn" class="primary" type="submit">Actualizar contraseña</button>
            <button id="profilePasswordCancelBtn" class="outline" type="button">Cancelar</button>
          </div>
        </form>
        <div id="profileEditMessage" class="message hidden"></div>
      </div>`);
    $('editProfileForm').addEventListener('submit', saveProfileChanges);
    $('cancelProfileEditBtn').addEventListener('click', closeModal);
    $('profilePasswordChangeBtn').addEventListener('click', showProfilePasswordForm);
    $('profilePasswordForm').addEventListener('submit', changeProfilePassword);
    $('profilePasswordCancelBtn').addEventListener('click', hideProfilePasswordForm);
    setTimeout(() => $('editProfileName')?.focus(), 20);
  }

  async function saveProfileChanges(e) {
    e.preventDefault();
    if (!state.me || !state.authUser) return;
    const input = $('editProfileName');
    const button = $('saveProfileBtn');
    const name = input.value.trim().replace(/\s+/g, ' ');
    if (name.length < 2) return profileEditMessage('Escribe un nombre válido de al menos 2 caracteres.', 'error');
    if (name.length > 60) return profileEditMessage('El nombre no puede superar 60 caracteres.', 'error');
    button.disabled = true;
    button.textContent = 'Guardando…';
    try {
      await db.collection('users').doc(state.authUser.uid).update({
        name,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      if (auth.currentUser && auth.currentUser.displayName !== name) {
        try { await auth.currentUser.updateProfile({ displayName: name }); }
        catch (profileErr) { console.warn('No se pudo sincronizar displayName de Authentication:', profileErr); }
      }
      closeModal();
      showMessage('Tus datos personales se han actualizado.', 'success');
    } catch (err) {
      console.error(err);
      profileEditMessage(friendlyError(err), 'error');
      button.disabled = false;
      button.textContent = 'Guardar cambios';
    }
  }

  function showProfilePasswordForm() {
    const form = $('profilePasswordForm');
    const button = $('profilePasswordChangeBtn');
    if (!form || !button) return;
    form.classList.remove('hidden');
    button.classList.add('hidden');
    $('profileEditMessage')?.classList.add('hidden');
    setTimeout(() => $('profileCurrentPassword')?.focus(), 20);
  }

  function hideProfilePasswordForm() {
    const form = $('profilePasswordForm');
    const button = $('profilePasswordChangeBtn');
    if (!form || !button) return;
    form.reset();
    form.classList.add('hidden');
    button.classList.remove('hidden');
    $('profileEditMessage')?.classList.add('hidden');
  }

  async function changeProfilePassword(e) {
    e.preventDefault();
    const user = auth.currentUser;
    if (!user || !user.email) return profileEditMessage('No se ha encontrado la sesión o el correo de acceso.', 'error');

    const currentPassword = $('profileCurrentPassword').value;
    const newPassword = $('profileNewPassword').value;
    const newPassword2 = $('profileNewPassword2').value;
    const button = $('profilePasswordSaveBtn');

    if (newPassword !== newPassword2) return profileEditMessage('Las nuevas contraseñas no coinciden.', 'error');
    if (newPassword.length < 6) return profileEditMessage('La nueva contraseña debe tener al menos 6 caracteres.', 'error');
    if (currentPassword === newPassword) return profileEditMessage('La nueva contraseña debe ser distinta de la actual.', 'error');

    button.disabled = true;
    button.textContent = 'Actualizando…';
    try {
      const credential = firebase.auth.EmailAuthProvider.credential(user.email, currentPassword);
      await user.reauthenticateWithCredential(credential);
      await user.updatePassword(newPassword);
      $('profilePasswordForm').reset();
      $('profilePasswordForm').classList.add('hidden');
      $('profilePasswordChangeBtn').classList.remove('hidden');
      profileEditMessage('Contraseña actualizada correctamente.', 'success');
    } catch (err) {
      console.error(err);
      const code = err?.code || '';
      if (code === 'auth/wrong-password' || code === 'auth/invalid-credential') {
        profileEditMessage('La contraseña actual no es correcta.', 'error');
      } else if (code === 'auth/weak-password') {
        profileEditMessage('La nueva contraseña no cumple los requisitos de seguridad.', 'error');
      } else if (code === 'auth/too-many-requests') {
        profileEditMessage('Demasiados intentos. Espera unos minutos y vuelve a probar.', 'error');
      } else {
        profileEditMessage(friendlyError(err), 'error');
      }
    } finally {
      button.disabled = false;
      button.textContent = 'Actualizar contraseña';
    }
  }

  function profileEditMessage(text, type='') {
    const box = $('profileEditMessage');
    if (!box) return;
    box.textContent = text;
    box.className = 'message' + (type ? ' ' + type : '');
    box.classList.remove('hidden');
  }

  function renderProfile() {
    if (!state.me) return;
    const u=state.me;
    $('profileHeader').innerHTML=`<div class="profile-name"><h3>${esc(u.name)}</h3><p>${esc(u.email)} · ${provisional(u)?'Rating provisional':'Rating consolidado'}</p></div><div class="profile-rating"><div class="big">${ratingLabel(u)}</div><div class="rd">RD ${one(u.rd)} · σ ${Number(u.volatility||0).toFixed(4)}</div></div>`;
    $('profileStats').innerHTML=[stat('Partidas',u.gamesPlayed||0,'Confirmadas'),stat('Victorias',u.wins||0,scorePct(u)+'% puntuación'),stat('Máximo',round(u.maxRating),'Rating histórico'),stat('Mínimo',round(u.minRating),'Rating histórico')].join('');
    $('myRecentGames').innerHTML=myGames().slice(0,6).map(g=>{
      const cls=resultClassFor(g,u.id);return `<div class="game-row"><div><strong>${esc(playerName(g.whiteUid))} ${gameResultText(g)} ${esc(playerName(g.blackUid))}</strong><div class="game-meta">${fmtDate(asDate(g.playedAt))}</div></div><span class="result-pill ${cls}">${cls==='win'?'Victoria':cls==='loss'?'Derrota':'Tablas'}</span></div>`;
    }).join('')||empty('Todavía no has jugado partidas confirmadas.');
    $('glickoInfo').innerHTML=`<p><strong>Rating:</strong> ${round(u.rating)}</p><p><strong>RD:</strong> ${one(u.rd)} ${provisional(u)?'<span class="provisional">(provisional)</span>':'(estable)'}</p><p><strong>Volatilidad:</strong> ${Number(u.volatility||0).toFixed(5)}</p><p class="small-note">El signo ? desaparece cuando el RD baja a 110 o menos. La incertidumbre puede volver a aumentar después de largos periodos de inactividad.</p>`;
    if(state.currentView==='profile') setTimeout(drawRatingChart,20);
  }

  function drawRatingChart() {
    const canvas=$('ratingChart'); if(!canvas||!state.me)return;
    const dpr=window.devicePixelRatio||1, rect=canvas.getBoundingClientRect();
    canvas.width=Math.max(300,rect.width*dpr);canvas.height=260*dpr;
    const ctx=canvas.getContext('2d');ctx.scale(dpr,dpr);const W=canvas.width/dpr,H=260;
    ctx.clearRect(0,0,W,H);ctx.fillStyle='#0c1425';ctx.fillRect(0,0,W,H);
    const games=myGames().slice().sort((a,b)=>asDate(a.playedAt)-asDate(b.playedAt));
    const pts=[{r:CFG.initialRating,d:state.me.createdAt?asDate(state.me.createdAt):new Date()}];
    games.forEach(g=>pts.push({r:Number(g.whiteUid===state.me.id?g.whiteRatingAfter:g.blackRatingAfter),d:asDate(g.playedAt)}));
    if(pts.length<2){ctx.fillStyle='#94a3b8';ctx.font='14px sans-serif';ctx.fillText('La gráfica aparecerá después de tu primera partida.',20,35);return;}
    const min=Math.min(...pts.map(p=>p.r))-40,max=Math.max(...pts.map(p=>p.r))+40,pad=34;
    ctx.strokeStyle='#2a3953';ctx.lineWidth=1;for(let i=0;i<5;i++){let y=pad+(H-2*pad)*i/4;ctx.beginPath();ctx.moveTo(pad,y);ctx.lineTo(W-pad,y);ctx.stroke();}
    ctx.strokeStyle='#f59e0b';ctx.lineWidth=2.5;ctx.beginPath();pts.forEach((p,i)=>{const x=pad+(W-2*pad)*(i/(pts.length-1));const y=H-pad-(H-2*pad)*((p.r-min)/(max-min));i?ctx.lineTo(x,y):ctx.moveTo(x,y);});ctx.stroke();
    ctx.fillStyle='#cbd5e1';ctx.font='12px sans-serif';ctx.fillText(String(round(max)),4,pad+4);ctx.fillText(String(round(min)),4,H-pad+4);ctx.fillText(`Actual ${round(pts.at(-1).r)}`,Math.max(pad,W-120),20);
  }

  function renderPlayers() {
    $('playersGrid').innerHTML=activeUsers().slice().sort((a,b)=>Number(b.rating)-Number(a.rating)).map(u=>`<div class="player-card"><h3>${esc(u.name)}</h3><div class="muted">${provisional(u)?'Provisional':'Consolidado'}</div><div class="rating-line">${ratingLabel(u)}</div><div class="player-stats"><span>PJ ${u.gamesPlayed||0}</span><span>G ${u.wins||0}</span><span>T ${u.draws||0}</span><span>P ${u.losses||0}</span></div><button class="outline small" style="margin-top:12px" onclick="ClubApp.playerModal('${u.id}')">Ver ficha</button></div>`).join('');
  }

  function playerModal(uid) {
    const u=userById(uid); if(!u)return;
    const games=confirmedGames().filter(g=>g.whiteUid===uid||g.blackUid===uid);
    openModal(`<h2>${esc(u.name)}</h2><div class="summary-grid" style="grid-template-columns:1fr 1fr">${stat('Rating',ratingLabel(u),'RD '+one(u.rd))}${stat('Máximo',round(u.maxRating),'Histórico')}${stat('Partidas',u.gamesPlayed||0,'Confirmadas')}${stat('Puntuación',scorePct(u)+'%','G '+(u.wins||0)+' · T '+(u.draws||0)+' · P '+(u.losses||0))}</div><h3>Últimas partidas</h3>${games.slice(0,5).map(gameRow).join('')||empty('Sin partidas.')}`);
  }

  function renderH2H() {
    const a=$('h2hA').value,b=$('h2hB').value;if(!a||!b||a===b){$('h2hResult').innerHTML=empty('Selecciona dos jugadores diferentes.');return;}
    const games=confirmedGames().filter(g=>(g.whiteUid===a&&g.blackUid===b)||(g.whiteUid===b&&g.blackUid===a));
    let aw=0,bw=0,dr=0;games.forEach(g=>{if(g.result==='1/2-1/2')dr++;else{const winner=g.result==='1-0'?g.whiteUid:g.blackUid;if(winner===a)aw++;else bw++;}});
    $('h2hResult').innerHTML=`<div class="h2h-score"><div><div class="muted">${esc(playerName(a))}</div><div class="score">${aw}</div></div><div><strong>${games.length}</strong><div class="muted">partidas<br>${dr} tablas</div></div><div><div class="muted">${esc(playerName(b))}</div><div class="score">${bw}</div></div></div><div>${games.slice(0,10).map(gameRow).join('')||empty('No han jugado entre sí.')}</div>`;
  }

  function renderRecords() {
    const us=activeUsers();if(!us.length){$('recordsGrid').innerHTML=empty('Sin datos.');return;}
    const by=(fn)=>us.slice().sort((a,b)=>fn(b)-fn(a))[0];
    const best=by(u=>u.rating),peak=by(u=>u.maxRating),games=by(u=>u.gamesPlayed||0),wins=by(u=>u.wins||0);

    // "Mejor porcentaje de puntos" cuenta desde la primera partida y muestra
    // a TODOS los jugadores empatados en el porcentaje máximo.
    const eligible=us.filter(u=>Number(u.gamesPlayed||0)>=1);
    const pctRaw=(u)=>100*Number(u.score||0)/Number(u.gamesPlayed||1);
    const maxPct=eligible.length?Math.max(...eligible.map(pctRaw)):null;
    const pctLeaders=maxPct===null?[]:eligible
      .filter(u=>Math.abs(pctRaw(u)-maxPct)<1e-9)
      .sort((a,b)=>Number(b.gamesPlayed||0)-Number(a.gamesPlayed||0)||String(a.name||'').localeCompare(String(b.name||''),'es'));
    const fmtPct=(n)=>Number(n)%1===0?Number(n).toFixed(0):Number(n).toFixed(1);

    let upset=null;confirmedGames().forEach(g=>{if(g.result==='1/2-1/2')return;const winner=g.result==='1-0'?g.whiteUid:g.blackUid;const loser=winner===g.whiteUid?g.blackUid:g.whiteUid;const wr=winner===g.whiteUid?Number(g.whiteRatingBefore):Number(g.blackRatingBefore);const lr=loser===g.whiteUid?Number(g.whiteRatingBefore):Number(g.blackRatingBefore);const diff=lr-wr;if(diff>0&&(!upset||diff>upset.diff))upset={winner,loser,diff};});

    const normal=[
      ['👑','Mayor rating actual',best.name,ratingLabel(best)],
      ['🚀','Máximo histórico',peak.name,round(peak.maxRating)],
      ['♟️','Más partidas',games.name,(games.gamesPlayed||0)+' PJ'],
      ['🏆','Más victorias',wins.name,(wins.wins||0)+' victorias']
    ];
    const normalHtml=normal.map(r=>`<div class="record-card"><div class="icon">${r[0]}</div><div class="title">${r[1]}</div><div class="name">${esc(r[2])}</div><div class="value">${esc(r[3])}</div></div>`).join('');

    const pctHtml=`<div class="record-card"><div class="icon">🎯</div><div class="title">Mejor porcentaje de puntos</div>${pctLeaders.length?pctLeaders.map((u,i)=>`<div${i?` style="margin-top:10px;padding-top:10px;border-top:1px solid rgba(148,163,184,.20)"`:''}><div class="name">${esc(u.name)}</div><div class="value">${fmtPct(pctRaw(u))}%</div><div class="value" style="margin-top:6px;font-size:.95rem;letter-spacing:.02em">G${Number(u.wins||0)} J${Number(u.gamesPlayed||0)} P${Number(u.losses||0)} T${Number(u.draws||0)}</div></div>`).join(''):'<div class="name">—</div>'}</div>`;

    const upsetHtml=`<div class="record-card"><div class="icon">⚡</div><div class="title">Mayor sorpresa</div><div class="name">${esc(upset?playerName(upset.winner):'—')}</div><div class="value">${esc(upset?`ganó con ${round(upset.diff)} puntos menos`:'—')}</div></div>`;
    $('recordsGrid').innerHTML=normalHtml+pctHtml+upsetHtml;
  }

  function renderAdmin() {
    if(!isAdmin())return;
    $('adminUsers').innerHTML=state.users.slice().sort((a,b)=>a.name.localeCompare(b.name,'es')).map(u=>`<div class="admin-row"><div><strong>${esc(u.name)}</strong><div class="small-note">${esc(u.email)} · ${u.role} · ${u.active===false?'inactivo':'activo'}</div></div><div class="admin-actions"><button class="mini-btn" onclick="ClubApp.toggleActive('${u.id}')">${u.active===false?'Activar':'Desactivar'}</button>${u.id!==state.authUser.uid?`<button class="mini-btn" onclick="ClubApp.toggleRole('${u.id}')">${u.role==='admin'?'Hacer socio':'Hacer admin'}</button>`:''}</div></div>`).join('');
  }

  async function toggleActive(uid){if(!isAdmin())return;const u=userById(uid);await db.collection('users').doc(uid).update({active:u.active===false,updatedAt:firebase.firestore.FieldValue.serverTimestamp()});}
  async function toggleRole(uid){if(!isAdmin())return;const u=userById(uid);await db.collection('users').doc(uid).update({role:u.role==='admin'?'member':'admin',updatedAt:firebase.firestore.FieldValue.serverTimestamp()});}

  async function rebuildRatingsCore(silent=false) {
    const usersSnap=await db.collection('users').get();
    const gamesSnap=await db.collection('games').where('status','==','confirmed').get();
    const players=new Map(usersSnap.docs.map(d=>[d.id,{
      id:d.id,...d.data(),rating:CFG.initialRating,rd:CFG.initialRD,volatility:CFG.initialVolatility,
      maxRating:CFG.initialRating,minRating:CFG.initialRating,gamesPlayed:0,wins:0,draws:0,losses:0,score:0,
      lastGameAt:null,ratingPeriodKey:null
    }]));
    const games=gamesSnap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>asDate(a.playedAt)-asDate(b.playedAt));
    const groups=new Map();
    games.forEach(g=>{const k=ratingPeriodKey(g.playedAt);if(!groups.has(k))groups.set(k,[]);groups.get(k).push(g);});
    const gameUpdates=[];

    for(const [key,dayGames] of [...groups.entries()].sort((a,b)=>a[0].localeCompare(b[0]))){
      const participantIds=[...new Set(dayGames.flatMap(g=>[g.whiteUid,g.blackUid]))];
      const baselines=new Map();
      participantIds.forEach(uid=>{
        const p=players.get(uid); if(!p)return;
        const gap=p.ratingPeriodKey?Math.max(0,daysBetweenPeriods(p.ratingPeriodKey,key)-1):0;
        baselines.set(uid,{
          rating:Number(p.rating),rd:Glicko2Club.inflateForInactivePeriods(p,gap,CFG),volatility:Number(p.volatility),
          maxRating:Number(p.maxRating),minRating:Number(p.minRating)
        });
      });
      const results=new Map(participantIds.map(uid=>[uid,[]]));
      dayGames.forEach(g=>{
        const wb=baselines.get(g.whiteUid),bb=baselines.get(g.blackUid);if(!wb||!bb)return;
        const sw=g.result==='1-0'?1:g.result==='0-1'?0:0.5;
        results.get(g.whiteUid).push({opponent:bb,score:sw});
        results.get(g.blackUid).push({opponent:wb,score:1-sw});
      });
      const ends=new Map();
      participantIds.forEach(uid=>{const base=baselines.get(uid);if(base)ends.set(uid,Glicko2Club.updatePeriod(base,results.get(uid)||[],CFG));});

      participantIds.forEach(uid=>{
        const p=players.get(uid),base=baselines.get(uid),end=ends.get(uid);if(!p||!base||!end)return;
        const todays=dayGames.filter(g=>g.whiteUid===uid||g.blackUid===uid);
        todays.forEach(g=>{const sc=scoreForGame(g,uid);p.gamesPlayed++;p.score+=sc;if(sc===1)p.wins++;else if(sc===0.5)p.draws++;else p.losses++;});
        const latest=todays.map(g=>asDate(g.playedAt)).filter(Boolean).sort((a,b)=>b-a)[0];
        p.rating=end.rating;p.rd=end.rd;p.volatility=end.volatility;
        p.maxRating=Math.max(base.maxRating,end.rating);p.minRating=Math.min(base.minRating,end.rating);
        p.lastGameAt=latest?firebase.firestore.Timestamp.fromDate(latest):p.lastGameAt;p.ratingPeriodKey=key;
        p.periodStartRating=base.rating;p.periodStartRD=base.rd;p.periodStartVolatility=base.volatility;
        p.periodStartMaxRating=base.maxRating;p.periodStartMinRating=base.minRating;
      });

      dayGames.forEach(g=>{
        const wb=baselines.get(g.whiteUid),bb=baselines.get(g.blackUid),we=ends.get(g.whiteUid),be=ends.get(g.blackUid);
        if(!wb||!bb||!we||!be)return;
        gameUpdates.push({id:g.id,data:{
          ratingPeriodKey:key,ratingPeriodGameCountWhite:(results.get(g.whiteUid)||[]).length,ratingPeriodGameCountBlack:(results.get(g.blackUid)||[]).length,
          whiteRatingBefore:wb.rating,blackRatingBefore:bb.rating,whiteRatingAfter:we.rating,blackRatingAfter:be.rating,
          whiteRDBefore:wb.rd,blackRDBefore:bb.rd,whiteRDAfter:we.rd,blackRDAfter:be.rd,
          whiteDelta:we.rating-wb.rating,blackDelta:be.rating-bb.rating,
          whiteExpected:Glicko2Club.expectedScore(wb,bb,CFG),blackExpected:Glicko2Club.expectedScore(bb,wb,CFG)
        }});
      });
    }

    const writes=[];
    players.forEach(p=>writes.push({ref:db.collection('users').doc(p.id),data:{
      rating:p.rating,rd:p.rd,volatility:p.volatility,maxRating:p.maxRating,minRating:p.minRating,
      gamesPlayed:p.gamesPlayed,wins:p.wins,draws:p.draws,losses:p.losses,score:p.score,lastGameAt:p.lastGameAt,
      ratingPeriodKey:p.ratingPeriodKey||null,periodStartRating:p.periodStartRating??CFG.initialRating,
      periodStartRD:p.periodStartRD??CFG.initialRD,periodStartVolatility:p.periodStartVolatility??CFG.initialVolatility,
      periodStartMaxRating:p.periodStartMaxRating??CFG.initialRating,periodStartMinRating:p.periodStartMinRating??CFG.initialRating,
      updatedAt:firebase.firestore.FieldValue.serverTimestamp()
    }}));
    gameUpdates.forEach(x=>writes.push({ref:db.collection('games').doc(x.id),data:{...x.data,updatedAt:firebase.firestore.FieldValue.serverTimestamp()}}));
    for(let i=0;i<writes.length;i+=450){const batch=db.batch();writes.slice(i,i+450).forEach(w=>batch.update(w.ref,w.data));await batch.commit();}
    if(!silent)showMessage('Ranking recalculado con Glicko-2 puro por periodos diarios.','success');
  }

  async function rebuildRatings() {
    if(!isAdmin())return;
    if(!confirm('Esto recalculará todo el ranking con Glicko-2 puro, agrupando todas las partidas de cada día en un único periodo. ¿Continuar?'))return;
    try { showMessage('Recalculando periodos Glicko-2…'); await rebuildRatingsCore(false); }
    catch(err){console.error(err);showMessage(friendlyError(err),'error');}
  }

  function openModal(html){$('modalBody').innerHTML=html;$('modal').classList.remove('hidden');}
  function closeModal(){$('modal').classList.add('hidden');}

  window.ClubApp={confirmGame,rejectGame,cancelGame,playerModal,toggleActive,toggleRole,openEditProfile,resumeDraft,discardDraft,choosePromotion,openPgn,pgnJump,copyPgn,deleteExternalGame};
  window.addEventListener('resize',()=>{if(state.currentView==='profile')drawRatingChart();});
  window.addEventListener('DOMContentLoaded',boot);
})();
