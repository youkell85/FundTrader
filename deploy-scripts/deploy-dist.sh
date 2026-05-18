#!/bin/bash
set -e

echo "Stopping fundtrader-v2..."
pm2 stop fundtrader-v2 || true

echo "Replacing dist directory..."
rm -rf /root/FundTrader_20260516203417/v2/frontend/dist
cp -r /root/dist_20260517105623 /root/FundTrader_20260516203417/v2/frontend/dist

echo "Restarting fundtrader-v2..."
cd /root/FundTrader_20260516203417/v2/frontend
pm2 start dist/boot.js --name fundtrader-v2 --update-env
pm2 save

echo "Waiting for service to start..."
sleep 3

echo "Testing health endpoint..."
curl -s --connect-timeout 5 http://127.0.0.1:3000/fund/api/trpc/ping | head -c 100

echo ""
echo "Done!"
