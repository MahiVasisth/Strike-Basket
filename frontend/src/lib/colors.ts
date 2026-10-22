// One colour per market, used on the ring, dots, bars and charts.
const BY_SYMBOL: Record<string, string> = {
  "SPCX-USD": "#4D7CFF",
  "ZHIPU-USD": "#FFB020",
  "UNITREE-USD": "#18E2A0",
  "MINIMAX-USD": "#FF3D8B",
  "BTC-USD": "#FFB020",
  "ETH-USD": "#7C9BFF",
};
const FALLBACK = ["#4D7CFF", "#FFB020", "#18E2A0", "#FF3D8B", "#7C9BFF", "#9D7BFF"];

/** Known markets keep their colour; future baskets take colours from the list by index. */
export function marketColor(symbol: string, index: number) {
  return BY_SYMBOL[symbol] ?? FALLBACK[Math.max(0, index) % FALLBACK.length];
}

export function colorsFor(constituents: { symbol: string }[]) {
  return (symbol: string) => marketColor(symbol, constituents.findIndex((c) => c.symbol === symbol));
}
