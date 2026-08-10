(function () {
  'use strict';

  const CFG = window.RANKING_APP_CONFIG;
  const FB = window.RANKING_FIREBASE_CONFIG;
  const state = {
    authUser: null,
    me: null,
    users: [],
    games: [],
    unsubUsers: null,
    unsubGames: null,
    rankingMode: 'current',
    currentView: 'dashboard'
  };

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
    $('logoutButton').addEventListener('click', () => auth.signOut());
    $('menuButton').addEventListener('click', () => $('sidebar').classList.toggle('open'));
    document.querySelectorAll('.nav-item').forEach(btn => btn.addEventListener('click', () => showView(btn.dataset.view)));
    $('gameForm').addEventListener('submit', onCreateGame);
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
      await db.collection('users').doc(cred.user.uid).set(defaultProfile(cred.user, name));
      authMessage('Cuenta creada correctamente.', 'success');
    } catch (err) { authMessage(friendlyError(err), 'error'); }
  }

  async function onForgotPassword() {
    const email = $('loginEmail').value.trim();
    if (!email) return authMessage('Escribe primero tu email.', 'error');
    try { await auth.sendPasswordResetEmail(email); authMessage('Te hemos enviado el enlace de recuperación.', 'success'); }
    catch (err) { authMessage(friendlyError(err), 'error'); }
  }

  function friendlyError(err) {
    const map = {
      'auth/invalid-credential':'Email o contraseña incorrectos.',
      'auth/user-not-found':'No existe una cuenta con ese email.',
      'auth/wrong-password':'Contraseña incorrecta.',
      'auth/email-already-in-use':'Ese email ya está registrado.',
      'auth/weak-password':'La contraseña debe tener al menos 6 caracteres.',
      'auth/invalid-email':'El email no es válido.',
      'permission-denied':'Firebase ha rechazado la operación por las reglas de seguridad.'
    };
    return map[err.code] || err.message || 'Se ha producido un error.';
  }

  async function handleAuthState(user) {
    state.authUser = user;
    if (!user) {
      stopListeners();
      state.me = null; state.users=[]; state.games=[];
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
    state.unsubUsers = state.unsubGames = null;
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
      $('topUserName').textContent = state.me.name;
      $('adminNav').classList.toggle('hidden', !isAdmin());
      setSync('Firebase conectado','ok');
      refreshAll();
    }, err => { console.error(err); setSync('Error usuarios','error'); showMessage(friendlyError(err),'error'); });

    state.unsubGames = db.collection('games').orderBy('playedAt','desc').onSnapshot(snap => {
      state.games = snap.docs.map(d => ({ id:d.id, ...d.data() }));
      refreshAll();
    }, err => { console.error(err); setSync('Error partidas','error'); showMessage(friendlyError(err),'error'); });
  }

  function refreshAll() {
    if (!state.me) return;
    populateSelectors();
    renderDashboard(); renderPending(); renderGames(); renderProfile(); renderPlayers(); renderH2H(); renderRecords(); renderAdmin();
  }

  function showView(view) {
    state.currentView = view;
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    const target = $('view-' + view); if (target) target.classList.add('active');
    document.querySelectorAll('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.view === view));
    $('sidebar').classList.remove('open');
    if (view === 'profile') setTimeout(drawRatingChart, 30);
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
    return `<div class="game-row"><div class="game-main"><strong>${esc(playerName(g.whiteUid))} ${gameResultText(g)} ${esc(playerName(g.blackUid))}</strong><div class="game-meta">${d?fmtDate(d):''} · ${esc(g.timeControl||'')} ${g.event?'· '+esc(g.event):''}</div></div><span class="result-pill draw">${gameResultText(g)}</span></div>`;
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

  async function onCreateGame(e) {
    e.preventDefault();
    const opponentUid = $('gameOpponent').value;
    if (!opponentUid) return showMessage('Selecciona un rival.','error');
    const myColor = $('gameMyColor').value;
    const myResult = $('gameMyResult').value;
    let result;
    if (myResult==='draw') result='1/2-1/2';
    else if (myColor==='white') result = myResult==='win'?'1-0':'0-1';
    else result = myResult==='win'?'0-1':'1-0';
    const playedAt = new Date($('gameDate').value);
    const whiteUid = myColor==='white'?state.authUser.uid:opponentUid;
    const blackUid = myColor==='black'?state.authUser.uid:opponentUid;
    try {
      await db.collection('games').add({
        whiteUid, blackUid, result,
        creatorUid: state.authUser.uid,
        opponentUid,
        status:'pending',
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
      return `<div class="pending-card"><div class="pending-head"><div><strong>${esc(playerName(g.whiteUid))} ${gameResultText(g)} ${esc(playerName(g.blackUid))}</strong><div class="game-meta">${fmtDate(asDate(g.playedAt))} · ${esc(g.timeControl||'')}</div></div><span class="status-chip">${mustConfirm?'Debes confirmar':'Esperando rival'}</span></div><div class="pending-actions">${mustConfirm?`<button class="success-btn" onclick="ClubApp.confirmGame('${g.id}')">Confirmar</button><button class="danger-btn" onclick="ClubApp.rejectGame('${g.id}')">Rechazar</button>`:`<button class="danger-outline" onclick="ClubApp.cancelGame('${g.id}')">Cancelar</button>`}</div></div>`;
    }).join('') || empty('No tienes partidas pendientes.');
  }

  async function confirmGame(id) {
    try {
      await db.runTransaction(async tx => {
        const gameRef=db.collection('games').doc(id);
        const gameSnap=await tx.get(gameRef);
        if (!gameSnap.exists) throw new Error('La partida ya no existe.');
        const game=gameSnap.data();
        if (game.status!=='pending') throw new Error('La partida ya fue procesada.');
        if (game.opponentUid!==state.authUser.uid) throw new Error('Solo el rival puede confirmar esta partida.');
        const wRef=db.collection('users').doc(game.whiteUid), bRef=db.collection('users').doc(game.blackUid);
        const wSnap=await tx.get(wRef), bSnap=await tx.get(bRef);
        if (!wSnap.exists||!bSnap.exists) throw new Error('No se encuentran ambos jugadores.');
        const white={id:wSnap.id,...wSnap.data()}, black={id:bSnap.id,...bSnap.data()};
        const when=asDate(game.playedAt)||new Date();
        const sw=game.result==='1-0'?1:game.result==='0-1'?0:0.5;
        const upd=Glicko2Club.updatePair(white,black,sw,when,CFG);
        const wStats=nextStats(white,sw), bStats=nextStats(black,1-sw);
        const wRating=upd.white.rating, bRating=upd.black.rating;
        tx.update(wRef,{...wStats,rating:wRating,rd:upd.white.rd,volatility:upd.white.volatility,maxRating:Math.max(Number(white.maxRating||CFG.initialRating),wRating),minRating:Math.min(Number(white.minRating||CFG.initialRating),wRating),lastGameAt:game.playedAt,updatedAt:firebase.firestore.FieldValue.serverTimestamp()});
        tx.update(bRef,{...bStats,rating:bRating,rd:upd.black.rd,volatility:upd.black.volatility,maxRating:Math.max(Number(black.maxRating||CFG.initialRating),bRating),minRating:Math.min(Number(black.minRating||CFG.initialRating),bRating),lastGameAt:game.playedAt,updatedAt:firebase.firestore.FieldValue.serverTimestamp()});
        tx.update(gameRef,{status:'confirmed',confirmedBy:state.authUser.uid,confirmedAt:firebase.firestore.FieldValue.serverTimestamp(),updatedAt:firebase.firestore.FieldValue.serverTimestamp(),whiteRatingBefore:Number(white.rating||CFG.initialRating),blackRatingBefore:Number(black.rating||CFG.initialRating),whiteRatingAfter:wRating,blackRatingAfter:bRating,whiteRDBefore:Number(white.rd||CFG.initialRD),blackRDBefore:Number(black.rd||CFG.initialRD),whiteRDAfter:upd.white.rd,blackRDAfter:upd.black.rd,whiteDelta:upd.whiteDelta,blackDelta:upd.blackDelta,whiteExpected:upd.white.expected,blackExpected:upd.black.expected});
      });
      showMessage('Partida confirmada y ranking actualizado.','success');
    } catch(err){ console.error(err); showMessage(friendlyError(err),'error'); }
  }

  function nextStats(player,score) {
    return {
      gamesPlayed:Number(player.gamesPlayed||0)+1,
      wins:Number(player.wins||0)+(score===1?1:0),
      draws:Number(player.draws||0)+(score===0.5?1:0),
      losses:Number(player.losses||0)+(score===0?1:0),
      score:Number(player.score||0)+score
    };
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

  function renderGames() {
    const years=[...new Set(confirmedGames().map(g=>asDate(g.playedAt)?.getFullYear()).filter(Boolean))].sort((a,b)=>b-a);
    const yEl=$('gamesYear'), oldY=yEl.value;
    yEl.innerHTML='<option value="all">Todos los años</option>'+years.map(y=>`<option>${y}</option>`).join('');
    if ([...yEl.options].some(o=>o.value===oldY)) yEl.value=oldY;
    const y=yEl.value, p=$('gamesPlayer').value;
    const games=confirmedGames().filter(g=>(y==='all'||String(asDate(g.playedAt)?.getFullYear())===y)&&(p==='all'||g.whiteUid===p||g.blackUid===p));
    $('gamesTable').innerHTML=`<table><thead><tr><th>Fecha</th><th>Blancas</th><th>Resultado</th><th>Negras</th><th>Variación</th><th>Ritmo</th><th>Evento</th></tr></thead><tbody>${games.map(g=>`<tr><td>${fmtDate(asDate(g.playedAt))}</td><td>${esc(playerName(g.whiteUid))} <span class="muted">${round(g.whiteRatingBefore)}→${round(g.whiteRatingAfter)}</span></td><td><strong>${gameResultText(g)}</strong></td><td>${esc(playerName(g.blackUid))} <span class="muted">${round(g.blackRatingBefore)}→${round(g.blackRatingAfter)}</span></td><td><span class="delta ${Number(g.whiteDelta)>=0?'pos':'neg'}">${signed(g.whiteDelta)}</span> / <span class="delta ${Number(g.blackDelta)>=0?'pos':'neg'}">${signed(g.blackDelta)}</span></td><td>${esc(g.timeControl||'')}</td><td>${esc(g.event||'—')}</td></tr>`).join('')}</tbody></table>`;
  }

  function signed(n){ n=Math.round(Number(n||0)); return (n>0?'+':'')+n; }

  function myGames(){const uid=state.authUser.uid;return confirmedGames().filter(g=>g.whiteUid===uid||g.blackUid===uid);}

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
    const eligible=us.filter(u=>Number(u.gamesPlayed||0)>=5);const pctBest=eligible.length?eligible.slice().sort((a,b)=>Number(scorePct(b))-Number(scorePct(a)))[0]:null;
    let upset=null;confirmedGames().forEach(g=>{if(g.result==='1/2-1/2')return;const winner=g.result==='1-0'?g.whiteUid:g.blackUid;const loser=winner===g.whiteUid?g.blackUid:g.whiteUid;const wr=winner===g.whiteUid?Number(g.whiteRatingBefore):Number(g.blackRatingBefore);const lr=loser===g.whiteUid?Number(g.whiteRatingBefore):Number(g.blackRatingBefore);const diff=lr-wr;if(diff>0&&(!upset||diff>upset.diff))upset={winner,loser,diff};});
    const rec=[['👑','Mayor rating actual',best.name,ratingLabel(best)],['🚀','Máximo histórico',peak.name,round(peak.maxRating)],['♟️','Más partidas',games.name,(games.gamesPlayed||0)+' PJ'],['🏆','Más victorias',wins.name,(wins.wins||0)+' victorias'],['🎯','Mejor puntuación (mín. 5 PJ)',pctBest?pctBest.name:'—',pctBest?scorePct(pctBest)+'%':'—'],['⚡','Mayor sorpresa',upset?playerName(upset.winner):'—',upset?`ganó con ${round(upset.diff)} puntos menos`:'—']];
    $('recordsGrid').innerHTML=rec.map(r=>`<div class="record-card"><div class="icon">${r[0]}</div><div class="title">${r[1]}</div><div class="name">${esc(r[2])}</div><div class="value">${esc(r[3])}</div></div>`).join('');
  }

  function renderAdmin() {
    if(!isAdmin())return;
    $('adminUsers').innerHTML=state.users.slice().sort((a,b)=>a.name.localeCompare(b.name,'es')).map(u=>`<div class="admin-row"><div><strong>${esc(u.name)}</strong><div class="small-note">${esc(u.email)} · ${u.role} · ${u.active===false?'inactivo':'activo'}</div></div><div class="admin-actions"><button class="mini-btn" onclick="ClubApp.toggleActive('${u.id}')">${u.active===false?'Activar':'Desactivar'}</button>${u.id!==state.authUser.uid?`<button class="mini-btn" onclick="ClubApp.toggleRole('${u.id}')">${u.role==='admin'?'Hacer socio':'Hacer admin'}</button>`:''}</div></div>`).join('');
  }

  async function toggleActive(uid){if(!isAdmin())return;const u=userById(uid);await db.collection('users').doc(uid).update({active:u.active===false,updatedAt:firebase.firestore.FieldValue.serverTimestamp()});}
  async function toggleRole(uid){if(!isAdmin())return;const u=userById(uid);await db.collection('users').doc(uid).update({role:u.role==='admin'?'member':'admin',updatedAt:firebase.firestore.FieldValue.serverTimestamp()});}

  async function rebuildRatings() {
    if(!isAdmin())return;
    if(!confirm('Esto recalculará todo el ranking desde la primera partida confirmada. Úsalo solo para corregir inconsistencias. ¿Continuar?'))return;
    try {
      showMessage('Recalculando ranking…');
      const usersSnap=await db.collection('users').get();
      const gamesSnap=await db.collection('games').where('status','==','confirmed').get();
      const players=new Map(usersSnap.docs.map(d=>[d.id,{id:d.id,...d.data(),rating:CFG.initialRating,rd:CFG.initialRD,volatility:CFG.initialVolatility,maxRating:CFG.initialRating,minRating:CFG.initialRating,gamesPlayed:0,wins:0,draws:0,losses:0,score:0,lastGameAt:null}]));
      const games=gamesSnap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>asDate(a.playedAt)-asDate(b.playedAt));
      const gameUpdates=[];
      for(const g of games){const w=players.get(g.whiteUid),b=players.get(g.blackUid);if(!w||!b)continue;const when=asDate(g.playedAt)||new Date();const sw=g.result==='1-0'?1:g.result==='0-1'?0:.5;const beforeW={...w},beforeB={...b};const upd=Glicko2Club.updatePair(w,b,sw,when,CFG);Object.assign(w,nextStats(w,sw),{rating:upd.white.rating,rd:upd.white.rd,volatility:upd.white.volatility,maxRating:Math.max(w.maxRating,upd.white.rating),minRating:Math.min(w.minRating,upd.white.rating),lastGameAt:g.playedAt});Object.assign(b,nextStats(b,1-sw),{rating:upd.black.rating,rd:upd.black.rd,volatility:upd.black.volatility,maxRating:Math.max(b.maxRating,upd.black.rating),minRating:Math.min(b.minRating,upd.black.rating),lastGameAt:g.playedAt});gameUpdates.push({id:g.id,data:{whiteRatingBefore:beforeW.rating,blackRatingBefore:beforeB.rating,whiteRatingAfter:w.rating,blackRatingAfter:b.rating,whiteRDBefore:beforeW.rd,blackRDBefore:beforeB.rd,whiteRDAfter:w.rd,blackRDAfter:b.rd,whiteDelta:w.rating-beforeW.rating,blackDelta:b.rating-beforeB.rating,whiteExpected:upd.white.expected,blackExpected:upd.black.expected}});}
      const writes=[];players.forEach(p=>writes.push({ref:db.collection('users').doc(p.id),data:{rating:p.rating,rd:p.rd,volatility:p.volatility,maxRating:p.maxRating,minRating:p.minRating,gamesPlayed:p.gamesPlayed,wins:p.wins,draws:p.draws,losses:p.losses,score:p.score,lastGameAt:p.lastGameAt,updatedAt:firebase.firestore.FieldValue.serverTimestamp()}}));gameUpdates.forEach(x=>writes.push({ref:db.collection('games').doc(x.id),data:{...x.data,updatedAt:firebase.firestore.FieldValue.serverTimestamp()}}));
      for(let i=0;i<writes.length;i+=450){const batch=db.batch();writes.slice(i,i+450).forEach(w=>batch.update(w.ref,w.data));await batch.commit();}
      showMessage('Ranking recalculado correctamente.','success');
    }catch(err){console.error(err);showMessage(friendlyError(err),'error');}
  }

  function openModal(html){$('modalBody').innerHTML=html;$('modal').classList.remove('hidden');}
  function closeModal(){$('modal').classList.add('hidden');}

  window.ClubApp={confirmGame,rejectGame,cancelGame,playerModal,toggleActive,toggleRole};
  window.addEventListener('resize',()=>{if(state.currentView==='profile')drawRatingChart();});
  window.addEventListener('DOMContentLoaded',boot);
})();
