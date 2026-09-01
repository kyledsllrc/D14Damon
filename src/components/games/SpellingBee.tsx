import React, { useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import {
  ArrowLeft,
  Brain,
  CheckCircle2,
  Clock3,
  RefreshCcw,
  Send,
  Sparkles,
  Swords,
  Trophy,
  Zap,
} from 'lucide-react';
import { isValidEnglishWord } from '../../utils/dictionary';
import { AiGameConfig } from '../VsAiArena';

interface SpellingBeeProps {
  onBackToHub: () => void;
  aiConfig?: AiGameConfig | null;
}

interface BeePuzzle {
  letters: string[];
  center: string;
  theme: string;
  validWords: string[];
}

const BEE_PUZZLES: BeePuzzle[] = [
  {
    letters: ['S', 'P', 'E', 'L', 'L', 'I', 'N', 'G'],
    center: 'E',
    theme: 'Word Builder',
    validWords: ['SPELL', 'SPILL', 'PEN', 'PEEL', 'SELL', 'SING', 'GLEE', 'PILE', 'LINE', 'LENS', 'SPINE', 'LING', 'SPEL', 'PIN', 'SLING', 'SHELL', 'SPELLED', 'INSIDE'],
  },
  {
    letters: ['C', 'A', 'R', 'E', 'T', 'L', 'O', 'N'],
    center: 'E',
    theme: 'Creative Thinking',
    validWords: ['CARE', 'CAROL', 'CART', 'COAL', 'CORE', 'CREATE', 'EAR', 'EARL', 'EARN', 'LACE', 'LENT', 'LONE', 'OCEAN', 'RACE', 'RACER', 'REACT', 'ROLE', 'TONE', 'COAT', 'CLORE'],
  },
  {
    letters: ['M', 'A', 'T', 'H', 'S', 'E', 'R', 'I'],
    center: 'E',
    theme: 'Math & Logic',
    validWords: ['MATH', 'MATE', 'MERIT', 'HEAR', 'HEART', 'SHARE', 'SMART', 'SHE', 'SHEAR', 'RAM', 'RATE', 'SEAR', 'SEAM', 'HARE', 'ITEM', 'TIME', 'THEM', 'METER'],
  },
];

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const shuffle = <T,>(items: T[]) => [...items].sort(() => Math.random() - 0.5);

const normalize = (word: string) => word.toUpperCase().replace(/[^A-Z]/g, '');

const getWordScore = (word: string) => {
  if (word.length <= 3) return 0;
  if (word.length === 4) return 1;
  return word.length;
};

const buildPuzzle = (config: BeePuzzle): BeePuzzle => ({
  ...config,
  letters: shuffle(config.letters),
});

export const SpellingBee: React.FC<SpellingBeeProps> = ({ onBackToHub, aiConfig }) => {
  const defaultPuzzle = useMemo(() => buildPuzzle(BEE_PUZZLES[Math.floor(Math.random() * BEE_PUZZLES.length)]), []);
  const [puzzle, setPuzzle] = useState<BeePuzzle>(defaultPuzzle);
  const [playerInput, setPlayerInput] = useState('');
  const [foundWords, setFoundWords] = useState<string[]>([]);
  const [score, setScore] = useState(0);
  const [aiScore, setAiScore] = useState(0);
  const [status, setStatus] = useState('Use the center letter. Words must be 4+ letters.');
  const [timeLeft, setTimeLeft] = useState(75);
  const [gameState, setGameState] = useState<'intro' | 'playing' | 'finished'>('playing');

  const validWordSet = useMemo(() => new Set(puzzle.validWords.map((w) => w.toUpperCase())), [puzzle]);

  const resetRound = () => {
    const next = buildPuzzle(BEE_PUZZLES[Math.floor(Math.random() * BEE_PUZZLES.length)]);
    setPuzzle(next);
    setPlayerInput('');
    setFoundWords([]);
    setScore(0);
    setAiScore(0);
    setTimeLeft(75);
    setGameState('playing');
    setStatus('Use the center letter. Words must be 4+ letters.');
  };

  useEffect(() => {
    if (gameState !== 'playing') return;

    const timer = window.setInterval(() => {
      setTimeLeft((current) => {
        if (current <= 1) {
          setGameState('finished');
          setStatus('Round over — score the words you found.');
          return 0;
        }
        return current - 1;
      });
    }, 1000);

    return () => window.clearInterval(timer);
  }, [gameState]);

  const submitWord = () => {
    if (gameState !== 'playing') return;

    const word = normalize(playerInput);
    if (!word) {
      setStatus('Type a word to submit.');
      return;
    }

    if (word.length < 4) {
      setStatus('Words must be at least 4 letters long.');
      return;
    }

    if (!word.includes(puzzle.center)) {
      setStatus(`The word must include the center letter: ${puzzle.center}`);
      return;
    }

    const letterCounts = new Map<string, number>();
    for (const letter of puzzle.letters) {
      letterCounts.set(letter, (letterCounts.get(letter) ?? 0) + 1);
    }

    let validLetters = true;
    const usedCounts = new Map<string, number>();
    for (const char of word) {
      const count = usedCounts.get(char) ?? 0;
      const available = letterCounts.get(char) ?? 0;
      if (count >= available) {
        validLetters = false;
        break;
      }
      usedCounts.set(char, count + 1);
    }

    if (!validLetters) {
      setStatus('That word uses letters outside the bee set.');
      return;
    }

    if (foundWords.some((entry) => entry.toUpperCase() === word)) {
      setStatus('You already found that word.');
      return;
    }

    if (!isValidEnglishWord(word) || !validWordSet.has(word)) {
      setStatus(`"${word}" is not valid for this bee. Try another word.`);
      return;
    }

    const points = getWordScore(word);
    const nextFound = [...foundWords, word];
    setFoundWords(nextFound);
    setScore((prev) => prev + points);
    setPlayerInput('');
    setStatus(`Nice! "${word}" is valid for +${points} points.`);

    if (aiConfig) {
      const aiOptions = puzzle.validWords.filter((candidate) => !nextFound.includes(candidate) && !nextFound.includes(candidate.toUpperCase()));
      const aiWord = aiOptions[Math.floor(Math.random() * Math.max(aiOptions.length, 1))] ?? puzzle.validWords[0];
      window.setTimeout(() => {
        const aiPoints = getWordScore(aiWord.toUpperCase());
        setAiScore((prev) => prev + aiPoints);
        setStatus(`AI played "${aiWord}" for +${aiPoints}.`);
      }, 500);
    }
  };

  const allWordsFound = foundWords.length >= Math.max(4, puzzle.validWords.length * 0.5);

  useEffect(() => {
    if (timeLeft === 0) {
      setGameState('finished');
    }
    if (allWordsFound && gameState === 'playing') {
      setGameState('finished');
      setStatus('Perfect run — you cleared the bee board.');
    }
  }, [allWordsFound, gameState, timeLeft]);

  const winnerText = aiConfig
    ? score === aiScore
      ? 'Draw — both sides matched the bee.'
      : score > aiScore
        ? 'You win the bee challenge!'
        : 'AI wins this round.'
    : 'Round complete';

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: 'easeOut' }}
      className="w-full max-w-5xl mx-auto space-y-4 animate-fade-in font-sans"
    >
      <div className="flex items-center justify-between gap-3 bg-[#0f172a] p-4 rounded-[28px] border border-slate-700 shadow-[0_18px_40px_rgba(15,23,42,0.35)]">
        <div className="flex items-center gap-3">
          <motion.button
            whileHover={{ scale: 1.04 }}
            whileTap={{ scale: 0.96 }}
            onClick={onBackToHub}
            className="p-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-all"
          >
            <ArrowLeft className="w-4 h-4" />
          </motion.button>

          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-black text-white">Spelling Bee</h2>
              <span className="px-2 py-0.5 text-[10px] font-black rounded-full bg-amber-500/15 text-amber-300 border border-amber-400/35">
                {aiConfig ? 'VS AI' : 'Multiplayer Ready'}
              </span>
            </div>
            <p className="text-xs text-slate-400">Create valid words from the bee letters and beat the board.</p>
          </div>
        </div>

        <div className="flex items-center gap-2 text-xs font-bold text-slate-200">
          <Clock3 className="w-4 h-4 text-cyan-300" />
          <span>{timeLeft}s</span>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_240px] gap-4">
        <div className="rounded-[28px] border border-slate-700 bg-[#0f172a] p-4 shadow-[0_16px_40px_rgba(15,23,42,0.35)]">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div className="flex gap-2">
              {puzzle.letters.map((letter) => (
                <motion.div
                  key={`${letter}-${puzzle.theme}`}
                  whileTap={{ scale: 0.96 }}
                  className={`flex h-14 w-14 items-center justify-center rounded-2xl text-2xl font-black border transition-all ${
                    letter === puzzle.center
                      ? 'border-amber-400 bg-amber-400 text-slate-900 shadow-[0_8px_18px_rgba(251,191,36,0.32)]'
                      : 'border-slate-600 bg-slate-800 text-white'
                  }`}
                >
                  {letter}
                </motion.div>
              ))}
            </div>

            <div className="rounded-2xl border border-slate-700 bg-slate-900/80 px-3 py-2 text-right">
              <div className="text-[10px] uppercase tracking-wider text-slate-400">Theme</div>
              <div className="text-sm font-black text-white">{puzzle.theme}</div>
            </div>
          </div>

          <div className="mb-4 flex items-center gap-2 rounded-2xl border border-slate-700 bg-slate-900 p-2">
            <input
              value={playerInput}
              onChange={(event) => setPlayerInput(normalize(event.target.value))}
              onKeyDown={(event) => {
                if (event.key === 'Enter') submitWord();
              }}
              placeholder="Type a valid word"
              className="flex-1 bg-transparent px-3 py-2.5 text-base text-white placeholder:text-slate-500 outline-none"
              maxLength={16}
            />
            <motion.button
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.97 }}
              onClick={submitWord}
              className="flex items-center gap-2 rounded-xl bg-amber-400 px-3 py-2.5 text-sm font-black text-slate-900 hover:bg-amber-300 transition-all"
            >
              <Send className="w-4 h-4" />
              Submit
            </motion.button>
          </div>

          <div className="rounded-2xl border border-slate-700 bg-slate-900/80 p-3 text-sm text-slate-200">
            <div className="flex items-center gap-2 font-black text-white">
              <Sparkles className="w-4 h-4 text-amber-300" />
              Match Feed
            </div>
            <p className="mt-2 text-slate-300">{status}</p>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            {foundWords.length === 0 ? (
              <div className="text-xs text-slate-400">No valid words found yet.</div>
            ) : (
              foundWords.map((word) => (
                <span
                  key={word}
                  className="rounded-full border border-emerald-400/50 bg-emerald-500/10 px-2.5 py-1 text-xs font-bold text-emerald-200"
                >
                  {word}
                </span>
              ))
            )}
          </div>
        </div>

        <div className="space-y-4 rounded-[28px] border border-slate-700 bg-[#0f172a] p-4 shadow-[0_16px_40px_rgba(15,23,42,0.35)]">
          <div className="rounded-2xl border border-emerald-500/35 bg-emerald-500/10 p-3">
            <div className="flex items-center gap-2 text-xs font-black uppercase tracking-wider text-emerald-200">
              <Trophy className="w-4 h-4" />
              Your Score
            </div>
            <div className="mt-2 text-3xl font-black text-white">{score}</div>
          </div>

          {aiConfig && (
            <div className="rounded-2xl border border-violet-500/35 bg-violet-500/10 p-3">
              <div className="flex items-center gap-2 text-xs font-black uppercase tracking-wider text-violet-200">
                <Brain className="w-4 h-4" />
                AI Score
              </div>
              <div className="mt-2 text-3xl font-black text-white">{aiScore}</div>
            </div>
          )}

          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={resetRound}
            className="flex w-full items-center justify-center gap-2 rounded-2xl bg-slate-700 px-4 py-3 text-sm font-black text-white hover:bg-slate-600 transition-all"
          >
            <RefreshCcw className="w-4 h-4" />
            New Bee
          </motion.button>

          <div className="rounded-2xl border border-slate-700 bg-slate-900/80 p-3 text-xs text-slate-300">
            <div className="flex items-center gap-2 font-black text-white">
              <Zap className="w-4 h-4 text-amber-300" />
              Rules
            </div>
            <ul className="mt-2 space-y-1.5">
              <li>• Use the center letter in every word.</li>
              <li>• Use only the letters in the bee.</li>
              <li>• Words must be 4+ letters and valid.</li>
              <li>• Longer words score more points.</li>
            </ul>
          </div>

          {gameState === 'finished' && (
            <div className="rounded-2xl border border-amber-400/35 bg-amber-500/10 p-3 text-xs text-amber-100">
              <div className="flex items-center gap-2 font-black text-white">
                <CheckCircle2 className="w-4 h-4" />
                Result
              </div>
              <p className="mt-2">{aiConfig ? winnerText : 'This round is complete.'}</p>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
};
