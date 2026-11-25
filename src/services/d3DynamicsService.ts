import { MatchAnalysis } from '../types/football';

export interface OddsIntervalPoint {
  id: string;
  label: string;
  minuteMark: number; // 0 for pre-match, 15, 30, 45, 60, 75, 90
  homeWin: number;
  draw: number;
  awayWin: number;
  over25: number;
  isProjected: boolean;
  goalEventText?: string;
}

export interface PossessionIntervalPoint {
  id: string;
  label: string;
  half: 1 | 2;
  minuteStart: number;
  minuteEnd: number;
  homePossession: number; // 25..75
  awayPossession: number; // 100 - homePossession
  homeDangerousAttacks: number;
  awayDangerousAttacks: number;
  dominanceDelta: number; // home - away
  isCurrentInterval: boolean;
  isProjected: boolean;
}

export interface MatchDynamicsData {
  oddsSeries: OddsIntervalPoint[];
  openingOdds: {
    homeWin: number;
    draw: number;
    awayWin: number;
    over25: number;
  };
  currentOdds: {
    homeWin: number;
    draw: number;
    awayWin: number;
    over25: number;
  };
  possessionSeries: PossessionIntervalPoint[];
  avgHomePossession: number;
  avgAwayPossession: number;
  peakHomeInterval: PossessionIntervalPoint;
  peakAwayInterval: PossessionIntervalPoint;
  momentumShifts: number;
}

function hashSeed(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

function seededNoise(seed: number, step: number): number {
  const x = Math.sin(seed * 0.001 + step * 12.9898) * 43758.5453;
  return x - Math.floor(x); // [0, 1)
}

function clampOdd(value: number): number {
  return Number(Math.max(1.06, Math.min(18.0, value)).toFixed(2));
}

export function generateMatchDynamicsData(match: MatchAnalysis): MatchDynamicsData {
  const seed = hashSeed(`${match.id}-${match.homeTeam}-${match.awayTeam}`);
  const isLive = match.status === 'live';
  const isFinished = match.status === 'finished';
  const liveMinute = isLive ? (match.liveMinute ?? 45) : isFinished ? 90 : 0;

  // Base odds from match or derived from stats
  const baseHome = match.odds?.homeWin ?? Number((1.65 + (seededNoise(seed, 1) * 1.45)).toFixed(2));
  const baseDraw = match.odds?.draw ?? Number((3.1 + (seededNoise(seed, 2) * 0.95)).toFixed(2));
  const baseAway = match.odds?.awayWin ?? Number((2.2 + (seededNoise(seed, 3) * 2.1)).toFixed(2));
  const baseOver25 = match.odds?.totalOver25 ?? Number((1.55 + (seededNoise(seed, 4) * 0.75)).toFixed(2));

  // Opening odds slight realistic drift from current/prematch baseline
  const openShiftHome = (seededNoise(seed, 11) - 0.48) * 0.24;
  const openShiftAway = -openShiftHome * 0.85 + (seededNoise(seed, 12) - 0.5) * 0.14;
  const openShiftDraw = (seededNoise(seed, 13) - 0.5) * 0.2;
  const openShiftOver = (seededNoise(seed, 14) - 0.5) * 0.16;

  const openingOdds = {
    homeWin: clampOdd(baseHome + openShiftHome),
    draw: clampOdd(baseDraw + openShiftDraw),
    awayWin: clampOdd(baseAway + openShiftAway),
    over25: clampOdd(baseOver25 + openShiftOver),
  };

  const intervals = match.intervals15?.intervals ?? [];
  const defaultIntervalLabels = [
    { id: '1-15', label: "1–15'", start: 1, end: 15, half: 1 as const },
    { id: '16-30', label: "16–30'", start: 16, end: 30, half: 1 as const },
    { id: '31-45', label: "31–45+'", start: 31, end: 45, half: 1 as const },
    { id: '46-60', label: "46–60'", start: 46, end: 60, half: 2 as const },
    { id: '61-75', label: "61–75'", start: 61, end: 75, half: 2 as const },
    { id: '76-90', label: "76–90+'", start: 76, end: 90, half: 2 as const },
  ];

  // Map live goals to 15-minute intervals
  const goalEvents = (match.liveEvents ?? []).filter((e) => e.type === 'goal' || e.type === 'penalty');
  const goalsByBucket: Record<number, { home: number; away: number; labels: string[] }> = {};
  for (const ev of goalEvents) {
    const bucketIdx = Math.min(5, Math.max(0, Math.floor((ev.minute - 1) / 15)));
    if (!goalsByBucket[bucketIdx]) {
      goalsByBucket[bucketIdx] = { home: 0, away: 0, labels: [] };
    }
    if (ev.team === 'home') goalsByBucket[bucketIdx].home += 1;
    else goalsByBucket[bucketIdx].away += 1;
    goalsByBucket[bucketIdx].labels.push(`${ev.minute}' ${ev.player}`);
  }

  // If live/finished match has score but no explicit liveEvents, distribute score deltas realistically
  const scoreHome = match.homeScore ?? 0;
  const scoreAway = match.awayScore ?? 0;
  const hasExplicitGoals = goalEvents.length > 0;
  const activeBucketsCount = isLive
    ? Math.max(1, Math.min(6, Math.ceil(liveMinute / 15)))
    : isFinished
    ? 6
    : 0;

  if (!hasExplicitGoals && (isLive || isFinished) && (scoreHome > 0 || scoreAway > 0)) {
    for (let g = 0; g < scoreHome; g++) {
      const idx = Math.floor(seededNoise(seed, 40 + g) * activeBucketsCount);
      if (!goalsByBucket[idx]) goalsByBucket[idx] = { home: 0, away: 0, labels: [] };
      goalsByBucket[idx].home += 1;
      goalsByBucket[idx].labels.push(`Гол: ${match.homeTeam}`);
    }
    for (let g = 0; g < scoreAway; g++) {
      const idx = Math.floor(seededNoise(seed, 60 + g) * activeBucketsCount);
      if (!goalsByBucket[idx]) goalsByBucket[idx] = { home: 0, away: 0, labels: [] };
      goalsByBucket[idx].away += 1;
      goalsByBucket[idx].labels.push(`Гол: ${match.awayTeam}`);
    }
  }

  // Build odds trajectory across Pre-match + six 15-min intervals
  const oddsSeries: OddsIntervalPoint[] = [
    {
      id: 'pre',
      label: 'Старт',
      minuteMark: 0,
      homeWin: openingOdds.homeWin,
      draw: openingOdds.draw,
      awayWin: openingOdds.awayWin,
      over25: openingOdds.over25,
      isProjected: false,
    },
  ];

  let curH = openingOdds.homeWin;
  let curD = openingOdds.draw;
  let curA = openingOdds.awayWin;
  let curO = openingOdds.over25;
  let runningHomeGoals = 0;
  let runningAwayGoals = 0;

  defaultIntervalLabels.forEach((slot, idx) => {
    const intData = intervals[idx];
    const bucketGoals = goalsByBucket[idx];
    const isProjected = !isFinished && (match.status === 'upcoming' || slot.start > liveMinute);

    if (bucketGoals && !isProjected) {
      runningHomeGoals += bucketGoals.home;
      runningAwayGoals += bucketGoals.away;
    }

    const homeAttackEdge = intData
      ? (intData.homeScoredPercent - intData.awayScoredPercent) / 100
      : (seededNoise(seed, 100 + idx) - 0.5) * 0.18;

    const jitterH = (seededNoise(seed, 200 + idx) - 0.5) * 0.14;
    const jitterD = (seededNoise(seed, 220 + idx) - 0.5) * 0.16;
    const jitterA = (seededNoise(seed, 240 + idx) - 0.5) * 0.18;
    const jitterO = (seededNoise(seed, 260 + idx) - 0.5) * 0.12;

    if (!isProjected) {
      // Actual in-play / historical odds adjustment
      const goalDiff = runningHomeGoals - runningAwayGoals;
      const totalGoals = runningHomeGoals + runningAwayGoals;

      // Apply event shock if a goal happened in this interval
      const homeGoalShock = bucketGoals ? bucketGoals.home * -0.45 + bucketGoals.away * 0.65 : 0;
      const awayGoalShock = bucketGoals ? bucketGoals.away * -0.5 + bucketGoals.home * 0.72 : 0;
      const drawGoalShock =
        goalDiff === 0
          ? -0.14 * ((idx + 1) / 6)
          : Math.abs(goalDiff) >= 2
          ? 0.55
          : 0.22;

      const overGoalShock =
        totalGoals >= 3
          ? -0.55
          : bucketGoals && bucketGoals.home + bucketGoals.away > 0
          ? -0.28 * (bucketGoals.home + bucketGoals.away)
          : 0.16;

      curH = clampOdd(curH + homeGoalShock - homeAttackEdge * 0.25 + jitterH);
      curA = clampOdd(curA + awayGoalShock + homeAttackEdge * 0.28 + jitterA);
      curD = clampOdd(curD + drawGoalShock + jitterD);
      curO = clampOdd(curO + overGoalShock + jitterO);

      // Anchor final completed slice near real match.odds if upcoming or early live
      if (idx === activeBucketsCount - 1 && match.odds && goalDiff === 0) {
        curH = clampOdd((curH + match.odds.homeWin) / 2);
        curD = clampOdd((curD + match.odds.draw) / 2);
        curA = clampOdd((curA + match.odds.awayWin) / 2);
        curO = clampOdd((curO + match.odds.totalOver25) / 2);
      }
    } else {
      // Projected market curve based on 15-min scoring intensity & time decay
      const peakBoost = intData?.isPeakDanger ? -0.11 : 0.08;
      curH = clampOdd(curH - homeAttackEdge * 0.22 + jitterH * 0.7);
      curA = clampOdd(curA + homeAttackEdge * 0.24 + jitterA * 0.7);
      curD = clampOdd(curD - 0.06 + jitterD * 0.6);
      curO = clampOdd(curO + peakBoost + jitterO * 0.6);
    }

    oddsSeries.push({
      id: slot.id,
      label: slot.label,
      minuteMark: slot.end,
      homeWin: curH,
      draw: curD,
      awayWin: curA,
      over25: curO,
      isProjected,
      goalEventText: bucketGoals?.labels.length ? bucketGoals.labels.join(', ') : undefined,
    });
  });

  // Determine "current" odds point (last non-projected slice, or pre-match baseline for upcoming)
  const lastActualIdx = isFinished
    ? oddsSeries.length - 1
    : isLive
    ? Math.max(1, Math.min(oddsSeries.length - 1, activeBucketsCount))
    : 0;
  const currentOddsPoint = oddsSeries[lastActualIdx];

  // Build 15-minute ball possession series grounded in pressureData & team strength
  const homeAvgStrength = match.homeTeamStats?.avgGoalsScored ?? 1.5;
  const awayAvgStrength = match.awayTeamStats?.avgGoalsScored ?? 1.3;
  const basePossessionFromStats = 50 + Math.round((homeAvgStrength - awayAvgStrength) * 6);
  const anchorHomePoss = match.pressureData?.homePossession ?? Math.min(64, Math.max(36, basePossessionFromStats));

  const possessionSeries: PossessionIntervalPoint[] = defaultIntervalLabels.map((slot, idx) => {
    const intData = intervals[idx];
    const intervalMomentum = intData
      ? (intData.homeScoredPercent - intData.awayScoredPercent) * 0.32 +
        (intData.awayConcededPercent - intData.homeConcededPercent) * 0.14
      : 0;

    // Natural game-state wave (home push early/late, away counter-control mid-game)
    const wave = Math.sin((idx + 1) * 1.15 + (seed % 7)) * 6.5;
    const scoreAdjust =
      (isLive || isFinished) && slot.start <= liveMinute
        ? scoreHome > scoreAway
          ? -3 // leading home side cedes slight possession
          : scoreAway > scoreHome
          ? 4 // trailing home side presses higher
          : 0
        : 0;

    const rawHome = Math.round(anchorHomePoss + intervalMomentum + wave + scoreAdjust);
    const homePossession = Math.max(28, Math.min(72, rawHome));
    const awayPossession = 100 - homePossession;

    const baseAttacks = Math.round(6 + seededNoise(seed, 300 + idx) * 8);
    const homeDangerousAttacks = Math.max(
      2,
      Math.round(baseAttacks * (homePossession / 50) + (intData?.homeGoalsScored ?? 0) * 0.6)
    );
    const awayDangerousAttacks = Math.max(
      2,
      Math.round(baseAttacks * (awayPossession / 50) + (intData?.awayGoalsScored ?? 0) * 0.6)
    );

    const isCurrentInterval = isLive && liveMinute >= slot.start && liveMinute <= slot.end;
    const isProjected = !isFinished && (match.status === 'upcoming' || slot.start > liveMinute);

    return {
      id: slot.id,
      label: slot.label,
      half: slot.half,
      minuteStart: slot.start,
      minuteEnd: slot.end,
      homePossession,
      awayPossession,
      homeDangerousAttacks,
      awayDangerousAttacks,
      dominanceDelta: homePossession - awayPossession,
      isCurrentInterval,
      isProjected,
    };
  });

  const avgHomePossession = Math.round(
    possessionSeries.reduce((sum, p) => sum + p.homePossession, 0) / possessionSeries.length
  );
  const avgAwayPossession = 100 - avgHomePossession;

  const peakHomeInterval = possessionSeries.reduce(
    (best, cur) => (cur.homePossession > best.homePossession ? cur : best),
    possessionSeries[0]
  );
  const peakAwayInterval = possessionSeries.reduce(
    (best, cur) => (cur.awayPossession > best.awayPossession ? cur : best),
    possessionSeries[0]
  );

  let momentumShifts = 0;
  for (let i = 1; i < possessionSeries.length; i++) {
    const prevLead = possessionSeries[i - 1].dominanceDelta >= 0;
    const curLead = possessionSeries[i].dominanceDelta >= 0;
    if (prevLead !== curLead) momentumShifts += 1;
  }

  return {
    oddsSeries,
    openingOdds,
    currentOdds: {
      homeWin: currentOddsPoint.homeWin,
      draw: currentOddsPoint.draw,
      awayWin: currentOddsPoint.awayWin,
      over25: currentOddsPoint.over25,
    },
    possessionSeries,
    avgHomePossession,
    avgAwayPossession,
    peakHomeInterval,
    peakAwayInterval,
    momentumShifts,
  };
}
