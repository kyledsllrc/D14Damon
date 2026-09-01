import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { ArrowLeft, Gauge, Play, RotateCcw, Sparkles, Trophy, Target, Zap } from 'lucide-react';
import { AiGameConfig } from '../VsAiArena';

interface EightBallPoolProps {
  onBackToHub: () => void;
  aiConfig?: AiGameConfig | null;
}

type BallType = 'cue' | 'solid' | 'stripe' | 'eight';

type Ball = {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  color: string;
  label: string;
  type: BallType;
  isCue?: boolean;
  pocketed?: boolean;
};

const TABLE_WIDTH = 820;
const TABLE_HEIGHT = 430;
const POCKET_RADIUS = 20;
const BAULK = 18;
const POCKETS = [
  { x: 14, y: 14 },
  { x: TABLE_WIDTH / 2, y: 12 },
  { x: TABLE_WIDTH - 14, y: 14 },
  { x: 14, y: TABLE_HEIGHT - 14 },
  { x: TABLE_WIDTH / 2, y: TABLE_HEIGHT - 12 },
  { x: TABLE_WIDTH - 14, y: TABLE_HEIGHT - 14 },
];

const BALL_COLORS: Record<BallType, string> = {
  cue: '#f8fafc',
  solid: '#f97316',
  stripe: '#ffffff',
  eight: '#0f172a',
};

const STRIPE_COLORS = ['#f59e0b', '#22c55e', '#38bdf8', '#ef4444', '#a855f7', '#facc15', '#f472b6'];

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const createRack = (): Ball[] => {
  const rack: Ball[] = [
    {
      id: 'cue',
      x: 170,
      y: TABLE_HEIGHT / 2,
      vx: 0,
      vy: 0,
      radius: 12,
      color: BALL_COLORS.cue,
      label: 'Cue',
      type: 'cue',
      isCue: true,
    },
  ];

  const rackTypes: BallType[] = [
    'solid', 'stripe', 'solid', 'stripe', 'solid', 'stripe', 'solid',
    'stripe', 'solid', 'stripe', 'solid', 'stripe', 'solid', 'stripe', 'eight',
  ];

  const startX = 610;
  const startY = TABLE_HEIGHT / 2;
  const deltaX = 14.5;
  const deltaY = 15.5;

  let index = 0;
  for (let row = 0; row < 5; row += 1) {
    const count = row + 1;
    for (let col = 0; col < count; col += 1) {
      const type = rackTypes[index] || 'solid';
      const x = startX + row * deltaX;
      const y = startY + (col - row / 2) * deltaY;
      rack.push({
        id: `ball-${index + 1}`,
        x,
        y,
        vx: 0,
        vy: 0,
        radius: 12,
        color: type === 'eight' ? BALL_COLORS.eight : type === 'stripe' ? STRIPE_COLORS[index % STRIPE_COLORS.length] : BALL_COLORS.solid,
        label: type === 'eight' ? '8' : type === 'stripe' ? 'Str' : 'Sol',
        type,
      });
      index += 1;
    }
  }

  return rack;
};

export const EightBallPool: React.FC<EightBallPoolProps> = ({ onBackToHub, aiConfig }) => {
  const [balls, setBalls] = useState<Ball[]>(() => createRack());
  const [aimAngle, setAimAngle] = useState(-Math.PI / 2);
  const [power, setPower] = useState(58);
  const [status, setStatus] = useState('Rack set');
  const [turn, setTurn] = useState<'player' | 'ai'>('player');
  const [isAnimating, setIsAnimating] = useState(false);
  const tableRef = useRef<HTMLDivElement | null>(null);

  const cueBall = useMemo(() => balls.find((ball) => ball.isCue) ?? balls[0], [balls]);

  const resetRack = () => {
    setBalls(createRack());
    setAimAngle(-Math.PI / 2);
    setPower(58);
    setStatus('Rack set');
    setTurn('player');
    setIsAnimating(false);
  };

  useEffect(() => {
    if (!balls.some((ball) => Math.abs(ball.vx) > 0.15 || Math.abs(ball.vy) > 0.15) || !isAnimating) {
      return;
    }

    let animationFrame = 0;
    const tick = () => {
      let movementDetected = false;
      setBalls((currentBalls) => {
        const nextBalls = currentBalls.map((ball) => ({ ...ball }));

        for (let i = 0; i < nextBalls.length; i += 1) {
          const ball = nextBalls[i];
          if (ball.pocketed) continue;

          ball.x += ball.vx;
          ball.y += ball.vy;
          ball.vx *= 0.992;
          ball.vy *= 0.992;

          if (Math.abs(ball.vx) < 0.04) ball.vx = 0;
          if (Math.abs(ball.vy) < 0.04) ball.vy = 0;

          if (Math.abs(ball.vx) + Math.abs(ball.vy) > 0.04) {
            movementDetected = true;
          }

          if (ball.x - ball.radius < BAULK || ball.x + ball.radius > TABLE_WIDTH - BAULK) {
            ball.vx *= -0.93;
            ball.x = clamp(ball.x, ball.radius + BAULK, TABLE_WIDTH - ball.radius - BAULK);
          }

          if (ball.y - ball.radius < BAULK || ball.y + ball.radius > TABLE_HEIGHT - BAULK) {
            ball.vy *= -0.93;
            ball.y = clamp(ball.y, ball.radius + BAULK, TABLE_HEIGHT - ball.radius - BAULK);
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
            const distance = Math.hypot(dx, dy) || 0.0001;
            const minDistance = a.radius + b.radius;

            if (distance < minDistance) {
              const nx = dx / distance;
              const ny = dy / distance;
              const overlap = minDistance - distance;
              a.x -= nx * overlap * 0.5;
              a.y -= ny * overlap * 0.5;
              b.x += nx * overlap * 0.5;
              b.y += ny * overlap * 0.5;

              const dvx = b.vx - a.vx;
              const dvy = b.vy - a.vy;
              const velocityAlongNormal = dvx * nx + dvy * ny;

              if (velocityAlongNormal < 0) {
                const impulse = -velocityAlongNormal * 0.95;
                a.vx -= impulse * nx;
                a.vy -= impulse * ny;
                b.vx += impulse * nx;
                b.vy += impulse * ny;
              }
            }
          }
        }

        const stillMoving = nextBalls.some((ball) => !ball.pocketed && (Math.abs(ball.vx) > 0.05 || Math.abs(ball.vy) > 0.05));
        if (!stillMoving) {
          setStatus('Shot settled');
          setIsAnimating(false);
        }

        return nextBalls;
      });

      if (movementDetected) {
        animationFrame = requestAnimationFrame(tick);
      }
    };

    animationFrame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animationFrame);
  }, [balls, isAnimating]);

  const handleAimMove = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!tableRef.current || !cueBall || isAnimating) return;
    const rect = tableRef.current.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * TABLE_WIDTH;
    const y = ((event.clientY - rect.top) / rect.height) * TABLE_HEIGHT;
    const dx = x - cueBall.x;
    const dy = y - cueBall.y;
    const angle = Math.atan2(dy, dx);
    setAimAngle(angle + Math.PI);
  };

  const shootCueBall = () => {
    if (!cueBall || isAnimating) return;
    const moving = balls.some((ball) => Math.abs(ball.vx) > 0.1 || Math.abs(ball.vy) > 0.1);
    if (moving) return;

    const force = power * 0.32;
    const dx = Math.cos(aimAngle) * force;
    const dy = Math.sin(aimAngle) * force;

    setBalls((currentBalls) =>
      currentBalls.map((ball) =>
        ball.isCue ? { ...ball, vx: dx, vy: dy } : { ...ball }
      )
    );

    setIsAnimating(true);
    setStatus(aiConfig ? 'AI is tracking the break' : 'Shot taken');
    setTurn((prev) => (prev === 'player' && aiConfig ? 'ai' : 'player'));
  };

  const aiTurn = () => {
    if (!aiConfig || turn !== 'ai') return;
    const target = Math.max(18, 120 - power);
    setPower((prev) => clamp(prev + 5, 18, 100));
    setBalls((currentBalls) =>
      currentBalls.map((ball) =>
        ball.isCue
          ? {
              ...ball,
              vx: (Math.random() - 0.2) * target * 0.18,
              vy: (Math.random() - 0.1) * target * 0.18,
            }
          : { ...ball }
      )
    );
    setStatus('AI break shot');
    setIsAnimating(true);
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
      <div className="flex flex-wrap items-center justify-between gap-3 bg-[#0f172a] p-3 rounded-[26px] border border-[#24324a] shadow-[0_20px_45px_rgba(15,23,42,0.35)]">
        <div className="flex items-center gap-3">
          <button
            onClick={onBackToHub}
            className="p-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold transition-all border border-slate-700"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>

          <div className="flex items-center gap-2">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-amber-400 to-orange-600 flex items-center justify-center border border-amber-300/50 shadow-md">
              <Target className="w-5 h-5 text-slate-900" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-black text-white">8 Ball Pool</h2>
                <span className="px-2 py-0.5 text-[10px] font-black rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-400/40">
                  {aiConfig ? 'VS AI' : 'Local Match'}
                </span>
              </div>
              <p className="text-[11px] text-slate-400">Classic cue control with animated ball movement and rack breaks.</p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3 text-xs font-bold">
          <div className="px-2.5 py-1.5 rounded-xl bg-slate-800 text-slate-200 border border-slate-700">
            <span className="text-slate-400">Turn:</span> <span className="text-white">{turn === 'player' ? 'Player' : 'AI'}</span>
          </div>
          <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-slate-800 text-slate-200 border border-slate-700">
            <Gauge className="w-4 h-4 text-cyan-300" />
            <span>{status}</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_260px] gap-4">
        <div className="relative overflow-hidden rounded-[30px] border border-[#bd8b40] bg-gradient-to-b from-[#7f4f1b] via-[#62401a] to-[#4d3313] p-3 shadow-[0_25px_60px_rgba(15,23,42,0.45)]">
          <div className="absolute inset-x-6 top-3 h-12 rounded-full bg-[#f5d9a3]/30 blur-2xl" />
          <div
            ref={tableRef}
            className="relative mx-auto overflow-hidden rounded-[20px] border-[8px] border-[#b7772d] bg-[radial-gradient(circle_at_center,_rgba(58,191,106,0.6),_rgba(7,96,55,0.98)_58%,_rgba(5,72,41,1)_100%)] shadow-[inset_0_0_0_2px_rgba(255,255,255,0.08),inset_0_0_35px_rgba(0,0,0,0.18)]"
            style={{ width: '100%', maxWidth: 820, height: 430 }}
            onMouseMove={handleAimMove}
            onClick={handleAimMove}
          >
            <div className="absolute inset-0 rounded-[12px] border border-white/10" />
            <div className="absolute left-0 right-0 top-1/2 h-px bg-white/12" />
            <div className="absolute top-0 bottom-0 left-1/2 w-px bg-white/12" />

            {[...Array(6)].map((_, index) => {
              const pocket = POCKETS[index];
              return (
                <div
                  key={`pocket-${index}`}
                  className="absolute rounded-full bg-[#0a1220] border-2 border-[#1b2838] shadow-[inset_0_0_10px_rgba(0,0,0,0.9)]"
                  style={{ left: pocket.x - 15, top: pocket.y - 15, width: 30, height: 30 }}
                />
              );
            })}

            <div className="absolute left-[18px] top-[18px] right-[18px] bottom-[18px] rounded-[12px] border border-white/10" />

            {balls.map((ball) => (
              <motion.div
                key={ball.id}
                animate={{
                  x: ball.x - ball.radius,
                  y: ball.y - ball.radius,
                  scale: ball.pocketed ? 0.72 : 1,
                  opacity: ball.pocketed ? 0.12 : 1,
                }}
                transition={{ type: 'spring', stiffness: 220, damping: 20 }}
                className="absolute rounded-full border-[2px] border-slate-900/75 shadow-[inset_-6px_-6px_0_rgba(15,23,42,0.24),0_2px_10px_rgba(15,23,42,0.35)]"
                style={{
                  width: ball.radius * 2,
                  height: ball.radius * 2,
                  background: ball.type === 'stripe'
                    ? `linear-gradient(135deg, ${ball.color} 0%, ${ball.color} 42%, rgba(255,255,255,0.9) 42%, rgba(255,255,255,0.9) 58%, ${ball.color} 58%, ${ball.color} 100%)`
                    : ball.color,
                  left: 0,
                  top: 0,
                }}
              >
                {ball.type !== 'cue' && (
                  <div className="flex h-full items-center justify-center text-[9px] font-black text-slate-900 select-none">
                    {ball.type === 'eight' ? '8' : ball.type === 'stripe' ? '•' : '■'}
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
                <div className="h-full w-full rounded-full bg-white/85 shadow-[0_0_18px_rgba(255,255,255,0.9)]" />
              </div>
            )}
          </div>
        </div>

        <div className="space-y-4 rounded-[28px] border border-slate-800 bg-[#0f172a] p-4 shadow-[0_20px_45px_rgba(15,23,42,0.35)]">
          <div className="space-y-3">
            <div className="flex items-center justify-between text-[11px] font-black uppercase tracking-wider text-slate-400">
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
              className="flex items-center justify-center gap-2 rounded-2xl bg-emerald-500 px-3 py-3 text-sm font-black text-white shadow-lg shadow-emerald-600/30 hover:bg-emerald-400 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={isAnimating}
            >
              <Play className="w-4 h-4" />
              Shoot
            </button>
            <button
              onClick={resetRack}
              className="flex items-center justify-center gap-2 rounded-2xl bg-slate-700 px-3 py-3 text-sm font-black text-white hover:bg-slate-600 transition-all"
            >
              <RotateCcw className="w-4 h-4" />
              Reset
            </button>
          </div>

          <div className="rounded-2xl bg-slate-800/80 border border-slate-700 p-3 text-xs text-slate-300">
            <div className="flex items-center gap-2 font-bold text-white">
              <Sparkles className="w-4 h-4 text-amber-400" />
              Match note
            </div>
            <ul className="mt-2 space-y-1.5">
              <li>• Click on the table to line up the cue.</li>
              <li>• Higher power increases break speed.</li>
              <li>• Pocketed balls stop and the rack settles.</li>
            </ul>
          </div>

          <div className="rounded-2xl bg-emerald-500/10 border border-emerald-400/40 p-3 text-xs text-emerald-200">
            <div className="flex items-center gap-2 font-black">
              <Zap className="w-4 h-4" />
              Focus
            </div>
            <p className="mt-2">This table is styled to match the classic arcade pool look with a green felt, wood rails, and high-contrast pocketing.</p>
          </div>

          <div className="rounded-2xl bg-amber-500/10 border border-amber-400/40 p-3 text-xs text-amber-200">
            <div className="flex items-center gap-2 font-black">
              <Trophy className="w-4 h-4" />
              Scoreboard
            </div>
            <div className="mt-2 flex items-center justify-between text-sm font-black">
              <span>Player</span>
              <span>200</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
