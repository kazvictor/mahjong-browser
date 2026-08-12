/**
 * AI behaviour configuration.
 *
 * Centralised so the "thinking" delay and any future AI tuning knobs live in
 * one place rather than being scattered through the AI modules. The game
 * engine and UI both read from here so a single change re-tunes every AI.
 */

/** Minimum delay (ms) an AI "thinks" before acting on its turn. */
export const AI_THINK_TIME_MIN = 1000;

/** Maximum delay (ms) an AI "thinks" before acting on its turn. */
export const AI_THINK_TIME_MAX = 2000;
