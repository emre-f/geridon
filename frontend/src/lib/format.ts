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

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    ...fractionDigits,
  }).format(value);
}

export function formatCompact(value: number) {
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 2,
  }).format(value);
}

function compactNumber(value: number) {
  return new Intl.NumberFormat("en-US", {
    notation: Math.abs(value) >= 1000 ? "compact" : "standard",
    maximumFractionDigits: 2,
  }).format(value);
}

export function formatCompactCurrency(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: Math.abs(value) >= 1000 ? "compact" : "standard",
    maximumFractionDigits: 2,
  }).format(value);
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
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(date);
  }

  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(date);
}
