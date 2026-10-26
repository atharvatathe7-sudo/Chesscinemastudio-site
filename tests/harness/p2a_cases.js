// Phase 2A movement cases. Each PGN is legal; `ply` is the move under test; d = Chebyshev distance.
const ROOK_PGN = '1. a4 h5 2. Ra3 Rh6 3. Rb3 Ra6';            // ply 5 Rb3 (a3-b3, 1 sq), ply 6 Ra6 (h6-a6, 7 sq)
const BISHOP_PGN = '1. a4 g5 2. Ra2 g4 3. b3 h5 4. Bb2 Nh6 5. Ba1 Nf5 6. Bxh8'; // ply 9 Ba1 (b2-a1, 1 sq diag), ply 11 Bxh8 (a1-h8, 7 sq diag, capture)
const QSC_PGN = '1. d4 d5 2. Nc3 Nc6 3. Bf4 Bf5 4. Qd2 Qd7 5. O-O-O'; // ply 9 O-O-O
const L = require('./lib');
const CASES = [
  { id: 'rook_1sq', pgn: ROOK_PGN, ply: 5, from: 'a3', to: 'b3', d: 1 },
  { id: 'rook_7sq', pgn: ROOK_PGN, ply: 6, from: 'h6', to: 'a6', d: 7 },
  { id: 'diag_1sq', pgn: BISHOP_PGN, ply: 9, from: 'b2', to: 'a1', d: 1 },
  { id: 'diag_7sq_capture', pgn: BISHOP_PGN, ply: 11, from: 'a1', to: 'h8', d: 7, capture: true },
  { id: 'knight', pgn: L.LEGAL_PGN, ply: 3, from: 'g1', to: 'f3', d: 2 },
  { id: 'pawn_push_2', pgn: L.LEGAL_PGN, ply: 1, from: 'e2', to: 'e4', d: 2 },
  { id: 'pawn_push_1', pgn: L.EP_PGN, ply: 3, from: 'e4', to: 'e5', d: 1 },
  { id: 'capture_Nxe5', pgn: L.LEGAL_PGN, ply: 9, from: 'f3', to: 'e5', d: 2, capture: true },
  { id: 'en_passant', pgn: L.EP_PGN, ply: 5, from: 'e5', to: 'd6', d: 1, capture: true, victimSq: 'd5' },
  { id: 'promotion', pgn: L.PROMO_PGN, ply: 9, from: 'b7', to: 'a8', d: 1, capture: true },
  { id: 'castle_kingside', pgn: L.CASTLE_PGN, ply: 7, from: 'e1', to: 'g1', d: 2, rook: ['h1', 'f1'] },
  { id: 'castle_queenside', pgn: QSC_PGN, ply: 9, from: 'e1', to: 'c1', d: 2, rook: ['a1', 'd1'] }
];
module.exports = { CASES, ROOK_PGN, BISHOP_PGN, QSC_PGN };
