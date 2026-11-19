#!/usr/bin/env bash
# Serve the website, the Balls49 extension routes and the virtual football API on a domain
# exactly as on the server IP. Run as the balls49 user:
#   bash deploy/add-site-domain.sh predictions.emmyfxchart.com
#
# The domain's HTTPS block is rebuilt from the live IP block on every run, so run it again
# after anything changes the IP block (for example deploy/install-vps.sh in the virtual
# football repository). An existing HTTPS block for the domain is replaced in place and keeps
# its certificate; otherwise a certificate is requested and a new block is added. The IP
# keeps working throughout, and nginx is restored if the new configuration fails its test.
set -euo pipefail
domain=${1:-}
server_ip=159.65.25.30
ip_site=/etc/nginx/sites-available/balls49-extension
managed_site=/etc/nginx/sites-available/balls49-domain
acme_root=/var/www/balls49-acme
site_env=/etc/balls49/site.env

if [ "$(id -un)" != balls49 ]; then echo 'Run this script as the balls49 user.' >&2; exit 1; fi
if ! [[ "$domain" =~ ^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$ ]]; then
  echo 'Usage: bash deploy/add-site-domain.sh predictions.example.com' >&2; exit 1
fi
sudo -v
sudo test -f "$ip_site"

# DNS must point at this server.
if ! getent ahostsv4 "$domain" | awk '{print $1}' | grep -qx "$server_ip"; then
  echo "$domain does not resolve to $server_ip. Add an A record for it at your DNS provider, wait for it to resolve, then run this again." >&2
  exit 1
fi

backup_dir=$(mktemp -d)
restore() {
  echo 'Nginx validation failed; restoring the previous configuration.' >&2
  # Undo in reverse order, so each file ends up as it was before this run.
  while IFS=$'\t' read -r original saved; do
    if [ "$saved" = '-' ]; then sudo rm -f "$original"; else sudo cp -p "$saved" "$original"; fi
  done < <(tac "$backup_dir/manifest")
  if ! sudo test -f "$managed_site"; then sudo rm -f /etc/nginx/sites-enabled/balls49-domain; fi
  sudo nginx -t && sudo systemctl reload nginx
  exit 1
}
: > "$backup_dir/manifest"

# The nginx editing: find the IP block and any existing HTTPS block for the domain.
nginx_edit() {
  sudo python3 - "$1" "$ip_site" "$domain" "$server_ip" "$managed_site" "$acme_root" "$backup_dir" <<'PY'
import glob, os, re, shutil, sys
action, ip_site, domain, server_ip, managed_site, acme_root, backup_dir = sys.argv[1:]

def server_blocks(text):
    for match in re.finditer(r'(?m)^[ \t]*server\s*\{', text):
        depth, i = 0, match.end() - 1
        while i < len(text):
            if text[i] == '{': depth += 1
            elif text[i] == '}':
                depth -= 1
                if depth == 0: break
            i += 1
        yield match.start(), i + 1, text[match.start():i + 1]

def names(block):
    found = re.search(r'server_name\s+([^;]+);', block)
    return found.group(1).split() if found else []

def https(block):
    return re.search(r'listen\s+[^;]*443', block) is not None

def read(path):
    return open(path, encoding='utf-8').read()

ip_text = read(ip_site)
ip_blocks = [b for _, _, b in server_blocks(ip_text) if https(b) and server_ip in names(b)]
if len(ip_blocks) != 1:
    raise SystemExit(f'Expected one HTTPS block for {server_ip} in {ip_site}; found {len(ip_blocks)}. Review nginx first.')
ip_block = ip_blocks[0]

enabled_dir = os.environ.get('NGINX_ENABLED_DIR', '/etc/nginx/sites-enabled')  # overridable for tests
files = {os.path.realpath(p) for p in glob.glob(os.path.join(enabled_dir, '*')) if os.path.isfile(p)}
files.add(os.path.realpath(ip_site))
existing = [(path, start, end, block) for path in sorted(files) for start, end, block in server_blocks(read(path))
            if https(block) and domain in names(block)]
if len(existing) > 1:
    raise SystemExit(f'{domain} has {len(existing)} HTTPS server blocks ({", ".join(p for p, *_ in existing)}). Remove the extras first.')
if existing and server_ip in names(existing[0][3]):
    raise SystemExit(f'{domain} shares a server block with {server_ip}. Review nginx before continuing.')

if action == 'check':
    print('existing' if existing else 'new')
    raise SystemExit(0)

def shared_listen(match):
    # default_server and socket options (reuseport, backlog=, deferred, ...) may appear only once
    # per address:port, and the IP block already has them; keep the address and per-block flags.
    parts = match.group(1).split()
    keep = [parts[0]] + [p for p in parts[1:] if p in ('ssl', 'http2', 'quic', 'proxy_protocol')]
    return 'listen ' + ' '.join(keep) + ';'

def copy_for_domain(cert, key):
    block = re.sub(r'\blisten\s+([^;]+);', shared_listen, ip_block)
    block = re.sub(r'server_name\s+[^;]+;', f'server_name {domain};', block, count=1)
    block = re.sub(r'ssl_certificate\s+[^;]+;', f'ssl_certificate {cert};', block, count=1)
    block = re.sub(r'ssl_certificate_key\s+[^;]+;', f'ssl_certificate_key {key};', block, count=1)
    # The virtual football installer refreshes the block between its markers; keep the markers
    # unique to the IP block so it never updates this copy instead.
    block = block.replace('# BEGIN Balls49 Virtual Football API', '# Copied from the IP block: Virtual Football API')
    block = block.replace('# END Balls49 Virtual Football API', '# End of copied Virtual Football API')
    return '# Managed by deploy/add-site-domain.sh: a copy of the IP block. Rebuilt on every run.\n' + block

def save(path):
    with open(os.path.join(backup_dir, 'manifest'), 'a', encoding='utf-8') as manifest:
        if os.path.exists(path):
            copy = os.path.join(backup_dir, f'{len(os.listdir(backup_dir))}-{os.path.basename(path)}')
            shutil.copy2(path, copy)
            manifest.write(f'{path}\t{copy}\n')
        else:
            manifest.write(f'{path}\t-\n')

if existing:
    path, start, end, block = existing[0]
    cert = re.search(r'ssl_certificate\s+([^;]+);', block)
    key = re.search(r'ssl_certificate_key\s+([^;]+);', block)
    if not cert or not key:
        raise SystemExit(f'The HTTPS block for {domain} in {path} has no certificate lines. Review it first.')
    text = read(path)
    save(path)
    # Replace the block itself, and a managed comment line just above it from an earlier run.
    head = text[:start]
    marker = '# Managed by deploy/add-site-domain.sh: a copy of the IP block. Rebuilt on every run.\n'
    if head.endswith(marker): head = head[:-len(marker)]
    open(path, 'w', encoding='utf-8').write(head + copy_for_domain(cert.group(1).strip(), key.group(1).strip()) + text[end:])
    print(f'Replaced the HTTPS block for {domain} in {path}.')
else:
    live = f'/etc/letsencrypt/live/{domain}'
    if not os.path.isfile(f'{live}/fullchain.pem'):
        raise SystemExit(f'No certificate at {live}.')
    http = (f'server {{\n    listen 80;\n    server_name {domain};\n'
            f'    location ^~ /.well-known/acme-challenge/ {{ root {acme_root}; }}\n'
            f'    location / {{ return 301 https://{domain}$request_uri; }}\n}}\n\n')
    save(managed_site)
    open(managed_site, 'w', encoding='utf-8').write(http + copy_for_domain(f'{live}/fullchain.pem', f'{live}/privkey.pem') + '\n')
    print(f'Added {managed_site} for {domain}.')
PY
}

state=$(nginx_edit check)
if [ "$state" = new ] && ! sudo test -f "/etc/letsencrypt/live/$domain/fullchain.pem"; then
  # No block and no certificate yet: serve the ACME challenge for the domain, then request one.
  command -v certbot >/dev/null || { echo 'certbot is not installed.' >&2; exit 1; }
  sudo install -d -m 755 "$acme_root"
  printf '%s\t-\n' "$managed_site" >> "$backup_dir/manifest"
  printf 'server {\n    listen 80;\n    server_name %s;\n    location ^~ /.well-known/acme-challenge/ { root %s; }\n    location / { return 404; }\n}\n' "$domain" "$acme_root" | sudo tee "$managed_site" >/dev/null
  sudo ln -sf "$managed_site" /etc/nginx/sites-enabled/balls49-domain
  sudo nginx -t || restore
  sudo systemctl reload nginx
  sudo certbot certonly --webroot -w "$acme_root" -d "$domain" --non-interactive --agree-tos \
    --keep-until-expiring --deploy-hook 'systemctl reload nginx'
fi

nginx_edit apply
if [ "$state" = new ]; then sudo ln -sf "$managed_site" /etc/nginx/sites-enabled/balls49-domain; fi
sudo nginx -t || restore
sudo systemctl reload nginx

# The website accepts requests from the domain and uses it in email links.
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

status=$(curl -s -o /dev/null -w '%{http_code}' "https://$domain/virtual-api/get_bets" || true)
if [ "$status" = 401 ]; then
  echo "Done: https://$domain serves the website, the extension routes and the virtual football API."
else
  echo "Nginx is updated, but https://$domain/virtual-api/get_bets answered $status (expected 401). Check: sudo systemctl status balls49-virtual.service balls49-site.service" >&2
fi
rm -rf "$backup_dir"
