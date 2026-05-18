#!/bin/bash
cat > /etc/nginx/conf.d/fundtrader.conf << 'EOF'
server {
    listen 80;
    server_name 150.158.127.92;

    location /claw/api/ {
        proxy_pass http://127.0.0.1:3111/api/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }

    location /claw/ {
        proxy_pass http://127.0.0.1:3111/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }

    location = /fund/api/trpc {
        proxy_pass http://127.0.0.1:3000/fund/api/trpc;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_buffering off;
    }

    location /fund/api/trpc/ {
        proxy_pass http://127.0.0.1:3000/fund/api/trpc/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_buffering off;
    }

    location /fund/api/ {
        proxy_pass http://127.0.0.1:8766/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_buffering off;
    }

    location /fund/ {
        proxy_pass http://127.0.0.1:3000/fund/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_buffering off;
    }

    location / {
        root /var/www/html;
        index index.html index.htm;
    }
}
EOF
nginx -t && systemctl reload nginx
