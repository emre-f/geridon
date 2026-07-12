# Optimization benchmark results

Run with `npm run bench` (seeded, deterministic workloads; MACD-cross + RSI-filter
strategy, 40-trial random search with successive halving, anchored folds).
"Fold backtests" counts every indicator+signal+simulation pass: trials, baseline,
buy & hold, and ablation. Peak RSS is sampled after every finished trial.

## 2026-07-12 — node v22.22.2, Apple M2 Max, darwin arm64

| workload               | trials | fold backtests | elapsed ms | evals/sec | peak RSS MB |
| ---------------------- | ------ | -------------- | ---------- | --------- | ----------- |
| 1d (5y, 1250 candles)  | 40     | 143            | 959        | 149       | 134         |
| 1h (6mo, 3500 candles) | 40     | 195            | 3,460      | 56        | 169         |

### Conclusion

At 56–149 fold backtests/second single-threaded, a maximum-size experiment
(500 trials, ~3–4 folds evaluated per trial after halving) completes in well
under a minute on daily data and in a few minutes on intraday data — far inside
the 30-minute runtime cap — with peak memory under 200 MB. Plain TypeScript
signal evaluation is fast enough; no native dependency or second
language/runtime is justified at current workloads. Re-run and append a row
here before revisiting that decision.
