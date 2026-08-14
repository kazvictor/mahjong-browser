/**
 * Unit tests for Riichi han/fu scoring.
 *
 * Covers hand analysis (decomposition, wait detection, chiitoitsu/kokushi),
 * fu calculation, yaku evaluation (common patterns + yakuman), base-point
 * resolution / limits, and dealer-vs-non-dealer payment distribution with
 * honba/tsumibou sticks. Known-hand patterns are asserted against standard
 * Riichi scoring tables.
 */
import { describe, expect, it } from 'vitest';
import type { Hand, Meld, Tile } from '../../src/game-logic';
import {
  analyzeWinningHand,
  calculateFu,
  calculateScore,
  evaluateYaku,
  resolveLimit,
} from '../../src/game-logic';

/** Build a tile without needing unique ids (id defaults to key). */
function t(suit: Tile['suit'], rank: number): Tile {
  return { id: `${suit}-${rank}`, suit, rank };
}

function hand(tiles: readonly Tile[], melds: readonly Meld[] = []): Hand {
  return { tiles: [...tiles], melds, bonusTiles: [] };
}

/** Mixed-suit all-simples hand with one concealed pung: exactly 1 han (tanyao)
 * on ron — no pinfu (pung present), no flush (mixed suits), no toitoi
 * (chows present). 222 dots (pung) + 345 bam + 678 char + 567 dots + 55 bam.
 * Every tile is a simple (2-8), so tanyao matches. */
function singleHanTanyaoHand(): Hand {
  const pung: Meld = {
    type: 'pung',
    tiles: [t('dots', 2), t('dots', 2), t('dots', 2)],
    isConcealed: true,
  };
  const tiles = [
    t('bamboo', 3), t('bamboo', 4), t('bamboo', 5),
    t('characters', 6), t('characters', 7), t('characters', 8),
    t('dots', 5), t('dots', 6), t('dots', 7),
    t('bamboo', 5), t('bamboo', 5),
  ];
  return hand(tiles, [pung]);
}

/** The winning tile for singleHanTanyaoHand (completes the 678 characters chow). */
const TANYAO_WIN = t('characters', 8);

/** An all-simples, all-chows, concealed hand (pinfu + tanyao on ron).
 * 234, 345, 456, 678 dots + 55 dots pair — all one suit (also chinitsu). */
function pinfuTanyaoChinitsuHand(): Hand {
  const tiles = [
    t('dots', 2), t('dots', 3), t('dots', 4),
    t('dots', 3), t('dots', 4), t('dots', 5),
    t('dots', 4), t('dots', 5), t('dots', 6),
    t('dots', 6), t('dots', 7), t('dots', 8),
    t('dots', 5), t('dots', 5),
  ];
  return hand(tiles);
}

function defaultOptions(overrides: Partial<Parameters<typeof calculateScore>[1]> = {}) {
  return {
    winningTile: t('dots', 5),
    isTsumo: false,
    seatWind: 1,
    roundWind: 1,
    isDealer: true,
    isRiichi: false,
    ...overrides,
  };
}

describe('analyzeWinningHand', () => {
  it('decomposes a standard hand into four melds plus a pair', () => {
    const analyzed = analyzeWinningHand(pinfuTanyaoChinitsuHand(), t('dots', 5));
    expect(analyzed.melds).toHaveLength(4);
    expect(analyzed.pair).toHaveLength(2);
    expect(analyzed.isChiitoitsu).toBe(false);
    expect(analyzed.isKokushi).toBe(false);
    expect(analyzed.isFullyConcealed).toBe(true);
  });

  it('detects chiitoitsu (seven pairs)', () => {
    const tiles = [
      t('dots', 1), t('dots', 1),
      t('dots', 2), t('dots', 2),
      t('bamboo', 3), t('bamboo', 3),
      t('characters', 4), t('characters', 4),
      t('winds', 1), t('winds', 1),
      t('dragons', 1), t('dragons', 1),
      t('dots', 9), t('dots', 9),
    ];
    const analyzed = analyzeWinningHand(hand(tiles), t('dots', 9));
    expect(analyzed.isChiitoitsu).toBe(true);
    expect(analyzed.waitType).toBe('tanki');
  });

  it('detects kokushi musou (thirteen orphans)', () => {
    const tiles = [
      t('bamboo', 1), t('bamboo', 9),
      t('characters', 1), t('characters', 9),
      t('dots', 1), t('dots', 9),
      t('winds', 1), t('winds', 2), t('winds', 3), t('winds', 4),
      t('dragons', 1), t('dragons', 2), t('dragons', 3),
      t('winds', 1), // duplicate east = the pair
    ];
    const analyzed = analyzeWinningHand(hand(tiles), t('winds', 1));
    expect(analyzed.isKokushi).toBe(true);
  });

  it('classifies a kanchan (closed) wait', () => {
    // 567 567 345 789 + 44 pair, winning on 6 (middle of a 5-6-7).
    const tiles = [
      t('dots', 2), t('dots', 3), t('dots', 4),
      t('dots', 5), t('dots', 6), t('dots', 7),
      t('dots', 3), t('dots', 4), t('dots', 5),
      t('dots', 7), t('dots', 8), t('dots', 9),
      t('dots', 4), t('dots', 4),
    ];
    const analyzed = analyzeWinningHand(hand(tiles), t('dots', 6));
    expect(analyzed.waitType).toBe('kanchan');
  });

  it('classifies a penchan wait', () => {
    // 123 456 789 456 + 77 pair; win on 3 of the 1-2-3 chow.
    const tiles = [
      t('dots', 1), t('dots', 2), t('dots', 3),
      t('dots', 4), t('dots', 5), t('dots', 6),
      t('dots', 7), t('dots', 8), t('dots', 9),
      t('dots', 4), t('dots', 5), t('dots', 6),
      t('dots', 7), t('dots', 7),
    ];
    const analyzed = analyzeWinningHand(hand(tiles), t('dots', 3));
    expect(analyzed.waitType).toBe('penchan');
  });

  it('classifies a ryanmen wait', () => {
    // 123 456 789 567 + 44 pair; win on 4 of the 4-5-6.
    const tiles = [
      t('dots', 1), t('dots', 2), t('dots', 3),
      t('dots', 4), t('dots', 5), t('dots', 6),
      t('dots', 7), t('dots', 8), t('dots', 9),
      t('dots', 5), t('dots', 6), t('dots', 7),
      t('dots', 4), t('dots', 4),
    ];
    const analyzed = analyzeWinningHand(hand(tiles), t('dots', 4));
    expect(analyzed.waitType).toBe('ryanmen');
  });

  it('classifies a tanki (pair) wait', () => {
    // 123 234 678 789 + 55 pair; the winning 5 appears ONLY in the pair
    // (no chow contains a 5).
    const tiles = [
      t('dots', 1), t('dots', 2), t('dots', 3),
      t('dots', 2), t('dots', 3), t('dots', 4),
      t('dots', 6), t('dots', 7), t('dots', 8),
      t('dots', 7), t('dots', 8), t('dots', 9),
      t('dots', 5), t('dots', 5),
    ];
    const analyzed = analyzeWinningHand(hand(tiles), t('dots', 5));
    expect(analyzed.waitType).toBe('tanki');
  });

  it('throws on a non-winning (non-decomposable) hand', () => {
    const tiles = [
      t('dots', 1), t('dots', 2), t('dots', 4),
      t('dots', 4), t('dots', 5), t('dots', 6),
      t('dots', 7), t('dots', 8), t('dots', 9),
      t('dots', 1), t('dots', 2), t('dots', 3),
      t('dots', 8), t('dots', 8),
    ];
    expect(() => analyzeWinningHand(hand(tiles), t('dots', 8))).toThrow(
      /cannot be decomposed/,
    );
  });

  it('throws on a hand that is not 14 playable tiles', () => {
    const tiles = [
      t('dots', 1), t('dots', 2), t('dots', 3),
      t('dots', 4), t('dots', 5), t('dots', 6),
      t('dots', 7), t('dots', 8), t('dots', 9),
      t('dots', 1), t('dots', 2), t('dots', 3),
      t('dots', 8),
    ];
    expect(() => analyzeWinningHand(hand(tiles), t('dots', 8))).toThrow(/14 playable/);
  });
});

describe('calculateFu', () => {
  it('computes an all-simples concealed tsumo hand fu (30)', () => {
    // singleHanTanyaoHand: concealed pung 222 dots (+4 concealed simple),
    // menzen tsumo (+2), base 20 → 26 → 30. But wait, the pung is concealed
    // and the hand is fully concealed, so +2 tsumo applies.
    const analyzed = analyzeWinningHand(singleHanTanyaoHand(), TANYAO_WIN);
    // fu: 20 + 4 (concealed simple pung) + 2 (tsumo) = 26 → 30.
    expect(calculateFu(analyzed, { ...defaultOptions(), isTsumo: true }, false)).toBe(30);
  });

  it('adds +10 for a closed-hand ron', () => {
    const analyzed = analyzeWinningHand(singleHanTanyaoHand(), TANYAO_WIN);
    // 20 + 4 (concealed simple pung) + 10 (closed ron) = 34 → 40.
    expect(calculateFu(analyzed, defaultOptions(), false)).toBe(40);
  });

  it('a concealed terminal pung scores 8 fu (fully concealed → +10 closed ron)', () => {
    // 111 dots (concealed terminal pung, +8), 234, 567, 678, 99 pair.
    const meld: Meld = {
      type: 'pung',
      tiles: [t('dots', 1), t('dots', 1), t('dots', 1)],
      isConcealed: true,
    };
    const tiles = [
      t('dots', 2), t('dots', 3), t('dots', 4),
      t('dots', 5), t('dots', 6), t('dots', 7),
      t('dots', 6), t('dots', 7), t('dots', 8),
      t('dots', 9), t('dots', 9),
    ];
    const analyzed = analyzeWinningHand(hand(tiles, [meld]), t('dots', 4));
    // Hand is fully concealed (concealed pung + no exposed melds): 20 + 8
    // (concealed terminal pung) + 10 (closed-hand ron) = 38 → 40.
    expect(calculateFu(analyzed, defaultOptions(), false)).toBe(40);
  });

  it('pinfu tsumo forces 20 fu', () => {
    const analyzed = analyzeWinningHand(pinfuTanyaoChinitsuHand(), t('dots', 5));
    expect(calculateFu(analyzed, { ...defaultOptions(), isTsumo: true }, true)).toBe(20);
  });

  it('pinfu ron forces 30 fu', () => {
    const analyzed = analyzeWinningHand(pinfuTanyaoChinitsuHand(), t('dots', 5));
    expect(calculateFu(analyzed, defaultOptions(), true)).toBe(30);
  });

  it('chiitoitsu is a fixed 25 fu', () => {
    const tiles = [
      t('dots', 1), t('dots', 1),
      t('dots', 2), t('dots', 2),
      t('bamboo', 3), t('bamboo', 3),
      t('characters', 4), t('characters', 4),
      t('winds', 1), t('winds', 1),
      t('dragons', 1), t('dragons', 1),
      t('dots', 9), t('dots', 9),
    ];
    const analyzed = analyzeWinningHand(hand(tiles), t('dots', 9));
    expect(calculateFu(analyzed, defaultOptions(), false)).toBe(25);
  });
});

describe('evaluateYaku', () => {
  it('detects tanyao (all simples)', () => {
    const analyzed = analyzeWinningHand(singleHanTanyaoHand(), TANYAO_WIN);
    const yaku = evaluateYaku(analyzed, singleHanTanyaoHand(), defaultOptions());
    expect(yaku.some((y) => y.name === 'Tanyao')).toBe(true);
  });

  it('detects riichi (fully concealed win)', () => {
    const analyzed = analyzeWinningHand(pinfuTanyaoChinitsuHand(), t('dots', 5));
    const yaku = evaluateYaku(analyzed, pinfuTanyaoChinitsuHand(), {
      ...defaultOptions(),
      isRiichi: true,
    });
    expect(yaku.some((y) => y.name === 'Riichi' && y.han === 1)).toBe(true);
  });

  it('detects ippatsu only alongside riichi', () => {
    const analyzed = analyzeWinningHand(pinfuTanyaoChinitsuHand(), t('dots', 5));
    const withIppatsu = evaluateYaku(analyzed, pinfuTanyaoChinitsuHand(), {
      ...defaultOptions(),
      isRiichi: true,
      isIppatsu: true,
    });
    expect(withIppatsu.some((y) => y.name === 'Ippatsu')).toBe(true);
    // ippatsu without riichi is invalid — must not be awarded.
    const withoutRiichi = evaluateYaku(analyzed, pinfuTanyaoChinitsuHand(), {
      ...defaultOptions(),
      isIppatsu: true,
    });
    expect(withoutRiichi.some((y) => y.name === 'Ippatsu')).toBe(false);
  });

  it('detects menzen tsumo', () => {
    const analyzed = analyzeWinningHand(pinfuTanyaoChinitsuHand(), t('dots', 5));
    const yaku = evaluateYaku(analyzed, pinfuTanyaoChinitsuHand(), {
      ...defaultOptions(),
      isTsumo: true,
    });
    expect(yaku.some((y) => y.name === 'Menzen Tsumo')).toBe(true);
  });

  it('detects pinfu for an all-chow ryanmen concealed hand', () => {
    const analyzed = analyzeWinningHand(pinfuTanyaoChinitsuHand(), t('dots', 5));
    const yaku = evaluateYaku(analyzed, pinfuTanyaoChinitsuHand(), defaultOptions());
    expect(yaku.some((y) => y.name === 'Pinfu')).toBe(true);
  });

  it('detects chinitsu for a pure one-suit hand', () => {
    const analyzed = analyzeWinningHand(pinfuTanyaoChinitsuHand(), t('dots', 5));
    const yaku = evaluateYaku(analyzed, pinfuTanyaoChinitsuHand(), defaultOptions());
    expect(yaku.some((y) => y.name === 'Chinitsu')).toBe(true);
  });

  it('detects yakuhai dragon pung', () => {
    const meld: Meld = {
      type: 'pung',
      tiles: [t('dragons', 1), t('dragons', 1), t('dragons', 1)],
      isConcealed: false,
    };
    // 11 concealed tiles (3 chows + pair) + 3-tile pung = 14 total.
    const tiles = [
      t('dots', 2), t('dots', 3), t('dots', 4),
      t('dots', 3), t('dots', 4), t('dots', 5),
      t('dots', 4), t('dots', 5), t('dots', 6),
      t('dots', 6), t('dots', 7), t('dots', 8),
      t('dots', 5), t('dots', 5),
    ];
    // Remove one chow's 3 tiles so concealed = 11: keep 3 chows (9) + pair (2).
    const concealed = [
      t('dots', 2), t('dots', 3), t('dots', 4),
      t('dots', 5), t('dots', 6), t('dots', 7),
      t('dots', 6), t('dots', 7), t('dots', 8),
      t('dots', 5), t('dots', 5),
    ];
    const analyzed = analyzeWinningHand(hand(concealed, [meld]), t('dots', 4));
    const yaku = evaluateYaku(analyzed, hand(concealed, [meld]), defaultOptions());
    expect(yaku.some((y) => y.name === 'Yakuhai (Dragon)')).toBe(true);
    void tiles; // (kept for clarity in the docstring; not used)
  });

  it('detects seat-wind pung', () => {
    const meld: Meld = {
      type: 'pung',
      tiles: [t('winds', 1), t('winds', 1), t('winds', 1)], // East, seat 1
      isConcealed: false,
    };
    const concealed = [
      t('dots', 2), t('dots', 3), t('dots', 4),
      t('dots', 5), t('dots', 6), t('dots', 7),
      t('dots', 6), t('dots', 7), t('dots', 8),
      t('dots', 5), t('dots', 5),
    ];
    const analyzed = analyzeWinningHand(hand(concealed, [meld]), t('dots', 4));
    const yaku = evaluateYaku(analyzed, hand(concealed, [meld]), defaultOptions());
    expect(yaku.some((y) => y.name === 'Yakuhai (Seat Wind)')).toBe(true);
  });

  it('detects chiitoitsu (2 han)', () => {
    const tiles = [
      t('dots', 1), t('dots', 1),
      t('dots', 2), t('dots', 2),
      t('bamboo', 3), t('bamboo', 3),
      t('characters', 4), t('characters', 4),
      t('winds', 1), t('winds', 1),
      t('dragons', 1), t('dragons', 1),
      t('dots', 9), t('dots', 9),
    ];
    const analyzed = analyzeWinningHand(hand(tiles), t('dots', 9));
    const yaku = evaluateYaku(analyzed, hand(tiles), defaultOptions());
    expect(yaku.some((y) => y.name === 'Chiitoitsu' && y.han === 2)).toBe(true);
  });

  it('detects kokushi musou as a yakuman', () => {
    const tiles = [
      t('bamboo', 1), t('bamboo', 9),
      t('characters', 1), t('characters', 9),
      t('dots', 1), t('dots', 9),
      t('winds', 1), t('winds', 2), t('winds', 3), t('winds', 4),
      t('dragons', 1), t('dragons', 2), t('dragons', 3),
      t('winds', 1),
    ];
    const analyzed = analyzeWinningHand(hand(tiles), t('winds', 1));
    const yaku = evaluateYaku(analyzed, hand(tiles), defaultOptions());
    expect(yaku.some((y) => y.name === 'Kokushi Musou' && y.yakuman)).toBe(true);
  });

  it('does not award yakuman when allowYakuman is false', () => {
    const tiles = [
      t('bamboo', 1), t('bamboo', 9),
      t('characters', 1), t('characters', 9),
      t('dots', 1), t('dots', 9),
      t('winds', 1), t('winds', 2), t('winds', 3), t('winds', 4),
      t('dragons', 1), t('dragons', 2), t('dragons', 3),
      t('winds', 1),
    ];
    const analyzed = analyzeWinningHand(hand(tiles), t('winds', 1));
    const yaku = evaluateYaku(analyzed, hand(tiles), {
      ...defaultOptions(),
      allowYakuman: false,
    });
    expect(yaku.every((y) => !y.yakuman)).toBe(true);
  });

  it('throws at calculateScore when no yaku is present', () => {
    // A winning hand with no yaku: mixed suits, open pung, has a terminal
    // (breaks tanyao), not a value wind, not all chows (pung present).
    const pung: Meld = {
      type: 'pung',
      tiles: [t('dots', 1), t('dots', 1), t('dots', 1)],
      isConcealed: false,
    };
    const concealed = [
      t('bamboo', 2), t('bamboo', 3), t('bamboo', 4),
      t('characters', 5), t('characters', 6), t('characters', 7),
      t('dots', 6), t('dots', 7), t('dots', 8),
      t('dots', 5), t('dots', 5),
    ];
    const winning = hand(concealed, [pung]);
    expect(() =>
      calculateScore(winning, defaultOptions({ winningTile: t('dots', 8) }), 0),
    ).toThrow(/No yaku/);
  });
});

describe('resolveLimit', () => {
  it('computes base points below mangan', () => {
    const { limit, rawBasePoints } = resolveLimit(1, 30, false);
    expect(limit).toBe('none');
    expect(rawBasePoints).toBe(30 * 2 ** 3); // fu * 2^(2+han) = 240
  });

  it('caps 5 han at mangan', () => {
    const { limit, rawBasePoints } = resolveLimit(5, 30, false);
    expect(limit).toBe('mangan');
    expect(rawBasePoints).toBe(2000);
  });

  it('caps 6-7 han at haneman', () => {
    expect(resolveLimit(6, 30, false).limit).toBe('haneman');
    expect(resolveLimit(7, 30, false).limit).toBe('haneman');
  });

  it('caps 8-10 han at baiman', () => {
    expect(resolveLimit(8, 30, false).limit).toBe('baiman');
    expect(resolveLimit(10, 30, false).limit).toBe('baiman');
  });

  it('caps 11-12 han at sanbaiman', () => {
    expect(resolveLimit(11, 30, false).limit).toBe('sanbaiman');
    expect(resolveLimit(12, 30, false).limit).toBe('sanbaiman');
  });

  it('caps 13+ han at yakuman', () => {
    expect(resolveLimit(13, 30, false).limit).toBe('yakuman');
  });

  it('caps 4 han / 40 fu at mangan (the classic 4h40f rule)', () => {
    expect(resolveLimit(4, 40, false).limit).toBe('mangan');
    // 4 han / 30 fu stays below mangan.
    expect(resolveLimit(4, 30, false).limit).toBe('none');
  });

  it('caps 3 han / 70 fu at mangan', () => {
    expect(resolveLimit(3, 70, false).limit).toBe('mangan');
  });

  it('treats a yakuman flag as yakuman regardless of han', () => {
    const { limit, rawBasePoints } = resolveLimit(0, 0, true);
    expect(limit).toBe('yakuman');
    expect(rawBasePoints).toBe(8000);
  });
});

describe('calculateScore — distribution', () => {
  it('non-dealer ron: discarder pays 4x base (rounded to 100)', () => {
    // singleHanTanyaoHand: 1 han, 40 fu → base 40*2^3=320, 4x=1280→1300.
    const result = calculateScore(
      singleHanTanyaoHand(),
      defaultOptions({
        isTsumo: false,
        isDealer: false,
        seatWind: 2,
        roundWind: 1,
        ronPayer: 3,
      }),
      1, // winner seat 1
    );
    expect(result.han).toBe(1); // tanyao only
    expect(result.fu).toBe(40);
    expect(result.limit).toBe('none');
    expect(result.rawBasePoints).toBe(320);
    expect(result.payments[3]).toBe(-1300);
    expect(result.payments[1]).toBe(1300);
    expect(result.winnerNet).toBe(1300);
  });

  it('non-dealer tsumo: dealer pays 2x, others pay 1x', () => {
    // 2 han (tanyao + menzen tsumo), 30 fu: base 30*2^4=480.
    // Dealer 2x=960→1000, others 480→500 → 2000.
    const result = calculateScore(
      singleHanTanyaoHand(),
      defaultOptions({
        isTsumo: true,
        isDealer: false,
        seatWind: 2,
      }),
      1,
    );
    expect(result.han).toBe(2);
    expect(result.fu).toBe(30);
    expect(result.payments[0]).toBe(-1000); // dealer (seat 0)
    expect(result.payments[2]).toBe(-500);
    expect(result.payments[3]).toBe(-500);
    expect(result.payments[1]).toBe(2000);
    expect(result.tablePayment).toBe(2000);
  });

  it('dealer tsumo: each non-dealer pays 2x base', () => {
    // Dealer tsumo, 2 han 30 fu: each of 3 pays 2x480=960→1000 → 3000.
    const result = calculateScore(
      singleHanTanyaoHand(),
      defaultOptions({ isTsumo: true, isDealer: true, seatWind: 1 }),
      0,
    );
    expect(result.payments[1]).toBe(-1000);
    expect(result.payments[2]).toBe(-1000);
    expect(result.payments[3]).toBe(-1000);
    expect(result.payments[0]).toBe(3000);
  });

  it('dealer ron: discarder pays 6x base', () => {
    // 1 han 40 fu dealer ron: 6x320=1920→2000.
    const result = calculateScore(
      singleHanTanyaoHand(),
      defaultOptions({
        isTsumo: false,
        isDealer: true,
        seatWind: 1,
        ronPayer: 2,
      }),
      0,
    );
    expect(result.payments[2]).toBe(-2000);
    expect(result.payments[0]).toBe(2000);
  });

  it('adds honba sticks (300 each) to the winner and charges the ron payer', () => {
    const result = calculateScore(
      singleHanTanyaoHand(),
      defaultOptions({
        isTsumo: false,
        isDealer: false,
        seatWind: 2,
        honba: 2,
        ronPayer: 3,
      }),
      1,
    );
    expect(result.stickPayment).toBe(600);
    expect(result.winnerNet).toBe(1300 + 600);
    expect(result.payments[3]).toBe(-1900); // 1300 ron + 600 sticks
  });

  it('splits honba sticks among losers on tsumo', () => {
    const result = calculateScore(
      singleHanTanyaoHand(),
      defaultOptions({
        isTsumo: true,
        isDealer: false,
        seatWind: 2,
        honba: 1,
      }),
      1,
    );
    expect(result.stickPayment).toBe(300);
    // Split 300 among 3 losers → 100 each.
    expect(result.payments[0]).toBe(-1000 - 100);
    expect(result.payments[2]).toBe(-500 - 100);
    expect(result.payments[3]).toBe(-500 - 100);
    expect(result.payments[1]).toBe(2000 + 300);
  });

  it('sums tsumibou (penalty) sticks alongside honba', () => {
    const result = calculateScore(
      singleHanTanyaoHand(),
      defaultOptions({
        isTsumo: false,
        isDealer: false,
        seatWind: 2,
        honba: 1,
        tsumibou: 2,
        ronPayer: 3,
      }),
      1,
    );
    expect(result.stickPayment).toBe(900); // 3 sticks * 300
    expect(result.payments[3]).toBe(-1300 - 900);
  });

  it('resolves a mangan hand to the mangan payment', () => {
    // 5 han: chiitoitsu(2) + riichi(1) + ippatsu(1) + tsumo(1) = 5 → mangan.
    const tiles = [
      t('dots', 1), t('dots', 1),
      t('dots', 2), t('dots', 2),
      t('bamboo', 3), t('bamboo', 3),
      t('characters', 4), t('characters', 4),
      t('winds', 1), t('winds', 1),
      t('dragons', 1), t('dragons', 1),
      t('dots', 9), t('dots', 9),
    ];
    const result = calculateScore(
      hand(tiles),
      defaultOptions({
        isTsumo: true,
        isDealer: false,
        seatWind: 2,
        isRiichi: true,
        isIppatsu: true,
        winningTile: t('dots', 9),
      }),
      1,
    );
    expect(result.han).toBe(5);
    expect(result.limit).toBe('mangan');
    expect(result.rawBasePoints).toBe(2000);
    // Non-dealer tsumo mangan: dealer 4000, others 2000 → 8000.
    expect(result.payments[0]).toBe(-4000);
    expect(result.payments[2]).toBe(-2000);
    expect(result.payments[3]).toBe(-2000);
    expect(result.payments[1]).toBe(8000);
  });

  it('resolves a yakuman to the yakuman payment', () => {
    const tiles = [
      t('bamboo', 1), t('bamboo', 9),
      t('characters', 1), t('characters', 9),
      t('dots', 1), t('dots', 9),
      t('winds', 1), t('winds', 2), t('winds', 3), t('winds', 4),
      t('dragons', 1), t('dragons', 2), t('dragons', 3),
      t('winds', 1),
    ];
    const result = calculateScore(
      hand(tiles),
      defaultOptions({
        isTsumo: true,
        isDealer: false,
        seatWind: 2,
        winningTile: t('winds', 1),
      }),
      1,
    );
    expect(result.isYakuman).toBe(true);
    expect(result.limit).toBe('yakuman');
    // Non-dealer yakuman tsumo: dealer 16000, others 8000 → 32000.
    expect(result.payments[0]).toBe(-16000);
    expect(result.payments[2]).toBe(-8000);
    expect(result.payments[3]).toBe(-8000);
    expect(result.payments[1]).toBe(32000);
  });
});

describe('calculateScore — integration with winning hand', () => {
  it('throws when the hand is not a valid win', () => {
    const tiles = [
      t('dots', 1), t('dots', 2), t('dots', 4),
      t('dots', 4), t('dots', 5), t('dots', 6),
      t('dots', 7), t('dots', 8), t('dots', 9),
      t('dots', 1), t('dots', 2), t('dots', 3),
      t('dots', 8), t('dots', 8),
    ];
    expect(() =>
      calculateScore(
        hand(tiles),
        defaultOptions({ winningTile: t('dots', 8) }),
        0,
      ),
    ).toThrow();
  });

  it('handles a tanyao win and reports a full breakdown', () => {
    const result = calculateScore(
      singleHanTanyaoHand(),
      defaultOptions({
        isTsumo: false,
        isDealer: false,
        seatWind: 2,
        ronPayer: 3,
      }),
      1,
    );
    expect(result.patterns.some((p) => p.name === 'Tanyao')).toBe(true);
    expect(result.han).toBe(1);
    expect(result.fu).toBe(40);
    expect(result.basePayment).toBe(400); // 320 → 400
    expect(result.tablePayment).toBe(1300); // 4x base rounded
    expect(result.payments).toHaveLength(4);
    // Net sum across all players must be zero (conservation).
    expect(result.payments.reduce((s, p) => s + p, 0)).toBe(0);
  });
});
