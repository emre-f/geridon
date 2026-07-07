// Intl constructors allocate locale tables on every call, so all formatters
// are hoisted to module scope; currency formatting caches per digit config.
const currencyFormatters = new Map<string, Intl.NumberFormat>();
const compactFormat = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 2,
});
const standardFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
const compactCurrencyFormat = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 2,
});
const standardCurrencyFormat = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});
const intradayDateFormat = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});
const dailyDateFormat = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "numeric",
});

function currencyFractionDigits(value: number) {
  const absoluteValue = Math.abs(value);

  if (absoluteValue === 0) {
    return { minimumFractionDigits: 2, maximumFractionDigits: 2 };
  }

  if (absoluteValue < 1) {
    const significantDecimals = Math.ceil(-Math.log10(absoluteValue)) + 3;

    return {
      minimumFractionDigits: 0,
      maximumFractionDigits: significantDecimals,
    };
  }

  return {
    minimumFractionDigits: 2,
    maximumFractionDigits: absoluteValue < 10 ? 3 : 2,
  };
}

export function formatCurrency(value: number) {
  const fractionDigits = currencyFractionDigits(value);
  const key = `${fractionDigits.minimumFractionDigits}-${fractionDigits.maximumFractionDigits}`;
  let formatter = currencyFormatters.get(key);

  if (!formatter) {
    formatter = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      ...fractionDigits,
    });
    currencyFormatters.set(key, formatter);
  }

  return formatter.format(value);
}

export function formatCompact(value: number) {
  return compactFormat.format(value);
}

function compactNumber(value: number) {
  return (Math.abs(value) >= 1000 ? compactFormat : standardFormat).format(value);
}

export function formatCompactCurrency(value: number) {
  return (Math.abs(value) >= 1000 ? compactCurrencyFormat : standardCurrencyFormat).format(value);
}

export function formatPercent(value: number) {
  return `${value > 0 ? "+" : ""}${compactNumber(value)}%`;
}

export function formatAbsolutePercent(value: number) {
  return `${compactNumber(Math.abs(value))}%`;
}

export function formatDate(ms: number, timeframe: string) {
  const date = new Date(ms);

  if (timeframe === "1h" || timeframe === "4h") {
    return intradayDateFormat.format(date);
  }

  return dailyDateFormat.format(date);
}
