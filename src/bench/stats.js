export function summarize(times) {
  const sorted = [...times].sort((a, b) => a - b)
  const n = sorted.length
  const sum = sorted.reduce((a, b) => a + b, 0)

  const median = n % 2 === 0
    ? (sorted[n / 2 - 1] + sorted[n / 2]) / 2
    : sorted[(n - 1) / 2]

  const percentile = (q) => {
    const pos  = q * (n - 1)
    const lo   = Math.floor(pos)
    const hi   = Math.ceil(pos)
    const frac = pos - lo
    return sorted[lo] + (sorted[hi] - sorted[lo]) * frac
  }

  return {
    n,
    min:    sorted[0],
    median,
    mean:   sum / n,
    p95:    percentile(0.95),
    p99:    percentile(0.99),
    max:    sorted[n - 1],
  }
}

export const fmt = ms => ms.toFixed(3)
