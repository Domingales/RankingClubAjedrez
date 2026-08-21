(function () {
  'use strict';

  const FB = window.RANKING_FIREBASE_CONFIG;
  const $ = id => document.getElementById(id);
  let auth = null;
  let oobCode = '';

  function showOnly(id) {
    ['resetLoading','resetInvalid','resetForm','resetSuccess'].forEach(x => $(x)?.classList.toggle('hidden', x !== id));
  }

  function showMessage(text, type='') {
    const box = $('resetMessage');
    box.textContent = text;
    box.className = 'message' + (type ? ' ' + type : '');
    box.classList.remove('hidden');
  }

  function invalid(text) {
    $('resetInvalidText').textContent = text || 'El enlace ha caducado, ya se utilizó o no es válido.';
    showOnly('resetInvalid');
  }

  function friendlyResetError(err) {
    const code = err?.code || '';
    const map = {
      'auth/expired-action-code': 'Este enlace ha caducado. Vuelve a la app y solicita un enlace nuevo.',
      'auth/invalid-action-code': 'Este enlace no es válido o ya fue utilizado. Solicita uno nuevo.',
      'auth/user-disabled': 'Esta cuenta está desactivada.',
      'auth/user-not-found': 'La cuenta asociada a este enlace ya no existe.',
      'auth/weak-password': 'La nueva contraseña no cumple los requisitos de seguridad.'
    };
    return map[code] || err?.message || 'No se ha podido completar la recuperación.';
  }

  async function bootReset() {
    try {
      if (!window.firebase || !FB || !FB.apiKey) throw new Error('Falta la configuración de Firebase.');
      firebase.initializeApp(FB);
      auth = firebase.auth();
      auth.languageCode = 'es';

      const params = new URLSearchParams(window.location.search);
      const mode = params.get('mode');
      oobCode = params.get('oobCode') || '';

      // IMPORTANTE: no usamos el parámetro apiKey del enlace. La página usa siempre
      // la clave activa incluida en firebase-config.js.
      if (mode !== 'resetPassword' || !oobCode) {
        return invalid('El enlace no contiene un código de recuperación válido. Solicita uno nuevo desde Ranking Club Ajedrez.');
      }

      const email = await auth.verifyPasswordResetCode(oobCode);
      $('resetEmail').textContent = email;
      showOnly('resetForm');
      setTimeout(() => $('resetPassword')?.focus(), 50);
    } catch (err) {
      console.error(err);
      invalid(friendlyResetError(err));
    }
  }

  async function submitReset(e) {
    e.preventDefault();
    const p1 = $('resetPassword').value;
    const p2 = $('resetPassword2').value;
    const button = $('resetSubmit');

    if (p1 !== p2) return showMessage('Las contraseñas no coinciden.', 'error');
    if (p1.length < 6) return showMessage('La contraseña debe tener al menos 6 caracteres.', 'error');

    button.disabled = true;
    button.textContent = 'Guardando…';
    $('resetMessage').classList.add('hidden');
    try {
      await auth.confirmPasswordReset(oobCode, p1);
      showOnly('resetSuccess');
    } catch (err) {
      console.error(err);
      showMessage(friendlyResetError(err), 'error');
      button.disabled = false;
      button.textContent = 'Guardar nueva contraseña';
    }
  }

  window.addEventListener('DOMContentLoaded', () => {
    $('resetForm').addEventListener('submit', submitReset);
    bootReset();
  });
})();
