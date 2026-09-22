# txn-classifier

Transaction import pipeline for the finance team. Parses bank CSV exports into typed transactions. Classification into the chart of accounts is currently done by hand each month.

## Setup

```
npm install
cp .env.example .env   # add your real key
npm test
```
