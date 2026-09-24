// Cumulative XP needed to *reach* a level, as shown on the Server page:
//
//     xp(L) = floor(((divider × L)² − offset) ÷ multiplier) + 1      (L ≥ 1)
//
// With the defaults (multiplier 2, offset 5, divider 10) that is 48 XP for
// level 1, 1,248 for level 5, 4,998 for level 10 and 7,198 for level 12.

export interface Formula {
    multiplier: number;
    offset: number;
    divider: number;
}

export const MAX_LEVEL = 10_000;

export function xpForLevel(level: number, f: Formula): number {
    if (level <= 0) return 0;
    const raw = Math.floor((Math.pow(f.divider * level, 2) - f.offset) / f.multiplier) + 1;
    return Math.max(0, raw);
}

export function levelForXp(xp: number, f: Formula): number {
    xp = Math.max(0, xp);

    // Invert the curve for a first guess, then step to the exact level so
    // floating point never puts someone one level off.
    let level = Math.floor(Math.sqrt(Math.max(0, xp * f.multiplier + f.offset)) / f.divider);
    level = Math.max(0, Math.min(MAX_LEVEL, level));

    while (level < MAX_LEVEL && xpForLevel(level + 1, f) <= xp) level++;
    while (level > 0 && xpForLevel(level, f) > xp) level--;

    return level;
}

export interface LevelProgress {
    level: number;
    current: number;   // XP earned inside this level
    needed: number;    // XP this level takes in total
    next_at: number;   // cumulative XP where the next level starts
}

export function progressFor(xp: number, f: Formula): LevelProgress {
    const level = levelForXp(xp, f);
    const start = xpForLevel(level, f);
    const next_at = xpForLevel(level + 1, f);
    return {
        level,
        current: Math.max(0, xp - start),
        needed: Math.max(1, next_at - start),
        next_at
    };
}
