#!/usr/bin/env bash
# Serve the website, the Balls49 extension routes and the virtual football API on a domain
# as well as on the server IP. Run as the balls49 user:  bash deploy/add-site-domain.sh prediction.emmyfxchart.com
#
# Safe to run again: the domain's HTTPS block is rebuilt from the live IP block each time, so
# run it again after anything changes the IP block (for example deploy/install-vps.sh in the
# virtual football repository). The IP address keeps working throughout.
set -euo pipefail
domain=${1:-}
server_ip=159.65.25.30
ip_site=/etc/nginx/sites-available/balls49-extension
domain_site=/etc/nginx/sites-available/balls49-domain
acme_root=/var/www/balls49-acme
site_env=/etc/balls49/site.env

if [ "$(id -un)" != balls49 ]; then echo 'Run this script as the balls49 user.' >&2; exit 1; fi
if ! [[ "$domain" =~ ^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$ ]]; then
  echo 'Usage: bash deploy/add-site-domain.sh prediction.example.com' >&2; exit 1
fi
command -v certbot >/dev/null || { echo 'certbot is not installed.' >&2; exit 1; }
sudo -v
sudo test -f "$ip_site"

# 1. DNS must already point at this server, or the certificate request fails.
if ! getent ahostsv4 "$domain" | awk '{print $1}' | grep -qx "$server_ip"; then
  echo "$domain does not resolve to $server_ip yet. Add an A record for it at your DNS provider, wait for it to resolve, then run this again." >&2
  exit 1
fi

backup_dir=$(mktemp -d)
sudo cp -p "$ip_site" "$backup_dir/"
if sudo test -f "$domain_site"; then sudo cp -p "$domain_site" "$backup_dir/"; fi
restore() {
  echo 'Nginx validation failed; restoring the previous configuration.' >&2
  sudo cp -p "$backup_dir/balls49-extension" "$ip_site"
  if [ -f "$backup_dir/balls49-domain" ]; then sudo cp -p "$backup_dir/balls49-domain" "$domain_site"; else sudo rm -f "$domain_site" "/etc/nginx/sites-enabled/balls49-domain"; fi
  sudo nginx -t && sudo systemctl reload nginx
  exit 1
}

http_block() {
  cat <<EOF
# Managed by deploy/add-site-domain.sh. Rebuilt on every run.
server {
    listen 80;
    server_name $domain;
    location ^~ /.well-known/acme-challenge/ { root $acme_root; }
    location / { return 301 https://$domain\$request_uri; }
}
EOF
}

# 2. Port 80 for the domain: certificate challenges and a redirect to HTTPS.
sudo install -d -m 755 "$acme_root"
if ! sudo test -f "/etc/letsencrypt/live/$domain/fullchain.pem"; then
  http_block | sudo tee "$domain_site" >/dev/null
  sudo ln -sf "$domain_site" /etc/nginx/sites-enabled/balls49-domain
  sudo nginx -t || restore
  sudo systemctl reload nginx
  sudo certbot certonly --webroot -w "$acme_root" -d "$domain" --non-interactive --agree-tos \
    --keep-until-expiring --deploy-hook 'systemctl reload nginx'
fi

# 3. HTTPS for the domain: the live IP block with the domain's name and certificate.
{ http_block; echo; sudo python3 - "$ip_site" "$domain" "$server_ip" <<'PY2'
import re, sys
ip_site, domain, server_ip = sys.argv[1:]
config = open(ip_site, encoding='utf-8').read()
for match in re.finditer(r'server\s*\{', config):
    depth, i = 0, match.end() - 1
    while True:
        if config[i] == '{': depth += 1
        elif config[i] == '}':
            depth -= 1
            if depth == 0: break
        i += 1
    block = config[match.start():i + 1]
    if re.search(r'listen\s+443', block):
        block = re.sub(r'server_name\s+[^;]+;', f'server_name {domain};', block, count=1)
        block = block.replace(f'/etc/letsencrypt/live/{server_ip}/', f'/etc/letsencrypt/live/{domain}/')
        if f'/etc/letsencrypt/live/{domain}/fullchain.pem' not in block:
            raise SystemExit('The HTTPS block does not use the expected certificate paths; review it before continuing.')
        print(block)
        break
else:
    raise SystemExit(f'No HTTPS server block found in {ip_site}.')
PY2
} | sudo tee "$domain_site.new" >/dev/null
sudo mv "$domain_site.new" "$domain_site"
sudo ln -sf "$domain_site" /etc/nginx/sites-enabled/balls49-domain
sudo nginx -t || restore
sudo systemctl reload nginx

# 4. The website accepts requests from the domain and uses it in email links.
sudo python3 - "$site_env" "$domain" <<'PY'
import sys
path, domain = sys.argv[1:]
origin = f'https://{domain}'
lines = open(path, encoding='utf-8').read().splitlines()
values = dict(line.split('=', 1) for line in lines if '=' in line and not line.startswith('#'))
origins = [o for o in values.get('SITE_ALLOWED_ORIGINS', '').split(',') if o]
if origin not in origins: origins.append(origin)
updates = {'SITE_ALLOWED_ORIGINS': ','.join(origins), 'SITE_PUBLIC_URL': origin}
out, seen = [], set()
for line in lines:
    key = line.split('=', 1)[0] if '=' in line else None
    if key in updates: out.append(f'{key}={updates[key]}'); seen.add(key)
    else: out.append(line)
out += [f'{k}={v}' for k, v in updates.items() if k not in seen]
open(path, 'w', encoding='utf-8').write('\n'.join(out) + '\n')
PY
sudo systemctl restart balls49-site.service
sleep 2
if curl -fsS -o /dev/null "https://$domain/public-virtual-football"; then
  echo "Done: https://$domain serves the website and the virtual football feed."
else
  echo "Nginx and the certificate are in place, but https://$domain/public-virtual-football did not answer yet. Check: sudo systemctl status balls49-site.service" >&2
fi
rm -rf "$backup_dir"
