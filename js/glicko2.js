(function (global) {
  'use strict';

  const SCALE = 173.7178;
  const PI2 = Math.PI * Math.PI;

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function toMu(rating) {
    return (rating - 1500) / SCALE;
  }

  function toPhi(rd) {
    return rd / SCALE;
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

  function inflateRD(player, atDate, cfg) {
    const maxRD = cfg.initialRD || 350;
    const ratingPeriodDays = cfg.ratingPeriodDays || 1;
    const sigma = Number(player.volatility || cfg.initialVolatility || 0.06);
    let rd = Number(player.rd || cfg.initialRD || 350);

    if (!player.lastGameAt) return clamp(rd, 30, maxRD);

    const last = player.lastGameAt instanceof Date
      ? player.lastGameAt
      : (player.lastGameAt.toDate ? player.lastGameAt.toDate() : new Date(player.lastGameAt));

    const days = Math.max(0, (atDate.getTime() - last.getTime()) / 86400000);
    const periods = Math.floor(days / ratingPeriodDays);
    if (periods <= 0) return clamp(rd, 30, maxRD);

    let phi = toPhi(rd);
    phi = Math.sqrt(phi * phi + sigma * sigma * periods);
    return clamp(fromPhi(phi), 30, maxRD);
  }

  function updateOne(player, opponent, score, color, atDate, cfg) {
    const tau = cfg.tau || 0.5;
    const whiteAdv = Number(cfg.whiteAdvantageRating || 0);

    const effectiveRD = inflateRD(player, atDate, cfg);
    const effectiveOppRD = inflateRD(opponent, atDate, cfg);

    const mu = toMu(Number(player.rating || cfg.initialRating || 1500));
    const phi = toPhi(effectiveRD);
    const sigma = Number(player.volatility || cfg.initialVolatility || 0.06);

    let opponentRating = Number(opponent.rating || cfg.initialRating || 1500);
    // Si el jugador lleva blancas, tratamos al rival como ligeramente más débil
    // para elevar la expectativa de blancas. Si lleva negras, tratamos al rival
    // como ligeramente más fuerte para rebajar la expectativa de negras.
    if (color === 'white') opponentRating -= whiteAdv;
    if (color === 'black') opponentRating += whiteAdv;

    const oppMu = toMu(opponentRating);
    const oppPhi = toPhi(effectiveOppRD);
    const gg = g(oppPhi);
    const expected = E(mu, oppMu, oppPhi);
    const v = 1 / (gg * gg * expected * (1 - expected));
    const delta = v * gg * (score - expected);
    const sigmaPrime = volatilityPrime(phi, sigma, delta, v, tau);
    const phiStar = Math.sqrt(phi * phi + sigmaPrime * sigmaPrime);
    const phiPrime = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v);
    const muPrime = mu + phiPrime * phiPrime * gg * (score - expected);

    return {
      rating: clamp(fromMu(muPrime), 100, 4000),
      rd: clamp(fromPhi(phiPrime), 30, cfg.initialRD || 350),
      volatility: clamp(sigmaPrime, 0.01, 1),
      expected
    };
  }

  function updatePair(white, black, scoreWhite, atDate, cfg) {
    const scoreBlack = 1 - scoreWhite;
    const whiteNew = updateOne(white, black, scoreWhite, 'white', atDate, cfg);
    const blackNew = updateOne(black, white, scoreBlack, 'black', atDate, cfg);
    return {
      white: whiteNew,
      black: blackNew,
      whiteDelta: whiteNew.rating - Number(white.rating || cfg.initialRating || 1500),
      blackDelta: blackNew.rating - Number(black.rating || cfg.initialRating || 1500)
    };
  }

  function isProvisional(player, cfg) {
    return Number(player.rd || cfg.initialRD || 350) > Number(cfg.provisionalRD || 110);
  }

  global.Glicko2Club = {
    updatePair,
    updateOne,
    inflateRD,
    isProvisional,
    SCALE
  };
})(window);
