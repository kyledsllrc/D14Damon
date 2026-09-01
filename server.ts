import express, { Request, Response } from 'express';
import http from 'http';
import path from 'path';
import { Server as SocketIOServer, Socket } from 'socket.io';
import { createServer as createViteServer } from 'vite';
import { initializeApp, cert, applicationDefault } from 'firebase-admin/app';
import { getFirestore, FieldValue, Firestore } from 'firebase-admin/firestore';
import fs from 'fs';
import {
  GameState,
  Player,
  RoomSettings,
  RoomSummary,
  CanvasAction,
  ChatMessage,
  LeaderboardEntry,
  WordChoice,
  UserProfile,
  ArcadeGameMode,
} from './src/types';
import { getRandomWordChoices } from './src/data/words';
import {
  DUEL_PROMPTS,
  TRIVIA_QUESTIONS,
  ANAGRAM_PUZZLES,
  TriviaQuestion,
  AnagramPuzzle,
} from './src/data/arcadeData';
import { isValidEnglishWord, SYLLABLE_PROMPTS } from './src/utils/dictionary';
import { EMOJI_PUZZLES } from './src/data/emojiPuzzles';
import dotenv from 'dotenv';
dotenv.config();

const app = express();
const server = http.createServer(app);
const io = new SocketIOServer(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
  pingInterval: 10000,
  pingTimeout: 5000,
});

app.use(express.json());

// Initialize Firebase Admin if credentials provided
let firestore: Firestore | null = null;
try {
  // If GOOGLE_APPLICATION_CREDENTIALS is set, the default credential provider works.
  // Otherwise, if a JSON string is provided in FIREBASE_SERVICE_ACCOUNT_JSON, initialize from that.
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS && fs.existsSync(process.env.GOOGLE_APPLICATION_CREDENTIALS)) {
    initializeApp({
      credential: applicationDefault(),
    });
    firestore = getFirestore();
    console.log('[Firebase] Initialized via GOOGLE_APPLICATION_CREDENTIALS file.');
  } else if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    const svc = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
    initializeApp({
      credential: cert(svc),
    });
    firestore = getFirestore();
    console.log('[Firebase] Initialized via FIREBASE_SERVICE_ACCOUNT_JSON env var.');
  } else {
    console.log('[Firebase] GOOGLE_APPLICATION_CREDENTIALS not set — running in in-memory-only mode.');
  }
} catch (err) {
  console.error('[Firebase] Initialization error:', err);
  firestore = null;
}

// In-Memory Database for Global Persistence (fallback)
interface GlobalStatsStore {
  leaderboard: LeaderboardEntry[];
  users: Map<string, UserProfile>;
}

const GLOBAL_STORE: GlobalStatsStore = {
  leaderboard: [],
  users: new Map<string, UserProfile>(),
};

// Rooms Registry
export type UnoColor = 'red' | 'blue' | 'green' | 'yellow' | 'wild';
export type UnoType = 'number' | 'skip' | 'reverse' | 'draw2' | 'wild' | 'wild4';

export interface UnoCard {
  id: string;
  color: UnoColor;
  type: UnoType;
  value: number | null; // 0-9
  score: number;
}

export interface ServerUnoGame {
  deck: UnoCard[];
  discardPile: UnoCard[];
  activeColor: UnoColor;
  currentTurnPlayerId: string;
  direction: 1 | -1;
  playerHands: Map<string, UnoCard[]>;
  calledUno: Set<string>;
  historyLog: { text: string; color: string }[];
  cardsPlayed: number;
  winner?: { id: string; name: string; avatar: string } | null;
  finalScore?: number;
  status: 'playing' | 'game_over';
}

export interface ServerTriviaGame {
  questions: TriviaQuestion[];
  currentIndex: number;
  timeLeft: number;
  playerScores: Map<string, number>;
  playerStreaks: Map<string, number>;
  playerAnswers: Map<string, { optionIndex: number; isCorrect: boolean; points: number }>;
  timerInterval?: NodeJS.Timeout;
  status: 'playing' | 'round_end' | 'game_over';
  winner?: { id: string; name: string; avatar: string } | null;
  finalScores?: Array<{ id: string; name: string; avatar: string; score: number }>;
}

export interface ServerBombGame {
  prompt: string;
  timeLeft: number;
  totalTime: number;
  currentTurnPlayerId: string;
  usedWords: string[];
  playerLives: Map<string, number>;
  playerScores: Map<string, number>;
  defusedCount: number;
  timerInterval?: NodeJS.Timeout;
  status: 'playing' | 'exploded' | 'victory';
  winner?: { id: string; name: string; avatar: string } | null;
}

export interface ServerDuelGame {
  topic: string;
  timeLeft: number;
  phase: 'dueling' | 'judging' | 'results';
  playerSubmissions: Map<string, { strokeCount: number; detailScore: number }>;
  timerInterval?: NodeJS.Timeout;
  winner?: { id: string; name: string; avatar: string } | null;
  finalResults?: { player1: any; player2: any; winnerId: string | null };
}

export interface ServerAnagramGame {
  puzzles: AnagramPuzzle[];
  currentIndex: number;
  scrambledLetters: string[];
  playerScores: Map<string, number>;
  playerStreaks: Map<string, number>;
  timeLeft: number;
  timerInterval?: NodeJS.Timeout;
  status: 'playing' | 'game_over';
  winner?: { id: string; name: string; avatar: string } | null;
  history: Array<{ word: string; solvedBy: string; points: number }>;
}

export interface ServerEmojiGame {
  puzzles: any[];
  currentIndex: number;
  playerScores: Map<string, number>;
  timeLeft: number;
  timerInterval?: NodeJS.Timeout;
  status: 'playing' | 'game_over';
  winner?: { id: string; name: string; avatar: string } | null;
}

interface ServerRoom {
  id: string;
  code: string;
  name: string;
  hostSocketId: string;
  settings: RoomSettings;
  state: GameState;
  drawingHistory: CanvasAction[];
  messages: ChatMessage[];
  timerInterval?: NodeJS.Timeout;
  currentTurnWord: string;
  currentWordPoints: number;
  wordSelected: boolean;
  drawerIndex: number;
  playersWhoGuessed: Set<string>;
  unoGame?: ServerUnoGame;
  triviaGame?: ServerTriviaGame;
  bombGame?: ServerBombGame;
  duelGame?: ServerDuelGame;
  anagramGame?: ServerAnagramGame;
  emojiGame?: ServerEmojiGame;
}

const ROOMS = new Map<string, ServerRoom>();

function generateRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 5; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

function normalizeRoomSettings(settings: Partial<RoomSettings> = {}): RoomSettings {
  const maxPlayers = Math.min(Math.max(Number(settings.maxPlayers) || 8, 2), 10);
  return {
    roundDuration: Number(settings.roundDuration) || 60,
    maxRounds: Number(settings.maxRounds) || 3,
    maxPlayers,
    wordCategory: settings.wordCategory || 'all',
    customWords: Array.isArray(settings.customWords) ? settings.customWords : [],
    isPrivate: Boolean(settings.isPrivate),
    allowHints: settings.allowHints !== false,
    botPlayersEnabled: false,
    betting: settings.betting,
    gameMode: (settings.gameMode || 'multiplayer_draw') as ArcadeGameMode,
  };
}

// Firestore helpers
async function saveRoomToFirestore(room: ServerRoom) {
  if (!firestore) return;
  try {
    const doc = {
      id: room.id,
      code: room.code,
      name: room.name,
      settings: room.settings,
      state: {
        ...room.state,
        // Avoid storing large or circular objects; sanitize players
        players: room.state.players.map(p => ({
          id: p.id,
          username: p.username,
          avatar: p.avatar,
          color: p.color,
          score: p.score,
          isHost: p.isHost,
          isConnected: p.isConnected,
        })),
      },
      updatedAt: FieldValue.serverTimestamp(),
    };
    await firestore.collection('rooms').doc(room.id).set(doc, { merge: true });
  } catch (err) {
    console.error('Failed to save room to Firestore:', err);
  }
}

async function deleteRoomFromFirestore(roomId: string) {
  if (!firestore) return;
  try {
    await firestore.collection('rooms').doc(roomId).delete();
  } catch (err) {
    console.error('Failed to delete room from Firestore:', err);
  }
}

async function saveActivityToFirestore(activity: any) {
  if (!firestore) return;
  try {
    await firestore.collection('activities').add({
      ...activity,
      createdAt: FieldValue.serverTimestamp(),
    });
  } catch (err) {
    console.error('Failed to save activity to Firestore:', err);
  }
}

async function saveLeaderboardEntryToFirestore(entry: LeaderboardEntry) {
  if (!firestore) return;
  try {
    await firestore.collection('leaderboard').doc(entry.userId).set({
      userId: entry.userId,
      username: entry.username,
      avatar: entry.avatar,
      score: entry.score,
      wins: entry.wins,
      gamesPlayed: entry.gamesPlayed,
      wordsGuessed: entry.wordsGuessed,
      rank: entry.rank,
      winRate: entry.winRate,
      level: entry.level,
      lastActive: entry.lastActive,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  } catch (err) {
    console.error('Failed to save leaderboard entry to Firestore:', err);
  }
}

function updateGlobalLeaderboard(player: Player, won: boolean) {
  let entry = GLOBAL_STORE.leaderboard.find(e => e.userId === player.id || e.username.toLowerCase() === player.username.toLowerCase());
  
  if (entry) {
    entry.score += player.score;
    entry.gamesPlayed += 1;
    if (won) entry.wins += 1;
    entry.wordsGuessed += (player.stats?.wordsGuessed || 0);
    entry.winRate = Math.round((entry.wins / entry.gamesPlayed) * 100);
    entry.lastActive = 'Just now';
    entry.level = Math.floor(entry.score / 800) + 1;
    entry.avatar = player.avatar || entry.avatar;
  } else {
    entry = {
      userId: player.id,
      username: player.username,
      avatar: player.avatar,
      score: player.score,
      wins: won ? 1 : 0,
      gamesPlayed: 1,
      wordsGuessed: player.stats?.wordsGuessed || 0,
      rank: 0,
      winRate: won ? 100 : 0,
      lastActive: 'Just now',
      level: Math.floor(player.score / 800) + 1,
    };
    GLOBAL_STORE.leaderboard.push(entry);
  }

  // Recalculate ranks
  GLOBAL_STORE.leaderboard.sort((a, b) => b.score - a.score);
  GLOBAL_STORE.leaderboard.forEach((item, index) => {
    item.rank = index + 1;
  });

  // Broadcast updated leaderboard globally
  io.emit('leaderboard:update', GLOBAL_STORE.leaderboard);

  // Persist leaderboard entry for the player
  saveLeaderboardEntryToFirestore(entry).catch(() => {});
}

function getMaskedHint(word: string, revealedIndices: number[]): string {
  return word
    .split('')
    .map((char, index) => {
      if (char === ' ') return '  ';
      if (revealedIndices.includes(index)) return char;
      return '_';
    })
    .join(' ');
}

function sanitizeWordForComparison(w: string): string {
  return w.toLowerCase().trim().replace(/[^a-z0-9]/g, '');
}

function calculateLevenshtein(a: string, b: string): number {
  const an = a ? a.length : 0;
  const bn = b ? b.length : 0;
  if (an === 0) return bn;
  if (bn === 0) return an;
  const matrix = Array.from({ length: bn + 1 }, () => Array(an + 1).fill(0));
  for (let i = 0; i <= an; ++i) matrix[0][i] = i;
  for (let i = 0; i <= bn; ++i) matrix[i][0] = i;
  for (let i = 1; i <= bn; ++i) {
    for (let j = 1; j <= an; ++j) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          Math.min(matrix[i][j - 1] + 1, matrix[i - 1][j] + 1) // insertion / deletion
        );
      }
    }
  }
  return matrix[bn][an];
}

function isBotPlayer(player: Player): boolean {
  return typeof player.id === 'string' && player.id.startsWith('bot_');
}

function getConnectedHumanPlayers(room: ServerRoom): Player[] {
  return room.state.players.filter(player => player.isConnected && !isBotPlayer(player));
}

function getPublicRoomsList(): RoomSummary[] {
  const publicRooms: RoomSummary[] = [];
  ROOMS.forEach(room => {
    const activeCount = getConnectedHumanPlayers(room).length;
    // Only return non-private rooms with active players and open slots
    if (!room.settings.isPrivate && room.state.status === 'lobby' && activeCount > 0 && activeCount < room.settings.maxPlayers) {
      publicRooms.push({
        id: room.id,
        name: room.name,
        code: room.code,
        hostName: room.state.players.find(p => p.isHost && p.isConnected)?.username || room.state.players.find(p => p.isConnected)?.username || 'Host',
        playerCount: activeCount,
        maxPlayers: room.settings.maxPlayers,
        status: room.state.status,
        isPrivate: room.settings.isPrivate,
        roundDuration: room.settings.roundDuration,
        currentRound: room.state.currentRound,
        maxRounds: room.state.totalRounds,
        gameMode: room.settings.gameMode,
        betting: room.settings.betting,
      });
    }
  });
  return publicRooms;
}

// ==================== UNO MULTIPLAYER SERVER ENGINE ====================
function createUnoDeck(): UnoCard[] {
  const deck: UnoCard[] = [];
  const colors: UnoColor[] = ['red', 'blue', 'green', 'yellow'];

  colors.forEach((color) => {
    // 1 Zero card per color
    deck.push({
      id: `${color}_0_${Math.random().toString(36).substring(2, 7)}`,
      color,
      type: 'number',
      value: 0,
      score: 0,
    });

    // 2 of each 1-9 per color
    for (let v = 1; v <= 9; v++) {
      deck.push({
        id: `${color}_${v}_a_${Math.random().toString(36).substring(2, 7)}`,
        color,
        type: 'number',
        value: v,
        score: v,
      });
      deck.push({
        id: `${color}_${v}_b_${Math.random().toString(36).substring(2, 7)}`,
        color,
        type: 'number',
        value: v,
        score: v,
      });
    }

    // 2 Skips, 2 Reverses, 2 Draw Twos per color
    for (let i = 0; i < 2; i++) {
      deck.push({
        id: `${color}_skip_${i}_${Math.random().toString(36).substring(2, 7)}`,
        color,
        type: 'skip',
        value: null,
        score: 20,
      });
      deck.push({
        id: `${color}_reverse_${i}_${Math.random().toString(36).substring(2, 7)}`,
        color,
        type: 'reverse',
        value: null,
        score: 20,
      });
      deck.push({
        id: `${color}_draw2_${i}_${Math.random().toString(36).substring(2, 7)}`,
        color,
        type: 'draw2',
        value: null,
        score: 20,
      });
    }
  });

  // 4 Wilds & 4 Wild Draw Fours
  for (let i = 0; i < 4; i++) {
    deck.push({
      id: `wild_${i}_${Math.random().toString(36).substring(2, 7)}`,
      color: 'wild',
      type: 'wild',
      value: null,
      score: 50,
    });
    deck.push({
      id: `wild4_${i}_${Math.random().toString(36).substring(2, 7)}`,
      color: 'wild',
      type: 'wild4',
      value: null,
      score: 50,
    });
  }

  // Shuffle deck using Fisher-Yates
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }

  return deck;
}

function initUnoGame(room: ServerRoom) {
  const activePlayers = room.state.players.filter(p => p.isConnected);
  if (activePlayers.length < 2) return;

  const deck = createUnoDeck();
  const playerHands = new Map<string, UnoCard[]>();

  activePlayers.forEach(p => {
    playerHands.set(p.id, deck.splice(0, 7));
  });

  // Pick top non-wild4 card for discard pile
  let topCard = deck.pop()!;
  while (topCard.type === 'wild4') {
    deck.unshift(topCard);
    topCard = deck.pop()!;
  }

  const startColor: UnoColor = topCard.color === 'wild' ? 'red' : topCard.color;

  room.unoGame = {
    deck,
    discardPile: [topCard],
    activeColor: startColor,
    currentTurnPlayerId: activePlayers[0].id,
    direction: 1,
    playerHands,
    calledUno: new Set<string>(),
    historyLog: [
      {
        text: `Match started! Top card: ${topCard.color === 'wild' ? 'Wild' : topCard.color.toUpperCase()} ${
          topCard.type === 'number' ? topCard.value : topCard.type.toUpperCase()
        }`,
        color: startColor,
      },
    ],
    cardsPlayed: 0,
    winner: null,
    finalScore: 0,
    status: 'playing',
  };

  broadcastUnoState(room, `Match started! ${activePlayers[0].username}'s turn`);
}

function broadcastUnoState(room: ServerRoom, banner?: string) {
  if (!room.unoGame) return;
  const game = room.unoGame;
  const activePlayers = room.state.players.filter(p => p.isConnected);
  const topDiscard = game.discardPile[game.discardPile.length - 1] || null;

  activePlayers.forEach(p => {
    const socketId = p.socketId;
    if (!socketId) return;
    const socket = io.sockets.sockets.get(socketId);
    if (!socket) return;

    const myHand = game.playerHands.get(p.id) || [];
    const playerSummaries = activePlayers.map(pl => ({
      id: pl.id,
      name: pl.username,
      avatar: pl.avatar,
      color: pl.color,
      isBot: pl.id.startsWith('bot_'),
      cardCount: (game.playerHands.get(pl.id) || []).length,
      calledUno: game.calledUno.has(pl.id),
      cards: pl.id === p.id ? myHand : [],
    }));

    socket.emit('uno:state', {
      players: playerSummaries,
      myCards: myHand,
      discardPile: game.discardPile,
      topDiscard,
      activeColor: game.activeColor,
      currentTurnPlayerId: game.currentTurnPlayerId,
      direction: game.direction,
      deckCount: game.deck.length,
      historyLog: game.historyLog,
      cardsPlayed: game.cardsPlayed,
      actionBanner: banner || null,
      winner: game.winner || null,
      finalScore: game.finalScore || 0,
      status: game.status,
    });
  });
}

function drawCardsFromUnoDeck(room: ServerRoom, playerId: string, count: number): UnoCard[] {
  if (!room.unoGame) return [];
  const game = room.unoGame;
  const drawn: UnoCard[] = [];
  const hand = game.playerHands.get(playerId) || [];

  for (let i = 0; i < count; i++) {
    if (game.deck.length === 0) {
      if (game.discardPile.length > 1) {
        const top = game.discardPile[game.discardPile.length - 1];
        const rest = game.discardPile.slice(0, game.discardPile.length - 1);
        game.deck = rest.sort(() => Math.random() - 0.5);
        game.discardPile = [top];
      } else {
        break;
      }
    }
    const card = game.deck.pop();
    if (card) {
      drawn.push(card);
      hand.push(card);
    }
  }

  game.playerHands.set(playerId, hand);
  if (hand.length > 1) {
    game.calledUno.delete(playerId);
  }
  return drawn;
}

function clearAllRoomTimers(room: ServerRoom) {
  if (room.timerInterval) {
    clearInterval(room.timerInterval);
    room.timerInterval = undefined;
  }
  if (room.triviaGame?.timerInterval) {
    clearInterval(room.triviaGame.timerInterval);
    room.triviaGame.timerInterval = undefined;
  }
  if (room.bombGame?.timerInterval) {
    clearInterval(room.bombGame.timerInterval);
    room.bombGame.timerInterval = undefined;
  }
  if (room.duelGame?.timerInterval) {
    clearInterval(room.duelGame.timerInterval);
    room.duelGame.timerInterval = undefined;
  }
  if (room.anagramGame?.timerInterval) {
    clearInterval(room.anagramGame.timerInterval);
    room.anagramGame.timerInterval = undefined;
  }
  if (room.emojiGame?.timerInterval) {
    clearInterval(room.emojiGame.timerInterval);
    room.emojiGame.timerInterval = undefined;
  }
}

// ==================== WORD BOMB MULTIPLAYER SERVER ENGINE ====================
function initBombGame(room: ServerRoom) {
  clearAllRoomTimers(room);
  const activePlayers = room.state.players.filter(p => p.isConnected);
  if (activePlayers.length < 1) return;

  const promptObj = SYLLABLE_PROMPTS[Math.floor(Math.random() * SYLLABLE_PROMPTS.length)];
  const playerLives = new Map<string, number>();
  const playerScores = new Map<string, number>();

  activePlayers.forEach(p => {
    playerLives.set(p.id, 3);
    playerScores.set(p.id, 0);
  });

  const duration = 10;
  room.bombGame = {
    prompt: promptObj.prompt,
    timeLeft: duration,
    totalTime: duration,
    currentTurnPlayerId: activePlayers[0].id,
    usedWords: [],
    playerLives,
    playerScores,
    defusedCount: 0,
    status: 'playing',
    winner: null,
  };

  broadcastBombState(room, `💣 Match started! ${activePlayers[0].username} has the bomb!`);
  startBombTimer(room);
}

function startBombTimer(room: ServerRoom) {
  if (!room.bombGame) return;
  if (room.bombGame.timerInterval) clearInterval(room.bombGame.timerInterval);

  room.bombGame.timerInterval = setInterval(() => {
    if (!room.bombGame || room.bombGame.status !== 'playing') {
      if (room.bombGame?.timerInterval) clearInterval(room.bombGame.timerInterval);
      return;
    }

    room.bombGame.timeLeft -= 1;

    if (room.bombGame.timeLeft <= 0) {
      // Bomb explodes on active player!
      const explodedPlayerId = room.bombGame.currentTurnPlayerId;
      const playerObj = room.state.players.find(p => p.id === explodedPlayerId);
      const currentLives = (room.bombGame.playerLives.get(explodedPlayerId) || 1) - 1;
      room.bombGame.playerLives.set(explodedPlayerId, Math.max(0, currentLives));

      io.to(room.id).emit('bomb:sound', { sound: 'explode' });

      // Check remaining alive players
      const alivePlayers = room.state.players.filter(p => p.isConnected && (room.bombGame?.playerLives.get(p.id) || 0) > 0);

      if (alivePlayers.length <= 1) {
        // Victory condition!
        const winnerPlayer = alivePlayers[0] || playerObj || room.state.players[0];
        room.bombGame.status = 'victory';
        room.bombGame.winner = { id: winnerPlayer.id, name: winnerPlayer.username, avatar: winnerPlayer.avatar };
        if (room.bombGame.timerInterval) clearInterval(room.bombGame.timerInterval);

        const winScore = 500 + (room.bombGame.defusedCount * 50);
        winnerPlayer.score = (winnerPlayer.score || 0) + winScore;
        updateGlobalLeaderboard(winnerPlayer, true);

        broadcastBombState(room, `👑 ${winnerPlayer.username} survived the Word Bomb Royale! (+${winScore} pts)`);
        io.to(room.id).emit('bomb:sound', { sound: 'victory' });
        return;
      }

      // Next alive player
      const nextPromptObj = SYLLABLE_PROMPTS[Math.floor(Math.random() * SYLLABLE_PROMPTS.length)];
      room.bombGame.prompt = nextPromptObj.prompt;

      const activeList = room.state.players.filter(p => p.isConnected);
      const currentIdx = activeList.findIndex(p => p.id === explodedPlayerId);
      let nextIdx = (currentIdx + 1) % activeList.length;
      while ((room.bombGame.playerLives.get(activeList[nextIdx].id) || 0) <= 0) {
        nextIdx = (nextIdx + 1) % activeList.length;
      }

      const nextPlayer = activeList[nextIdx];
      room.bombGame.currentTurnPlayerId = nextPlayer.id;
      const baseTime = Math.max(6, 10 - Math.floor(room.bombGame.defusedCount / 5));
      room.bombGame.timeLeft = baseTime;
      room.bombGame.totalTime = baseTime;

      broadcastBombState(room, `💥 BOOM! ${playerObj?.username || 'Player'} exploded! Bomb passed to ${nextPlayer.username}!`);
    } else {
      io.to(room.id).emit('bomb:tick', { timeLeft: room.bombGame.timeLeft });
    }
  }, 1000);
}

function broadcastBombState(room: ServerRoom, banner?: string) {
  if (!room.bombGame) return;
  const game = room.bombGame;
  const activePlayers = room.state.players.filter(p => p.isConnected);

  const playersState = activePlayers.map(p => ({
    id: p.id,
    name: p.username,
    avatar: p.avatar,
    color: p.color,
    lives: game.playerLives.get(p.id) ?? 3,
    score: game.playerScores.get(p.id) ?? 0,
    isCurrentTurn: p.id === game.currentTurnPlayerId,
    isEliminated: (game.playerLives.get(p.id) ?? 3) <= 0,
  }));

  io.to(room.id).emit('bomb:state', {
    prompt: game.prompt,
    timeLeft: game.timeLeft,
    totalTime: game.totalTime,
    currentTurnPlayerId: game.currentTurnPlayerId,
    usedWords: game.usedWords,
    defusedCount: game.defusedCount,
    status: game.status,
    winner: game.winner,
    players: playersState,
    banner: banner || null,
  });
}

// ==================== TRIVIA DASH MULTIPLAYER SERVER ENGINE ====================
function initTriviaGame(room: ServerRoom) {
  clearAllRoomTimers(room);
  const activePlayers = room.state.players.filter(p => p.isConnected);
  if (activePlayers.length < 1) return;

  // Shuffle TRIVIA_QUESTIONS and take 8
  const shuffled = [...TRIVIA_QUESTIONS].sort(() => Math.random() - 0.5).slice(0, 8);
  const playerScores = new Map<string, number>();
  const playerStreaks = new Map<string, number>();

  activePlayers.forEach(p => {
    playerScores.set(p.id, 0);
    playerStreaks.set(p.id, 0);
  });

  room.triviaGame = {
    questions: shuffled,
    currentIndex: 0,
    timeLeft: 15,
    playerScores,
    playerStreaks,
    playerAnswers: new Map(),
    status: 'playing',
    winner: null,
  };

  broadcastTriviaState(room, `🧠 Trivia Dash Royale! Question 1 of ${shuffled.length}`);
  startTriviaQuestionTimer(room);
}

function startTriviaQuestionTimer(room: ServerRoom) {
  if (!room.triviaGame) return;
  if (room.triviaGame.timerInterval) clearInterval(room.triviaGame.timerInterval);

  room.triviaGame.timerInterval = setInterval(() => {
    if (!room.triviaGame || room.triviaGame.status !== 'playing') {
      if (room.triviaGame?.timerInterval) clearInterval(room.triviaGame.timerInterval);
      return;
    }

    room.triviaGame.timeLeft -= 1;

    if (room.triviaGame.timeLeft <= 0) {
      endTriviaRound(room);
    } else {
      io.to(room.id).emit('trivia:tick', { timeLeft: room.triviaGame.timeLeft });
    }
  }, 1000);
}

function endTriviaRound(room: ServerRoom) {
  if (!room.triviaGame) return;
  if (room.triviaGame.timerInterval) clearInterval(room.triviaGame.timerInterval);

  room.triviaGame.status = 'round_end';
  const currentQ = room.triviaGame.questions[room.triviaGame.currentIndex];
  broadcastTriviaState(room, `✅ Correct Answer: ${currentQ.options[currentQ.correctIndex]}`);

  // Transition after 3.5 seconds to next question or game over
  setTimeout(() => {
    if (!room.triviaGame) return;

    if (room.triviaGame.currentIndex >= room.triviaGame.questions.length - 1) {
      // Game Over
      room.triviaGame.status = 'game_over';
      const activePlayers = room.state.players.filter(p => p.isConnected);
      const finalRankings = activePlayers
        .map(p => ({
          id: p.id,
          name: p.username,
          avatar: p.avatar,
          score: room.triviaGame?.playerScores.get(p.id) || 0,
        }))
        .sort((a, b) => b.score - a.score);

      room.triviaGame.finalScores = finalRankings;
      const winner = finalRankings[0];
      if (winner) {
        room.triviaGame.winner = winner;
        const winnerPlayer = room.state.players.find(p => p.id === winner.id);
        if (winnerPlayer) {
          winnerPlayer.score = (winnerPlayer.score || 0) + winner.score;
          updateGlobalLeaderboard(winnerPlayer, true);
        }
      }

      broadcastTriviaState(room, `🏆 Match Finished! ${winner ? `${winner.name} won with ${winner.score} pts!` : ''}`);
      io.to(room.id).emit('trivia:sound', { sound: 'victory' });
    } else {
      // Next Question
      room.triviaGame.currentIndex += 1;
      room.triviaGame.timeLeft = 15;
      room.triviaGame.playerAnswers.clear();
      room.triviaGame.status = 'playing';
      broadcastTriviaState(room, `Question ${room.triviaGame.currentIndex + 1} of ${room.triviaGame.questions.length}`);
      startTriviaQuestionTimer(room);
    }
  }, 3500);
}

function broadcastTriviaState(room: ServerRoom, banner?: string) {
  if (!room.triviaGame) return;
  const game = room.triviaGame;
  const activePlayers = room.state.players.filter(p => p.isConnected);
  const currentQ = game.questions[game.currentIndex] || null;

  const leaderboard = activePlayers
    .map(p => ({
      id: p.id,
      name: p.username,
      avatar: p.avatar,
      color: p.color,
      score: game.playerScores.get(p.id) || 0,
      streak: game.playerStreaks.get(p.id) || 0,
      hasAnswered: game.playerAnswers.has(p.id),
      lastAnswer: game.status === 'round_end' || game.status === 'game_over' ? game.playerAnswers.get(p.id) : undefined,
    }))
    .sort((a, b) => b.score - a.score);

  io.to(room.id).emit('trivia:state', {
    currentIndex: game.currentIndex,
    totalQuestions: game.questions.length,
    currentQuestion: currentQ,
    timeLeft: game.timeLeft,
    status: game.status,
    winner: game.winner,
    finalScores: game.finalScores,
    leaderboard,
    banner: banner || null,
  });
}

// ==================== SPEED DUEL MULTIPLAYER SERVER ENGINE ====================
function initDuelGame(room: ServerRoom) {
  clearAllRoomTimers(room);
  const activePlayers = room.state.players.filter(p => p.isConnected);
  if (activePlayers.length < 1) return;

  const topic = DUEL_PROMPTS[Math.floor(Math.random() * DUEL_PROMPTS.length)];
  room.drawingHistory = [];

  room.duelGame = {
    topic,
    timeLeft: 30,
    phase: 'dueling',
    playerSubmissions: new Map(),
    winner: null,
  };

  broadcastDuelState(room, `🎨 Speed Duel: Draw "${topic}"! 30 seconds on the clock!`);
  startDuelTimer(room);
}

function startDuelTimer(room: ServerRoom) {
  if (!room.duelGame) return;
  if (room.duelGame.timerInterval) clearInterval(room.duelGame.timerInterval);

  room.duelGame.timerInterval = setInterval(() => {
    if (!room.duelGame || room.duelGame.phase !== 'dueling') {
      if (room.duelGame?.timerInterval) clearInterval(room.duelGame.timerInterval);
      return;
    }

    room.duelGame.timeLeft -= 1;

    if (room.duelGame.timeLeft <= 0) {
      if (room.duelGame.timerInterval) clearInterval(room.duelGame.timerInterval);
      room.duelGame.phase = 'judging';
      broadcastDuelState(room, `🤖 AI Judges are rating both masterworks...`);

      // Evaluate after 3 seconds
      setTimeout(() => {
        if (!room.duelGame) return;
        const activePlayers = room.state.players.filter(p => p.isConnected);
        const p1 = activePlayers[0];
        const p2 = activePlayers[1] || activePlayers[0];

        const score1 = room.duelGame.playerSubmissions.get(p1.id)?.detailScore || Math.floor(70 + Math.random() * 25);
        const score2 = p2.id !== p1.id ? (room.duelGame.playerSubmissions.get(p2.id)?.detailScore || Math.floor(70 + Math.random() * 25)) : 0;

        let winnerId: string | null = null;
        if (score1 > score2) winnerId = p1.id;
        else if (score2 > score1) winnerId = p2.id;

        const winnerPlayer = activePlayers.find(p => p.id === winnerId);
        room.duelGame.phase = 'results';
        room.duelGame.winner = winnerPlayer ? { id: winnerPlayer.id, name: winnerPlayer.username, avatar: winnerPlayer.avatar } : null;
        room.duelGame.finalResults = {
          player1: { id: p1.id, name: p1.username, avatar: p1.avatar, score: score1 },
          player2: { id: p2.id, name: p2.username, avatar: p2.avatar, score: score2 },
          winnerId,
        };

        if (winnerPlayer) {
          winnerPlayer.score = (winnerPlayer.score || 0) + 300;
          updateGlobalLeaderboard(winnerPlayer, true);
        }

        broadcastDuelState(room, `🏆 ${winnerPlayer ? `${winnerPlayer.username} wins the Speed Duel!` : 'It’s a tie!'}`);
        io.to(room.id).emit('duel:sound', { sound: 'victory' });
      }, 3000);
    } else {
      io.to(room.id).emit('duel:tick', { timeLeft: room.duelGame.timeLeft });
    }
  }, 1000);
}

function broadcastDuelState(room: ServerRoom, banner?: string) {
  if (!room.duelGame) return;
  const game = room.duelGame;

  io.to(room.id).emit('duel:state', {
    topic: game.topic,
    timeLeft: game.timeLeft,
    phase: game.phase,
    winner: game.winner,
    finalResults: game.finalResults,
    banner: banner || null,
  });
}

// ==================== ANAGRAM RUSH MULTIPLAYER SERVER ENGINE ====================
function initAnagramGame(room: ServerRoom) {
  clearAllRoomTimers(room);
  const activePlayers = room.state.players.filter(p => p.isConnected);
  if (activePlayers.length < 1) return;

  const shuffledPuzzles = [...ANAGRAM_PUZZLES].sort(() => Math.random() - 0.5).slice(0, 6);
  const playerScores = new Map<string, number>();
  const playerStreaks = new Map<string, number>();

  activePlayers.forEach(p => {
    playerScores.set(p.id, 0);
    playerStreaks.set(p.id, 0);
  });

  const curr = shuffledPuzzles[0];
  const scrambled = curr.word.split('').sort(() => Math.random() - 0.5);
  // Guarantee not identical to original
  if (scrambled.join('') === curr.word && curr.word.length > 2) {
    [scrambled[0], scrambled[1]] = [scrambled[1], scrambled[0]];
  }

  room.anagramGame = {
    puzzles: shuffledPuzzles,
    currentIndex: 0,
    scrambledLetters: scrambled,
    playerScores,
    playerStreaks,
    timeLeft: 25,
    status: 'playing',
    winner: null,
    history: [],
  };

  broadcastAnagramState(room, `🔤 Anagram Rush: Unscramble the word!`);
  startAnagramTimer(room);
}

function startAnagramTimer(room: ServerRoom) {
  if (!room.anagramGame) return;
  if (room.anagramGame.timerInterval) clearInterval(room.anagramGame.timerInterval);

  room.anagramGame.timerInterval = setInterval(() => {
    if (!room.anagramGame || room.anagramGame.status !== 'playing') {
      if (room.anagramGame?.timerInterval) clearInterval(room.anagramGame.timerInterval);
      return;
    }

    room.anagramGame.timeLeft -= 1;

    if (room.anagramGame.timeLeft <= 0) {
      // Time expired on this puzzle -> advance to next
      advanceAnagramPuzzle(room, null);
    } else {
      io.to(room.id).emit('anagram:tick', { timeLeft: room.anagramGame.timeLeft });
    }
  }, 1000);
}

function advanceAnagramPuzzle(room: ServerRoom, solvedByName: string | null) {
  if (!room.anagramGame) return;
  const game = room.anagramGame;
  const currentP = game.puzzles[game.currentIndex];

  if (game.currentIndex >= game.puzzles.length - 1) {
    // Game Over
    game.status = 'game_over';
    if (game.timerInterval) clearInterval(game.timerInterval);

    const activePlayers = room.state.players.filter(p => p.isConnected);
    const rankings = activePlayers
      .map(p => ({
        id: p.id,
        name: p.username,
        avatar: p.avatar,
        score: game.playerScores.get(p.id) || 0,
      }))
      .sort((a, b) => b.score - a.score);

    const topWinner = rankings[0];
    if (topWinner) {
      game.winner = topWinner;
      const winnerPlayer = room.state.players.find(p => p.id === topWinner.id);
      if (winnerPlayer) {
        winnerPlayer.score = (winnerPlayer.score || 0) + topWinner.score;
        updateGlobalLeaderboard(winnerPlayer, true);
      }
    }

    broadcastAnagramState(room, `🏆 Game Over! ${topWinner ? `${topWinner.name} won!` : ''}`);
    io.to(room.id).emit('anagram:sound', { sound: 'victory' });
  } else {
    game.currentIndex += 1;
    const nextP = game.puzzles[game.currentIndex];
    const scrambled = nextP.word.split('').sort(() => Math.random() - 0.5);
    if (scrambled.join('') === nextP.word && nextP.word.length > 2) {
      [scrambled[0], scrambled[1]] = [scrambled[1], scrambled[0]];
    }

    game.scrambledLetters = scrambled;
    game.timeLeft = 25;
    broadcastAnagramState(room, solvedByName ? `🎉 ${solvedByName} solved "${currentP.word}"! Next puzzle!` : `⏰ Time’s up! Answer was "${currentP.word}". Next puzzle!`);
    startAnagramTimer(room);
  }
}

function broadcastAnagramState(room: ServerRoom, banner?: string) {
  if (!room.anagramGame) return;
  const game = room.anagramGame;
  const activePlayers = room.state.players.filter(p => p.isConnected);
  const currentP = game.puzzles[game.currentIndex] || null;

  const leaderboard = activePlayers
    .map(p => ({
      id: p.id,
      name: p.username,
      avatar: p.avatar,
      color: p.color,
      score: game.playerScores.get(p.id) || 0,
    }))
    .sort((a, b) => b.score - a.score);

  io.to(room.id).emit('anagram:state', {
    currentIndex: game.currentIndex,
    totalPuzzles: game.puzzles.length,
    scrambledLetters: game.scrambledLetters,
    category: currentP?.category || 'General',
    hint: currentP?.hint || '',
    difficulty: currentP?.difficulty || 'Medium',
    points: currentP?.points || 150,
    timeLeft: game.timeLeft,
    status: game.status,
    winner: game.winner,
    leaderboard,
    banner: banner || null,
  });
}

// ==================== EMOJI CHARADES MULTIPLAYER SERVER ENGINE ====================
function initEmojiGame(room: ServerRoom) {
  clearAllRoomTimers(room);
  const activePlayers = room.state.players.filter(p => p.isConnected);
  if (activePlayers.length < 1) return;

  const shuffledPuzzles = [...EMOJI_PUZZLES].sort(() => Math.random() - 0.5).slice(0, 8);
  const playerScores = new Map<string, number>();

  activePlayers.forEach(p => {
    playerScores.set(p.id, 0);
  });

  room.emojiGame = {
    puzzles: shuffledPuzzles,
    currentIndex: 0,
    playerScores,
    timeLeft: 30,
    status: 'playing',
    winner: null,
  };

  broadcastEmojiState(room, `🎬 Emoji Charades! Guess the movie or pop culture title!`);
  startEmojiTimer(room);
}

function startEmojiTimer(room: ServerRoom) {
  if (!room.emojiGame) return;
  if (room.emojiGame.timerInterval) clearInterval(room.emojiGame.timerInterval);

  room.emojiGame.timerInterval = setInterval(() => {
    if (!room.emojiGame || room.emojiGame.status !== 'playing') {
      if (room.emojiGame?.timerInterval) clearInterval(room.emojiGame.timerInterval);
      return;
    }

    room.emojiGame.timeLeft -= 1;

    if (room.emojiGame.timeLeft <= 0) {
      advanceEmojiPuzzle(room, null);
    } else {
      io.to(room.id).emit('emoji:tick', { timeLeft: room.emojiGame.timeLeft });
    }
  }, 1000);
}

function advanceEmojiPuzzle(room: ServerRoom, solvedByName: string | null) {
  if (!room.emojiGame) return;
  const game = room.emojiGame;
  const currentP = game.puzzles[game.currentIndex];

  if (game.currentIndex >= game.puzzles.length - 1) {
    // Game Over
    game.status = 'game_over';
    if (game.timerInterval) clearInterval(game.timerInterval);

    const activePlayers = room.state.players.filter(p => p.isConnected);
    const rankings = activePlayers
      .map(p => ({
        id: p.id,
        name: p.username,
        avatar: p.avatar,
        score: game.playerScores.get(p.id) || 0,
      }))
      .sort((a, b) => b.score - a.score);

    const topWinner = rankings[0];
    if (topWinner) {
      game.winner = topWinner;
      const winnerPlayer = room.state.players.find(p => p.id === topWinner.id);
      if (winnerPlayer) {
        winnerPlayer.score = (winnerPlayer.score || 0) + topWinner.score;
        updateGlobalLeaderboard(winnerPlayer, true);
      }
    }

    broadcastEmojiState(room, `🏆 Game Over! ${topWinner ? `${topWinner.name} won!` : ''}`);
    io.to(room.id).emit('emoji:sound', { sound: 'victory' });
  } else {
    game.currentIndex += 1;
    game.timeLeft = 30;
    broadcastEmojiState(room, solvedByName ? `🎉 ${solvedByName} guessed "${currentP.answer}"! Next puzzle!` : `⏰ Time’s up! Answer was "${currentP.answer}". Next puzzle!`);
    startEmojiTimer(room);
  }
}

function broadcastEmojiState(room: ServerRoom, banner?: string) {
  if (!room.emojiGame) return;
  const game = room.emojiGame;
  const activePlayers = room.state.players.filter(p => p.isConnected);
  const currentP = game.puzzles[game.currentIndex] || null;

  const leaderboard = activePlayers
    .map(p => ({
      id: p.id,
      name: p.username,
      avatar: p.avatar,
      color: p.color,
      score: game.playerScores.get(p.id) || 0,
    }))
    .sort((a, b) => b.score - a.score);

  io.to(room.id).emit('emoji:state', {
    currentIndex: game.currentIndex,
    totalPuzzles: game.puzzles.length,
    emojis: currentP?.emojis || [],
    category: currentP?.category || 'General',
    hint: currentP?.hint || '',
    points: currentP?.points || 100,
    timeLeft: game.timeLeft,
    status: game.status,
    winner: game.winner,
    leaderboard,
    banner: banner || null,
  });
}

function getNextUnoIndex(current: number, step: number, direction: 1 | -1, total: number): number {
  if (total <= 0) return 0;
  let next = (current + step * direction) % total;
  if (next < 0) next += total;
  return next;
}

// REST APIs
app.get('/api/health', (req: Request, res: Response) => {
  res.json({ status: 'ok', activeRooms: ROOMS.size, timestamp: Date.now() });
});

app.get('/api/leaderboard', (req: Request, res: Response) => {
  res.json({ leaderboard: GLOBAL_STORE.leaderboard });
});

app.get('/api/rooms', (req: Request, res: Response) => {
  res.json({ rooms: getPublicRoomsList() });
});

// Socket.io Real-time Event Management
io.on('connection', (socket: Socket) => {
  let currentRoomId: string | null = null;
  let currentPlayerId: string | null = null;

  // Send initial leaderboard and public rooms list immediately
  socket.emit('leaderboard:update', GLOBAL_STORE.leaderboard);
  socket.emit('rooms:list', getPublicRoomsList());

  // Allow client to request latest public rooms on demand
  socket.on('rooms:get', () => {
    socket.emit('rooms:list', getPublicRoomsList());
  });

  // 1. Create Room
  socket.on('room:create', async ({ player, settings, roomName }: { player: Player; settings: RoomSettings; roomName: string }) => {
    const normalizedSettings = normalizeRoomSettings(settings);
    const roomId = 'room_' + Math.random().toString(36).substring(2, 9);
    const code = generateRoomCode();

    const hostPlayer: Player = {
      ...player,
      socketId: socket.id,
      isHost: true,
      isDrawing: false,
      hasGuessed: false,
      score: 0,
      roundScore: 0,
      streak: 0,
      isConnected: true,
    };

    const newRoom: ServerRoom = {
      id: roomId,
      code,
      name: roomName || `${player.username}'s Game`,
      hostSocketId: socket.id,
      settings: {
        ...normalizedSettings,
        // Multiplayer rooms always use real participants. Solo AI remains
        // available through the separate VS AI arcade flow.
        botPlayersEnabled: false,
      },
      state: {
        roomId,
        roomCode: code,
        roomName: roomName || `${player.username}'s Game`,
        status: 'lobby',
        currentRound: 1,
        totalRounds: settings.maxRounds || 3,
        drawerId: null,
        drawerName: null,
        word: '',
        wordLength: 0,
        revealedIndices: [],
        hint: '',
        wordChoices: [],
        timeLeft: settings.roundDuration || 60,
        totalTime: settings.roundDuration || 60,
        players: [hostPlayer],
        // Keep the state and server-normalized settings in sync. Arcade clients
        // use this roster/config after the host starts a room match.
        settings: {
          ...normalizedSettings,
          botPlayersEnabled: false,
        },
      },
      drawingHistory: [],
      messages: [],
      currentTurnWord: '',
      currentWordPoints: 100,
      wordSelected: false,
      drawerIndex: 0,
      playersWhoGuessed: new Set<string>(),
    };

    // Ensure no accidental bot players are present when bots are not enabled
    newRoom.state.players = newRoom.state.players.filter(p => !isBotPlayer(p));

    ROOMS.set(roomId, newRoom);
    currentRoomId = roomId;
    currentPlayerId = player.id;

    socket.join(roomId);
    socket.emit('room:joined', { room: newRoom.state, isHost: true });
    socket.emit('canvas:history', newRoom.drawingHistory);
    broadcastPublicRoomsList();

    // Persist room to Firestore (best-effort, async)
    await saveRoomToFirestore(newRoom);
    await saveActivityToFirestore({ type: 'room_create', roomId: newRoom.id, by: player.id, roomName: newRoom.name }).catch(() => {});
  });

  // 2. Join Room by Code or ID
  socket.on('room:join', async ({ roomIdentifier, player }: { roomIdentifier: string; player: Player }) => {
    const search = roomIdentifier.trim().toUpperCase();
    let room: ServerRoom | undefined;

    ROOMS.forEach(r => {
      if (r.id === roomIdentifier || r.code === search) {
        room = r;
      }
    });

    if (!room) {
      socket.emit('room:error', { message: 'Room not found. Check code or ID.' });
      return;
    }

    // Multiplayer rooms accept real participants only.
    if (isBotPlayer(player)) {
      socket.emit('room:error', { message: 'Multiplayer rooms accept real players only.' });
      return;
    }

    // Check if player rejoining
    const existingIndex = room.state.players.findIndex(p => p.id === player.id);
    if (existingIndex < 0 && room.state.status !== 'lobby') {
      socket.emit('room:error', { message: 'This game has already started. Join the next round.' });
      return;
    }
    if (existingIndex < 0 && getConnectedHumanPlayers(room).length >= room.settings.maxPlayers) {
      socket.emit('room:error', { message: 'Room is full.' });
      return;
    }
    const newPlayer: Player = {
      ...player,
      socketId: socket.id,
      isHost: existingIndex >= 0 ? room.state.players[existingIndex].isHost : room.state.players.length === 0,
      isDrawing: existingIndex >= 0 ? room.state.players[existingIndex].isDrawing : false,
      hasGuessed: existingIndex >= 0 ? room.state.players[existingIndex].hasGuessed : false,
      score: existingIndex >= 0 ? room.state.players[existingIndex].score : 0,
      roundScore: 0,
      streak: existingIndex >= 0 ? room.state.players[existingIndex].streak : 0,
      isConnected: true,
    };

    if (existingIndex >= 0) {
      room.state.players[existingIndex] = newPlayer;
    } else {
      room.state.players.push(newPlayer);
    }

    currentRoomId = room.id;
    currentPlayerId = player.id;

    socket.join(room.id);
    socket.emit('room:joined', { room: room.state, isHost: newPlayer.isHost });
    socket.emit('canvas:history', room.drawingHistory);

    // Announce player joined
    const joinMsg: ChatMessage = {
      id: 'sys_' + Date.now(),
      senderName: 'System',
      text: `👋 ${newPlayer.username} joined the game!`,
      type: 'system',
      timestamp: Date.now(),
    };
    io.to(room.id).emit('chat:message', joinMsg);
    io.to(room.id).emit('room:state', sanitizeStateForClient(room));
    broadcastPublicRoomsList();

    // Save updated room
    await saveRoomToFirestore(room);
    await saveActivityToFirestore({ type: 'player_join', roomId: room.id, playerId: newPlayer.id }).catch(() => {});
  });

  // 3. Quick Match / Auto Join
  socket.on('room:quick_join', ({ player }: { player: Player }) => {
    let targetRoom: ServerRoom | undefined;
    ROOMS.forEach(r => {
      if (!r.settings.isPrivate && getConnectedHumanPlayers(r).length < r.settings.maxPlayers && r.state.status === 'lobby') {
        targetRoom = r;
      }
    });

    if (targetRoom) {
      // Join existing
      socket.emit('room:join_ready', { roomIdentifier: targetRoom.id });
    } else {
      // Auto-create public lobby
      const defaultSettings: RoomSettings = normalizeRoomSettings({
        roundDuration: 60,
        maxRounds: 3,
        maxPlayers: 8,
        wordCategory: 'all',
        customWords: [],
        isPrivate: false,
        allowHints: true,
        botPlayersEnabled: false,
      });
      const roomId = 'room_' + Math.random().toString(36).substring(2, 9);
      const code = generateRoomCode();
      const hostPlayer: Player = {
        ...player,
        socketId: socket.id,
        isHost: true,
        isDrawing: false,
        hasGuessed: false,
        score: 0,
        roundScore: 0,
        streak: 0,
        isConnected: true,
      };

      const newRoom: ServerRoom = {
        id: roomId,
        code,
        name: `Public Arena #${code.substring(0, 3)}`,
        hostSocketId: socket.id,
        settings: defaultSettings,
        state: {
          roomId,
          roomCode: code,
          roomName: `Public Arena #${code.substring(0, 3)}`,
          status: 'lobby',
          currentRound: 1,
          totalRounds: 3,
          drawerId: null,
          drawerName: null,
          word: '',
          wordLength: 0,
          revealedIndices: [],
          hint: '',
          wordChoices: [],
          timeLeft: 60,
          totalTime: 60,
          players: [hostPlayer],
          settings: defaultSettings,
        },
        drawingHistory: [],
        messages: [],
        currentTurnWord: '',
        currentWordPoints: 100,
        wordSelected: false,
        drawerIndex: 0,
        playersWhoGuessed: new Set<string>(),
      };

      ROOMS.set(roomId, newRoom);
      socket.join(roomId);
      socket.emit('room:joined', { room: newRoom.state, isHost: true });
      broadcastPublicRoomsList();

      // Save created room
      saveRoomToFirestore(newRoom).catch(() => {});
      saveActivityToFirestore({ type: 'room_quick_create', roomId: newRoom.id }).catch(() => {});
    }
  });

  // 4. Start Game (Host only) — dispatcher by gameMode
  socket.on('game:start', async () => {
    if (!currentRoomId) return;
    const room = ROOMS.get(currentRoomId);
    if (!room) return;

    const caller = room.state.players.find(p => p.id === currentPlayerId);
    if (!caller?.isHost) {
      socket.emit('room:error', { message: 'Only host can start the game.' });
      return;
    }

    // Determine requested game mode (server-first)
    const rawGameMode = (room.settings && (room.settings as any).gameMode) || (room.state.settings && (room.state.settings as any).gameMode) || 'multiplayer_draw';
    const gameMode = typeof rawGameMode === 'string' ? rawGameMode.toLowerCase() : 'multiplayer_draw';

    // Never let an AI entry occupy a multiplayer slot. Remove legacy or
    // previously-added bot records before validating the real-player roster.
    const hadBots = room.state.players.some(isBotPlayer);
    if (hadBots) {
      room.state.players = room.state.players.filter(player => !isBotPlayer(player));
      room.settings.botPlayersEnabled = false;
      if (room.state.settings) room.state.settings.botPlayersEnabled = false;
      io.to(room.id).emit('room:state', sanitizeStateForClient(room));
    }

    const activePlayers = getConnectedHumanPlayers(room);
    const minimumPlayers = 2;
    if (activePlayers.length < minimumPlayers) {
      socket.emit('room:error', {
        message: 'Need at least 2 connected real players to start this multiplayer game.',
      });
      return;
    }

    const GAME_MODE_TITLES: Record<string, string> = {
      uno_party: '🃏 UNO Party Showdown',
      trivia_dash: '⚡ Trivia Dash 60s',
      anagram_rush: '🔤 Anagram Rush',
      bomb_chain: '💥 Word Bomb Chain',
      ai_sketch_guess: '🤖 AI Sketch Guesser',
      speed_duel: '⚔️ 1v1 Speed Duel',
      pixel_reveal: '🔍 Pixel Reveal Mystery',
      blindfold_maestro: '🙈 Blindfold Maestro',
      emoji_charades: '🎭 Emoji Charades',
      sound_mystery: '🎵 Sound & Audio Mystery',
      reflex_neon: '⚡ Neon Reflex Blitz',
      color_clash: '🎨 Color Clash Matrix',
      cyber_typing: '⌨️ Cyber Typing Rush',
      simon_sequence: '🎶 Simon Sequence Matrix',
      math_sprint: '🔢 Math Sprint 60s',
      emoji_match: '🧩 Emoji Tile Match',
      whack_doodle: '🔨 Whack-a-Doodle',
      tower_stack: '🏗️ Cyber Tower Stacker',
      ngip_mega_wheel: '🎡 Mega Jackpot Wheel',
      ngip_vault_hacker: '🔐 Cyber Vault Hacker',
      multiplayer_draw: '🎨 Multiplayer Drawing Arena',
    };

    if (gameMode === 'multiplayer_draw' || gameMode === 'drawing') {
      if (activePlayers.length < 2) {
        socket.emit('room:error', {
          message: 'Need at least 2 connected real players to start Drawing Arena. Invite a friend with the Room Code.',
        });
        return;
      }

      // Reset scores & rounds
      room.state.currentRound = 1;
      room.state.players.forEach(p => {
        p.score = 0;
        p.roundScore = 0;
        p.hasGuessed = false;
        p.streak = 0;
      });
      room.drawerIndex = 0;

      await saveActivityToFirestore({ type: 'game_start_drawing', roomId: room.id, by: caller.id }).catch(() => {});
      startTurnCycle(room);
      broadcastPublicRoomsList();
      await saveRoomToFirestore(room);
    } else {
      // Non-drawing multiplayer arcade game (UNO Party, Trivia Dash, Word Bomb, etc.)
      if (room.timerInterval) clearInterval(room.timerInterval);

      // Transition room status to active playing
      room.state.status = 'drawing';
      room.drawingHistory = [];
      room.currentTurnWord = '';
      room.currentWordPoints = 0;
      room.wordSelected = false;

      const title = GAME_MODE_TITLES[gameMode] || gameMode;

      io.to(room.id).emit('room:state', sanitizeStateForClient(room));
      io.to(room.id).emit('chat:message', {
        id: 'start_' + Date.now(),
        senderName: 'Game Master',
        text: `🎮 ${title} match has started! Good luck to all players!`,
        type: 'system',
        timestamp: Date.now(),
      });

      if (gameMode === 'uno_party') {
        initUnoGame(room);
      } else if (gameMode === 'trivia_dash') {
        initTriviaGame(room);
      } else if (gameMode === 'bomb_chain') {
        initBombGame(room);
      } else if (gameMode === 'speed_duel') {
        initDuelGame(room);
      } else if (gameMode === 'anagram_rush') {
        initAnagramGame(room);
      } else if (gameMode === 'emoji_charades') {
        initEmojiGame(room);
      }

      await saveActivityToFirestore({ type: `game_start_${gameMode}`, roomId: room.id, by: caller.id }).catch(() => {});
      await saveRoomToFirestore(room);
      broadcastPublicRoomsList();
    }
  });

  // 5. Word Selection by Drawer
  socket.on('word:select', ({ choice }: { choice: WordChoice }) => {
    if (!currentRoomId) return;
    const room = ROOMS.get(currentRoomId);
    if (!room || room.state.status !== 'selecting_word') return;

    if (room.state.drawerId !== currentPlayerId) return;

    room.currentTurnWord = choice.word;
    room.currentWordPoints = choice.points;
    room.wordSelected = true;
    room.state.word = choice.word;
    room.state.wordLength = choice.word.length;
    room.state.hint = choice.hint || '';
    room.state.revealedIndices = [];

    // Clear previous timer and begin drawing phase
    if (room.timerInterval) clearInterval(room.timerInterval);
    beginDrawingPhase(room);

    // Save room state
    saveRoomToFirestore(room).catch(() => {});
  });

  // 6. Drawing Events (Broadcast to room)
  socket.on('draw:action', (action: CanvasAction) => {
    if (!currentRoomId) return;
    const room = ROOMS.get(currentRoomId);
    if (!room || room.state.status !== 'drawing') return;

    // In speed_duel or canvas_collab, allow any player to draw
    const isFreeDrawMode = room.settings.gameMode === 'speed_duel';
    if (!isFreeDrawMode && room.state.drawerId !== currentPlayerId) return;

    if (action.type === 'clear') {
      room.drawingHistory = [];
    } else {
      room.drawingHistory.push(action);
    }

    // Broadcast stroke to all OTHER clients in the room
    socket.to(currentRoomId).emit('draw:action', action);
  });

  // 7. Clear Canvas
  socket.on('canvas:clear', () => {
    if (!currentRoomId) return;
    const room = ROOMS.get(currentRoomId);
    if (!room) return;
    const isFreeDrawMode = room.settings.gameMode === 'speed_duel';
    if (!isFreeDrawMode && room.state.drawerId !== currentPlayerId) return;

    room.drawingHistory = [];
    io.to(currentRoomId).emit('canvas:clear');
  });

  // ==================== 7b. UNO MULTIPLAYER SOCKET HANDLERS ====================
  // Sync request on component mount or reconnect
  socket.on('uno:get_state', () => {
    if (!currentRoomId) return;
    const room = ROOMS.get(currentRoomId);
    if (!room) return;

    if (!room.unoGame) {
      initUnoGame(room);
    } else {
      broadcastUnoState(room);
    }
  });

  // Card Play Event
  socket.on('uno:play_card', ({ cardId, chosenWildColor }: { cardId: string; chosenWildColor?: UnoColor }) => {
    if (!currentRoomId || !currentPlayerId) return;
    const room = ROOMS.get(currentRoomId);
    if (!room) return;

    if (!room.unoGame) {
      initUnoGame(room);
      return;
    }

    const game = room.unoGame;
    if (game.status !== 'playing') return;

    // Validate turn
    if (game.currentTurnPlayerId !== currentPlayerId) {
      console.log(`[UNO] Play rejected: not player's turn (Turn: ${game.currentTurnPlayerId}, Sender: ${currentPlayerId})`);
      return;
    }

    const hand = game.playerHands.get(currentPlayerId);
    if (!hand) return;

    const cardIndex = hand.findIndex(c => c.id === cardId);
    if (cardIndex === -1) return;

    const card = hand[cardIndex];
    hand.splice(cardIndex, 1);
    game.playerHands.set(currentPlayerId, hand);
    game.discardPile.push(card);
    game.cardsPlayed += 1;

    const nextColor: UnoColor = chosenWildColor || (card.color === 'wild' ? 'red' : card.color);
    game.activeColor = nextColor;

    const senderPlayer = room.state.players.find(p => p.id === currentPlayerId);
    const senderName = senderPlayer?.username || 'Player';

    const cardLabel = `${card.color === 'wild' ? 'Wild' : card.color.toUpperCase()} ${card.type === 'number' ? card.value : card.type.toUpperCase()}`;
    game.historyLog.unshift({
      text: `${senderName} played ${cardLabel}${chosenWildColor ? ` (picked ${chosenWildColor.toUpperCase()})` : ''}`,
      color: nextColor,
    });
    if (game.historyLog.length > 12) game.historyLog.pop();

    // Check Win Condition
    if (hand.length === 0) {
      let totalScore = 0;
      game.playerHands.forEach((otherHand) => {
        otherHand.forEach(c => totalScore += c.score);
      });

      game.status = 'game_over';
      game.winner = { id: senderPlayer!.id, name: senderName, avatar: senderPlayer!.avatar };
      game.finalScore = totalScore;
      game.currentTurnPlayerId = '';

      broadcastUnoState(room, `🏆 ${senderName} won the UNO Showdown! (+${totalScore} pts)`);
      io.to(room.id).emit('uno:sound', { sound: 'victory' });

      if (senderPlayer) {
        senderPlayer.score = (senderPlayer.score || 0) + totalScore;
        updateGlobalLeaderboard(senderPlayer, true);
      }
      return;
    }

    // Action cards processing
    let advanceSteps = 1;
    let actionBanner: string | undefined;

    const activePlayers = room.state.players.filter(p => p.isConnected);
    const currentIdx = activePlayers.findIndex(p => p.id === currentPlayerId);

    if (card.type === 'skip') {
      const skippedIdx = getNextUnoIndex(currentIdx, 1, game.direction, activePlayers.length);
      actionBanner = `⛔ ${activePlayers[skippedIdx].username} was SKIPPED!`;
      advanceSteps = 2;
      io.to(room.id).emit('uno:sound', { sound: 'action' });
    } else if (card.type === 'reverse') {
      if (activePlayers.length === 2) {
        actionBanner = `🔄 Reverse! ${senderName} plays again!`;
        advanceSteps = 2;
      } else {
        game.direction = (game.direction * -1) as 1 | -1;
        actionBanner = `🔄 Rotation REVERSED!`;
        advanceSteps = 1;
      }
      io.to(room.id).emit('uno:sound', { sound: 'action' });
    } else if (card.type === 'draw2') {
      const victimIdx = getNextUnoIndex(currentIdx, 1, game.direction, activePlayers.length);
      const victim = activePlayers[victimIdx];
      actionBanner = `💥 ${victim.username} draws +2 cards and is skipped!`;
      drawCardsFromUnoDeck(room, victim.id, 2);
      advanceSteps = 2;
      io.to(room.id).emit('uno:sound', { sound: 'draw' });
    } else if (card.type === 'wild') {
      actionBanner = `🌈 Active color changed to ${nextColor.toUpperCase()}!`;
      io.to(room.id).emit('uno:sound', { sound: 'action' });
    } else if (card.type === 'wild4') {
      const victimIdx = getNextUnoIndex(currentIdx, 1, game.direction, activePlayers.length);
      const victim = activePlayers[victimIdx];
      actionBanner = `💥 WILD +4! ${victim.username} draws 4 cards and is skipped!`;
      drawCardsFromUnoDeck(room, victim.id, 4);
      advanceSteps = 2;
      io.to(room.id).emit('uno:sound', { sound: 'draw' });
    } else {
      io.to(room.id).emit('uno:sound', { sound: 'play' });
    }

    const nextTurnIdx = getNextUnoIndex(currentIdx, advanceSteps, game.direction, activePlayers.length);
    game.currentTurnPlayerId = activePlayers[nextTurnIdx].id;

    broadcastUnoState(room, actionBanner);
  });

  // Draw Card Event
  socket.on('uno:draw_card', () => {
    if (!currentRoomId || !currentPlayerId) return;
    const room = ROOMS.get(currentRoomId);
    if (!room || !room.unoGame) return;

    const game = room.unoGame;
    if (game.status !== 'playing') return;
    if (game.currentTurnPlayerId !== currentPlayerId) return;

    const senderPlayer = room.state.players.find(p => p.id === currentPlayerId);
    const senderName = senderPlayer?.username || 'Player';

    const drawn = drawCardsFromUnoDeck(room, currentPlayerId, 1);
    const drawnCard = drawn[0] || null;

    game.historyLog.unshift({
      text: `${senderName} drew 1 card from deck`,
      color: game.activeColor,
    });
    if (game.historyLog.length > 12) game.historyLog.pop();

    broadcastUnoState(room, `${senderName} drew 1 card`);
    socket.emit('uno:drawn_card_result', { card: drawnCard });
    io.to(room.id).emit('uno:sound', { sound: 'draw' });
  });

  // Pass Turn Event
  socket.on('uno:pass_turn', () => {
    if (!currentRoomId || !currentPlayerId) return;
    const room = ROOMS.get(currentRoomId);
    if (!room || !room.unoGame) return;

    const game = room.unoGame;
    if (game.status !== 'playing') return;
    if (game.currentTurnPlayerId !== currentPlayerId) return;

    const activePlayers = room.state.players.filter(p => p.isConnected);
    const currentIdx = activePlayers.findIndex(p => p.id === currentPlayerId);
    const nextTurnIdx = getNextUnoIndex(currentIdx, 1, game.direction, activePlayers.length);
    game.currentTurnPlayerId = activePlayers[nextTurnIdx].id;

    const senderPlayer = room.state.players.find(p => p.id === currentPlayerId);
    broadcastUnoState(room, `${senderPlayer?.username || 'Player'} passed turn`);
  });

  // Shout UNO Event
  socket.on('uno:call_uno', () => {
    if (!currentRoomId || !currentPlayerId) return;
    const room = ROOMS.get(currentRoomId);
    if (!room || !room.unoGame) return;

    const hand = room.unoGame.playerHands.get(currentPlayerId) || [];
    if (hand.length <= 2) {
      room.unoGame.calledUno.add(currentPlayerId);
      const sender = room.state.players.find(p => p.id === currentPlayerId);
      broadcastUnoState(room, `📣 ${sender?.username || 'Player'} SHOUTED UNO!`);
      io.to(room.id).emit('uno:sound', { sound: 'uno_call' });
    }
  });

  // Catch Uno Event
  socket.on('uno:catch_uno', ({ targetPlayerId }: { targetPlayerId: string }) => {
    if (!currentRoomId || !currentPlayerId) return;
    const room = ROOMS.get(currentRoomId);
    if (!room || !room.unoGame) return;

    const targetHand = room.unoGame.playerHands.get(targetPlayerId) || [];
    if (targetHand.length === 1 && !room.unoGame.calledUno.has(targetPlayerId)) {
      const targetPlayer = room.state.players.find(p => p.id === targetPlayerId);
      const catcher = room.state.players.find(p => p.id === currentPlayerId);
      drawCardsFromUnoDeck(room, targetPlayerId, 2);
      broadcastUnoState(room, `🚨 CAUGHT! ${catcher?.username} caught ${targetPlayer?.username} forgetting UNO! (+2 Penalty)`);
      io.to(room.id).emit('uno:sound', { sound: 'action' });
    }
  });

  // Rematch / Play Another Match
  socket.on('uno:rematch', () => {
    if (!currentRoomId) return;
    const room = ROOMS.get(currentRoomId);
    if (!room) return;
    initUnoGame(room);
  });

  // ==================== 7c. WORD BOMB MULTIPLAYER HANDLERS ====================
  socket.on('bomb:get_state', () => {
    if (!currentRoomId) return;
    const room = ROOMS.get(currentRoomId);
    if (!room) return;

    if (!room.bombGame) {
      initBombGame(room);
    } else {
      broadcastBombState(room);
    }
  });

  socket.on('bomb:submit_word', ({ word }: { word: string }) => {
    if (!currentRoomId || !currentPlayerId || !word) return;
    const room = ROOMS.get(currentRoomId);
    if (!room || !room.bombGame || room.bombGame.status !== 'playing') return;

    const game = room.bombGame;
    // Check turn
    if (game.currentTurnPlayerId !== currentPlayerId) {
      socket.emit('bomb:error', { message: 'Not your turn!' });
      return;
    }

    const cleanWord = word.trim().toUpperCase();
    if (!cleanWord.includes(game.prompt)) {
      socket.emit('bomb:error', { message: `Must contain "${game.prompt}"!` });
      return;
    }

    if (game.usedWords.includes(cleanWord)) {
      socket.emit('bomb:error', { message: `"${cleanWord}" was already used!` });
      return;
    }

    if (!isValidEnglishWord(cleanWord)) {
      socket.emit('bomb:error', { message: `"${cleanWord}" is not recognized in the dictionary.` });
      return;
    }

    // Word is VALID!
    game.usedWords.push(cleanWord);
    game.defusedCount += 1;

    const basePts = 100 + (cleanWord.length * 15) + (game.timeLeft * 10);
    const currScore = (game.playerScores.get(currentPlayerId) || 0) + basePts;
    game.playerScores.set(currentPlayerId, currScore);

    const playerObj = room.state.players.find(p => p.id === currentPlayerId);
    if (playerObj) {
      playerObj.score = (playerObj.score || 0) + basePts;
    }

    io.to(room.id).emit('bomb:sound', { sound: 'defuse' });

    // Pick next prompt & pass bomb to next alive player
    const nextPromptObj = SYLLABLE_PROMPTS[Math.floor(Math.random() * SYLLABLE_PROMPTS.length)];
    game.prompt = nextPromptObj.prompt;

    const activeList = room.state.players.filter(p => p.isConnected);
    const currentIdx = activeList.findIndex(p => p.id === currentPlayerId);
    let nextIdx = (currentIdx + 1) % activeList.length;
    while ((game.playerLives.get(activeList[nextIdx].id) || 0) <= 0) {
      nextIdx = (nextIdx + 1) % activeList.length;
    }

    const nextPlayer = activeList[nextIdx];
    game.currentTurnPlayerId = nextPlayer.id;
    const baseTime = Math.max(5, 10 - Math.floor(game.defusedCount / 4));
    game.timeLeft = baseTime;
    game.totalTime = baseTime;

    broadcastBombState(room, `🎉 ${playerObj?.username || 'Player'} played "${cleanWord}" (+${basePts} pts)! Bomb passed to ${nextPlayer.username}!`);
  });

  socket.on('bomb:rematch', () => {
    if (!currentRoomId) return;
    const room = ROOMS.get(currentRoomId);
    if (!room) return;
    initBombGame(room);
  });

  // Legacy relay support for Word Bomb
  socket.on('bomb:word_submit', (data: any) => {
    if (!currentRoomId) return;
    socket.to(currentRoomId).emit('bomb:word_submit', data);
  });

  socket.on('bomb:explode', (data: any) => {
    if (!currentRoomId) return;
    socket.to(currentRoomId).emit('bomb:explode', data);
  });

  socket.on('bomb:game_end', (data: any) => {
    if (!currentRoomId) return;
    socket.to(currentRoomId).emit('bomb:game_end', data);
  });

  // ==================== 7d. TRIVIA DASH MULTIPLAYER HANDLERS ====================
  socket.on('trivia:get_state', () => {
    if (!currentRoomId) return;
    const room = ROOMS.get(currentRoomId);
    if (!room) return;

    if (!room.triviaGame) {
      initTriviaGame(room);
    } else {
      broadcastTriviaState(room);
    }
  });

  socket.on('trivia:answer', ({ optionIndex }: { optionIndex: number }) => {
    if (!currentRoomId || !currentPlayerId) return;
    const room = ROOMS.get(currentRoomId);
    if (!room || !room.triviaGame || room.triviaGame.status !== 'playing') return;

    const game = room.triviaGame;
    if (game.playerAnswers.has(currentPlayerId)) return; // Already answered

    const currentQ = game.questions[game.currentIndex];
    const isCorrect = optionIndex === currentQ.correctIndex;

    let earned = 0;
    if (isCorrect) {
      const currentStreak = (game.playerStreaks.get(currentPlayerId) || 0) + 1;
      game.playerStreaks.set(currentPlayerId, currentStreak);
      earned = currentQ.points + Math.floor(game.timeLeft * 8) + (currentStreak > 1 ? currentStreak * 25 : 0);
      const newScore = (game.playerScores.get(currentPlayerId) || 0) + earned;
      game.playerScores.set(currentPlayerId, newScore);

      const pObj = room.state.players.find(p => p.id === currentPlayerId);
      if (pObj) {
        pObj.score = (pObj.score || 0) + earned;
      }
    } else {
      game.playerStreaks.set(currentPlayerId, 0);
    }

    game.playerAnswers.set(currentPlayerId, {
      optionIndex,
      isCorrect,
      points: earned,
    });

    socket.emit('trivia:answer_result', { isCorrect, points: earned, correctIndex: currentQ.correctIndex });

    // If all connected players have answered, immediately end the round
    const activeCount = room.state.players.filter(p => p.isConnected).length;
    if (game.playerAnswers.size >= activeCount) {
      endTriviaRound(room);
    } else {
      broadcastTriviaState(room);
    }
  });

  socket.on('trivia:rematch', () => {
    if (!currentRoomId) return;
    const room = ROOMS.get(currentRoomId);
    if (!room) return;
    initTriviaGame(room);
  });

  // ==================== 7e. SPEED DUEL MULTIPLAYER HANDLERS ====================
  socket.on('duel:get_state', () => {
    if (!currentRoomId) return;
    const room = ROOMS.get(currentRoomId);
    if (!room) return;

    if (!room.duelGame) {
      initDuelGame(room);
    } else {
      broadcastDuelState(room);
    }
  });

  socket.on('duel:submit_strokes', ({ strokeCount, detailScore }: { strokeCount: number; detailScore: number }) => {
    if (!currentRoomId || !currentPlayerId) return;
    const room = ROOMS.get(currentRoomId);
    if (!room || !room.duelGame) return;

    room.duelGame.playerSubmissions.set(currentPlayerId, { strokeCount, detailScore });
  });

  socket.on('duel:scores', (data: any) => {
    if (!currentRoomId) return;
    socket.to(currentRoomId).emit('duel:scores', data);
  });

  socket.on('duel:rematch', () => {
    if (!currentRoomId) return;
    const room = ROOMS.get(currentRoomId);
    if (!room) return;
    initDuelGame(room);
  });

  // ==================== 7f. ANAGRAM RUSH MULTIPLAYER HANDLERS ====================
  socket.on('anagram:get_state', () => {
    if (!currentRoomId) return;
    const room = ROOMS.get(currentRoomId);
    if (!room) return;

    if (!room.anagramGame) {
      initAnagramGame(room);
    } else {
      broadcastAnagramState(room);
    }
  });

  socket.on('anagram:submit_word', ({ word }: { word: string }) => {
    if (!currentRoomId || !currentPlayerId || !word) return;
    const room = ROOMS.get(currentRoomId);
    if (!room || !room.anagramGame || room.anagramGame.status !== 'playing') return;

    const game = room.anagramGame;
    const currentP = game.puzzles[game.currentIndex];
    const cleanWord = word.trim().toUpperCase();

    if (cleanWord === currentP.word.toUpperCase()) {
      // Solved!
      const earned = currentP.points + Math.floor(game.timeLeft * 5);
      const newScore = (game.playerScores.get(currentPlayerId) || 0) + earned;
      game.playerScores.set(currentPlayerId, newScore);

      const pObj = room.state.players.find(p => p.id === currentPlayerId);
      if (pObj) {
        pObj.score = (pObj.score || 0) + earned;
      }

      io.to(room.id).emit('anagram:sound', { sound: 'solve' });
      advanceAnagramPuzzle(room, pObj?.username || 'Player');
    } else {
      socket.emit('anagram:error', { message: 'Incorrect! Try another word.' });
    }
  });

  socket.on('anagram:rematch', () => {
    if (!currentRoomId) return;
    const room = ROOMS.get(currentRoomId);
    if (!room) return;
    initAnagramGame(room);
  });

  // ==================== 7g. EMOJI CHARADES MULTIPLAYER HANDLERS ====================
  socket.on('emoji:get_state', () => {
    if (!currentRoomId) return;
    const room = ROOMS.get(currentRoomId);
    if (!room) return;

    if (!room.emojiGame) {
      initEmojiGame(room);
    } else {
      broadcastEmojiState(room);
    }
  });

  socket.on('emoji:guess', ({ guess }: { guess: string }) => {
    if (!currentRoomId || !currentPlayerId || !guess) return;
    const room = ROOMS.get(currentRoomId);
    if (!room || !room.emojiGame || room.emojiGame.status !== 'playing') return;

    const game = room.emojiGame;
    const currentP = game.puzzles[game.currentIndex];
    const sanitizedG = sanitizeWordForComparison(guess);
    const sanitizedA = sanitizeWordForComparison(currentP.answer);

    if (sanitizedG === sanitizedA) {
      // Solved!
      const earned = (currentP.points || 100) + Math.floor(game.timeLeft * 4);
      const newScore = (game.playerScores.get(currentPlayerId) || 0) + earned;
      game.playerScores.set(currentPlayerId, newScore);

      const pObj = room.state.players.find(p => p.id === currentPlayerId);
      if (pObj) {
        pObj.score = (pObj.score || 0) + earned;
      }

      io.to(room.id).emit('emoji:sound', { sound: 'solve' });
      advanceEmojiPuzzle(room, pObj?.username || 'Player');
    } else {
      socket.emit('emoji:error', { message: 'Not quite! Keep guessing.' });
    }
  });

  socket.on('emoji:rematch', () => {
    if (!currentRoomId) return;
    const room = ROOMS.get(currentRoomId);
    if (!room) return;
    initEmojiGame(room);
  });

  // ==================== 7h. UNIVERSAL MINI-GAME SCORE SYNC ====================
  socket.on('game:score_sync', ({ score, detail, finished }: { score: number; detail?: any; finished?: boolean }) => {
    if (!currentRoomId || !currentPlayerId) return;
    const room = ROOMS.get(currentRoomId);
    if (!room) return;

    const playerObj = room.state.players.find(p => p.id === currentPlayerId);
    if (playerObj) {
      playerObj.score = Math.max(playerObj.score || 0, score);
      if (finished) {
        updateGlobalLeaderboard(playerObj, true);
      }
    }

    // Broadcast live room ranking to all participants
    const leaderboard = room.state.players
      .filter(p => p.isConnected)
      .map(p => ({
        id: p.id,
        name: p.username,
        avatar: p.avatar,
        color: p.color,
        score: p.score || 0,
      }))
      .sort((a, b) => b.score - a.score);

    io.to(room.id).emit('game:leaderboard_update', { leaderboard, detail });
  });

  // 8. Chat / Guess Submission
  socket.on('chat:send', ({ text }: { text: string }) => {
    if (!currentRoomId || !text || text.trim().length === 0) return;
    const room = ROOMS.get(currentRoomId);
    if (!room) return;

    const sender = room.state.players.find(p => p.id === currentPlayerId);
    if (!sender) return;

    const cleanInput = text.trim();
    const isDrawingPhase = room.state.status === 'drawing';
    const isDrawer = room.state.drawerId === sender.id;
    const alreadyGuessed = room.playersWhoGuessed.has(sender.id);

    // If drawing phase, check if input is a guess
    if (isDrawingPhase && !isDrawer && !alreadyGuessed) {
      const sanitizedGuess = sanitizeWordForComparison(cleanInput);
      const sanitizedTarget = sanitizeWordForComparison(room.currentTurnWord);

      if (sanitizedGuess === sanitizedTarget) {
        // CORRECT GUESS!
        room.playersWhoGuessed.add(sender.id);
        sender.hasGuessed = true;

        // Calculate score
        const timeRatio = Math.max(0.15, room.state.timeLeft / room.state.totalTime);
        const speedBonus = Math.round(room.currentWordPoints * timeRatio);
        const streakBonus = sender.streak * 25;
        const totalPointsGained = speedBonus + streakBonus;

        sender.roundScore = totalPointsGained;
        sender.score += totalPointsGained;
        sender.streak += 1;
        sender.guessTime = room.state.totalTime - room.state.timeLeft;

        // Notify Room that player guessed
        const correctMsg: ChatMessage = {
          id: 'guess_' + Date.now(),
          senderId: sender.id,
          senderName: sender.username,
          senderColor: sender.color,
          senderAvatar: sender.avatar,
          text: `🎉 ${sender.username} guessed the word! (+${totalPointsGained} pts)`,
          type: 'correct_guess',
          timestamp: Date.now(),
          pointsAwarded: totalPointsGained,
        };
        io.to(room.id).emit('chat:message', correctMsg);

        // Update player stats
        if (!sender.stats) {
          sender.stats = {
            gamesPlayed: 1,
            wins: 0,
            totalScore: totalPointsGained,
            wordsGuessed: 1,
            drawingsCompleted: 0,
            highestRoundScore: totalPointsGained,
          };
        } else {
          sender.stats.wordsGuessed += 1;
          sender.stats.totalScore += totalPointsGained;
          if (totalPointsGained > sender.stats.highestRoundScore) {
            sender.stats.highestRoundScore = totalPointsGained;
          }
        }

        // Broadcast room state
        io.to(room.id).emit('room:state', sanitizeStateForClient(room));

        // Check if ALL non-drawing players have guessed
        const nonDrawingPlayers = room.state.players.filter(p => p.id !== room.state.drawerId && p.isConnected);
        if (room.playersWhoGuessed.size >= nonDrawingPlayers.length) {
          // Everyone guessed! End round immediately
          if (room.timerInterval) clearInterval(room.timerInterval);
          endTurnCycle(room, 'Everyone guessed the word!');
        }
        return;
      }

      // Check if CLOSE guess (Levenshtein distance <= 2)
      const levDist = calculateLevenshtein(sanitizedGuess, sanitizedTarget);
      if (levDist > 0 && levDist <= 2 && sanitizedTarget.length >= 4) {
        socket.emit('chat:message', {
          id: 'close_' + Date.now(),
          senderName: 'Hint Master',
          text: `🔥 "${cleanInput}" is very close! Keep guessing!`,
          type: 'close_guess',
          timestamp: Date.now(),
        });
        return;
      }
    }

    // Standard Chat Message Broadcast
    const chatMsg: ChatMessage = {
      id: 'msg_' + Date.now() + '_' + Math.random().toString(36).substring(2, 5),
      senderId: sender.id,
      senderName: sender.username,
      senderColor: sender.color,
      senderAvatar: sender.avatar,
      text: cleanInput,
      type: 'chat',
      timestamp: Date.now(),
      reactions: {},
    };
    if (!room.messages) room.messages = [];
    room.messages.push(chatMsg);
    // Keep max 100 recent messages per room
    if (room.messages.length > 100) room.messages.shift();

    io.to(room.id).emit('chat:message', chatMsg);
  });

  // 9. Message Tapback Reaction (iMessage Style Double Tap)
  socket.on('chat:react_message', ({ messageId, emoji }: { messageId: string; emoji: string }) => {
    if (!currentRoomId || !messageId || !emoji) return;
    const room = ROOMS.get(currentRoomId);
    if (!room) return;
    const sender = room.state.players.find(p => p.id === currentPlayerId);
    if (!sender) return;

    if (!room.messages) room.messages = [];
    const targetMsg = room.messages.find(m => m.id === messageId);
    if (!targetMsg) return;

    if (!targetMsg.reactions) targetMsg.reactions = {};

    const userList = targetMsg.reactions[emoji] || [];
    const existingIndex = userList.indexOf(sender.id);

    if (existingIndex >= 0) {
      // Toggle off if already reacted
      userList.splice(existingIndex, 1);
      if (userList.length === 0) {
        delete targetMsg.reactions[emoji];
      } else {
        targetMsg.reactions[emoji] = userList;
      }
    } else {
      // Add reaction
      userList.push(sender.id);
      targetMsg.reactions[emoji] = userList;
    }

    // Broadcast updated reactions for this message to ALL players in the room
    io.to(room.id).emit('chat:message_reaction_update', {
      messageId,
      reactions: targetMsg.reactions,
      reactedBy: {
        userId: sender.id,
        username: sender.username,
        emoji,
      },
    });
  });

  // 9b. Quick Emoji Reaction (Floating arena reactions)
  socket.on('reaction:send', ({ emoji }: { emoji: string }) => {
    if (!currentRoomId) return;
    const room = ROOMS.get(currentRoomId);
    if (!room) return;
    const sender = room.state.players.find(p => p.id === currentPlayerId);
    if (!sender) return;

    io.to(room.id).emit('reaction:broadcast', {
      senderName: sender.username,
      emoji,
      id: 'rx_' + Date.now() + '_' + Math.random().toString(36).substring(2, 5),
    });
  });

  // 10. Live Profile & Avatar Update
  socket.on('player:profile_update', ({ player }: { player: { id: string; username: string; avatar: string; color?: string } }) => {
    if (!player || !player.id) return;

    // Update in current active room
    if (currentRoomId) {
      const room = ROOMS.get(currentRoomId);
      if (room) {
        const p = room.state.players.find(pl => pl.id === player.id);
        if (p) {
          p.username = player.username || p.username;
          p.avatar = player.avatar || p.avatar;
          if (player.color) p.color = player.color;
          io.to(room.id).emit('room:state', sanitizeStateForClient(room));
          saveRoomToFirestore(room).catch(() => {});
        }
      }
    }

    // Update in global leaderboard store
    const entry = GLOBAL_STORE.leaderboard.find(
      e => e.userId === player.id || e.username.toLowerCase() === (player.username || '').toLowerCase()
    );
    if (entry) {
      if (player.username) entry.username = player.username;
      if (player.avatar) entry.avatar = player.avatar;
      io.emit('leaderboard:update', GLOBAL_STORE.leaderboard);
      saveLeaderboardEntryToFirestore(entry).catch(() => {});
    }
  });

  // 11. Explicit Leave Room Handler
  socket.on('room:leave', async () => {
    if (currentRoomId && currentPlayerId) {
      const room = ROOMS.get(currentRoomId);
      if (room) {
        const pIndex = room.state.players.findIndex(p => p.id === currentPlayerId);
        if (pIndex >= 0) {
          const departingPlayer = room.state.players[pIndex];
          departingPlayer.isConnected = false;

          // If the room owner / host leaves, close the room immediately and return all players to lobby
          if (departingPlayer.isHost) {
            if (room.timerInterval) clearInterval(room.timerInterval);

            // Notify all players in room that the host left and room is dissolved
            io.to(room.id).emit('room:closed', {
              reason: `👑 Room host ${departingPlayer.username || 'Host'} left. The room has been closed.`,
              hostName: departingPlayer.username || 'Host',
            });

            // Disband sockets from room
            io.in(room.id).socketsLeave(room.id);

            // Delete room completely
            ROOMS.delete(room.id);
            await deleteRoomFromFirestore(room.id).catch(() => {});
            broadcastPublicRoomsList();
            socket.leave(currentRoomId);
            currentRoomId = null;
            return;
          }

          if (room.state.drawerId === departingPlayer.id && room.state.status === 'drawing') {
            if (room.timerInterval) clearInterval(room.timerInterval);
            endTurnCycle(room, 'Drawer left the game.');
          }

          io.to(room.id).emit('chat:message', {
            id: 'sys_' + Date.now(),
            senderName: 'System',
            text: `🚪 ${departingPlayer.username} left the room.`,
            type: 'system',
            timestamp: Date.now(),
          });

          // Remove room if no active players
          const activeCount = room.state.players.filter(p => p.isConnected).length;
          if (activeCount === 0) {
            if (room.timerInterval) clearInterval(room.timerInterval);
            ROOMS.delete(room.id);
            await deleteRoomFromFirestore(room.id).catch(() => {});
          } else {
            io.to(room.id).emit('room:state', sanitizeStateForClient(room));
            await saveRoomToFirestore(room).catch(() => {});
          }
          broadcastPublicRoomsList();
        }
        socket.leave(currentRoomId);
        currentRoomId = null;
      }
    }
  });

  // 12. Disconnect Handler
  socket.on('disconnect', async () => {
    if (currentRoomId && currentPlayerId) {
      const room = ROOMS.get(currentRoomId);
      if (room) {
        const pIndex = room.state.players.findIndex(p => p.id === currentPlayerId);
        if (pIndex >= 0) {
          const departingPlayer = room.state.players[pIndex];
          departingPlayer.isConnected = false;

          // If the room owner / host disconnected, close the room immediately and kick players to lobby
          if (departingPlayer.isHost) {
            if (room.timerInterval) clearInterval(room.timerInterval);

            // Notify all players in room that the host disconnected and room is dissolved
            io.to(room.id).emit('room:closed', {
              reason: `👑 Room host ${departingPlayer.username || 'Host'} disconnected. The room has been closed.`,
              hostName: departingPlayer.username || 'Host',
            });

            // Disband sockets from room
            io.in(room.id).socketsLeave(room.id);

            // Delete room completely
            ROOMS.delete(room.id);
            await deleteRoomFromFirestore(room.id).catch(() => {});
            broadcastPublicRoomsList();
            return;
          }

          // If was drawer in active turn, skip turn
          if (room.state.drawerId === departingPlayer.id && room.state.status === 'drawing') {
            if (room.timerInterval) clearInterval(room.timerInterval);
            endTurnCycle(room, 'Drawer left the game.');
          }

          io.to(room.id).emit('chat:message', {
            id: 'sys_' + Date.now(),
            senderName: 'System',
            text: `🚪 ${departingPlayer.username} left the room.`,
            type: 'system',
            timestamp: Date.now(),
          });

          // Clean empty rooms
          const activeCount = room.state.players.filter(p => p.isConnected).length;
          if (activeCount === 0) {
            if (room.timerInterval) clearInterval(room.timerInterval);
            ROOMS.delete(room.id);
            await deleteRoomFromFirestore(room.id).catch(() => {});
          } else {
            io.to(room.id).emit('room:state', sanitizeStateForClient(room));
            await saveRoomToFirestore(room).catch(() => {});
          }
          broadcastPublicRoomsList();
        }
      }
    }
  });
});

// Broadcast Helper
function broadcastPublicRoomsList() {
  io.emit('rooms:list', getPublicRoomsList());
}

// Game Turn & Round Engine (drawing mode)
function startTurnCycle(room: ServerRoom) {
  if (room.timerInterval) clearInterval(room.timerInterval);

  const activePlayers = room.state.players.filter(p => p.isConnected);
  if (activePlayers.length < 2) {
    room.state.status = 'lobby';
    io.to(room.id).emit('room:state', sanitizeStateForClient(room));
    io.to(room.id).emit('chat:message', {
      id: 'sys_' + Date.now(),
      senderName: 'System',
      text: '⚠️ Not enough players to continue. Returning to lobby.',
      type: 'system',
      timestamp: Date.now(),
    });
    saveRoomToFirestore(room).catch(() => {});
    return;
  }

  // Pick Drawer
  if (room.drawerIndex >= activePlayers.length) {
    room.drawerIndex = 0;
    room.state.currentRound += 1;
  }

  // Check Game Over
  if (room.state.currentRound > room.state.totalRounds) {
    handleGameOver(room);
    return;
  }

  const drawer = activePlayers[room.drawerIndex];
  room.state.drawerId = drawer.id;
  room.state.drawerName = drawer.username;

  // Reset player turn statuses
  room.state.players.forEach(p => {
    p.isDrawing = p.id === drawer.id;
    p.hasGuessed = false;
    p.roundScore = 0;
  });

  room.playersWhoGuessed.clear();
  room.drawingHistory = [];
  room.wordSelected = false;

  // Generate 3 word choices
  const choices = getRandomWordChoices(room.settings.wordCategory);
  room.state.wordChoices = choices;
  room.state.status = 'selecting_word';
  room.state.timeLeft = 12; // 12 seconds to choose a word
  room.state.totalTime = 12;
  room.state.word = '';
  room.state.hint = '';
  room.state.revealedIndices = [];

  io.to(room.id).emit('canvas:clear');
  io.to(room.id).emit('room:state', sanitizeStateForClient(room));

  // Drawer notification
  const drawerSocket = io.sockets.sockets.get(drawer.socketId || '');
  if (drawerSocket) {
    drawerSocket.emit('drawer:turn_start', { choices });
  }

  io.to(room.id).emit('chat:message', {
    id: 'turn_' + Date.now(),
    senderName: 'Game Master',
    text: `🎨 Round ${room.state.currentRound}/${room.state.totalRounds}: ${drawer.username} is choosing a word!`,
    type: 'drawer_turn',
    timestamp: Date.now(),
  });

  // Timer for word selection
  room.timerInterval = setInterval(() => {
    room.state.timeLeft -= 1;
    if (room.state.timeLeft <= 0) {
      if (room.timerInterval) clearInterval(room.timerInterval);
      if (!room.wordSelected) {
        // Auto-select medium choice
        const autoChoice = choices[1] || choices[0];
        room.currentTurnWord = autoChoice.word;
        room.currentWordPoints = autoChoice.points;
        room.wordSelected = true;
        room.state.word = autoChoice.word;
        room.state.wordLength = autoChoice.word.length;
        room.state.hint = autoChoice.hint || '';
        beginDrawingPhase(room);
      }
    } else {
      io.to(room.id).emit('room:timer', { timeLeft: room.state.timeLeft });
    }
  }, 1000);
}

function beginDrawingPhase(room: ServerRoom) {
  if (room.timerInterval) clearInterval(room.timerInterval);

  room.state.status = 'drawing';
  room.state.timeLeft = room.settings.roundDuration;
  room.state.totalTime = room.settings.roundDuration;
  room.state.revealedIndices = [];

  const drawer = room.state.players.find(p => p.id === room.state.drawerId);

  io.to(room.id).emit('room:state', sanitizeStateForClient(room));

  // Bot simulation only when explicitly enabled
  triggerBotSimulationIfNeeded(room);

  // Interval for drawing turn
  room.timerInterval = setInterval(() => {
    room.state.timeLeft -= 1;

    // Hint letter reveal calculation
    if (room.settings.allowHints && room.state.wordLength > 3) {
      const timeRemainingPercent = room.state.timeLeft / room.state.totalTime;
      if (timeRemainingPercent <= 0.5 && room.state.revealedIndices.length === 0) {
        const availableIndices = room.currentTurnWord
          .split('')
          .map((c, i) => (c !== ' ' ? i : -1))
          .filter(i => i >= 0);
        if (availableIndices.length > 0) {
          const randomIndex = availableIndices[Math.floor(Math.random() * availableIndices.length)];
          room.state.revealedIndices.push(randomIndex);
          io.to(room.id).emit('room:hint_update', {
            revealedIndices: room.state.revealedIndices,
            maskedHint: getMaskedHint(room.currentTurnWord, room.state.revealedIndices),
          });
        }
      } else if (timeRemainingPercent <= 0.25 && room.state.revealedIndices.length === 1 && room.state.wordLength >= 6) {
        const availableIndices = room.currentTurnWord
          .split('')
          .map((c, i) => (c !== ' ' && !room.state.revealedIndices.includes(i) ? i : -1))
          .filter(i => i >= 0);
        if (availableIndices.length > 0) {
          const randomIndex = availableIndices[Math.floor(Math.random() * availableIndices.length)];
          room.state.revealedIndices.push(randomIndex);
          io.to(room.id).emit('room:hint_update', {
            revealedIndices: room.state.revealedIndices,
            maskedHint: getMaskedHint(room.currentTurnWord, room.state.revealedIndices),
          });
        }
      }
    }

    if (room.state.timeLeft <= 0) {
      if (room.timerInterval) clearInterval(room.timerInterval);
      endTurnCycle(room, `Time is up! The word was "${room.currentTurnWord}"`);
    } else {
      io.to(room.id).emit('room:timer', { timeLeft: room.state.timeLeft });
    }
  }, 1000);
}

function triggerBotSimulationIfNeeded(room: ServerRoom) {
  // Don't simulate bots unless the room explicitly enabled them
  if (!room.settings.botPlayersEnabled) return;

  const bots = room.state.players.filter(p => typeof p.id === 'string' && p.id.startsWith('bot_'));
  if (bots.length === 0) return;

  bots.forEach(bot => {
    if (bot.id === room.state.drawerId) {
      // Bot is drawing: emit some sample doodles
      setTimeout(() => {
        if (room.state.status === 'drawing' && room.state.drawerId === bot.id) {
          const samplePoints = [
            { x: 300, y: 300 },
            { x: 400, y: 320 },
            { x: 500, y: 300 },
            { x: 450, y: 500 },
            { x: 350, y: 500 },
            { x: 300, y: 300 },
          ];
          const strokeAction: CanvasAction = {
            id: 'bot_stroke_' + Date.now(),
            type: 'stroke',
            color: '#3B82F6',
            size: 4,
            points: samplePoints,
          };
          room.drawingHistory.push(strokeAction);
          io.to(room.id).emit('draw:action', strokeAction);
        }
      }, 2000);
    } else {
      // Bot is guessing: simulate guess after realistic delay
      const guessDelay = (Math.floor(Math.random() * 15) + 8) * 1000;
      setTimeout(() => {
        if (room.state.status === 'drawing' && !room.playersWhoGuessed.has(bot.id)) {
          room.playersWhoGuessed.add(bot.id);
          bot.hasGuessed = true;
          const score = Math.round(room.currentWordPoints * 0.7);
          bot.score += score;
          bot.roundScore = score;
          io.to(room.id).emit('chat:message', {
            id: 'bot_guess_' + Date.now(),
            senderName: bot.username,
            senderAvatar: bot.avatar,
            text: `🎉 ${bot.username} guessed the word! (+${score} pts)`,
            type: 'correct_guess',
            timestamp: Date.now(),
            pointsAwarded: score,
          });
          io.to(room.id).emit('room:state', sanitizeStateForClient(room));
        }
      }, guessDelay);
    }
  });
}

function endTurnCycle(room: ServerRoom, reason: string) {
  if (room.timerInterval) clearInterval(room.timerInterval);

  room.state.status = 'round_end';
  const drawer = room.state.players.find(p => p.id === room.state.drawerId);

  // Calculate drawer bonus (points for each player who guessed)
  const guesserCount = room.playersWhoGuessed.size;
  const nonDrawingCount = Math.max(1, room.state.players.filter(p => p.id !== room.state.drawerId && p.isConnected).length);
  let drawerBonus = 0;

  if (drawer && guesserCount > 0) {
    const guessRatio = guesserCount / nonDrawingCount;
    drawerBonus = Math.round(room.currentWordPoints * 0.6 * guessRatio);
    drawer.score += drawerBonus;
    drawer.roundScore = drawerBonus;
    if (drawer.stats) drawer.stats.drawingsCompleted += 1;
  }

  // Build round summary
  const correctGuessers = room.state.players
    .filter(p => room.playersWhoGuessed.has(p.id))
    .map(p => ({
      playerId: p.id,
      name: p.username,
      scoreGained: p.roundScore,
      time: p.guessTime || 0,
    }));

  room.state.roundSummary = {
    word: room.currentTurnWord,
    drawerBonus,
    correctGuessers,
  };

  io.to(room.id).emit('chat:message', {
    id: 'reveal_' + Date.now(),
    senderName: 'Game Master',
    text: `✨ Word revealed: "${room.currentTurnWord}"! ${reason}`,
    type: 'word_reveal',
    timestamp: Date.now(),
  });

  io.to(room.id).emit('room:state', sanitizeStateForClient(room));

  // Save room snapshot and activity
  saveRoomToFirestore(room).catch(() => {});
  saveActivityToFirestore({ type: 'round_end', roomId: room.id, reason }).catch(() => {});

  // Advance drawer index
  room.drawerIndex += 1;

  // 6 seconds delay before next turn
  setTimeout(() => {
    if (ROOMS.has(room.id)) {
      startTurnCycle(room);
    }
  }, 6000);
}

function handleGameOver(room: ServerRoom) {
  if (room.timerInterval) clearInterval(room.timerInterval);

  room.state.status = 'game_over';

  // Sort players by score
  const sortedPlayers = [...room.state.players].sort((a, b) => b.score - a.score);
  const winner = sortedPlayers[0] || null;
  room.state.winner = winner;

  // Update global leaderboard and player lifetime stats
  sortedPlayers.forEach((player, idx) => {
    const isWinner = idx === 0 && player.score > 0;
    updateGlobalLeaderboard(player, isWinner);
  });

  io.to(room.id).emit('chat:message', {
    id: 'gameover_' + Date.now(),
    senderName: 'Game Master',
    text: `🏆 GAME OVER! 🥇 Winner: ${winner?.username} with ${winner?.score} points!`,
    type: 'system',
    timestamp: Date.now(),
  });

  io.to(room.id).emit('room:state', sanitizeStateForClient(room));

  // Save final room (and optionally archive)
  saveRoomToFirestore(room).catch(() => {});
  saveActivityToFirestore({ type: 'game_over', roomId: room.id, winner: winner?.id }).catch(() => {});
}

// Sanitize State: Mask secret word for guessers during drawing phase
function sanitizeStateForClient(room: ServerRoom): GameState {
  const isDrawing = room.state.status === 'drawing';
  const maskedWord = isDrawing
    ? getMaskedHint(room.currentTurnWord, room.state.revealedIndices)
    : room.currentTurnWord;

  return {
    ...room.state,
    word: maskedWord,
  };
}

/**
 * UNO stub: put room in UNO state (not a full engine yet).
 * Replace with a full implementation when ready.
 */
function startUnoGame(room: ServerRoom) {
  if (room.timerInterval) clearInterval(room.timerInterval);

  room.state.status = 'drawing';
  // UNO doesn't use drawing state/word; clear to avoid confusion
  room.drawingHistory = [];
  room.currentTurnWord = '';
  room.currentWordPoints = 0;
  room.wordSelected = false;
  // Broadcast UNO state
  io.to(room.id).emit('room:state', sanitizeStateForClient(room));
  io.to(room.id).emit('chat:message', {
    id: 'uno_' + Date.now(),
    senderName: 'Game Master',
    text: `🃏 UNO lobby ready. (This is a server stub — full UNO engine not implemented yet.)`,
    type: 'system',
    timestamp: Date.now(),
  });

  // Save room snapshot and activity (best-effort)
  saveRoomToFirestore(room).catch(() => {});
  saveActivityToFirestore({ type: 'uno_lobby', roomId: room.id }).catch(() => {});
}

// Start Server and Vite Middleware
async function startServer() {
  const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req: Request, res: Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Guess What? Game Server running on port ${PORT}`);
  });
}

startServer();