# Product Requirements Document: GambleKing

**Version:** 1.0
**Date:** April 16, 2026
**Author:** Manus AI
**Project:** GambleKing — Automated Betfair Exchange Trading Platform

---

## Table of Contents

1. [Introduction](#1-introduction)
2. [Market Strategy: Pre-Race Horse Racing Scalping](#2-market-strategy-pre-race-horse-racing-scalping)
3. [System Architecture and Integration Roadmap](#3-system-architecture-and-integration-roadmap)
4. [Phase 1 Requirements: Bet Angel Integration](#4-phase-1-requirements-bet-angel-integration)
5. [Phase 2 Requirements: Direct Betfair API Integration](#5-phase-2-requirements-direct-betfair-api-integration)
6. [Core Feature Specifications](#6-core-feature-specifications)
7. [Risk Management and Loss Stops](#7-risk-management-and-loss-stops)
8. [User Interface Requirements](#8-user-interface-requirements)
9. [Non-Functional Requirements](#9-non-functional-requirements)
10. [Constraints, Assumptions, and Dependencies](#10-constraints-assumptions-and-dependencies)
11. [Glossary](#11-glossary)
12. [References](#12-references)

---

## 1. Introduction

### 1.1 Purpose

This Product Requirements Document (PRD) defines the specifications, features, and technical architecture for **GambleKing**, an automated algorithmic trading application designed to exploit known, repeatable trends in betting exchange markets. The document serves as the authoritative reference for all development, design, and testing activities throughout the project lifecycle.

The initial market focus is **pre-race horse racing scalping** on the Betfair Exchange. The application is designed to be entirely out of the market before any race commences, eliminating in-play risk entirely. The strategy is characterised by low per-trade returns offset by high trade volume, generating cumulative profitability over time.

### 1.2 Product Vision

GambleKing is envisioned as a two-phase platform. In **Phase 1**, the application integrates with **Bet Angel Professional** — leveraging its Excel spreadsheet automation and local JSON API — as a rapid, lower-risk path to live market operation. In **Phase 2**, the application transitions to **direct Betfair Exchange API integration**, removing the Bet Angel dependency and achieving lower latency, greater architectural control, and reduced operational costs.

The core product philosophy is: **automate the edge, control the risk**. Every trade is governed by strict stop-loss rules, and the system is architecturally incapable of holding an open position into a live race.

### 1.3 Target Users

| User Type | Description |
|---|---|
| Algorithmic Trader | A technically proficient individual seeking to automate a proven manual scalping strategy |
| Betting Syndicate | A group of traders sharing a single Betfair account and strategy configuration |
| Quantitative Developer | A developer building and testing new betting market models using GambleKing's infrastructure |

### 1.4 Scope

This document covers the horse racing scalping module as the first betting market to be exploited. Future market expansions (e.g., football, greyhound racing) are acknowledged in the roadmap but are out of scope for this version of the PRD.

---

## 2. Market Strategy: Pre-Race Horse Racing Scalping

### 2.1 What is Betfair Exchange Scalping?

The Betfair Exchange operates as a peer-to-peer betting marketplace where participants can both **back** (bet for a selection to win) and **lay** (bet against a selection winning). This creates a two-sided order book with a spread between the best available back price and the best available lay price — analogous to a bid-ask spread in financial markets.

**Scalping** is the strategy of profiting from this spread by simultaneously offering a back bet at the current lay price and a lay bet at the current back price. If both orders are matched by other market participants, the trader captures the spread as profit without any directional exposure to the outcome of the race [1].

> "Scalping is a strategy that is typically defined as just going for a very small profit by nipping in and out of the market quickly. The key to scalping is that you're just going for a one-tick profit, where a 'tick' is just one movement in the betting odds." — Peter Webb, Bet Angel [1]

A single tick profit on a £100 stake at odds of 6.0 (where the tick increment is 0.2) yields a profit of £20 on the trade. Repeated across dozens of trades per session, this compounds into meaningful returns.

### 2.2 Betfair Tick Size Reference

Betfair uses variable price increments (ticks) depending on the odds range. GambleKing must implement this table precisely to calculate correct order prices and stop-loss offsets [8].

| Odds Range | Tick Increment |
|---|---|
| 1.01 → 2.00 | 0.01 |
| 2.00 → 3.00 | 0.02 |
| 3.00 → 4.00 | 0.05 |
| 4.00 → 6.00 | 0.10 |
| 6.00 → 10.00 | 0.20 |
| 10.00 → 20.00 | 0.50 |
| 20.00 → 30.00 | 1.00 |
| 30.00 → 50.00 | 2.00 |
| 50.00 → 100.00 | 5.00 |
| 100.00 → 1000.00 | 10.00 |

### 2.3 Ideal Market Conditions

Not all horse racing markets are suitable for scalping. The system must evaluate and select markets and runners based on the following criteria, in order of priority [1] [2]:

**High Liquidity.** Markets with large total matched volumes are preferred. High-quality race meetings (e.g., Group 1 races, major handicaps) and competitive fields attract the most money, creating deep order books where both sides of a scalp trade can be filled rapidly. Low-grade maiden races with unraced horses are explicitly unsuitable, as price uncertainty creates rapid and unpredictable movement.

**Price Stability.** The target runner must exhibit a stable, range-bound price over a rolling short-term window (e.g., the last 30–60 seconds). A runner whose price is drifting (lengthening) or steaming (shortening) rapidly is unsuitable for scalping, as the directional movement makes it likely that only one side of the paired order will be matched.

**Balanced Order Book Depth.** The unmatched money queued immediately behind the current best back and lay prices should be approximately equal on both sides. A significant imbalance — for example, £200 waiting on the lay side but only £15 on the back side — indicates that one order will be matched almost immediately while the other may be stranded, forcing a scratch or loss [2].

### 2.4 Trade Lifecycle

The complete lifecycle of a single scalp trade within GambleKing is as follows:

1. **Market Scan:** The system identifies qualifying races and runners meeting the criteria defined in Section 2.3.
2. **Order Placement:** A paired back and lay order is submitted simultaneously at the current spread prices.
3. **Monitoring:** The system monitors the matched status of both orders and tracks the current market price.
4. **Successful Exit:** Both orders are matched. The trade is profitable. The system logs the result and may immediately re-enter the market on the same or a different runner.
5. **Stop-Loss Trigger:** If the market price moves adversely by a configurable number of ticks before both orders are matched, the stop-loss module cancels the unmatched order and places a closing order to exit the position at a controlled loss.
6. **Pre-Race Forced Exit:** Regardless of trade status, all open positions and unmatched orders are forcibly cancelled and closed a configurable number of seconds before the scheduled race start time.

---

## 3. System Architecture and Integration Roadmap

### 3.1 High-Level Architecture

GambleKing is structured as a three-tier application:

| Tier | Technology | Responsibility |
|---|---|---|
| **Presentation** | React (TypeScript) | Dashboard, configuration, analytics, live market view |
| **Application** | Node.js (TypeScript) | Strategy engine, order management, risk management, API integration |
| **Data** | PostgreSQL / MongoDB | Trade logs, market data history, configuration state |

The application backend exposes a WebSocket connection to the React frontend to push real-time market data and trade status updates. All external exchange communication flows exclusively through the Node.js application layer.

### 3.2 Integration Roadmap

The project is structured in two distinct integration phases, with a clear migration path between them.

**Phase 1 — Bet Angel Bridge (Months 1–3):** The Node.js backend communicates with a locally running instance of Bet Angel Professional via its local JSON API (default port 9000). Bet Angel acts as the authenticated Betfair session manager and order execution engine. This approach dramatically reduces the complexity of initial development by delegating authentication, session management, and order routing to a proven third-party tool.

**Phase 2 — Direct Betfair API (Months 4+):** The Bet Angel dependency is removed. The Node.js backend connects directly to the Betfair Exchange API using the JSON-RPC Betting API for order management and the Exchange Stream API (TCP/TLS) for real-time market data. This phase delivers lower latency, removes the Bet Angel licensing cost dependency, and enables deployment to cloud infrastructure.

---

## 4. Phase 1 Requirements: Bet Angel Integration

### 4.1 Bet Angel Professional Prerequisites

The following Bet Angel Professional features must be configured and active for Phase 1 operation:

- Bet Angel Professional (licensed, active subscription) must be running on the same machine as the GambleKing Node.js backend.
- The **Bet Angel API** must be activated in Bet Angel Settings, with the JSON API enabled on a specified port (default: 9000) [4].
- The **Guardian** multi-market tool must be used to load and manage multiple horse racing markets simultaneously [5].
- **Excel Integration** must be configured for markets where spreadsheet-based automation rules are used as a fallback or supplementary execution method [3].

### 4.2 Bet Angel API Integration (Node.js)

The Bet Angel API accepts and returns **JSON-formatted messages** over HTTP, callable from any language. GambleKing's Node.js backend will use this API as its primary execution channel in Phase 1 [4].

The API is organized into four discrete components, all of which GambleKing will utilize:

| API Component | GambleKing Usage |
|---|---|
| **Markets Component** | Retrieve available horse racing markets, market IDs, and runner details |
| **Betting Component** | Place back and lay orders, cancel unmatched orders, retrieve matched bet status |
| **Guardian Component** | Programmatically manage the Guardian market watchlist |
| **Automation Component** | Trigger and manage Bet Angel's built-in automation rules where applicable |

### 4.3 Excel Spreadsheet Integration

Bet Angel's Excel integration provides a two-way data bridge: real-time market data (prices, volumes, matched amounts) is streamed into a linked spreadsheet, and bet commands written into designated cells are read and executed by Bet Angel [3].

GambleKing will use this integration in the following scenarios:

- **Fallback Execution:** If the Bet Angel JSON API is unavailable, the system can write bet commands directly to the linked Excel spreadsheet via a COM automation interface from Node.js.
- **Strategy Prototyping:** New scalping rule variants can be rapidly prototyped using Excel formulas and VBA before being ported to the Node.js strategy engine.
- **Stop-Loss via Spreadsheet:** Bet Angel's native Excel integration supports global settings such as stop losses, offset bets, and green-up commands written as text strings in designated cells [3].

### 4.4 Guardian Configuration

Bet Angel's Guardian tool enables simultaneous management of multiple markets. GambleKing will programmatically populate Guardian with the day's target horse racing markets via the Guardian API component, applying a consistent set of automation rules to each market.

---

## 5. Phase 2 Requirements: Direct Betfair API Integration

### 5.1 Betfair API Overview

The Betfair Exchange API comprises three primary services [6]:

| Service | Protocol | Purpose |
|---|---|---|
| **Betting API** | JSON-RPC over HTTPS | Market navigation, odds retrieval, order placement and cancellation |
| **Accounts API** | JSON-RPC over HTTPS | Account balance, statement, and funds management |
| **Exchange Stream API** | JSON over TCP/TLS | Low-latency real-time subscription to market and order data |

### 5.2 Authentication

Betfair API authentication requires a valid Application Key (App Key) and a Session Token (SSO token) obtained via the Betfair login endpoint. GambleKing must implement non-interactive (certificate-based) login to support unattended automated operation [6].

- A **Delayed App Key** (free) is available for development and testing with a data delay.
- A **Live App Key** (one-off activation fee of £499 debited from the Betfair account) is required for live trading with real-time data [6].

### 5.3 Exchange Stream API

The Exchange Stream API is the critical component for Phase 2 scalping, providing the low-latency market data required for competitive order placement. Key characteristics:

- Operates over a persistent TCP/TLS connection (port 443).
- Delivers incremental market change messages (MCM) containing price ladder updates, matched volumes, and order status changes.
- Supports market-level and order-level subscriptions.
- GambleKing will subscribe to the `EX_BEST_OFFERS` and `EX_TRADED` data fields for the target horse racing markets.

### 5.4 Node.js/TypeScript Libraries

GambleKing will leverage the open-source `betfair-node` TypeScript library [7], which provides:

- Full JSON-RPC API integration for the Betting and Accounts APIs.
- Real-time Exchange Stream API support.
- TypeScript type definitions for all Betfair data structures.

### 5.5 API Rate Limits and Charges

The following operational constraints must be respected by the GambleKing application:

| Constraint | Limit |
|---|---|
| Login requests | 100 per minute |
| Historical Data API requests | 100 per 10 seconds |
| Transaction charges | Apply after 1,000 bets per hour |
| Commission | Charged on net winnings per market (Market Base Rate, typically 5–7%) |

---

## 6. Core Feature Specifications

### 6.1 Market Scanner

The market scanner is a background service that runs continuously during trading hours. It queries the Betfair API (via Bet Angel in Phase 1, directly in Phase 2) for all upcoming UK and Irish horse racing markets within a configurable time window (e.g., the next 4 hours).

For each market, the scanner evaluates:
- Total matched volume (minimum configurable threshold, e.g., £50,000).
- Number of runners (configurable range, e.g., 6–20 runners preferred).
- Race type and class (configurable filter to exclude low-grade maidens and novice hurdles).
- Time to race start (markets must have at least a configurable minimum time remaining, e.g., 5 minutes, to allow for sufficient scalping activity).

Markets passing all filters are added to the active trading queue.

### 6.2 Runner Selection Algorithm

Within each qualified market, the runner selection algorithm evaluates each runner in real time against the following signals:

- **Price Volatility Score:** Calculated from the standard deviation of the best back price over a rolling 30-second window. Runners with a score below a configurable threshold are flagged as scalp candidates.
- **Order Book Balance Ratio:** The ratio of unmatched money at the best back price versus the best lay price. A ratio between 0.7 and 1.3 (configurable) indicates a balanced book.
- **Traded Volume Rank:** Runners with the highest traded volume within the market are preferred, as deeper liquidity reduces slippage risk.

### 6.3 Order Management System

The Order Management System (OMS) is the core execution component. It must:

- Maintain an internal order book tracking all submitted, matched, and cancelled orders.
- Assign a unique trade ID to each paired scalp order (back + lay).
- Track the matched/unmatched status of each leg of a trade independently.
- Expose a real-time order status feed to the React frontend via WebSocket.
- Enforce the maximum concurrent open trades limit (configurable, e.g., 5 trades per market).

### 6.4 Greening Up

When a trade is to be closed for a profit (or controlled loss), the system calculates the **green-up bet**: a single bet placed at the current market price that equalises the profit or loss across all runners in the market. This ensures the position is fully closed regardless of the race result [10].

The green-up calculation is:

```
Green-up stake = (Back stake × Back odds) / Current lay odds
```

---

## 7. Risk Management and Loss Stops

Risk management is a first-class concern in GambleKing. The following mechanisms are mandatory and cannot be disabled by the user.

### 7.1 Per-Trade Stop-Loss

Every scalp trade is assigned a stop-loss at the point of order placement. The stop-loss is defined in **ticks** from the entry price (configurable, default: 2 ticks).

The stop-loss logic operates as follows:

1. After one leg of a paired order is matched, the system begins monitoring the current best price of the matched leg.
2. If the price moves adversely by the configured stop-loss tick count, the unmatched opposing leg is immediately cancelled.
3. A closing order is placed at the current market price to exit the matched leg, accepting the controlled loss.
4. The trade is logged as a stop-loss exit.

The stop-loss is implemented as a server-side process within the Node.js application, not as an exchange-side conditional order, to ensure it responds to real-time price data [9].

### 7.2 Pre-Race Forced Exit

This is the most critical risk control in the system. All open positions and unmatched orders in a given market **must** be closed before the race starts. The system implements a two-stage forced exit:

| Stage | Trigger | Action |
|---|---|---|
| **Warning Stage** | Configurable time before start (default: 60 seconds) | System stops opening new trades in this market; alerts the dashboard |
| **Hard Exit Stage** | Configurable time before start (default: 10 seconds) | All unmatched orders are cancelled; all open positions are greened up at the current market price |

The race start time is obtained from the Betfair API's `listRaceDetails` endpoint, which provides the official race status and start time for horse racing markets. The system uses this, not the scheduled start time, to account for delayed starts.

### 7.3 Daily Loss Limit

A configurable daily loss limit (e.g., £200) is enforced at the session level. When the cumulative net P&L for the day reaches the configured loss limit, all trading activity is suspended for the remainder of the day and the user is alerted via the dashboard.

### 7.4 Maximum Stake Limits

Each trade has a configurable maximum stake (e.g., £200 per leg). The system will reject any order that would exceed this limit. A separate maximum liability limit is enforced for lay bets, calculated as `(lay odds - 1) × lay stake`.

### 7.5 Connection Loss Failsafe

If the connection to the Betfair API (or Bet Angel in Phase 1) is interrupted, the system must:

1. Immediately attempt reconnection with exponential backoff.
2. If reconnection fails within 30 seconds and there are open positions, trigger an emergency alert to the user.
3. In Phase 2, maintain a local cache of open orders and attempt to cancel them upon reconnection.

---

## 8. User Interface Requirements

The React frontend provides the operational control centre for GambleKing. It communicates with the Node.js backend via a REST API for configuration and a WebSocket connection for real-time data.

### 8.1 Dashboard Overview

The main dashboard provides a real-time summary of the current trading session:

- **Session P&L:** Running total of profit and loss for the current day, displayed prominently.
- **Active Markets:** A list of markets currently being traded, with time to race start and current status.
- **Trade Feed:** A live-updating log of recent trades, showing entry price, exit price, P&L, and exit reason (profit, stop-loss, forced exit).
- **System Status:** Connection status indicators for the Bet Angel API (Phase 1) or Betfair Stream API (Phase 2).

### 8.2 Market Detail View

Clicking on an active market opens a detailed view showing:

- The current odds ladder for each runner, with live price updates.
- Matched volume bars at each price level.
- Active orders for the current market, with matched/unmatched status.
- The countdown timer to the forced exit trigger.

### 8.3 Strategy Configuration Panel

The configuration panel allows the user to adjust the following parameters, with changes taking effect on the next trade cycle:

| Parameter | Description | Default |
|---|---|---|
| `scalp_stake` | Stake size per scalp trade leg (£) | £50 |
| `stop_loss_ticks` | Number of adverse ticks before stop-loss triggers | 2 |
| `pre_race_exit_seconds` | Seconds before start to trigger hard exit | 10 |
| `pre_race_warning_seconds` | Seconds before start to stop new trades | 60 |
| `min_market_volume` | Minimum total matched volume to qualify a market (£) | £50,000 |
| `max_concurrent_trades` | Maximum open trades per market | 5 |
| `daily_loss_limit` | Maximum daily loss before trading suspends (£) | £200 |
| `max_stake_per_trade` | Maximum stake per individual order leg (£) | £200 |

### 8.4 Performance Analytics

A dedicated analytics section provides historical performance reporting:

- P&L over time (daily, weekly, monthly charts).
- Trade success rate (percentage of trades closed at profit vs. stop-loss).
- Average profit per winning trade vs. average loss per stop-loss trade.
- Best and worst performing markets and runners.
- Commission costs summary.

---

## 9. Non-Functional Requirements

### 9.1 Performance and Latency

In Phase 1, the system's latency is bounded by the Bet Angel API response time, which is acceptable given the pre-race (non-in-play) nature of the strategy. In Phase 2, the Exchange Stream API delivers sub-second price updates, and the Node.js application must process these and submit orders within a target of **under 200 milliseconds** from signal detection to order submission.

The Node.js event loop must be kept free of blocking operations. All I/O operations (database writes, API calls) must be fully asynchronous.

### 9.2 Reliability and Uptime

The application must achieve **99.5% uptime** during configured trading hours. The following reliability measures are required:

- Automated process restart via a process manager (e.g., PM2) in the event of an application crash.
- Graceful shutdown handling that ensures all open positions are closed before the process terminates.
- Comprehensive structured logging (e.g., using Winston or Pino) for all trade events, API calls, and errors.

### 9.3 Security

- All API credentials (Betfair App Key, session tokens, Bet Angel credentials) must be stored in environment variables or a secrets manager, never in source code or configuration files.
- The React frontend must communicate with the Node.js backend over HTTPS/WSS in production.
- Input validation must be applied to all user-configurable parameters to prevent invalid or dangerous values from being submitted to the exchange.

### 9.4 Testability

- The strategy engine must be fully unit-testable with a mock market data provider, enabling backtesting against historical Betfair data without live API calls.
- Betfair provides a **Delayed App Key** for development, which returns real market data with a delay — this must be used for all non-production testing.
- A **paper trading mode** must be implemented in Phase 1, where the system simulates trade execution using live market data without placing real orders.

### 9.5 Maintainability

- The codebase must adhere to a consistent TypeScript style guide (e.g., ESLint with a standard ruleset).
- The strategy engine, OMS, risk management module, and API integration layers must be cleanly separated into discrete modules to facilitate independent testing and future market expansion.

---

## 10. Constraints, Assumptions, and Dependencies

### 10.1 Constraints

- **Regulatory Compliance:** The application must operate within the terms of service of the Betfair Exchange and comply with applicable gambling regulations in the user's jurisdiction. Betfair reserves the right to restrict or close accounts engaged in systematic trading.
- **Betfair Commission:** The Market Base Rate commission (typically 5–7% on net winnings per market) directly impacts scalping profitability and must be factored into all P&L calculations and strategy viability assessments.
- **Bet Angel Licensing (Phase 1):** Phase 1 operation requires an active Bet Angel Professional subscription and a Windows environment to run the Bet Angel desktop application.
- **Live App Key Cost (Phase 2):** A one-off £499 activation fee is required for the Betfair Live App Key needed for real-time data in Phase 2.

### 10.2 Assumptions

- The user has an active, funded Betfair Exchange account with API access enabled.
- The target horse racing markets (UK and Irish) provide sufficient liquidity for the scalping strategy to be viable during normal trading hours.
- The user is responsible for ensuring compliance with all applicable laws and regulations regarding automated betting in their jurisdiction.

### 10.3 Dependencies

| Dependency | Phase | Purpose |
|---|---|---|
| Bet Angel Professional | Phase 1 | Execution engine and Betfair session manager |
| Microsoft Excel | Phase 1 | Fallback automation and strategy prototyping |
| Betfair Exchange API | Phase 2 | Direct market data and order execution |
| `betfair-node` npm package | Phase 2 | TypeScript wrapper for Betfair API |
| Node.js ≥ 20 LTS | Both | Backend runtime |
| React ≥ 18 | Both | Frontend framework |
| PostgreSQL or MongoDB | Both | Persistent data storage |

---

## 11. Glossary

| Term | Definition |
|---|---|
| **Back Bet** | A bet placed for a selection to win. The backer wins if the selection wins. |
| **Lay Bet** | A bet placed against a selection winning. The layer wins if the selection loses. |
| **Tick** | The minimum price increment on the Betfair Exchange, which varies by odds range. |
| **Scalping** | A trading strategy that profits from the spread between back and lay prices via high-frequency, low-margin trades. |
| **Greening Up** | Placing a closing bet to equalise profit or loss across all runners in a market, ensuring a guaranteed outcome regardless of the race result. |
| **Stop-Loss** | An automated order or rule that closes a losing position once it reaches a predefined loss threshold. |
| **Spread** | The difference between the best available back price and the best available lay price in a market. |
| **Liquidity** | The volume of money available to be matched in a market at any given time. |
| **Steam** | A rapid, sustained shortening of a selection's odds, indicating strong backing activity. |
| **Drift** | A rapid, sustained lengthening of a selection's odds, indicating strong laying activity. |
| **Guardian** | Bet Angel's multi-market management tool for monitoring and trading multiple markets simultaneously. |
| **Exchange Stream API** | Betfair's low-latency TCP/TLS service for real-time market data subscriptions. |
| **App Key** | A unique identifier required to authenticate with the Betfair Exchange API. |

---

## 12. References

[1] [Horse Racing Betting Strategy: How to scalp on the Betfair Exchange — Betting.Betfair.com](https://betting.betfair.com/horse-racing/horse-racing-betting-masterclass/horse-racing-betting-strategy-how-to-scalp-on-betfair-exchange-270723-696.html)

[2] [Betfair Trading — Scalping — Explained Part 1/3 — Bet Angel](https://www.betangel.com/betfair-scalping-explained/)

[3] [Bet Angel — Excel Spreadsheet Integration — Bet Angel](https://www.betangel.com/features/excel/)

[4] [Activating the API in Bet Angel — Bet Angel API Guide](https://www.betangel.com/api-guide/activating_the_api_in_bet_angel.html)

[5] [Understanding Bet Angel's Guardian Tool — Betfair Trading Blog](https://www.betfairtradingblog.com/bet-angel-guardian/)

[6] [Guide to the Betfair Exchange API — Betfair Developers](https://developer.betfair.com/exchange-api/)

[7] [felixmccuaig/betfair-node — GitHub](https://github.com/felixmccuaig/betfair-node)

[8] [Ticks & Offset Ticks — BetexTrader Manual](https://www.betextrader.com/manual/ticks--offset-ticks.htm)

[9] [Should You Use Automated Stop Loss On Betfair? — Sports Trading Life](https://sportstradinglife.com/2014/01/should-you-use-automated-stop-loss-on-betfair/)

[10] [Green Up Settings — Bet Angel User Guide](https://www.betangel.com/user-guide/green_up_settings.html)

[11] [Are there any costs associated with API access? — Betfair Developer Support](https://support.developer.betfair.com/hc/en-us/articles/115003864531-Are-there-any-costs-associated-with-API-access)

[12] [Bet Angel API — Bet Angel User Guide](https://www.betangel.com/user-guide/bet_angel_api.html)
