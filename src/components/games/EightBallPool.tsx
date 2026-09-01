import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { ArrowLeft, Gauge, Play, RotateCcw, Sparkles, Trophy } from 'lucide-react';
import { AiGameConfig } from '../VsAiArena';

interface EightBallPoolProps {
  onBackToHub: () => void;
  aiConfig?: AiGameConfig | null;
}

type Ball = {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  color: string;
  label: string;
  isCue?: boolean;
  pocketed?: boolean;
};

const TABLE_WIDTH = 760;
const TABLE_HEIGHT = 420;
const POCKET_RADIUS = 18;
const POCKETS = [
  { x: 12, y: 12 },
  { x: TABLE_WIDTH / 2, y: 10 },
  { x: TABLE_WIDTH - 12, y: 12 },
  { x: 12, y: TABLE_HEIGHT - 12 },
  { x: TABLE_WIDTH / 2, y: TABLE_HEIGHT - 10 },
  { x: TABLE_WIDTH - 12, y: TABLE_HEIGHT - 12 },
];

const POOL_BALL_COLORS: Record<string, string> = {
  cue: '#f8fafc',
  solid1: '#f97316',
  solid2: '#22c55e',
  solid3: '#0ea5e9',
  solid4: '#ef4444',
  solid5: '#a855f7',
  solid6: '#facc15',
  solid7: '#f472b6',
  stripe1: '#f8fafc',
  stripe2: '#f59e0b',
  stripe3: '#34d399',
  stripe4: '#60a5fa',
  stripe5: '#f87171',
  stripe6: '#c084fc',
  stripe7: '#fbbf24',
  eight: '#0f172a',
};

const BALL_LAYOUT = [
  'solid1', 'stripe1', 'solid2', 'stripe2', 'solid3', 'stripe3', 'solid4',
  'stripe4', 'solid5', 'stripe5', 'solid6', 'stripe6', 'solid7', 'stripe7', 'eight',
];

const createRack = (): Ball[] => {
  const rack: Ball[] = [
    { id: 'cue', x: 160, y: TABLE_HEIGHT / 2, vx: 0, vy: 0, radius: 12, color: POOL_BALL_COLORS.cue, label: 'Cue', isCue: true },
  ];

  const startX = 580;
  const startY = TABLE_HEIGHT / 2;
  const gap = 14;

  BALL_LAYOUT.forEach((ballKey, index) => {
    const row = Math.floor(Math.sqrt(2 * index + 1));
    const col = index - row * (row + 1) / 2;
    const x = startX + row * gap * 0.86;
    const y = startY + (col - row / 2) * gap;

    rack.push({
      id: `ball-${ballKey}-${index}`,
      x,
      y,
      vx: 0,
      vy: 0,
      radius: 11,
      color: POOL_BALL_COLORS[ballKey],
      label: ballKey === 'eight' ? '8' : (ballKey.includes('solid') ? 'solid' : 'stripe'),
    });
  });

  return rack;
};

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

export const EightBallPool: React.FC<EightBallPoolProps> = ({ onBackToHub, aiConfig }) => {
  const [balls, setBalls] = useState<Ball[]>(() => createRack());
  const [aimAngle, setAimAngle] = useState(-Math.PI / 2);
  const [power, setPower] = useState(42);
  const [status, setStatus] = useState('Rack ready');
  const [turn, setTurn] = useState<'player' | 'ai'>('player');
  const tableRef = useRef<HTMLDivElement | null>(null);

  const cueBall = useMemo(() => balls.find((ball) => ball.isCue) ?? balls[0], [balls]);

  const resetRack = () => {
    setBalls(createRack());
    setAimAngle(-Math.PI / 2);
    setPower(42);
    setStatus('Rack reset');
    setTurn('player');
  };

  useEffect(() => {
    if (!balls.some((ball) => Math.abs(ball.vx) > 0.1 || Math.abs(ball.vy) > 0.1)) {
      return;
    }

    let frameId = 0;
    const tick = () => {
      let anyMovement = false;
      setBalls((currentBalls) => {
        const nextBalls = currentBalls.map((ball) => ({ ...ball }));

        for (let i = 0; i < nextBalls.length; i += 1) {
          const ball = nextBalls[i];
          if (ball.pocketed) continue;

          ball.x += ball.vx;
          ball.y += ball.vy;
          ball.vx *= 0.992;
          ball.vy *= 0.992;

          if (Math.abs(ball.vx) < 0.05) ball.vx = 0;
          if (Math.abs(ball.vy) < 0.05) ball.vy = 0;

          if (Math.abs(ball.vx) + Math.abs(ball.vy) > 0.05) anyMovement = true;

          if (ball.x - ball.radius <= 0 || ball.x + ball.radius >= TABLE_WIDTH) {
            ball.vx *= -0.92;
            ball.x = clamp(ball.x, ball.radius, TABLE_WIDTH - ball.radius);
          }
          if (ball.y - ball.radius <= 0 || ball.y + ball.radius >= TABLE_HEIGHT) {
            ball.vy *= -0.92;
            ball.y = clamp(ball.y, ball.radius, TABLE_HEIGHT - ball.radius);
          }

          for (const pocket of POCKETS) {
            const dx = ball.x - pocket.x;
            const dy = ball.y - pocket.y;
            if (Math.hypot(dx, dy) < POCKET_RADIUS) {
              ball.vx = 0;
              ball.vy = 0;
              ball.x = pocket.x;
              ball.y = pocket.y;
              ball.pocketed = true;
            }
          }
        }

        for (let i = 0; i < nextBalls.length; i += 1) {
          for (let j = i + 1; j < nextBalls.length; j += 1) {
            const a = nextBalls[i];
            const b = nextBalls[j];
            if (a.pocketed || b.pocketed) continue;

            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const dist = Math.hypot(dx, dy) || 0.0001;
            const minDist = a.radius + b.radius;

            if (dist < minDist) {
              const nx = dx / dist;
              const ny = dy / dist;
              const overlap = minDist - dist;
              a.x -= nx * overlap * 0.5;
              a.y -= ny * overlap * 0.5;
              b.x += nx * overlap * 0.5;
              b.y += ny * overlap * 0.5;

              const relativeVx = b.vx - a.vx;
              const relativeVy = b.vy - a.vy;
              const velocityAlongNormal = relativeVx * nx + relativeVy * ny;

              if (velocityAlongNormal < 0) {
                const impulse = -velocityAlongNormal * 0.9;
                a.vx -= impulse * nx;
                a.vy -= impulse * ny;
                b.vx += impulse * nx;
                b.vy += impulse * ny;
              }
            }
          }
        }

        return nextBalls;
      });

      if (anyMovement) {
        frameId = window.requestAnimationFrame(tick);
      }
    };

    frameId = window.requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
  }, [balls]);

  const handleAimMove = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!tableRef.current || !cueBall) return;
    const rect = tableRef.current.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * TABLE_WIDTH;
    const y = ((event.clientY - rect.top) / rect.height) * TABLE_HEIGHT;
    const dx = x - cueBall.x;
    const dy = y - cueBall.y;
    const angle = Math.atan2(dy, dx);
    setAimAngle(angle + Math.PI);
  };

  const shootCueBall = () => {
    if (!cueBall) return;
    if (balls.some((ball) => Math.abs(ball.vx) > 0.1 || Math.abs(ball.vy) > 0.1)) {
      return;
    }

    const force = power * 0.28;
    const dx = Math.cos(aimAngle) * force;
    const dy = Math.sin(aimAngle) * force;

    setBalls((currentBalls) =>
      currentBalls.map((ball) =>
        ball.isCue
          ? { ...ball, vx: dx, vy: dy }
          : { ...ball }
      )
    );

    setStatus('Shot taken — watch the rack');
    setTurn((prev) => (prev === 'player' && aiConfig ? 'ai' : 'player'));
  };

  const aiTurn = () => {
    if (!aiConfig) return;
    if (turn !== 'ai') return;

    const target = Math.max(18, 110 - power);
    setPower((prev) => clamp(prev + 8, 10, 100));
    setBalls((currentBalls) =>
      currentBalls.map((ball) =>
        ball.isCue
          ? { ...ball, vx: (Math.random() - 0.2) * target * 0.18, vy: (Math.random() - 0.1) * target * 0.18 }
          : { ...ball }
      )
    );
    setStatus('AI break shot');
    setTurn('player');
  };

  useEffect(() => {
    if (turn === 'ai' && aiConfig) {
      const timeout = window.setTimeout(aiTurn, 600);
      return () => window.clearTimeout(timeout);
    }
  }, [turn, aiConfig]);

  return (
    <div className="w-full max-w-6xl mx-auto space-y-4 animate-fade-in font-sans">
      <div className="flex flex-wrap items-center justify-between gap-3 bg-white dark:bg-slate-900 p-4 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-sm">
        <div className="flex items-center gap-3">
          <button
            onClick={onBackToHub}
            className="p-2 rounded-xl text-slate-500 hover:text-slate-900 dark:hover:text-white bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-xs font-bold transition-all"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-black text-slate-900 dark:text-white">8 Ball Pool</h2>
              <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                {aiConfig ? 'VS AI' : 'Local Match'}
              </span>
            </div>
            <p className="text-xs text-slate-500">Power the cue, line up the shot, and break the rack with motion-rich pool physics.</p>
          </div>
        </div>

        <div className="flex items-center gap-2 text-xs font-bold text-slate-600 dark:text-slate-300">
          <Gauge className="w-4 h-4 text-cyan-500" />
          <span>{status}</span>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_260px] gap-4">
        <div className="relative overflow-hidden rounded-[28px] border border-emerald-200 dark:border-emerald-900 bg-gradient-to-b from-emerald-700 via-emerald-800 to-emerald-900 shadow-2xl p-3">
          <div
            ref={tableRef}
            className="relative mx-auto overflow-hidden rounded-[22px] border-4 border-emerald-200/70 bg-[radial-gradient(circle_at_center,_rgba(16,185,129,0.4),_rgba(5,150,105,0.9))] shadow-inner"
            style={{ width: '100%', maxWidth: 760, height: 420 }}
            onMouseMove={handleAimMove}
            onClick={handleAimMove}
          >
            {[...Array(6)].map((_, index) => {
              const pocket = POCKETS[index];
              return (
                <div
                  key={`pocket-${index}`}
                  className="absolute rounded-full bg-slate-950/80 border-2 border-slate-700"
                  style={{ left: pocket.x - 15, top: pocket.y - 15, width: 30, height: 30 }}
                />
              );
            })}

            <div className="absolute inset-4 border border-white/15 rounded-[18px]" />
            <div className="absolute inset-10 border border-white/10 rounded-[16px]" />

            {balls.map((ball) => (
              <motion.div
                key={ball.id}
                animate={{
                  x: ball.x - ball.radius,
                  y: ball.y - ball.radius,
                  scale: ball.pocketed ? 0.75 : 1,
                  opacity: ball.pocketed ? 0.2 : 1,
                }}
                transition={{ type: 'spring', stiffness: 160, damping: 18 }}
                className="absolute rounded-full border-2 border-slate-900/60 shadow-md"
                style={{
                  width: ball.radius * 2,
                  height: ball.radius * 2,
                  background: ball.color,
                  boxShadow: ball.color === '#f8fafc' ? 'inset -2px -2px 0 rgba(15,23,42,0.2), 0 0 12px rgba(255,255,255,0.18)' : 'inset -3px -3px 0 rgba(15,23,42,0.2)',
                  left: 0,
                  top: 0,
                }}
              >
                {ball.label !== 'Cue' && (
                  <div className="flex h-full items-center justify-center text-[10px] font-black text-slate-900">
                    {ball.label === 'eight' ? '8' : (ball.label === 'stripe' ? '•' : '■')}
                  </div>
                )}
              </motion.div>
            ))}

            {cueBall && (
              <div
                className="absolute pointer-events-none"
                style={{
                  left: cueBall.x,
                  top: cueBall.y,
                  width: 220,
                  height: 4,
                  transform: `rotate(${(aimAngle * 180) / Math.PI}deg)`,
                  transformOrigin: '0 50%',
                }}
              >
                <div className="h-full w-full rounded-full bg-white/75 shadow-[0_0_18px_rgba(255,255,255,0.7)]" />
              </div>
            )}
          </div>
        </div>

        <div className="space-y-4 rounded-[28px] border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-sm">
          <div className="space-y-3">
            <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              <span>Power</span>
              <span>{power}%</span>
            </div>
            <input
              type="range"
              min={10}
              max={100}
              value={power}
              onChange={(event) => setPower(Number(event.target.value))}
              className="w-full accent-emerald-500"
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={shootCueBall}
              className="flex items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-3 py-3 text-sm font-black text-white shadow-lg shadow-emerald-600/30 hover:bg-emerald-500 transition-all"
            >
              <Play className="w-4 h-4" />
              Shoot
            </button>
            <button
              onClick={resetRack}
              className="flex items-center justify-center gap-2 rounded-2xl bg-slate-200 dark:bg-slate-800 px-3 py-3 text-sm font-black text-slate-800 dark:text-slate-100 hover:bg-slate-300 dark:hover:bg-slate-700 transition-all"
            >
              <RotateCcw className="w-4 h-4" />
              Reset
            </button>
          </div>

          <div className="rounded-2xl bg-slate-100 dark:bg-slate-800 p-3 text-xs text-slate-600 dark:text-slate-300">
            <div className="flex items-center gap-2 font-bold text-slate-800 dark:text-slate-100">
              <Sparkles className="w-4 h-4 text-amber-500" />
              Match Notes
            </div>
            <ul className="mt-2 space-y-1.5">
              <li>• Aim via the cue line and click on the table.</li>
              <li>• Higher power adds more cue-ball speed.</li>
              <li>• Pocketed balls fade out and the rack settles naturally.</li>
            </ul>
          </div>

          <div className="rounded-2xl bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 p-3 text-xs text-emerald-700 dark:text-emerald-300">
            <div className="flex items-center gap-2 font-black">
              <Trophy className="w-4 h-4" />
              Focus
            </div>
            <p className="mt-2">This version keeps the real table feel with smooth motion, pocket detection, and reactive ball collisions.</p>
          </div>
        </div>
      </div>
    </div>
  );
};
