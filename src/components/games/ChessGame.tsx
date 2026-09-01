import React, { useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { ArrowLeft, RotateCcw, Sparkles, Swords } from 'lucide-react';
import { AiGameConfig } from '../VsAiArena';

type PieceColor = 'w' | 'b';
type PieceType = 'p' | 'r' | 'n' | 'b' | 'q' | 'k';
type BoardCell = {
  type: PieceType;
  color: PieceColor;
} | null;

type Board = BoardCell[][];

type Move = { from: string; to: string; captured?: boolean };

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
const PLAYER_COLOR: PieceColor = 'b';
const ENEMY_COLOR: PieceColor = 'w';

const PIECE_SYMBOLS: Record<string, string> = {
  wp: '♙',
  wn: '♘',
  wb: '♗',
  wr: '♖',
  wq: '♕',
  wk: '♔',
  bp: '♟',
  bn: '♞',
  bb: '♝',
  br: '♜',
  bq: '♛',
  bk: '♚',
};

const getInitialBoard = (): Board => {
  const board: Board = Array.from({ length: 8 }, () => Array(8).fill(null));

  const setupBackRank: PieceType[] = ['r', 'n', 'b', 'q', 'k', 'b', 'n', 'r'];
  setupBackRank.forEach((type, col) => {
    board[0][col] = { type, color: PLAYER_COLOR };
    board[7][col] = { type, color: ENEMY_COLOR };
  });

  for (let col = 0; col < 8; col += 1) {
    board[1][col] = { type: 'p', color: PLAYER_COLOR };
    board[6][col] = { type: 'p', color: ENEMY_COLOR };
  }

  return board;
};

const coordsToSquare = (row: number, col: number) => `${FILES[col]}${8 - row}`;
const squareToCoords = (square: string) => {
  const file = FILES.indexOf(square[0]);
  const row = 8 - Number(square[1]);
  return { row, col: file };
};

const cloneBoard = (board: Board): Board => board.map((row) => row.map((cell) => (cell ? { ...cell } : null)));

const inBounds = (row: number, col: number) => row >= 0 && row < 8 && col >= 0 && col < 8;

const generateMovesForPiece = (board: Board, row: number, col: number, piece: { type: PieceType; color: PieceColor }): string[] => {
  const moves: string[] = [];
  const direction = piece.color === 'w' ? -1 : 1;

  if (piece.type === 'p') {
    const oneStep = row + direction;
    if (inBounds(oneStep, col) && !board[oneStep][col]) {
      moves.push(coordsToSquare(oneStep, col));
      const startingRow = piece.color === 'w' ? 6 : 1;
      const twoStep = row + direction * 2;
      if (row === startingRow && !board[twoStep][col]) {
        moves.push(coordsToSquare(twoStep, col));
      }
    }

    [-1, 1].forEach((offset) => {
      const attackRow = row + direction;
      const attackCol = col + offset;
      if (inBounds(attackRow, attackCol) && board[attackRow][attackCol] && board[attackRow][attackCol]?.color !== piece.color) {
        moves.push(coordsToSquare(attackRow, attackCol));
      }
    });

    return moves;
  }

  if (piece.type === 'r' || piece.type === 'b' || piece.type === 'q') {
    const directions: Array<[number, number]> = [];
    if (piece.type === 'r' || piece.type === 'q') {
      directions.push([1, 0], [-1, 0], [0, 1], [0, -1]);
    }
    if (piece.type === 'b' || piece.type === 'q') {
      directions.push([1, 1], [1, -1], [-1, 1], [-1, -1]);
    }

    directions.forEach(([dr, dc]) => {
      let rr = row + dr;
      let cc = col + dc;
      while (inBounds(rr, cc)) {
        const target = board[rr][cc];
        if (!target) {
          moves.push(coordsToSquare(rr, cc));
        } else {
          if (target.color !== piece.color) moves.push(coordsToSquare(rr, cc));
          break;
        }
        rr += dr;
        cc += dc;
      }
    });
  }

  if (piece.type === 'n') {
    const offsets = [
      [2, 1], [2, -1], [-2, 1], [-2, -1],
      [1, 2], [1, -2], [-1, 2], [-1, -2],
    ];
    offsets.forEach(([dr, dc]) => {
      const rr = row + dr;
      const cc = col + dc;
      if (inBounds(rr, cc)) {
        const target = board[rr][cc];
        if (!target || target.color !== piece.color) moves.push(coordsToSquare(rr, cc));
      }
    });
  }

  if (piece.type === 'k') {
    [-1, 0, 1].forEach((dr) => {
      [-1, 0, 1].forEach((dc) => {
        if (dr === 0 && dc === 0) return;
        const rr = row + dr;
        const cc = col + dc;
        if (inBounds(rr, cc)) {
          const target = board[rr][cc];
          if (!target || target.color !== piece.color) moves.push(coordsToSquare(rr, cc));
        }
      });
    });
  }

  return moves;
};

const getOccupiedSquares = (board: Board) => {
  const squares: string[] = [];
  board.forEach((row, r) => {
    row.forEach((cell, c) => {
      if (cell) squares.push(coordsToSquare(r, c));
    });
  });
  return squares;
};

const getAvailableMoves = (board: Board, color: PieceColor) => {
  const available: Move[] = [];
  board.forEach((row, rowIndex) => {
    row.forEach((cell, colIndex) => {
      if (!cell || cell.color !== color) return;
      const moves = generateMovesForPiece(board, rowIndex, colIndex, cell);
      moves.forEach((target) => {
        available.push({ from: coordsToSquare(rowIndex, colIndex), to: target, captured: !!board[squareToCoords(target).row][squareToCoords(target).col] });
      });
    });
  });
  return available;
};

export const ChessGame: React.FC<{ onBackToHub: () => void; aiConfig?: AiGameConfig | null }> = ({ onBackToHub, aiConfig }) => {
  const [board, setBoard] = useState<Board>(() => getInitialBoard());
  const [turn, setTurn] = useState<PieceColor>(PLAYER_COLOR);
  const [selected, setSelected] = useState<string | null>(null);
  const [status, setStatus] = useState(`${PLAYER_COLOR === 'w' ? 'White' : 'Black'} to move`);

  const legalMoves = useMemo(() => {
    if (!selected) return [];
    const { row, col } = squareToCoords(selected);
    const piece = board[row][col];
    if (!piece) return [];
    return generateMovesForPiece(board, row, col, piece);
  }, [board, selected]);

  const handleCellClick = (square: string) => {
    const { row, col } = squareToCoords(square);
    const cell = board[row][col];

    if (selected) {
      const target = legalMoves.includes(square);
      if (target) {
        const nextBoard = cloneBoard(board);
        const sourceCoords = squareToCoords(selected);
        const targetCoords = { row, col };
        const movingPiece = nextBoard[sourceCoords.row][sourceCoords.col];
        if (!movingPiece) return;

        nextBoard[targetCoords.row][targetCoords.col] = movingPiece;
        nextBoard[sourceCoords.row][sourceCoords.col] = null;

        if (movingPiece.type === 'p' && (targetCoords.row === 0 || targetCoords.row === 7)) {
          nextBoard[targetCoords.row][targetCoords.col] = { type: 'q', color: movingPiece.color };
        }

        const nextTurn: PieceColor = turn === PLAYER_COLOR ? ENEMY_COLOR : PLAYER_COLOR;
        setBoard(nextBoard);
        setSelected(null);
        setTurn(nextTurn);
        setStatus(`${nextTurn === PLAYER_COLOR ? 'Black' : 'White'} to move`);
        return;
      }

      if (cell && cell.color === turn) {
        setSelected(square);
        return;
      }

      setSelected(null);
      return;
    }

    if (cell && cell.color === turn) {
      setSelected(square);
    }
  };

  const handleReset = () => {
    setBoard(getInitialBoard());
    setSelected(null);
    setTurn(PLAYER_COLOR);
    setStatus(`${PLAYER_COLOR === 'w' ? 'White' : 'Black'} to move`);
  };

  const aiMove = () => {
    if (!aiConfig || turn !== ENEMY_COLOR) return;
    const moves = getAvailableMoves(board, ENEMY_COLOR);
    if (moves.length === 0) {
      setStatus('No legal moves for AI');
      return;
    }

    const move = moves[Math.floor(Math.random() * moves.length)];
    const from = squareToCoords(move.from);
    const to = squareToCoords(move.to);
    const nextBoard = cloneBoard(board);
    const movingPiece = nextBoard[from.row][from.col];
    if (!movingPiece) return;

    nextBoard[to.row][to.col] = movingPiece;
    nextBoard[from.row][from.col] = null;

    setBoard(nextBoard);
    setTurn(PLAYER_COLOR);
    setStatus(`${PLAYER_COLOR === 'w' ? 'White' : 'Black'} to move`);
  };

  React.useEffect(() => {
    if (aiConfig && turn === ENEMY_COLOR) {
      const timer = window.setTimeout(aiMove, 450);
      return () => window.clearTimeout(timer);
    }
  }, [turn, aiConfig, board]);

  const boardSquares = useMemo(() => {
    return Array.from({ length: 8 }, (_, rowIndex) =>
      Array.from({ length: 8 }, (_, colIndex) => {
        const sq = coordsToSquare(rowIndex, colIndex);
        const cell = board[rowIndex][colIndex];
        const isSelected = selected === sq;
        const isLegal = legalMoves.includes(sq);
        const isDark = (rowIndex + colIndex) % 2 === 1;

        return { sq, cell, isSelected, isLegal, isDark };
      })
    );
  }, [board, legalMoves, selected]);

  return (
    <div className="w-full max-w-6xl mx-auto space-y-4 animate-fade-in font-sans">
      <div className="flex flex-wrap items-center justify-between gap-3 bg-[#0f172a] p-4 rounded-[28px] border border-slate-700 shadow-[0_18px_40px_rgba(15,23,42,0.35)]">
        <div className="flex items-center gap-3">
          <button
            onClick={onBackToHub}
            className="p-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-all"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-black text-white">Chess</h2>
              <span className="px-2 py-0.5 text-[10px] font-black rounded-full bg-violet-500/15 text-violet-300 border border-violet-400/35">
                {aiConfig ? 'VS AI' : '1v1 Board'}
              </span>
            </div>
            <p className="text-xs text-slate-400">Clean tactical board with legal move previews and a real 1v1 match flow.</p>
          </div>
        </div>

        <div className="flex items-center gap-2 text-xs font-bold text-slate-200">
          <Swords className="w-4 h-4 text-violet-300" />
          <span>{status}</span>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_220px] gap-4">
        <div className="rounded-[28px] border border-slate-700 bg-[#0f172a] p-3 shadow-[0_16px_40px_rgba(15,23,42,0.35)]">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 rounded-full border border-slate-600 bg-slate-900/80 px-3 py-1.5 text-[11px] font-black text-slate-200">
              <span className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full bg-slate-200 text-slate-900">♟</span>
              You: Black
            </div>
            <div className="flex items-center gap-2 rounded-full border border-slate-600 bg-slate-900/80 px-3 py-1.5 text-[11px] font-black text-slate-200">
              <span className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full bg-slate-900 text-slate-100 ring-1 ring-slate-600">♔</span>
              Opponent: White
            </div>
          </div>
          <div className="mx-auto max-w-[720px] aspect-square overflow-hidden rounded-[22px] border border-slate-600 bg-slate-950 shadow-inner">
            <div className="grid grid-cols-8 h-full w-full">
              {boardSquares.flat().map(({ sq, cell, isSelected, isLegal, isDark }) => (
                <button
                  key={sq}
                  onClick={() => handleCellClick(sq)}
                  className={`relative flex items-center justify-center text-2xl sm:text-3xl transition-all ${
                    isDark ? 'bg-[#b88b5c]' : 'bg-[#f0d9b5]'
                  } ${isSelected ? 'ring-4 ring-amber-300 shadow-inner' : ''} ${isLegal ? 'shadow-[inset_0_0_0_4px_rgba(34,197,94,0.8)]' : ''}`}
                >
                  {isLegal && !cell && <span className="absolute h-3.5 w-3.5 rounded-full bg-emerald-500/75" />}
                  {cell && (
                    <motion.div
                      layout
                      whileHover={{ scale: 1.06 }}
                      whileTap={{ scale: 0.97 }}
                      className="drop-shadow-[0_3px_6px_rgba(0,0,0,0.3)]"
                    >
                      {PIECE_SYMBOLS[`${cell.color}${cell.type}`]}
                    </motion.div>
                  )}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="rounded-[28px] border border-slate-700 bg-[#0f172a] p-4 shadow-[0_16px_40px_rgba(15,23,42,0.35)] space-y-4">
          <button
            onClick={handleReset}
            className="flex w-full items-center justify-center gap-2 rounded-2xl bg-violet-600 px-4 py-3 text-sm font-black text-white shadow-lg shadow-violet-600/30 hover:bg-violet-500 transition-all"
          >
            <RotateCcw className="w-4 h-4" />
            New Game
          </button>

          <div className="rounded-2xl bg-violet-500/10 border border-violet-400/40 p-3 text-xs text-violet-200">
            <div className="flex items-center gap-2 font-black">
              <Sparkles className="w-4 h-4" />
              Match Flow
            </div>
            <ul className="mt-2 space-y-1.5">
              <li>• Click a piece to reveal legal moves.</li>
              <li>• Capture, protect, and coordinate attacks.</li>
              <li>• AI responds with a legal counter move.</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
};
