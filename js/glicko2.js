(function (global) {
  'use strict';

  // Implementación de Glicko-2 basada en la especificación de Mark Glickman.
  // No aplica bonificaciones por color ni factores K propios.
  const SCALE = 173.7178;
  const PI2 = Math.PI * Math.PI;

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function toMu(rating) {
    return (Number(rating) - 1500) / SCALE;
  }

  function toPhi(rd) {
    return Number(rd) / SCALE;
  }

  function fromMu(mu) {
    return 1500 + SCALE * mu;
  }

  function fromPhi(phi) {
    return SCALE * phi;
  }

  function g(phi) {
    return 1 / Math.sqrt(1 + (3 * phi * phi) / PI2);
  }

  function E(mu, opponentMu, opponentPhi) {
    return 1 / (1 + Math.exp(-g(opponentPhi) * (mu - opponentMu)));
  }

  function volatilityPrime(phi, sigma, delta, v, tau) {
    const a = Math.log(sigma * sigma);
    const eps = 0.000001;

    function f(x) {
      const ex = Math.exp(x);
      const num = ex * (delta * delta - phi * phi - v - ex);
      const den = 2 * Math.pow(phi * phi + v + ex, 2);
      return num / den - (x - a) / (tau * tau);
    }

    let A = a;
    let B;

    if (delta * delta > phi * phi + v) {
      B = Math.log(delta * delta - phi * phi - v);
    } else {
      let k = 1;
      while (f(a - k * tau) < 0) k += 1;
      B = a - k * tau;
    }

    let fA = f(A);
    let fB = f(B);

    while (Math.abs(B - A) > eps) {
      const C = A + ((A - B) * fA) / (fB - fA);
      const fC = f(C);
      if (fC * fB <= 0) {
        A = B;
        fA = fB;
      } else {
        fA /= 2;
      }
      B = C;
      fB = fC;
    }

    return Math.exp(A / 2);
  }

  // Periodos sin partidas: paso 6 de Glicko-2 repetido una vez por periodo inactivo.
  function inflateForInactivePeriods(player, periods, cfg) {
    const maxRD = Number(cfg.initialRD || 350);
    const sigma = Number(player.volatility || cfg.initialVolatility || 0.06);
    let phi = toPhi(player.rd || maxRD);
    const count = Math.max(0, Math.floor(Number(periods || 0)));
    if (!count) return clamp(fromPhi(phi), 30, maxRD);
    phi = Math.sqrt(phi * phi + sigma * sigma * count);
    return clamp(fromPhi(phi), 30, maxRD);
  }

  function expectedScore(player, opponent, cfg) {
    const mu = toMu(player.rating || cfg.initialRating || 1500);
    const oppMu = toMu(opponent.rating || cfg.initialRating || 1500);
    const oppPhi = toPhi(opponent.rd || cfg.initialRD || 350);
    return E(mu, oppMu, oppPhi);
  }

  // Actualiza UN jugador con TODOS sus resultados de un mismo periodo de rating.
  // results: [{ opponent: {rating, rd, volatility}, score: 0|0.5|1 }]
  function updatePeriod(player, results, cfg) {
    const tau = Number(cfg.tau || 0.5);
    const maxRD = Number(cfg.initialRD || 350);
    const mu = toMu(player.rating || cfg.initialRating || 1500);
    const phi = toPhi(player.rd || maxRD);
    const sigma = Number(player.volatility || cfg.initialVolatility || 0.06);

    if (!Array.isArray(results) || results.length === 0) {
      const phiPrime = Math.sqrt(phi * phi + sigma * sigma);
      return {
        rating: Number(player.rating || cfg.initialRating || 1500),
        rd: clamp(fromPhi(phiPrime), 30, maxRD),
        volatility: sigma
      };
    }

    let varianceSum = 0;
    let improvementSum = 0;

    for (const r of results) {
      const opponent = r.opponent || {};
      const oppMu = toMu(opponent.rating || cfg.initialRating || 1500);
      const oppPhi = toPhi(opponent.rd || maxRD);
      const gg = g(oppPhi);
      const expected = E(mu, oppMu, oppPhi);
      varianceSum += gg * gg * expected * (1 - expected);
      improvementSum += gg * (Number(r.score) - expected);
    }

    const v = 1 / varianceSum;
    const delta = v * improvementSum;
    const sigmaPrime = volatilityPrime(phi, sigma, delta, v, tau);
    const phiStar = Math.sqrt(phi * phi + sigmaPrime * sigmaPrime);
    const phiPrime = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v);
    const muPrime = mu + phiPrime * phiPrime * improvementSum;

    return {
      rating: clamp(fromMu(muPrime), 100, 4000),
      rd: clamp(fromPhi(phiPrime), 30, maxRD),
      volatility: clamp(sigmaPrime, 0.01, 1)
    };
  }

  function isProvisional(player, cfg) {
    return Number(player.rd || cfg.initialRD || 350) > Number(cfg.provisionalRD || 110);
  }

  global.Glicko2Club = {
    updatePeriod,
    expectedScore,
    inflateForInactivePeriods,
    isProvisional,
    SCALE
  };
})(window);
