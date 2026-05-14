#!/bin/bash
cd "$(dirname "$0")"
export API_HOST=0.0.0.0
export API_PORT=8766
export API_PREFIX=/fund/api
export CACHE_DIR=/tmp/fundtrader_cache
nohup python3 -m uvicorn app.main:app --host $API_HOST --port $API_PORT --root-path $API_PREFIX > /tmp/fundtrader.log 2>&1 &
echo "FundTrader started on port $API_PORT, PID: $!"
