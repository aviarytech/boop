/**
 * The ink impression left on a checked item: round for a person, square for
 * an agent. The ring text names who made the tick and when, so attribution is
 * readable without hovering (ring text from 56px up; smaller stamps keep
 * the ring and the initial, and the row's meta line carries the name). `fresh` plays the stamp-down animation once.
 */

import { useId } from "react";

interface StampProps {
  kind?: "person" | "agent";
  /** Who made the tick, e.g. "Theo" or "release-bot". */
  name: string;
  /** Short time label, e.g. "13:05" or "now". */
  time?: string;
  fresh?: boolean;
  size?: number;
  className?: string;
}

export function Stamp({ kind = "person", name, time, fresh, size = 56, className = "" }: StampProps) {
  const id = useId();
  const inkId = `${id}-ink`;
  // A stable per-name rotation (±3°) and noise seed, so each mark looks pressed by hand.
  const hash = [...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
  const tilt = ((hash % 61) - 30) / 10;
  const seed = hash % 97;
  const initial = (name.trim()[0] ?? "?").toUpperCase();
  const label = `${kind === "agent" ? "Stamped by agent" : "Stamped by"} ${name}${time ? `, ${time}` : ""}`;
  // Repeat the name around the ring until it is roughly full (~24 glyphs).
  const unit = `${name} · ${time ? `${time} · ` : ""}`;
  const ring = unit.repeat(Math.max(1, Math.round(24 / unit.length)));

  return (
    <span
      role="img"
      aria-label={label}
      className={`boop-stamp boop-stamp-${kind}${fresh ? " is-fresh" : ""} ${className}`}
      style={{ width: size, height: size, ["--stamp-tilt" as string]: `${tilt}deg` }}
    >
      <svg viewBox="0 0 66 66" aria-hidden="true">
        <defs>
          {/* Ink: a slight bleed at the edges and specks where the pad ran dry. */}
          <filter id={inkId} x="-8%" y="-8%" width="116%" height="116%">
            <feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="2" seed={seed} result="edge" />
            <feDisplacementMap in="SourceGraphic" in2="edge" scale="1.3" result="bled" />
            <feTurbulence type="fractalNoise" baseFrequency="1.9" numOctaves="1" seed={seed + 1} result="pad" />
            <feColorMatrix in="pad" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -3.2 2.6" result="dry" />
            <feComposite in="bled" in2="dry" operator="in" />
          </filter>
        </defs>
        <g filter={`url(#${inkId})`}>
        {kind === "agent" ? (
          <>
            <rect className="boop-stamp-ring" x="4" y="4" width="58" height="58" rx="6" pathLength={1} />
            <rect className="boop-stamp-inner" x="10" y="10" width="46" height="46" rx="3" />
            <text className="boop-stamp-text" x="33" y="30" textAnchor="middle"
              {...(name.length > 6 ? { textLength: 40, lengthAdjust: "spacingAndGlyphs" } : {})}>{name}</text>
            {time && <text className="boop-stamp-text" x="33" y="44" textAnchor="middle">{time}</text>}
          </>
        ) : (
          <>
            <defs>
              <path id={`${id}-arc`} d="M33 33 m-23.5 0 a23.5 23.5 0 1 1 47 0 a23.5 23.5 0 1 1 -47 0" />
            </defs>
            <circle className="boop-stamp-ring" cx="33" cy="33" r="30" pathLength={1} />
            {size >= 56 ? (
              <text className="boop-stamp-text">
                <textPath href={`#${id}-arc`} textLength="146" lengthAdjust="spacingAndGlyphs">{ring}</textPath>
              </text>
            ) : (
              <circle className="boop-stamp-inner" cx="33" cy="33" r="23" />
            )}
            <text className="boop-stamp-initial" x="33" y={size >= 56 ? 38.5 : 40} textAnchor="middle"
              style={size >= 56 ? undefined : { fontSize: 21 }}>{initial}</text>
          </>
        )}
        </g>
      </svg>
    </span>
  );
}
