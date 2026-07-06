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
- [ ] Parse strategy
- [ ] Execute historical simulation
- [ ] Track portfolio value
- [ ] Track positions
- [ ] Track cash
- [ ] Calculate trade history

## 8. Results
- [ ] Calculate total return
- [ ] Calculate annualized return
- [ ] Calculate max drawdown
- [ ] Calculate win rate
- [ ] Calculate average trade
- [ ] Calculate profit factor
- [ ] Calculate Sharpe ratio (optional)
- [ ] Generate equity curve

## 9. Benchmark Comparison
- [ ] Compare against Buy & Hold
- [ ] Compare against SPY
- [ ] Display comparison chart
- [ ] Display benchmark metrics
