"use client";

import { useEffect, useMemo, useRef } from "react";

interface Segment {
  id: string;
  name: string;
}

const SIZE = 400;
const C = SIZE / 2;
const R = C - 6;
const SPINS = 7;

function hashFraction(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return ((h >>> 0) % 10000) / 10000;
}

function point(angleDeg: number, radius: number) {
  const a = (angleDeg * Math.PI) / 180;
  return [C + radius * Math.sin(a), C - radius * Math.cos(a)] as const;
}

/**
 * Final rotation (degrees, clockwise) that brings the target segment under
 * the pointer at the top. Deterministic from the spin data, so every device
 * lands on the same spot.
 */
export function targetRotation(count: number, index: number, seed: string): number {
  const seg = 360 / count;
  const jitter = (hashFraction(seed) - 0.5) * seg * 0.6;
  return SPINS * 360 - ((index + 0.5) * seg + jitter);
}

/**
 * The server has already chosen the player (spin_candidates / current_player_id);
 * this only animates towards it. Devices that join late skip straight to the end.
 */
export function Wheel({
  segments,
  targetId,
  startedAt,
  durationMs,
  onDone,
}: {
  segments: Segment[];
  targetId: string;
  startedAt: string;
  durationMs: number;
  onDone: () => void;
}) {
  const discRef = useRef<HTMLDivElement>(null);
  const doneRef = useRef(onDone);
  useEffect(() => {
    doneRef.current = onDone;
  }, [onDone]);

  const n = Math.max(segments.length, 1);
  const seg = 360 / n;
  const index = Math.max(0, segments.findIndex((s) => s.id === targetId));
  const finalRot = targetRotation(n, index, `${targetId}:${startedAt}`);
  const fontSize = n <= 8 ? 16 : n <= 16 ? 13 : n <= 30 ? 10 : n <= 50 ? 8 : 6;
  const maxChars = n <= 16 ? 18 : 14;

  const paths = useMemo(
    () =>
      segments.map((s, i) => {
        const [x0, y0] = point(i * seg, R);
        const [x1, y1] = point((i + 1) * seg, R);
        const d = n === 1 ? "" : `M${C},${C} L${x0},${y0} A${R},${R} 0 ${seg > 180 ? 1 : 0} 1 ${x1},${y1} Z`;
        const hue = Math.round((i * 360) / n + (i % 2) * 18) % 360;
        return { ...s, d, fill: `hsl(${hue} 65% ${i % 2 ? 38 : 46}%)`, mid: (i + 0.5) * seg };
      }),
    [segments, seg, n],
  );

  useEffect(() => {
    const disc = discRef.current;
    if (!disc) return;
    const elapsed = Date.now() - Date.parse(startedAt);
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // Joined long after the spin (or clocks disagree a lot): show the result.
    if (reduced || !Number.isFinite(elapsed) || elapsed > durationMs + 3000) {
      disc.style.transform = `rotate(${finalRot}deg)`;
      const t = window.setTimeout(() => doneRef.current(), reduced ? 600 : 0);
      return () => window.clearTimeout(t);
    }
    const remaining = Math.max(durationMs - Math.max(elapsed, 0), 2500);
    const anim = disc.animate([{ transform: "rotate(0deg)" }, { transform: `rotate(${finalRot}deg)` }], {
      duration: remaining,
      easing: "cubic-bezier(0.15, 0.85, 0.25, 1)",
      fill: "forwards",
    });
    anim.onfinish = () => window.setTimeout(() => doneRef.current(), 500);
    return () => anim.cancel();
  }, [finalRot, startedAt, durationMs]);

  return (
    <div className="relative mx-auto aspect-square w-full max-w-[min(88vw,440px)]">
      <div className="absolute left-1/2 top-0 z-10 -translate-x-1/2 -translate-y-1" aria-hidden>
        <svg width="34" height="40" viewBox="0 0 34 40">
          <path d="M17 40 L2 6 Q17 -4 32 6 Z" fill="#fbbf24" stroke="#0f172a" strokeWidth="3" />
        </svg>
      </div>
      <div ref={discRef} className="h-full w-full will-change-transform">
        <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="h-full w-full drop-shadow-2xl" role="img" aria-label="Player wheel">
          <circle cx={C} cy={C} r={R + 4} fill="#0f172a" stroke="#fbbf24" strokeWidth="4" />
          {n === 1 ? (
            <circle cx={C} cy={C} r={R} fill={paths[0]?.fill ?? "#334155"} />
          ) : (
            paths.map((p) => <path key={p.id} d={p.d} fill={p.fill} stroke="#0f172a" strokeWidth="1" />)
          )}
          {paths.map((p) => (
            <g key={`t-${p.id}`} transform={`rotate(${p.mid - 90} ${C} ${C})`}>
              <text
                x={C + R - 12}
                y={C}
                textAnchor="end"
                dominantBaseline="central"
                fontSize={fontSize}
                fontWeight={600}
                fill="#fff"
              >
                {p.name.length > maxChars ? `${p.name.slice(0, maxChars - 1)}…` : p.name}
              </text>
            </g>
          ))}
          <circle cx={C} cy={C} r={26} fill="#0f172a" stroke="#fbbf24" strokeWidth="4" />
          <text x={C} y={C} textAnchor="middle" dominantBaseline="central" fontSize="20">🏏</text>
        </svg>
      </div>
    </div>
  );
}
