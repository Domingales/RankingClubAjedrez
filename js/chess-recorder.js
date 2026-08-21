(function (global) {
  'use strict';

  const FILES = 'abcdefgh';
  const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  const SAN_PIECE = { p: '', n: 'N', b: 'B', r: 'R', q: 'Q', k: 'K' };

  function opposite(color) { return color === 'w' ? 'b' : 'w'; }
  function validSquare(sq) { return typeof sq === 'string' && /^[a-h][1-8]$/.test(sq); }
  function coords(sq) { return { f: FILES.indexOf(sq[0]), r: Number(sq[1]) - 1 }; }
  function square(f, r) { return f >= 0 && f < 8 && r >= 0 && r < 8 ? FILES[f] + String(r + 1) : null; }
  function cloneBoard(board) {
    const out = {};
    Object.keys(board).forEach(sq => { out[sq] = { ...board[sq] }; });
    return out;
  }
  function tagText(v) { return String(v ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\r\n]+/g, ' ').trim(); }

  function parseFen(fen) {
    const parts = String(fen || START_FEN).trim().split(/\s+/);
    const rows = parts[0].split('/');
    if (rows.length !== 8) throw new Error('FEN no válido.');
    const board = {};
    rows.forEach((row, rowIndex) => {
      let file = 0;
      for (const ch of row) {
        if (/\d/.test(ch)) { file += Number(ch); continue; }
        const lower = ch.toLowerCase();
        if (!'pnbrqk'.includes(lower) || file > 7) throw new Error('FEN no válido.');
        const rank = 8 - rowIndex;
        board[FILES[file] + rank] = { type: lower, color: ch === lower ? 'b' : 'w' };
        file++;
      }
      if (file !== 8) throw new Error('FEN no válido.');
    });
    return {
      board,
      turn: parts[1] === 'b' ? 'b' : 'w',
      castling: parts[2] || '-',
      ep: parts[3] && parts[3] !== '-' ? parts[3] : null,
      halfmove: Number(parts[4] || 0),
      fullmove: Number(parts[5] || 1)
    };
  }

  class ClubChessRecorder {
    constructor(fen) {
      this._history = [];
      this._moves = [];
      this.load(fen || START_FEN);
    }

    load(fen) {
      const parsed = parseFen(fen);
      this.board = cloneBoard(parsed.board);
      this.turn = parsed.turn;
      this.castling = {
        w: { k: parsed.castling.includes('K'), q: parsed.castling.includes('Q') },
        b: { k: parsed.castling.includes('k'), q: parsed.castling.includes('q') }
      };
      this.epSquare = parsed.ep;
      this.halfmove = parsed.halfmove;
      this.fullmove = parsed.fullmove;
      this._history = [];
      this._moves = [];
      return this;
    }

    reset() { return this.load(START_FEN); }

    _snapshot() {
      return {
        board: cloneBoard(this.board),
        turn: this.turn,
        castling: { w: { ...this.castling.w }, b: { ...this.castling.b } },
        epSquare: this.epSquare,
        halfmove: this.halfmove,
        fullmove: this.fullmove
      };
    }

    _restore(s) {
      this.board = cloneBoard(s.board);
      this.turn = s.turn;
      this.castling = { w: { ...s.castling.w }, b: { ...s.castling.b } };
      this.epSquare = s.epSquare;
      this.halfmove = s.halfmove;
      this.fullmove = s.fullmove;
    }

    piece(squareName) {
      const p = this.board[squareName];
      return p ? { ...p } : null;
    }

    _kingSquare(color) {
      return Object.keys(this.board).find(sq => this.board[sq].type === 'k' && this.board[sq].color === color) || null;
    }

    _isSquareAttacked(target, byColor) {
      const { f, r } = coords(target);
      const pawnFromRank = r + (byColor === 'w' ? -1 : 1);
      for (const df of [-1, 1]) {
        const sq = square(f + df, pawnFromRank);
        const p = sq && this.board[sq];
        if (p && p.color === byColor && p.type === 'p') return true;
      }

      const knightOffsets = [[1,2],[2,1],[2,-1],[1,-2],[-1,-2],[-2,-1],[-2,1],[-1,2]];
      for (const [df, dr] of knightOffsets) {
        const sq = square(f + df, r + dr), p = sq && this.board[sq];
        if (p && p.color === byColor && p.type === 'n') return true;
      }

      for (let df = -1; df <= 1; df++) for (let dr = -1; dr <= 1; dr++) {
        if (!df && !dr) continue;
        const sq = square(f + df, r + dr), p = sq && this.board[sq];
        if (p && p.color === byColor && p.type === 'k') return true;
      }

      const rays = [
        [1,0,'rq'],[-1,0,'rq'],[0,1,'rq'],[0,-1,'rq'],
        [1,1,'bq'],[1,-1,'bq'],[-1,1,'bq'],[-1,-1,'bq']
      ];
      for (const [df, dr, types] of rays) {
        let nf = f + df, nr = r + dr;
        while (true) {
          const sq = square(nf, nr); if (!sq) break;
          const p = this.board[sq];
          if (p) {
            if (p.color === byColor && types.includes(p.type)) return true;
            break;
          }
          nf += df; nr += dr;
        }
      }
      return false;
    }

    isCheck(color) {
      const c = color || this.turn;
      const king = this._kingSquare(c);
      return king ? this._isSquareAttacked(king, opposite(c)) : false;
    }

    _pushMove(list, from, to, extra) {
      list.push({ from, to, ...(extra || {}) });
    }

    _pseudoFor(from, piece) {
      const list = [];
      const { f, r } = coords(from);
      const own = piece.color;
      const enemy = opposite(own);
      const addIf = (to) => {
        if (!to) return false;
        const target = this.board[to];
        if (!target) { this._pushMove(list, from, to); return true; }
        if (target.color === enemy) this._pushMove(list, from, to, { capture: target.type });
        return false;
      };

      if (piece.type === 'p') {
        const dr = own === 'w' ? 1 : -1;
        const startRank = own === 'w' ? 1 : 6;
        const promoRank = own === 'w' ? 7 : 0;
        const one = square(f, r + dr);
        if (one && !this.board[one]) {
          if (r + dr === promoRank) {
            ['q','r','b','n'].forEach(promotion => this._pushMove(list, from, one, { promotion }));
          } else {
            this._pushMove(list, from, one);
            const two = square(f, r + 2 * dr);
            if (r === startRank && two && !this.board[two]) this._pushMove(list, from, two, { bigPawn: true });
          }
        }
        for (const df of [-1, 1]) {
          const to = square(f + df, r + dr); if (!to) continue;
          const target = this.board[to];
          if (target && target.color === enemy) {
            if (r + dr === promoRank) ['q','r','b','n'].forEach(promotion => this._pushMove(list, from, to, { capture: target.type, promotion }));
            else this._pushMove(list, from, to, { capture: target.type });
          } else if (this.epSquare === to) {
            this._pushMove(list, from, to, { capture: 'p', enPassant: true });
          }
        }
        return list;
      }

      if (piece.type === 'n') {
        [[1,2],[2,1],[2,-1],[1,-2],[-1,-2],[-2,-1],[-2,1],[-1,2]].forEach(([df,dr]) => addIf(square(f+df,r+dr)));
        return list;
      }

      if (piece.type === 'b' || piece.type === 'r' || piece.type === 'q') {
        const dirs = [];
        if (piece.type === 'b' || piece.type === 'q') dirs.push([1,1],[1,-1],[-1,1],[-1,-1]);
        if (piece.type === 'r' || piece.type === 'q') dirs.push([1,0],[-1,0],[0,1],[0,-1]);
        dirs.forEach(([df,dr]) => {
          let nf=f+df,nr=r+dr;
          while (true) {
            const to=square(nf,nr); if(!to)break;
            const target=this.board[to];
            if(!target)this._pushMove(list,from,to);
            else { if(target.color===enemy)this._pushMove(list,from,to,{capture:target.type}); break; }
            nf+=df;nr+=dr;
          }
        });
        return list;
      }

      if (piece.type === 'k') {
        for (let df=-1; df<=1; df++) for (let dr=-1; dr<=1; dr++) if (df || dr) addIf(square(f+df,r+dr));
        const rank = own === 'w' ? '1' : '8';
        const kingStart = 'e' + rank;
        if (from === kingStart && !this.isCheck(own)) {
          if (this.castling[own].k) {
            const rook = this.board['h'+rank];
            if (rook && rook.color===own && rook.type==='r' && !this.board['f'+rank] && !this.board['g'+rank]
                && !this._isSquareAttacked('f'+rank,enemy) && !this._isSquareAttacked('g'+rank,enemy)) {
              this._pushMove(list,from,'g'+rank,{castle:'k'});
            }
          }
          if (this.castling[own].q) {
            const rook = this.board['a'+rank];
            if (rook && rook.color===own && rook.type==='r' && !this.board['b'+rank] && !this.board['c'+rank] && !this.board['d'+rank]
                && !this._isSquareAttacked('d'+rank,enemy) && !this._isSquareAttacked('c'+rank,enemy)) {
              this._pushMove(list,from,'c'+rank,{castle:'q'});
            }
          }
        }
      }
      return list;
    }

    _pseudoMoves(color) {
      const list = [];
      Object.keys(this.board).forEach(from => {
        const p = this.board[from];
        if (p.color === color) list.push(...this._pseudoFor(from,p));
      });
      return list;
    }

    _applyMove(move) {
      const piece = this.board[move.from];
      if (!piece) throw new Error('No hay pieza en la casilla de origen.');
      const moving = { ...piece };
      let capturedPiece = this.board[move.to] ? { ...this.board[move.to] } : null;

      delete this.board[move.from];
      if (move.enPassant) {
        const { f, r } = coords(move.to);
        const capSq = square(f, r + (moving.color === 'w' ? -1 : 1));
        capturedPiece = capSq && this.board[capSq] ? { ...this.board[capSq] } : { type:'p', color:opposite(moving.color) };
        if (capSq) delete this.board[capSq];
      }

      if (move.castle) {
        const rank = moving.color === 'w' ? '1' : '8';
        const rookFrom = (move.castle === 'k' ? 'h' : 'a') + rank;
        const rookTo = (move.castle === 'k' ? 'f' : 'd') + rank;
        this.board[rookTo] = this.board[rookFrom];
        delete this.board[rookFrom];
      }

      this.board[move.to] = { type: move.promotion || moving.type, color: moving.color };

      if (moving.type === 'k') this.castling[moving.color] = { k:false, q:false };
      if (moving.type === 'r') {
        if (move.from === 'a1') this.castling.w.q = false;
        if (move.from === 'h1') this.castling.w.k = false;
        if (move.from === 'a8') this.castling.b.q = false;
        if (move.from === 'h8') this.castling.b.k = false;
      }
      if (capturedPiece && capturedPiece.type === 'r') {
        if (move.to === 'a1') this.castling.w.q = false;
        if (move.to === 'h1') this.castling.w.k = false;
        if (move.to === 'a8') this.castling.b.q = false;
        if (move.to === 'h8') this.castling.b.k = false;
      }

      this.epSquare = null;
      if (moving.type === 'p' && move.bigPawn) {
        const a = coords(move.from), b = coords(move.to);
        this.epSquare = square(a.f, (a.r + b.r) / 2);
      }

      if (moving.type === 'p' || capturedPiece) this.halfmove = 0;
      else this.halfmove += 1;
      if (moving.color === 'b') this.fullmove += 1;
      this.turn = opposite(this.turn);
      return { moving, capturedPiece };
    }

    legalMoves(color) {
      const c = color || this.turn;
      const pseudo = this._pseudoMoves(c);
      const legal = [];
      for (const move of pseudo) {
        const s = this._snapshot();
        this._applyMove(move);
        const bad = this.isCheck(c);
        this._restore(s);
        if (!bad) legal.push({ ...move });
      }
      return legal;
    }

    legalMovesFrom(from) {
      if (!validSquare(from)) return [];
      const p = this.board[from];
      if (!p || p.color !== this.turn) return [];
      return this.legalMoves(this.turn).filter(m => m.from === from);
    }

    _sanBase(move) {
      const piece = this.board[move.from];
      if (move.castle === 'k') return 'O-O';
      if (move.castle === 'q') return 'O-O-O';
      const capture = Boolean(move.capture || move.enPassant || this.board[move.to]);
      let san = SAN_PIECE[piece.type];
      if (piece.type !== 'p') {
        const competitors = this.legalMoves(this.turn).filter(m => m.to === move.to && m.from !== move.from && this.board[m.from] && this.board[m.from].type === piece.type);
        if (competitors.length) {
          const sameFile = competitors.some(m => m.from[0] === move.from[0]);
          const sameRank = competitors.some(m => m.from[1] === move.from[1]);
          if (!sameFile) san += move.from[0];
          else if (!sameRank) san += move.from[1];
          else san += move.from;
        }
      } else if (capture) san += move.from[0];
      if (capture) san += 'x';
      san += move.to;
      if (move.promotion) san += '=' + SAN_PIECE[move.promotion];
      return san;
    }

    move(from, to, promotion) {
      if (!validSquare(from) || !validSquare(to)) throw new Error('Casilla no válida.');
      const candidates = this.legalMovesFrom(from).filter(m => m.to === to);
      if (!candidates.length) throw new Error('Movimiento ilegal.');
      let selected;
      if (promotion) selected = candidates.find(m => m.promotion === String(promotion).toLowerCase());
      else if (candidates.length === 1) selected = candidates[0];
      else if (candidates.some(m => m.promotion)) throw new Error('PROMOTION_REQUIRED');
      if (!selected) throw new Error('Promoción no válida.');

      const sanBase = this._sanBase(selected);
      const before = this._snapshot();
      this._applyMove(selected);
      let suffix = '';
      if (this.isCheck(this.turn)) suffix = this.legalMoves(this.turn).length ? '+' : '#';
      const san = sanBase + suffix;
      this._history.push(before);
      const record = {
        from: selected.from,
        to: selected.to,
        promotion: selected.promotion || '',
        san,
        fen: this.fen(),
        ply: this._moves.length + 1
      };
      this._moves.push(record);
      return { ...record };
    }

    undo() {
      if (!this._history.length) return null;
      const last = this._moves.pop() || null;
      const s = this._history.pop();
      this._restore(s);
      return last;
    }

    history() { return this._moves.map(m => ({ ...m })); }

    loadMoves(moves) {
      this.reset();
      (Array.isArray(moves) ? moves : []).forEach(m => this.move(m.from, m.to, m.promotion || undefined));
      return this;
    }

    fen() {
      const rows = [];
      for (let r=7;r>=0;r--) {
        let row='', empty=0;
        for (let f=0;f<8;f++) {
          const p=this.board[square(f,r)];
          if(!p){empty++;continue;}
          if(empty){row+=empty;empty=0;}
          let ch=p.type;
          if(p.color==='w')ch=ch.toUpperCase();
          row+=ch;
        }
        if(empty)row+=empty;
        rows.push(row);
      }
      let rights='';
      if(this.castling.w.k)rights+='K'; if(this.castling.w.q)rights+='Q';
      if(this.castling.b.k)rights+='k'; if(this.castling.b.q)rights+='q';
      return `${rows.join('/')} ${this.turn} ${rights||'-'} ${this.epSquare||'-'} ${this.halfmove} ${this.fullmove}`;
    }

    pgn(meta, result) {
      const r = result || '*';
      const d = meta?.date instanceof Date && !Number.isNaN(meta.date.getTime()) ? meta.date : new Date();
      const dateText = `${d.getFullYear()}.${String(d.getMonth()+1).padStart(2,'0')}.${String(d.getDate()).padStart(2,'0')}`;
      const tags = [
        ['Event', meta?.event || 'Partida del club'],
        ['Site', meta?.site || 'Ranking Club Ajedrez'],
        ['Date', dateText],
        ['Round', '-'],
        ['White', meta?.white || 'Blancas'],
        ['Black', meta?.black || 'Negras'],
        ['Result', r]
      ];
      if (meta?.whiteElo != null) tags.push(['WhiteElo', String(Math.round(Number(meta.whiteElo)))]);
      if (meta?.blackElo != null) tags.push(['BlackElo', String(Math.round(Number(meta.blackElo)))]);
      if (meta?.annotator) tags.push(['Annotator', meta.annotator]);
      if (meta?.timeControl) tags.push(['Ritmo', meta.timeControl]);
      if (meta?.initialFen && meta.initialFen !== START_FEN) {
        tags.push(['SetUp', '1']);
        tags.push(['FEN', meta.initialFen]);
      }
      const header = tags.map(([k,v]) => `[${k} "${tagText(v)}"]`).join('\n');
      const tokens=[];
      let startTurn='w', moveNumber=1;
      if (meta?.initialFen) {
        try { const initial=parseFen(meta.initialFen); startTurn=initial.turn; moveNumber=initial.fullmove || 1; } catch (_) {}
      }
      let turn=startTurn;
      this._moves.forEach((move,index) => {
        if (turn === 'w') {
          tokens.push(`${moveNumber}.`, move.san);
          turn='b';
        } else {
          if (index === 0) tokens.push(`${moveNumber}...`);
          tokens.push(move.san);
          moveNumber += 1;
          turn='w';
        }
      });
      const body=(tokens.join(' ') + (tokens.length?' ':'') + r).trim();
      return `${header}\n\n${body}`;
    }

    _sanForLegalMove(move) {
      const sanBase = this._sanBase(move);
      const before = this._snapshot();
      this._applyMove(move);
      let suffix = '';
      if (this.isCheck(this.turn)) suffix = this.legalMoves(this.turn).length ? '+' : '#';
      this._restore(before);
      return sanBase + suffix;
    }

    static normalizeSan(san) {
      let token = String(san || '').trim();
      token = token.replace(/\u00a0/g, '');
      token = token.replace(/0-0-0/gi, 'O-O-O').replace(/0-0/gi, 'O-O');
      token = token.replace(/e\.?p\.?$/i, '');
      token = token.replace(/[!?+#]+$/g, '');
      token = token.replace(/([a-h][18])([QRBN])$/i, '$1=$2');
      return token.replace(/\s+/g, '');
    }

    moveSan(san) {
      const raw = String(san || '').trim();
      if (!raw) throw new Error('Movimiento SAN vacío.');

      // También aceptamos UCI/LAN sencillo (e2e4, e7e8q) por compatibilidad
      // con algunos exportadores de PGN no estrictos.
      const uci = raw.match(/^([a-h][1-8])[-x]?([a-h][1-8])(?:=?([qrbnQRBN]))?[+#]?[!?]*$/);
      if (uci) return this.move(uci[1], uci[2], uci[3] ? uci[3].toLowerCase() : undefined);

      const wanted = ClubChessRecorder.normalizeSan(raw);
      const legal = this.legalMoves(this.turn);
      const matching = legal.filter(move => ClubChessRecorder.normalizeSan(this._sanForLegalMove(move)) === wanted);
      if (matching.length !== 1) {
        if (!matching.length) throw new Error(`No se puede interpretar el movimiento PGN “${raw}”.`);
        throw new Error(`El movimiento PGN “${raw}” es ambiguo.`);
      }
      const selected = matching[0];
      return this.move(selected.from, selected.to, selected.promotion || undefined);
    }

    static parsePgn(pgnText) {
      const source = String(pgnText || '').replace(/^\uFEFF/, '').trim();
      if (!source) throw new Error('El PGN está vacío.');

      const tags = {};
      source.split(/\r?\n/).forEach(line => {
        const m = line.match(/^\s*\[([A-Za-z0-9_]+)\s+"((?:\\.|[^"\\])*)"\]\s*$/);
        if (m) tags[m[1]] = m[2].replace(/\\"/g, '"').replace(/\\\\/g, '\\');
      });

      let movetext = source.replace(/^\s*\[[A-Za-z0-9_]+\s+"(?:\\.|[^"\\])*"\]\s*$/gm, ' ');
      movetext = movetext.replace(/\{[\s\S]*?\}/g, ' ');      // comentarios {...}
      movetext = movetext.replace(/;[^\r\n]*/g, ' ');          // comentarios ; hasta fin de línea

      // El importador archiva y reproduce la línea principal. Variantes entre
      // paréntesis se ignoran deliberadamente, incluidas variantes anidadas.
      let clean = '', depth = 0;
      for (const ch of movetext) {
        if (ch === '(') { depth++; continue; }
        if (ch === ')') { if (depth > 0) depth--; continue; }
        if (depth === 0) clean += ch;
      }
      movetext = clean.replace(/\$\d+/g, ' ');
      movetext = movetext.replace(/\b\d+\.(?:\.\.)?/g, ' ');
      movetext = movetext.replace(/[\u2026]/g, ' ');

      const initialFen = tags.FEN && String(tags.FEN).trim() ? String(tags.FEN).trim() : START_FEN;
      const engine = new ClubChessRecorder(initialFen);
      let result = ['1-0','0-1','1/2-1/2','*'].includes(tags.Result) ? tags.Result : '*';
      const tokens = movetext.split(/\s+/).map(t => t.trim()).filter(Boolean);
      for (let token of tokens) {
        token = token.replace(/^\.+/, '');
        if (!token || /^e\.?p\.?$/i.test(token)) continue;
        if (['1-0','0-1','1/2-1/2','*'].includes(token)) { result = token; break; }
        engine.moveSan(token);
      }

      return {
        tags,
        result,
        moves: engine.history(),
        initialFen,
        finalFen: engine.fen(),
        engine
      };
    }

    static parseFen(fen) { return parseFen(fen); }
    static get START_FEN() { return START_FEN; }
  }

  global.ClubChessRecorder = ClubChessRecorder;
})(window);
