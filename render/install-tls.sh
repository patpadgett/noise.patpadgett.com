#!/usr/bin/env bash
# Put render.patpadgett.com in front of the render box. Run once, as a user with sudo, after the DNS A record exists:
#   render.patpadgett.com  A  <this VM's public IP>      (dig +short render.patpadgett.com must answer before step 3)
# Idempotent; re-run after any change to nginx-render.conf.
set -euo pipefail
HOST=render.patpadgett.com
HERE=$(cd "$(dirname "$0")" && pwd)
IP=$(curl -s -4 https://api.ipify.org)
echo "1. DNS: $HOST → $(dig +short $HOST A | tr '\n' ' ')(this VM is $IP)"
if [ "$(dig +short $HOST A | head -1)" != "$IP" ]; then echo "   add the A record first (Hurricane Electric DNS: dns.he.net → patpadgett.com → A → $HOST → $IP)"; exit 1; fi
echo "2. nginx site"
# the ssl lines only work once the cert exists: start from the port-80 server, let certbot add 443
sudo tee /etc/nginx/sites-available/$HOST >/dev/null <<EOF
server {
    listen 80;
    server_name $HOST;
    location /.well-known/acme-challenge/ { root /var/www/html; }
    location / {
        proxy_pass http://127.0.0.1:8790;
        proxy_http_version 1.1;
        proxy_read_timeout 120s;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
EOF
sudo ln -sf /etc/nginx/sites-available/$HOST /etc/nginx/sites-enabled/$HOST
sudo nginx -t && sudo systemctl reload nginx
echo "3. certificate (certbot rewrites the site with the 443 server and the redirect)"
sudo certbot --nginx -d $HOST --non-interactive --agree-tos --redirect -m pat@patpadgett.com
echo "4. check"
curl -s -o /dev/null -w "   https://$HOST/health → %{http_code} (401 is right: no token)\n" https://$HOST/health
curl -s -o /dev/null -w "   CORS preflight from the site → %{http_code}\n" -X OPTIONS -H "Origin: https://noise.patpadgett.com" -H "Access-Control-Request-Method: POST" -H "Access-Control-Request-Headers: authorization,content-type" https://$HOST/jobs
echo "done. In the site: SETUP → engine 'This GPU' → URL https://$HOST, token from ~/.config/cue-render/env"
