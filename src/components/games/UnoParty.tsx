import React, { useState, useEffect, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  ArrowLeft,
  RotateCcw,
  Sparkles,
  Trophy,
  Zap,
  HelpCircle,
  Clock,
  Flame,
  Bot,
  User,
  ShieldAlert,
  Repeat,
  Ban,
  Layers,
  ChevronRight,
  Award,
  PlusCircle,
  Volume2,
  CheckCircle2,
  AlertCircle,
  Shield,
  Swords,
  Users,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useGame } from '../../context/GameContext';
import { soundManager } from '../../utils/soundEffects';
import { AvatarRenderer } from '../AvatarRenderer';
import { AiGameConfig } from '../VsAiArena';
import { getSocket } from '../../services/socket';
import { UnoTeamMode, UnoTeam } from '../../types';

interface UnoPartyProps {
  onBackToHub: () => void;
  aiConfig?: AiGameConfig | null;
}

export type UnoColor = 'red' | 'blue' | 'green' | 'yellow' | 'wild';
export type UnoType = 'number' | 'skip' | 'reverse' | 'draw2' | 'wild' | 'wild4';

export interface UnoCard {
  id: string;
  color: UnoColor;
  type: UnoType;
  value: number | null; // 0-9
  score: number;
}

export interface UnoPlayer {
  id: string;
  name: string;
  avatar: string;
  isBot: boolean;
  cards: UnoCard[];
  color: string;
  team?: UnoTeam;
  calledUno: boolean;
}

const COLOR_MAP: Record<UnoColor, { bg: string; text: string; ring: string; border: string; label: string }> = {
  red: {
    bg: 'bg-rose-600',
    text: 'text-rose-600',
    ring: 'ring-rose-500',
    border: 'border-rose-500',
    label: 'Red',
  },
  blue: {
    bg: 'bg-blue-600',
    text: 'text-blue-600',
    ring: 'ring-blue-500',
    border: 'border-blue-500',
    label: 'Blue',
  },
  green: {
    bg: 'bg-emerald-600',
    text: 'text-emerald-600',
    ring: 'ring-emerald-500',
    border: 'border-emerald-500',
    label: 'Green',
  },
  yellow: {
    bg: 'bg-amber-500',
    text: 'text-amber-500',
    ring: 'ring-amber-400',
    border: 'border-amber-400',
    label: 'Yellow',
  },
  wild: {
    bg: 'bg-gradient-to-tr from-rose-500 via-amber-400 via-emerald-400 to-blue-500',
    text: 'text-purple-600',
    ring: 'ring-purple-500',
    border: 'border-purple-400',
    label: 'Wild',
  },
};

const BOT_ROSTER = [
  { name: 'SparkyBot', avatar: 'avatar_neon_bot', color: '#6366F1' },
  { name: 'LunaFox', avatar: 'avatar_cyber_fox', color: '#EC4899' },
  { name: 'ShadowNinja', avatar: 'avatar_shadow_ninja', color: '#F59E0B' },
  { name: 'CyberCat', avatar: 'avatar_cyber_cat', color: '#10B981' },
  { name: 'BlazeKnight', avatar: 'avatar_blaze_knight', color: '#EF4444' },
  { name: 'PixelWizard', avatar: 'avatar_pixel_wizard', color: '#8B5CF6' },
  { name: 'FrostBite', avatar: 'avatar_frost_bite', color: '#06B6D4' },
  { name: 'RoboHero', avatar: 'avatar_robo_hero', color: '#3B82F6' },
  { name: 'HyperNova', avatar: 'avatar_hyper_nova', color: '#D946EF' },
];

// Generate fresh standard 108-card UNO Deck (or doubled for large 8-10 player games)
const createDeck = (playerCount: number = 4): UnoCard[] => {
  const deck: UnoCard[] = [];
  const colors: UnoColor[] = ['red', 'blue', 'green', 'yellow'];
  const copies = playerCount >= 8 ? 2 : 1; // Double deck for 8v8 or 5v5

  for (let c = 0; c < copies; c++) {
    colors.forEach((color) => {
      // 1 Zero card
      deck.push({
        id: `${color}_0_${c}_${Math.random()}`,
        color,
        type: 'number',
        value: 0,
        score: 0,
      });

      // 2 of each 1-9
      for (let v = 1; v <= 9; v++) {
        deck.push({
          id: `${color}_${v}_a_${c}_${Math.random()}`,
          color,
          type: 'number',
          value: v,
          score: v,
        });
        deck.push({
          id: `${color}_${v}_b_${c}_${Math.random()}`,
          color,
          type: 'number',
          value: v,
          score: v,
        });
      }

      // 2 Skips, 2 Reverses, 2 Draw Twos
      for (let i = 0; i < 2; i++) {
        deck.push({
          id: `${color}_skip_${i}_${c}_${Math.random()}`,
          color,
          type: 'skip',
          value: null,
          score: 20,
        });
        deck.push({
          id: `${color}_reverse_${i}_${c}_${Math.random()}`,
          color,
          type: 'reverse',
          value: null,
          score: 20,
        });
        deck.push({
          id: `${color}_draw2_${i}_${c}_${Math.random()}`,
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
        id: `wild_${i}_${c}_${Math.random()}`,
        color: 'wild',
        type: 'wild',
        value: null,
        score: 50,
      });
      deck.push({
        id: `wild4_${i}_${c}_${Math.random()}`,
        color: 'wild',
        type: 'wild4',
        value: null,
        score: 50,
      });
    }
  }

  // Shuffle deck using Fisher-Yates
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }

  return deck;
};

export const UnoParty: React.FC<UnoPartyProps> = ({ onBackToHub, aiConfig = null }) => {
  const { user, updateStats } = useAuth();
  const { gameState: roomState } = useGame();

  // Match state
  const [gameState, setGameState] = useState<'intro' | 'playing' | 'game_over'>('intro');
  const [teamMode, setTeamMode] = useState<UnoTeamMode>('ffa');
  const [playerCount, setPlayerCount] = useState(4);
  const [players, setPlayers] = useState<UnoPlayer[]>([]);
  const [myTeam, setMyTeam] = useState<UnoTeam | null>('red');
  const [winningTeam, setWinningTeam] = useState<UnoTeam | null>(null);
  const [teamCardCounts, setTeamCardCounts] = useState<{ red: number; blue: number }>({ red: 0, blue: 0 });

  const [deck, setDeck] = useState<UnoCard[]>([]);
  const [discardPile, setDiscardPile] = useState<UnoCard[]>([]);
  const [activeColor, setActiveColor] = useState<UnoColor>('red');
  const [currentTurn, setCurrentTurn] = useState<number>(0);
  const [currentTurnPlayerId, setCurrentTurnPlayerId] = useState<string>('');
  const [direction, setDirection] = useState<1 | -1>(1); // 1 = clockwise, -1 = counter-clockwise
  const [showColorPicker, setShowColorPicker] = useState<boolean>(false);
  const [pendingWildCard, setPendingWildCard] = useState<UnoCard | null>(null);
  const [actionBanner, setActionBanner] = useState<string | null>(null);
  const [historyLog, setHistoryLog] = useState<{ text: string; color: string }[]>([]);
  const [cardsPlayedThisGame, setCardsPlayedThisGame] = useState<number>(0);
  const [drawnThisTurn, setDrawnThisTurn] = useState<boolean>(false);
  const [lastDrawnCard, setLastDrawnCard] = useState<UnoCard | null>(null);
  const [winner, setWinner] = useState<UnoPlayer | null>(null);
  const [finalScore, setFinalScore] = useState<number>(0);


  const botTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const currentTurnRef = useRef(currentTurn);

  useEffect(() => {
    currentTurnRef.current = currentTurn;
  }, [currentTurn]);

  const isMultiplayerRoom = Boolean(
    roomState?.roomId && roomState.settings?.gameMode === 'uno_party'
  );
  const localPlayerId = user?.id || 'human';

  // Initialize Game (Solo / VS AI)
  const handleStartGame = (selectedMode: UnoTeamMode = teamMode) => {
    if (isMultiplayerRoom) {
      const socket = getSocket();
      socket.emit('uno:rematch');
      return;
    }

    let resolvedCount = playerCount;
    if (selectedMode === '2v2') resolvedCount = 4;
    else if (selectedMode === '3v3') resolvedCount = 6;
    else if (selectedMode === '4v4') resolvedCount = 8;
    else if (selectedMode === '5v5') resolvedCount = 10;

    setTeamMode(selectedMode);
    setPlayerCount(resolvedCount);
    const isTeamGame = selectedMode !== 'ffa';

    const newDeck = createDeck(resolvedCount);

    // Build player roster with alternating team seating
    // Red 1 (Human) -> Blue 1 -> Red 2 -> Blue 2 -> Red 3 -> Blue 3 ...
    const initialPlayers: UnoPlayer[] = [];

    for (let i = 0; i < resolvedCount; i++) {
      const assignedTeam: UnoTeam = isTeamGame ? (i % 2 === 0 ? 'red' : 'blue') : 'red';
      if (i === 0) {
        initialPlayers.push({
          id: localPlayerId,
          name: user?.username || 'You',
          avatar: user?.avatar || 'avatar_cosmic_astro',
          isBot: false,
          cards: [],
          color: user?.color || '#6366F1',
          team: assignedTeam,
          calledUno: false,
        });
      } else {
        const botMeta = BOT_ROSTER[(i - 1) % BOT_ROSTER.length];
        initialPlayers.push({
          id: `bot_${i}`,
          name: botMeta.name,
          avatar: botMeta.avatar,
          isBot: true,
          cards: [],
          color: botMeta.color,
          team: assignedTeam,
          calledUno: false,
        });
      }
    }

    // Deal 7 cards to each player
    initialPlayers.forEach((p) => {
      p.cards = newDeck.splice(0, 7);
    });

    // Start with a non-wild4 top discard
    let topCard = newDeck.pop()!;
    while (topCard.type === 'wild4') {
      newDeck.unshift(topCard);
      topCard = newDeck.pop()!;
    }

    const startColor: UnoColor = topCard.color === 'wild' ? 'red' : topCard.color;

    setPlayers(initialPlayers);
    setMyTeam('red');
    setDeck(newDeck);
    setDiscardPile([topCard]);
    setActiveColor(startColor);
    setCurrentTurn(0);
    setCurrentTurnPlayerId(initialPlayers[0].id);
    setDirection(1);
    setDrawnThisTurn(false);
    setLastDrawnCard(null);
    setShowColorPicker(false);
    setPendingWildCard(null);
    setWinner(null);
    setWinningTeam(null);
    setFinalScore(0);
    setCardsPlayedThisGame(0);
    setHistoryLog([
      {
        text: `Match started! ${isTeamGame ? `[${selectedMode.toUpperCase()} Team Battle] ` : ''}Top: ${
          topCard.color === 'wild' ? 'Wild' : topCard.color.toUpperCase()
        } ${topCard.type === 'number' ? topCard.value : topCard.type.toUpperCase()}`,
        color: topCard.color,
      },
    ]);
    setGameState('playing');

    soundManager.playRoundStart();
  };

  // Socket listeners for server-authoritative multiplayer UNO
  useEffect(() => {
    if (!isMultiplayerRoom) return;

    const socket = getSocket();
    socket.emit('uno:get_state');

    socket.on('uno:state', (data: {
      players: { id: string; name: string; avatar: string; color: string; isBot: boolean; team?: UnoTeam | null; cardCount: number; calledUno: boolean; cards: UnoCard[] }[];
      myCards: UnoCard[];
      myTeam?: UnoTeam | null;
      teamMode?: UnoTeamMode;
      teamCardCounts?: { red: number; blue: number };
      discardPile: UnoCard[];
      topDiscard: UnoCard | null;
      activeColor: UnoColor;
      currentTurnPlayerId: string;
      direction: 1 | -1;
      deckCount: number;
      historyLog: { text: string; color: string }[];
      cardsPlayed: number;
      actionBanner: string | null;
      winner: { id: string; name: string; avatar: string } | null;
      winningTeam?: UnoTeam | null;
      finalScore: number;
      status: 'playing' | 'game_over';
    }) => {
      setPlayers(
        data.players.map((p) => ({
          id: p.id,
          name: p.name,
          avatar: p.avatar,
          color: p.color,
          isBot: p.isBot,
          team: p.team || undefined,
          calledUno: p.calledUno,
          cards:
            p.id === localPlayerId
              ? data.myCards
              : Array(p.cardCount)
                  .fill(null)
                  .map((_, i) => ({
                    id: `hidden_${p.id}_${i}`,
                    color: 'wild' as UnoColor,
                    type: 'number' as UnoType,
                    value: null,
                    score: 0,
                  })),
        }))
      );
      if (data.teamMode) setTeamMode(data.teamMode);
      if (data.myTeam) setMyTeam(data.myTeam);
      if (data.teamCardCounts) setTeamCardCounts(data.teamCardCounts);
      if (data.winningTeam) setWinningTeam(data.winningTeam);

      setDeck(
        Array(data.deckCount)
          .fill(null)
          .map((_, i) => ({
            id: `deck_${i}`,
            color: 'wild' as UnoColor,
            type: 'number' as UnoType,
            value: null,
            score: 0,
          }))
      );
      setDiscardPile(data.discardPile || []);
      setActiveColor(data.activeColor);
      setCurrentTurnPlayerId(data.currentTurnPlayerId);
      setDirection(data.direction);
      setCardsPlayedThisGame(data.cardsPlayed || 0);
      if (data.actionBanner) triggerBanner(data.actionBanner);
      if (data.historyLog) setHistoryLog(data.historyLog);
      if (data.winner) {
        setWinner({
          id: data.winner.id,
          name: data.winner.name,
          avatar: data.winner.avatar,
          color: '#6366F1',
          isBot: false,
          team: data.winningTeam || undefined,
          calledUno: false,
          cards: [],
        });
        setFinalScore(data.finalScore || 0);
      }
      setGameState(data.status);
    });

    socket.on('uno:drawn_card_result', (data: { card: UnoCard | null }) => {
      setDrawnThisTurn(true);
      if (data.card) {
        setLastDrawnCard(data.card);
        if (isCardPlayable(data.card)) {
          triggerBanner(`Drew playable ${data.card.color.toUpperCase()} card! You can play it or pass.`);
        } else {
          triggerBanner(`Drew ${data.card.color.toUpperCase()} ${data.card.value ?? data.card.type} (Cannot Play).`);
        }
      }
    });

    socket.on('uno:sound', (data: { sound: 'play' | 'draw' | 'action' | 'uno_call' | 'victory' }) => {
      if (data.sound === 'play') soundManager.playCardPlay();
      else if (data.sound === 'draw') soundManager.playCardDraw();
      else if (data.sound === 'action') soundManager.playWildPlay();
      else if (data.sound === 'uno_call') soundManager.playUnoCall();
      else if (data.sound === 'victory') soundManager.playVictory();
    });

    return () => {
      socket.off('uno:state');
      socket.off('uno:drawn_card_result');
      socket.off('uno:sound');
    };
  }, [isMultiplayerRoom, localPlayerId]);

  const topDiscard = discardPile[discardPile.length - 1];
  const isHumanTurn = isMultiplayerRoom
    ? currentTurnPlayerId === localPlayerId && gameState === 'playing'
    : players[currentTurn]?.id === localPlayerId && gameState === 'playing';

  // Check if a card is valid to play according to official UNO rules
  const isCardPlayable = (card: UnoCard): boolean => {
    if (!topDiscard) return false;
    if (card.color === 'wild') return true;
    if (card.color === activeColor) return true;
    if (topDiscard.type === 'number' && card.type === 'number' && card.value === topDiscard.value) return true;
    if (card.type !== 'number' && card.type === topDiscard.type) return true;
    return false;
  };

  const localPlayer = players.find((player) => player.id === localPlayerId);
  const otherPlayers = players.filter((player) => player.id !== localPlayerId);
  const humanCards = localPlayer?.cards || [];
  const humanPlayableCards = humanCards.filter(isCardPlayable);
  const humanHasPlayableCard = humanPlayableCards.length > 0;
  const activePlayer = isMultiplayerRoom
    ? players.find((p) => p.id === currentTurnPlayerId)
    : players[currentTurn];
  const activePlayerName = activePlayer?.name || 'Player';

  // Calculate live team card totals
  const liveTeamCards = useMemo(() => {
    if (teamMode === 'ffa') return null;
    let red = 0;
    let blue = 0;
    players.forEach((p) => {
      const cnt = p.cards.length;
      if (p.team === 'red') red += cnt;
      if (p.team === 'blue') blue += cnt;
    });
    return { red, blue };
  }, [players, teamMode]);

  // Bot Turn Automated Logic with Team Awareness (Solo / VS AI mode only)
  useEffect(() => {
    if (isMultiplayerRoom || gameState !== 'playing') return;

    const currentPlayer = players[currentTurn];
    if (!currentPlayer || !currentPlayer.isBot) return;

    botTimeoutRef.current = setTimeout(() => {
      handleBotMove(currentPlayer);
    }, 1100 + Math.random() * 500);

    return () => {
      if (botTimeoutRef.current) clearTimeout(botTimeoutRef.current);
    };
  }, [isMultiplayerRoom, currentTurn, gameState, activeColor, discardPile]);

  // Execute bot turn with real UNO rules and Team Smart Strategy
  const handleBotMove = (bot: UnoPlayer) => {
    const playableCards = bot.cards.filter(isCardPlayable);

    if (playableCards.length > 0) {
      const isTeam = teamMode !== 'ffa' && Boolean(bot.team);
      const nextPlayerIdx = getNextPlayerIndex(1, direction, currentTurnRef.current);
      const nextPlayer = players[nextPlayerIdx];
      const isNextPlayerTeammate = isTeam && nextPlayer && nextPlayer.team === bot.team;

      let chosenCard: UnoCard;

      if (isNextPlayerTeammate) {
        // Next is teammate: avoid harmful skips or draw cards if bot has normal number cards!
        const gentleCard = playableCards.find((c) => c.type === 'number');
        chosenCard = gentleCard || playableCards[0];
      } else {
        // Next is rival: aggressively hit them with skips, +2 or +4!
        const attackCard = playableCards.find((c) => c.type === 'skip' || c.type === 'draw2' || c.type === 'wild4');
        chosenCard = attackCard || playableCards.find((c) => c.type !== 'number') || playableCards[0];
      }

      if (bot.cards.length === 2) {
        bot.calledUno = true;
        soundManager.playUnoCall();
        triggerBanner(`${bot.name} called UNO!`);
      }

      if (chosenCard.color === 'wild') {
        const colorCounts: Record<UnoColor, number> = { red: 0, blue: 0, green: 0, yellow: 0, wild: 0 };
        bot.cards.forEach((c) => {
          if (c.color !== 'wild') colorCounts[c.color]++;
        });
        const bestColor = (['red', 'blue', 'green', 'yellow'] as UnoColor[]).reduce((a, b) =>
          colorCounts[a] >= colorCounts[b] ? a : b
        );
        executePlayCard(currentTurn, chosenCard, bestColor);
      } else {
        executePlayCard(currentTurn, chosenCard);
      }
    } else {
      // Bot has NO playable card -> Must draw 1 card from deck
      triggerBanner(`${bot.name} draws 1 card`);
      drawCardsForPlayer(currentTurn, 1, (newCard) => {
        if (newCard && isCardPlayable(newCard)) {
          setTimeout(() => {
            if (newCard.color === 'wild') {
              executePlayCard(currentTurn, newCard, 'blue');
            } else {
              executePlayCard(currentTurn, newCard);
            }
          }, 700);
        } else {
          setTimeout(() => {
            passTurn();
          }, 600);
        }
      });
    }
  };

  // Human plays card
  const handleHumanPlayCard = (card: UnoCard) => {
    if (!isHumanTurn || showColorPicker) return;
    if (!isCardPlayable(card)) {
      soundManager.playTick();
      return;
    }

    if (card.color === 'wild') {
      setPendingWildCard(card);
      setShowColorPicker(true);
      return;
    }

    if (isMultiplayerRoom) {
      const socket = getSocket();
      socket.emit('uno:play_card', {
        cardId: card.id,
      });
      setDrawnThisTurn(false);
      setLastDrawnCard(null);
    } else {
      executePlayCard(currentTurn, card);
    }
  };

  // Color picker confirmed for Wild
  const handleSelectWildColor = (selectedCol: UnoColor) => {
    if (!pendingWildCard) return;
    setShowColorPicker(false);

    if (isMultiplayerRoom) {
      const socket = getSocket();
      socket.emit('uno:play_card', {
        cardId: pendingWildCard.id,
        chosenWildColor: selectedCol,
      });
      setDrawnThisTurn(false);
      setLastDrawnCard(null);
    } else {
      executePlayCard(currentTurn, pendingWildCard, selectedCol);
    }
    setPendingWildCard(null);
  };

  // Core Play Card Execution (Solo / VS AI mode)
  const executePlayCard = (playerIdx: number, card: UnoCard, chosenWildColor?: UnoColor) => {
    soundManager.playCardPlay();
    setCardsPlayedThisGame((prev) => prev + 1);

    const player = players[playerIdx];
    const newCards = player.cards.filter((c) => c.id !== card.id);

    setDiscardPile((prev) => [...prev, card]);
    setPlayers((prev) =>
      prev.map((p, idx) => (idx === playerIdx ? { ...p, cards: newCards } : p))
    );

    const nextColor: UnoColor = chosenWildColor || (card.color === 'wild' ? 'red' : card.color);
    setActiveColor(nextColor);

    const cardLabel = `${card.color === 'wild' ? 'Wild' : card.color.toUpperCase()} ${
      card.type === 'number' ? card.value : card.type.toUpperCase()
    }`;
    setHistoryLog((prev) => [
      {
        text: `${player.name} played ${cardLabel}${chosenWildColor ? ` (picked ${chosenWildColor.toUpperCase()})` : ''}`,
        color: nextColor,
      },
      ...prev.slice(0, 8),
    ]);

    // Win condition check
    if (newCards.length === 0) {
      handleGameOver(player);
      return;
    }

    // Process Action Cards
    let advanceStep = 1;
    let nextDirection = direction;

    if (card.type === 'skip') {
      soundManager.playTick();
      const skippedPlayer = getNextPlayerIndex(1, nextDirection);
      triggerBanner(`${players[skippedPlayer].name} was SKIPPED!`);
      advanceStep = 2;
    } else if (card.type === 'reverse') {
      soundManager.playReverse();
      if (players.length === 2) {
        triggerBanner(`Reverse! ${player.name} plays again!`);
        advanceStep = 2;
      } else {
        nextDirection = (direction * -1) as 1 | -1;
        setDirection(nextDirection);
        triggerBanner(`Rotation REVERSED!`);
        advanceStep = 1;
      }
    } else if (card.type === 'draw2') {
      soundManager.playWildPlay();
      const victimIdx = getNextPlayerIndex(1, nextDirection);
      triggerBanner(`${players[victimIdx].name} draws +2 and is skipped!`);
      drawCardsForPlayer(victimIdx, 2);
      advanceStep = 2;
    } else if (card.type === 'wild') {
      soundManager.playWildPlay();
      triggerBanner(`Color changed to ${nextColor.toUpperCase()}!`);
    } else if (card.type === 'wild4') {
      soundManager.playWildPlay();
      const victimIdx = getNextPlayerIndex(1, nextDirection);
      triggerBanner(`WILD +4! ${players[victimIdx].name} draws 4 and is skipped!`);
      drawCardsForPlayer(victimIdx, 4);
      advanceStep = 2;
    }

    const nextPlayerIndex = getNextPlayerIndex(advanceStep, nextDirection, currentTurnRef.current);
    setDrawnThisTurn(false);
    setLastDrawnCard(null);
    setCurrentTurn(nextPlayerIndex);
  };

  const getNextPlayerIndex = (
    step: number = 1,
    dir: 1 | -1 = direction,
    baseTurn: number = currentTurnRef.current
  ): number => {
    const total = players.length;
    let next = (baseTurn + step * dir) % total;
    if (next < 0) next += total;
    return next;
  };

  // Draw cards from deck (Solo / VS AI mode)
  const drawCardsForPlayer = (
    playerIdx: number,
    count: number = 1,
    onComplete?: (drawnCard?: UnoCard) => void
  ) => {
    soundManager.playCardDraw();
    let currentDeck = [...deck];
    const drawn: UnoCard[] = [];

    for (let i = 0; i < count; i++) {
      if (currentDeck.length === 0) {
        if (discardPile.length > 1) {
          const top = discardPile[discardPile.length - 1];
          const rest = discardPile.slice(0, discardPile.length - 1);
          currentDeck = [...rest].sort(() => Math.random() - 0.5);
          setDiscardPile([top]);
        } else {
          break;
        }
      }
      const card = currentDeck.pop();
      if (card) drawn.push(card);
    }

    setDeck(currentDeck);

    setPlayers((prev) =>
      prev.map((p, idx) =>
        idx === playerIdx ? { ...p, cards: [...p.cards, ...drawn], calledUno: false } : p
      )
    );

    if (onComplete) {
      onComplete(drawn[0]);
    }
  };

  // Human Draw: Draw 1 card when you have no valid card or choose to draw
  const handleHumanDraw = () => {
    if (!isHumanTurn || drawnThisTurn) return;

    if (isMultiplayerRoom) {
      const socket = getSocket();
      socket.emit('uno:draw_card');
    } else {
      setDrawnThisTurn(true);
      const humanIdx = players.findIndex((p) => p.id === localPlayerId);
      if (humanIdx === -1) return;

      drawCardsForPlayer(humanIdx, 1, (drawnCard) => {
        if (drawnCard) {
          setLastDrawnCard(drawnCard);
          if (isCardPlayable(drawnCard)) {
            triggerBanner(`Drew playable ${drawnCard.color.toUpperCase()} card! You can play it or pass.`);
          } else {
            triggerBanner(`Drew ${drawnCard.color.toUpperCase()} ${drawnCard.value ?? drawnCard.type} (Cannot Play). Turn passes.`);
            setTimeout(() => {
              passTurn();
            }, 1200);
          }
        }
      });
    }
  };

  // Pass Turn
  const passTurn = () => {
    soundManager.playTick();
    setDrawnThisTurn(false);
    setLastDrawnCard(null);

    if (isMultiplayerRoom) {
      const socket = getSocket();
      socket.emit('uno:pass_turn');
    } else {
      const nextIdx = getNextPlayerIndex(1, direction, currentTurnRef.current);
      setCurrentTurn(nextIdx);
    }
  };

  // Human calls UNO
  const handleCallUno = () => {
    const human = players.find((player) => player.id === localPlayerId);
    if (!human) return;
    if (human.cards.length <= 2) {
      soundManager.playUnoCall();
      if (isMultiplayerRoom) {
        const socket = getSocket();
        socket.emit('uno:call_uno');
      } else {
        const humanIdx = players.findIndex((p) => p.id === localPlayerId);
        setPlayers((prev) =>
          prev.map((p, idx) => (idx === humanIdx ? { ...p, calledUno: true } : p))
        );
        triggerBanner(`YOU CALLED UNO!`);
      }
    } else {
      soundManager.playTick();
      triggerBanner(`You can only call UNO when you have 1 or 2 cards!`);
    }
  };

  // Catch any player failing to call UNO - penalty system
  const handleCatchUno = (targetPlayerId: string, targetIdx?: number) => {
    if (isMultiplayerRoom) {
      const socket = getSocket();
      socket.emit('uno:catch_uno', { targetPlayerId });
    } else if (targetIdx !== undefined) {
      const target = players[targetIdx];
      if (!target || target.cards.length !== 1 || target.calledUno) return;
      soundManager.playVictory();
      triggerBanner(`CAUGHT! ${target.name} forgot to call UNO! (+2 Penalty)`);
      drawCardsForPlayer(targetIdx, 2);
    }
  };

  const triggerBanner = (msg: string) => {
    setActionBanner(msg);
    setTimeout(() => {
      setActionBanner(null);
    }, 2500);
  };

  // Game Over handling (Supporting Team Win!)
  const handleGameOver = (winningPlayer: UnoPlayer) => {
    soundManager.playVictory();
    setWinner(winningPlayer);

    const isTeam = teamMode !== 'ffa' && Boolean(winningPlayer.team);
    const winTeam = winningPlayer.team || null;
    setWinningTeam(winTeam);

    let calculatedPoints = 0;
    if (isTeam && winTeam) {
      // Sum remaining cards of opposing team only
      players.forEach((p) => {
        if (p.team !== winTeam) {
          p.cards.forEach((c) => (calculatedPoints += c.score));
        }
      });
    } else {
      players.forEach((p) => {
        p.cards.forEach((c) => (calculatedPoints += c.score));
      });
    }

    setFinalScore(calculatedPoints);
    setGameState('game_over');

    const didHumanWin = isTeam ? winTeam === 'red' : winningPlayer.id === localPlayerId;

    if (didHumanWin) {
      updateStats(
        {
          gamesPlayed: 1,
          wins: 1,
          totalScore: calculatedPoints,
          unoWins: 1,
          unoCardsPlayed: cardsPlayedThisGame,
        },
        true
      );

    } else {
      updateStats(
        {
          gamesPlayed: 1,
          totalScore: Math.floor(calculatedPoints / 3),
          unoCardsPlayed: cardsPlayedThisGame,
        },
        false
      );
    }
  };

  // Render Card Component
  const renderCard = (
    card: UnoCard,
    isPlayable: boolean = false,
    onClick?: () => void,
    isCompact: boolean = false,
    isJustDrawn: boolean = false
  ) => {
    const colorStyle = COLOR_MAP[card.color];
    return (
      <motion.div
        key={card.id}
        whileHover={isPlayable ? { y: -16, scale: 1.08, zIndex: 30 } : {}}
        whileTap={isPlayable ? { scale: 0.95 } : {}}
        onClick={isPlayable ? onClick : undefined}
        className={`relative select-none transition-shadow rounded-2xl border-2 flex flex-col items-center justify-between p-2 shadow-lg cursor-pointer overflow-hidden ${
          isCompact ? 'w-14 h-20 text-xs' : 'w-20 sm:w-24 h-32 sm:h-36 text-sm'
        } ${colorStyle.bg} ${
          isJustDrawn && isPlayable
            ? 'ring-4 ring-amber-400 scale-105 border-white shadow-2xl shadow-amber-500/50'
            : isPlayable
            ? 'ring-4 ring-white/90 shadow-2xl shadow-indigo-500/50 cursor-pointer border-white'
            : 'border-white/30 opacity-90'
        }`}
      >
        <div className="absolute inset-0 bg-gradient-to-tr from-black/20 via-transparent to-white/20 pointer-events-none" />

        {isJustDrawn && (
          <span className="absolute top-1 right-1 px-1 py-0.5 bg-amber-400 text-slate-950 font-black text-[8px] rounded uppercase z-20 shadow">
            Drawn
          </span>
        )}

        {/* Top-Left Corner */}
        <div className="self-start font-black text-white text-xs drop-shadow-md leading-none">
          {card.type === 'number' && card.value}
          {card.type === 'skip' && '⊘'}
          {card.type === 'reverse' && '⇄'}
          {card.type === 'draw2' && '+2'}
          {card.type === 'wild' && '★'}
          {card.type === 'wild4' && '+4'}
        </div>

        {/* Center Symbol */}
        <div className="w-12 sm:w-16 h-16 sm:h-20 bg-white rounded-[50%] flex items-center justify-center shadow-inner -rotate-12 border-2 border-black/10">
          <span
            className={`font-black tracking-tighter ${
              card.color === 'wild' ? 'text-slate-900' : colorStyle.text
            } ${isCompact ? 'text-base' : 'text-2xl sm:text-3xl'}`}
          >
            {card.type === 'number' && card.value}
            {card.type === 'skip' && '⊘'}
            {card.type === 'reverse' && '⇄'}
            {card.type === 'draw2' && '+2'}
            {card.type === 'wild' && '★'}
            {card.type === 'wild4' && '+4'}
          </span>
        </div>

        {/* Bottom-Right Corner */}
        <div className="self-end font-black text-white text-xs drop-shadow-md leading-none rotate-180">
          {card.type === 'number' && card.value}
          {card.type === 'skip' && '⊘'}
          {card.type === 'reverse' && '⇄'}
          {card.type === 'draw2' && '+2'}
          {card.type === 'wild' && '★'}
          {card.type === 'wild4' && '+4'}
        </div>
      </motion.div>
    );
  };

  return (
    <div className="w-full max-w-5xl mx-auto space-y-4 animate-fade-in font-sans select-none">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 bg-white dark:bg-slate-900 p-4 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-sm">
        <button
          onClick={onBackToHub}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-bold transition-all cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Arcade Hub</span>
        </button>

        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-rose-500 via-amber-500 to-blue-500 flex items-center justify-center shadow-md text-white">
            <Layers className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-black text-slate-900 dark:text-white leading-none">
              UNO Party Showdown
            </h2>
            <span className="text-[11px] font-bold text-rose-500">
              {isMultiplayerRoom
                ? `Live Room • ${teamMode !== 'ffa' ? `${teamMode.toUpperCase()} Team Battle` : 'Free For All'}`
                : teamMode !== 'ffa'
                ? `${teamMode.toUpperCase()} Team Clash (Red 🔴 vs Blue 🔵)`
                : 'Draw-1 Rules & Party Strategy'}
            </span>
          </div>
        </div>

        {gameState === 'playing' && (
          <div className="flex items-center gap-2">
            <div
              className={`flex items-center gap-1.5 px-3 py-1 rounded-xl text-xs font-black text-white shadow-sm ${
                COLOR_MAP[activeColor].bg
              }`}
            >
              <span>Active: {activeColor.toUpperCase()}</span>
            </div>
            <div className="hidden sm:flex items-center gap-1 text-xs font-bold text-slate-400">
              <Layers className="w-3.5 h-3.5" />
              <span>Deck: {deck.length}</span>
            </div>
          </div>
        )}
      </div>

      {/* INTRO SCREEN */}
      {gameState === 'intro' && (
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 sm:p-8 text-center space-y-6 shadow-xl"
        >
          <div className="w-20 h-20 sm:w-24 sm:h-24 mx-auto rounded-3xl bg-gradient-to-tr from-rose-500 via-amber-400 to-blue-500 flex items-center justify-center shadow-2xl text-white animate-pulse">
            <Layers className="w-10 h-10 sm:w-12 sm:h-12" />
          </div>

          <div className="space-y-2 max-w-lg mx-auto">
            <h1 className="text-2xl sm:text-3xl font-black text-slate-900 dark:text-white">
              UNO Party Arena!
            </h1>
            <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400">
              Play Free-For-All or team up in epic <strong>2v2, 3v3, 4v4, or 5v5 Team Battles</strong>! When anyone on your team empties their hand, your entire team wins the match!
            </p>
          </div>

          {/* Mode Selector (FFA vs 2v2, 3v3, 4v4, 5v5) */}
          {!isMultiplayerRoom && (
            <div className="max-w-md mx-auto space-y-3">
              <label className="text-xs font-black text-slate-700 dark:text-slate-300 uppercase tracking-wider block">
                Select Battle Format & Team Mode:
              </label>

              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                {[
                  { id: 'ffa', label: 'Solo (FFA)', desc: 'Free-For-All' },
                  { id: '2v2', label: '2 vs 2', desc: '4 Players' },
                  { id: '3v3', label: '3 vs 3', desc: '6 Players' },
                  { id: '4v4', label: '4 vs 4', desc: '8 Players' },
                  { id: '5v5', label: '5 vs 5', desc: '10 Players' },
                ].map((mode) => (
                  <button
                    key={mode.id}
                    type="button"
                    onClick={() => {
                      setTeamMode(mode.id as UnoTeamMode);
                    }}
                    className={`p-2.5 rounded-2xl text-center border transition-all cursor-pointer ${
                      teamMode === mode.id
                        ? 'bg-gradient-to-r from-rose-600 to-indigo-600 text-white border-rose-500 shadow-md shadow-rose-500/20 scale-102'
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-indigo-400'
                    }`}
                  >
                    <span className="block text-xs font-black">{mode.label}</span>
                    <span className="block text-[9px] opacity-75">{mode.desc}</span>
                  </button>
                ))}
              </div>

              {/* Player count selector for FFA */}
              {teamMode === 'ffa' ? (
                <div className="space-y-1.5 pt-1">
                  <label className="text-[11px] font-bold text-slate-400 block">
                    FFA Player Count:
                  </label>
                  <div className="flex justify-center gap-2">
                    {[2, 3, 4, 6, 8].map((num) => (
                      <button
                        key={num}
                        type="button"
                        onClick={() => setPlayerCount(num)}
                        className={`px-3 py-1.5 rounded-xl text-xs font-black transition-all border cursor-pointer ${
                          playerCount === num
                            ? 'bg-rose-500 text-white border-rose-500 shadow-xs'
                            : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700'
                        }`}
                      >
                        {num} Players
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                /* Team Roster Preview */
                <div className="p-3 bg-gradient-to-r from-rose-950/30 to-blue-950/30 rounded-2xl border border-slate-200 dark:border-slate-800 flex items-center justify-around text-xs">
                  <div className="text-center">
                    <span className="px-2 py-0.5 rounded-full bg-rose-500 text-white font-black text-[10px]">
                      TEAM RED 🔴 (You & Allies)
                    </span>
                    <p className="text-[11px] text-slate-400 font-bold mt-1">
                      {teamMode === '2v2' ? '2 Players' : teamMode === '3v3' ? '3 Players' : teamMode === '4v4' ? '4 Players' : '5 Players'}
                    </p>
                  </div>
                  <Swords className="w-5 h-5 text-amber-400 animate-pulse" />
                  <div className="text-center">
                    <span className="px-2 py-0.5 rounded-full bg-blue-500 text-white font-black text-[10px]">
                      TEAM BLUE 🔵 (Rival Squad)
                    </span>
                    <p className="text-[11px] text-slate-400 font-bold mt-1">
                      {teamMode === '2v2' ? '2 Players' : teamMode === '3v3' ? '3 Players' : teamMode === '4v4' ? '4 Players' : '5 Players'}
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="grid grid-cols-3 gap-3 max-w-md mx-auto text-xs">
            <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 flex flex-col items-center">
              <PlusCircle className="w-6 h-6 text-rose-500 mb-1" />
              <p className="font-bold text-slate-800 dark:text-slate-200">Draw 1 Rule</p>
              <p className="text-[10px] text-slate-500">Draw 1 when no match</p>
            </div>
            <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 flex flex-col items-center">
              <RotateCcw className="w-6 h-6 text-amber-500 mb-1" />
              <p className="font-bold text-slate-800 dark:text-slate-200">Team Strategy</p>
              <p className="text-[10px] text-slate-500">Coordinate color changes</p>
            </div>
            <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 flex flex-col items-center">
              <Sparkles className="w-6 h-6 text-indigo-500 mb-1" />
              <p className="font-bold text-slate-800 dark:text-slate-200">Call UNO!</p>
              <p className="text-[10px] text-slate-500">Penalty if caught!</p>
            </div>
          </div>

          <button
            onClick={() => handleStartGame(teamMode)}
            className="px-8 py-4 rounded-2xl font-black text-sm text-white bg-gradient-to-r from-rose-600 via-amber-500 to-blue-600 hover:from-rose-500 hover:to-blue-500 transition-all shadow-xl shadow-rose-600/30 hover:scale-105 active:scale-95 cursor-pointer"
          >
            <span>{isMultiplayerRoom ? 'Deal Room Cards & Play!' : 'Start Match & Deal Cards!'}</span>
          </button>
        </motion.div>
      )}

      {/* ACTIVE GAME TABLE */}
      {gameState === 'playing' && (
        <div className="space-y-4">
          {/* Dual Team Score HUD (when in team mode) */}
          {teamMode !== 'ffa' && liveTeamCards && (
            <div className="grid grid-cols-2 gap-3 p-3 bg-slate-900/90 rounded-2xl border border-slate-800 shadow-md">
              {/* Red Team Banner */}
              <div className="p-2 rounded-xl bg-rose-950/60 border border-rose-800 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-full bg-rose-500 animate-pulse" />
                  <div>
                    <span className="text-xs font-black text-rose-300 block leading-tight">
                      TEAM RED 🔴 {myTeam === 'red' && '(Your Squad)'}
                    </span>
                    <span className="text-[10px] text-rose-400/80">
                      {players.filter((p) => p.team === 'red').map((p) => p.name).join(', ')}
                    </span>
                  </div>
                </div>
                <div className="text-right">
                  <span className="text-base font-black text-rose-200">{liveTeamCards.red}</span>
                  <span className="text-[9px] text-rose-400 block uppercase">cards left</span>
                </div>
              </div>

              {/* Blue Team Banner */}
              <div className="p-2 rounded-xl bg-blue-950/60 border border-blue-800 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-full bg-blue-500 animate-pulse" />
                  <div>
                    <span className="text-xs font-black text-blue-300 block leading-tight">
                      TEAM BLUE 🔵 {myTeam === 'blue' && '(Your Squad)'}
                    </span>
                    <span className="text-[10px] text-blue-400/80">
                      {players.filter((p) => p.team === 'blue').map((p) => p.name).join(', ')}
                    </span>
                  </div>
                </div>
                <div className="text-right">
                  <span className="text-base font-black text-blue-200">{liveTeamCards.blue}</span>
                  <span className="text-[9px] text-blue-400 block uppercase">cards left</span>
                </div>
              </div>
            </div>
          )}

          <div className="bg-gradient-to-b from-slate-900 via-indigo-950 to-slate-950 border-4 border-slate-800 rounded-3xl p-4 sm:p-6 shadow-2xl relative min-h-[500px] flex flex-col justify-between overflow-hidden">
            {/* Direction Spiral Flow in the table center */}
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-10">
              <motion.div
                animate={{ rotate: direction === 1 ? 360 : -360 }}
                transition={{ repeat: Infinity, duration: 18, ease: 'linear' }}
                className="w-96 h-96 rounded-full border-8 border-dashed border-white"
              />
            </div>

            {/* Action Flash Banner */}
            <AnimatePresence>
              {actionBanner && (
                <motion.div
                  initial={{ opacity: 0, y: -20, scale: 0.9 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -20, scale: 0.9 }}
                  className="absolute top-4 left-1/2 -translate-x-1/2 z-40 px-5 py-2 rounded-full bg-amber-500 text-slate-950 text-xs sm:text-sm font-black shadow-2xl shadow-amber-500/50 flex items-center gap-2 border-2 border-white"
                >
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{actionBanner}</span>
                </motion.div>
              )}
            </AnimatePresence>

            {/* TOP AREA: Other Players (Teammates & Opponents) */}
            <div className="flex items-center justify-center gap-2 z-10 flex-wrap">
              {otherPlayers.map((otherP) => {
                const isOtherTurn = isMultiplayerRoom
                  ? currentTurnPlayerId === otherP.id
                  : players[currentTurn]?.id === otherP.id;
                const isMyTeammate = teamMode !== 'ffa' && otherP.team === 'red';
                const otherIdx = players.findIndex((p) => p.id === otherP.id);

                return (
                  <div
                    key={otherP.id}
                    className={`p-2.5 rounded-2xl border transition-all flex flex-col items-center gap-1 backdrop-blur-md min-w-[105px] max-w-[130px] ${
                      isOtherTurn
                        ? 'bg-indigo-600/40 border-amber-400 ring-2 ring-amber-400/60 scale-105 shadow-lg shadow-amber-400/20'
                        : isMyTeammate
                        ? 'bg-rose-950/40 border-rose-700/80 ring-1 ring-rose-500/30'
                        : otherP.team === 'blue'
                        ? 'bg-blue-950/40 border-blue-700/80 ring-1 ring-blue-500/30'
                        : 'bg-slate-900/60 border-slate-800'
                    }`}
                  >
                    {/* Team Role Pill */}
                    {teamMode !== 'ffa' && (
                      <span
                        className={`text-[9px] font-black px-1.5 py-0.2 rounded-full uppercase ${
                          isMyTeammate
                            ? 'bg-rose-600 text-white'
                            : 'bg-blue-600 text-white'
                        }`}
                      >
                        {isMyTeammate ? '🛡️ Ally' : '⚔️ Rival'}
                      </span>
                    )}

                    <div className="flex items-center gap-1.5 w-full">
                      <div className="w-7 h-7 rounded-full overflow-hidden bg-slate-800 border border-slate-700 flex items-center justify-center shrink-0">
                        <AvatarRenderer avatar={otherP.avatar} className="w-full h-full object-cover" />
                      </div>
                      <div className="text-left min-w-0 flex-1">
                        <span className="text-[11px] font-black text-white block leading-none truncate">
                          {otherP.name}
                        </span>
                        <span className="text-[9px] text-slate-400 font-bold">
                          {otherP.cards.length} cards {otherP.calledUno && '• UNO!'}
                        </span>
                      </div>
                    </div>

                    {/* Opponent Mini Card Backs */}
                    <div className="flex -space-x-2.5 overflow-hidden py-0.5">
                      {otherP.cards.slice(0, 5).map((_, i) => (
                        <div
                          key={i}
                          className={`w-4 h-6 rounded-sm border border-white shadow-xs flex items-center justify-center text-[7px] font-black text-white ${
                            isMyTeammate ? 'bg-rose-600' : 'bg-blue-600'
                          }`}
                        >
                          U
                        </div>
                      ))}
                      {otherP.cards.length > 5 && (
                        <div className="w-4 h-6 rounded-sm bg-slate-800 border border-slate-600 flex items-center justify-center text-[7px] font-bold text-slate-300">
                          +{otherP.cards.length - 5}
                        </div>
                      )}
                    </div>

                    {otherP.cards.length === 1 && !otherP.calledUno && (
                      <button
                        type="button"
                        onClick={() => handleCatchUno(otherP.id, otherIdx)}
                        className="px-2 py-0.5 rounded-lg bg-rose-500 hover:bg-rose-600 text-white text-[9px] font-black shadow animate-pulse cursor-pointer"
                      >
                        Catch UNO!
                      </button>
                    )}
                  </div>
                );
              })}
            </div>

            {/* CENTER TABLE: Draw Pile, Discard Pile & Active Color */}
            <div className="flex items-center justify-center gap-6 sm:gap-10 my-4 z-10">
              {/* Draw Pile Deck */}
              <div className="flex flex-col items-center gap-1.5">
                <motion.button
                  whileHover={isHumanTurn && !drawnThisTurn ? { scale: 1.05 } : {}}
                  whileTap={isHumanTurn && !drawnThisTurn ? { scale: 0.95 } : {}}
                  onClick={handleHumanDraw}
                  disabled={!isHumanTurn || drawnThisTurn}
                  className={`relative w-20 sm:w-24 h-32 sm:h-36 rounded-2xl bg-gradient-to-tr from-slate-900 to-rose-700 border-2 border-white/40 shadow-2xl flex flex-col items-center justify-center text-white font-black transition-all ${
                    isHumanTurn && !drawnThisTurn && !humanHasPlayableCard
                      ? 'ring-4 ring-amber-400 cursor-pointer shadow-amber-400/50 animate-pulse'
                      : isHumanTurn && !drawnThisTurn
                      ? 'ring-2 ring-indigo-400 cursor-pointer'
                      : 'opacity-75'
                  }`}
                >
                  <div className="w-12 h-16 rounded-full bg-white text-rose-600 flex items-center justify-center text-lg -rotate-12 shadow-inner font-black">
                    UNO
                  </div>
                  <span className="text-[10px] text-white/90 font-mono mt-1">
                    {deck.length} cards
                  </span>
                </motion.button>
                <span className="text-[10px] font-bold text-slate-400 uppercase">
                  {isHumanTurn && !drawnThisTurn && !humanHasPlayableCard ? 'Click to Draw 1' : 'Draw Deck'}
                </span>
              </div>

              {/* Active Color & Direction */}
              <div className="flex flex-col items-center gap-2">
                <div
                  className={`w-16 h-16 rounded-full border-4 flex items-center justify-center shadow-lg transition-colors ${
                    COLOR_MAP[activeColor].border
                  } ${COLOR_MAP[activeColor].bg}/20`}
                >
                  <motion.div
                    animate={{ rotate: direction === 1 ? 360 : -360 }}
                    transition={{ repeat: Infinity, duration: 4, ease: 'linear' }}
                    className="text-white"
                  >
                    <RotateCcw className="w-6 h-6" />
                  </motion.div>
                </div>
                <span
                  className={`text-xs font-black uppercase px-2.5 py-0.5 rounded-full text-white ${
                    COLOR_MAP[activeColor].bg
                  }`}
                >
                  {activeColor}
                </span>
              </div>

              {/* Discard Pile */}
              <div className="flex flex-col items-center gap-1.5">
                {topDiscard && renderCard(topDiscard, false, undefined, false)}
                <span className="text-[10px] font-bold text-slate-400 uppercase">Discard</span>
              </div>
            </div>

            {/* BOTTOM AREA: Human Hand Controls */}
            <div className="space-y-3 z-10">
              {/* Status Alert: When no card matches, tell user to draw */}
              {isHumanTurn && !humanHasPlayableCard && !drawnThisTurn && (
                <div className="p-2.5 rounded-xl bg-amber-500/20 border border-amber-400/40 text-amber-300 text-xs font-bold flex items-center justify-between gap-3 animate-fade-in">
                  <div className="flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
                    <span>No card matches the current color ({activeColor.toUpperCase()}) or value! Draw 1 card from deck.</span>
                  </div>
                  <button
                    type="button"
                    onClick={handleHumanDraw}
                    className="px-3 py-1 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs shadow transition-all shrink-0 cursor-pointer"
                  >
                    Draw 1 Card
                  </button>
                </div>
              )}

              {/* Hand Status Bar & Actions */}
              <div className="flex items-center justify-between text-xs font-bold text-slate-300">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-ping" />
                  <span>
                    {isHumanTurn
                      ? drawnThisTurn
                        ? 'Card drawn! Play it or Pass Turn'
                        : humanHasPlayableCard
                        ? 'Your turn! Select a matching card'
                        : 'Your turn! Draw 1 card from deck'
                      : `${activePlayerName}'s Turn...`}
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  {/* UNO Shout Button */}
                  <motion.button
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={handleCallUno}
                    className={`px-4 py-1.5 rounded-xl font-black text-xs text-white shadow-lg transition-all cursor-pointer ${
                      localPlayer && localPlayer.cards.length <= 2 && !localPlayer.calledUno
                        ? 'bg-rose-500 ring-4 ring-amber-400 animate-bounce shadow-rose-500/50'
                        : 'bg-slate-800 hover:bg-slate-700'
                    }`}
                  >
                    Shout UNO!
                  </motion.button>

                  {/* Draw 1 Card Button */}
                  {isHumanTurn && !drawnThisTurn && (
                    <button
                      onClick={handleHumanDraw}
                      className="px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-black text-xs shadow flex items-center gap-1.5 transition-all cursor-pointer"
                    >
                      <PlusCircle className="w-3.5 h-3.5" />
                      <span>Draw 1 Card</span>
                    </button>
                  )}

                  {/* Pass Turn Button if already drawn */}
                  {isHumanTurn && drawnThisTurn && (
                    <button
                      onClick={passTurn}
                      className="px-3 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 font-black text-xs shadow flex items-center gap-1 transition-all cursor-pointer"
                    >
                      <span>Pass Turn</span>
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>

              {/* Fanned Player Cards Container */}
              <div className="flex items-center justify-center -space-x-4 sm:-space-x-6 overflow-x-auto py-4 px-2">
                {localPlayer?.cards.map((card) => {
                  const playable = isHumanTurn && isCardPlayable(card) && !showColorPicker;
                  const isDrawn = lastDrawnCard?.id === card.id;
                  return (
                    <div key={card.id} className="transition-transform">
                      {renderCard(card, playable, () => handleHumanPlayCard(card), false, isDrawn)}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* WILD COLOR PICKER MODAL */}
          <AnimatePresence>
            {showColorPicker && (
              <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md"
              >
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 text-center space-y-4 max-w-sm w-full shadow-2xl">
                  <div className="w-12 h-12 mx-auto rounded-2xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-500">
                    <Sparkles className="w-6 h-6" />
                  </div>
                  <h3 className="text-lg font-black text-slate-900 dark:text-white">
                    Pick Next Active Color:
                  </h3>

                  <div className="grid grid-cols-2 gap-3 pt-2">
                    {(['red', 'blue', 'green', 'yellow'] as UnoColor[]).map((col) => (
                      <button
                        key={col}
                        type="button"
                        onClick={() => handleSelectWildColor(col)}
                        className={`p-4 rounded-2xl text-white font-black text-base shadow-lg transition-transform hover:scale-105 active:scale-95 cursor-pointer ${COLOR_MAP[col].bg}`}
                      >
                        {COLOR_MAP[col].label}
                      </button>
                    ))}
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Recent Plays Log */}
          <div className="p-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl flex items-center gap-2 overflow-x-auto text-xs">
            <span className="font-bold text-slate-400 uppercase tracking-wider shrink-0">
              Live Feed:
            </span>
            <div className="flex items-center gap-2">
              {historyLog.map((log, idx) => (
                <span
                  key={idx}
                  className="px-2.5 py-1 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-bold whitespace-nowrap text-slate-700 dark:text-slate-300"
                >
                  {log.text}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* GAME OVER MODAL */}
      {gameState === 'game_over' && (
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-8 text-center space-y-6 shadow-xl"
        >
          <div className="w-20 h-20 mx-auto rounded-3xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-500 shadow-inner">
            <Trophy className="w-10 h-10" />
          </div>

          <div className="space-y-1">
            {teamMode !== 'ffa' ? (
              <>
                <h2 className="text-2xl font-black text-slate-900 dark:text-white">
                  {winningTeam === 'red' ? '🎉 TEAM RED WINS THE UNO CLASH!' : '💥 TEAM BLUE WINS THE MATCH!'}
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {winningTeam === 'red'
                    ? `Victory! ${winner?.name} played the final card! Your team earned +${finalScore} points!`
                    : `Team Blue triumphed this round (${winner?.name} laid the winning card). Play a rematch!`}
                </p>
              </>
            ) : (
              <>
                <h2 className="text-2xl font-black text-slate-900 dark:text-white">
                  {winner?.id === localPlayerId ? 'You Won the UNO Showdown!' : `${winner?.name} Won the Match!`}
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {winner?.id === localPlayerId
                    ? `You earned ${finalScore} points from remaining opponents' cards!`
                    : 'Good effort! Rematch to reclaim the victory!'}
                </p>
              </>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3 max-w-xs mx-auto">
            <div className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700">
              <p className="text-xl font-black text-indigo-500">{finalScore}</p>
              <p className="text-[10px] text-slate-400 uppercase font-bold">Points Awarded</p>
            </div>
            <div className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700">
              <p className="text-xl font-black text-rose-500">{cardsPlayedThisGame}</p>
              <p className="text-[10px] text-slate-400 uppercase font-bold">Cards Played</p>
            </div>
          </div>

          <div className="flex items-center justify-center gap-3">
            <button
              onClick={() => handleStartGame(teamMode)}
              className="px-6 py-3 rounded-2xl bg-rose-600 hover:bg-rose-500 text-white font-black text-xs shadow-md transition-all cursor-pointer"
            >
              Play Another Match
            </button>
            <button
              onClick={onBackToHub}
              className="px-6 py-3 rounded-2xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 font-bold text-xs transition-all cursor-pointer"
            >
              Arcade Hub
            </button>
          </div>
        </motion.div>
      )}
    </div>
  );
};
