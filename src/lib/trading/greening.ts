// Greening calculations — PRD §6.4.
//
// A "green-up" closes an open position (back or lay) by placing an opposing
// bet sized so that the net P&L is identical regardless of whether the runner
// wins or loses. In a scalp, greening is how you lock in the profit once the
// market has moved in your favour, or cap the loss during a forced exit.
//
// Core identity, derived from equalising the win and lose branches:
//
//   Back-first: lay_stake = (back_stake × back_odds) / current_lay_odds
//   Lay-first:  back_stake = (lay_stake × lay_odds)  / current_back_odds
//
// Idealised (unrounded) profit:
//   Back-first: back_stake × (back_odds         - current_lay_odds) / current_lay_odds
//   Lay-first:  lay_stake  × (current_back_odds - lay_odds)         / current_back_odds
//
// Betfair requires stakes in whole pence, so the actual submitted stake is
// the raw formula's result rounded to 2dp. After that rounding, the two
// branches of the greened book no longer net to the same penny: one branch
// realises exactly the idealised profit, the other is up to ~1p off. The
// "guaranteed" profit we expose is the *branch minimum* computed from the
// rounded stake — the true floor a trader will realise, not the idealised
// value. The upside penny lands on the opposite branch.
//
// Positive value = market moved in your favour (back-first closed at lower
// odds, lay-first closed at higher). Negative = forced exit into a bad price.

export type PositionSide = "back" | "lay";

export type OpenPosition = {
  side: PositionSide;
  stake: number;
  odds: number;
};

export type GreenUpQuote = {
  closingSide: PositionSide;
  closingStake: number;
  closingOdds: number;
  guaranteedProfit: number;
};

// Stake increments on Betfair are £0.01. Round closing stakes to 2dp so we
// never submit a sub-penny order.
//
// P&L values (guaranteedProfit, netOutcome results) are NOT rounded — they're
// kept as exact floats. Rounding them at this layer would let the quoted
// "guaranteed floor" subtly overstate the realised minimum (half-up rounding
// pushes 13.0186 to 13.02, above the 13.0186 that actually settles). The UI
// formats P&L to 2dp at render time; aggregations use the exact float.
export const STAKE_PRECISION = 2;

function roundStake(stake: number): number {
  const factor = 10 ** STAKE_PRECISION;
  return Math.round(stake * factor) / factor;
}

function validateOdds(name: string, odds: number): void {
  if (!Number.isFinite(odds) || odds <= 1) {
    throw new Error(`${name} must be a finite number > 1 (got ${odds})`);
  }
}

function validateStake(name: string, stake: number): void {
  if (!Number.isFinite(stake) || stake <= 0) {
    throw new Error(`${name} must be a finite positive number (got ${stake})`);
  }
}

// PRD §6.4 raw formula, exposed so other code (and tests) can build on it.
export function greenUpLayStake(
  backStake: number,
  backOdds: number,
  currentLayOdds: number
): number {
  validateStake("backStake", backStake);
  validateOdds("backOdds", backOdds);
  validateOdds("currentLayOdds", currentLayOdds);
  return (backStake * backOdds) / currentLayOdds;
}

export function greenUpBackStake(
  layStake: number,
  layOdds: number,
  currentBackOdds: number
): number {
  validateStake("layStake", layStake);
  validateOdds("layOdds", layOdds);
  validateOdds("currentBackOdds", currentBackOdds);
  return (layStake * layOdds) / currentBackOdds;
}

// Compute the greening bet that closes an open position against the current
// market. `oppositePrice` is the price on the opposing side at which the
// closing bet will be placed (current best lay if you backed, current best
// back if you layed).
//
// `guaranteedProfit` is the minimum of the two branches (win/lose) computed
// from the ROUNDED closing stake — i.e. the floor the trader will actually
// realise once the bet is placed. One branch will come in higher by up to
// ~1p; that penny is an upside, not a forecast we promise.
export function computeGreenUp(
  position: OpenPosition,
  oppositePrice: number
): GreenUpQuote {
  validateStake("position.stake", position.stake);
  validateOdds("position.odds", position.odds);
  validateOdds("oppositePrice", oppositePrice);

  const rawClosingStake =
    position.side === "back"
      ? greenUpLayStake(position.stake, position.odds, oppositePrice)
      : greenUpBackStake(position.stake, position.odds, oppositePrice);
  const closingStake = roundStake(rawClosingStake);
  const closingSide: PositionSide = position.side === "back" ? "lay" : "back";

  // Compute realised P&L of both branches using the ROUNDED stake — this is
  // what actually settles. The guaranteed floor is the worse of the two,
  // kept as an exact float so we never overstate the floor by sub-penny
  // rounding drift.
  const book = netOutcome([
    position,
    { side: closingSide, stake: closingStake, odds: oppositePrice },
  ]);
  const guaranteedProfit = Math.min(book.ifWin, book.ifLose);

  return {
    closingSide,
    closingStake,
    closingOdds: oppositePrice,
    guaranteedProfit,
  };
}

// Verify greening math end-to-end: given a position and a closing bet, return
// the net P&L for each outcome. Used by tests and the paper-trade executor to
// confirm that books balance after a green-up.
export function simulateOutcome(args: {
  side: PositionSide;
  stake: number;
  odds: number;
}): { ifWin: number; ifLose: number } {
  validateStake("stake", args.stake);
  validateOdds("odds", args.odds);
  if (args.side === "back") {
    return { ifWin: args.stake * (args.odds - 1), ifLose: -args.stake };
  }
  return { ifWin: -args.stake * (args.odds - 1), ifLose: args.stake };
}

export function netOutcome(
  bets: Array<{ side: PositionSide; stake: number; odds: number }>
): { ifWin: number; ifLose: number } {
  return bets.reduce(
    (acc, b) => {
      const sim = simulateOutcome(b);
      return { ifWin: acc.ifWin + sim.ifWin, ifLose: acc.ifLose + sim.ifLose };
    },
    { ifWin: 0, ifLose: 0 }
  );
}
