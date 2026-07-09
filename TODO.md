# TODO
[X] Project setup
[X] Ingest market data into DB
[X] Simple charting

## 4. Indicators
- [X] Build indicator API
- [X] Implement SMA
- [X] Implement EMA
- [X] Implement RSI
- [X] Implement MACD
- [X] Implement Bollinger Bands
- [X] Implement ATR
- [X] Overlay indicators on chart
- [X] Allow multiple indicators
- [X] Allow indicator parameter editing

## 5. Strategy Builder
- [X] Design strategy JSON schema
- [X] Build visual rule builder
- [X] Add indicator selection
- [X] Add comparison operators
- [X] Add Cross Above
- [X] Add Cross Below
- [X] Add AND / OR / NOT groups
- [X] Validate strategy before running
- [X] Persist strategies in SQLite (CRUD API)
- [X] Sync per-ticker chart state to SQLite (survives cleared browser storage)

## 6. Signal Generation
- [X] Generate buy signals
- [X] Generate sell signals
- [X] Overlay buy markers
- [X] Overlay sell markers
- [X] Verify signals visually

## 7. Backtesting Engine
- [X] Parse strategy
- [X] Execute historical simulation
- [X] Track portfolio value
- [X] Track positions
- [X] Track cash
- [X] Calculate trade history
- [X] Position sizing (buy % of equity, sell % of position; next-open fills)
- [X] Persist runs per strategy (history list + reopen without recompute)
- [X] Shareable result image (PNG export)

## 8. Results
- [X] Calculate total return
- [X] Calculate annualized return
- [X] Calculate max drawdown
- [X] Calculate win rate
- [X] Calculate average trade
- [X] Calculate profit factor
- [X] Calculate Sharpe ratio (optional)
- [X] Generate equity curve

## 9. Benchmark Comparison
- [ ] Compare against Buy & Hold
- [ ] Compare against SPY
- [ ] Display comparison chart
- [ ] Display benchmark metrics
