#!/usr/bin/env python3
"""Send a generic backup failure notification; never include logs or secrets."""
import datetime
import json
import os
import sys
import time
import urllib.error
import urllib.request
import uuid


def main():
    api_key = os.environ.get('RESEND_API_KEY', '')
    sender = os.environ.get('SITE_EMAIL_FROM', '')
    recipient = os.environ.get('BACKUP_ALERT_TO', '').strip()
    if not api_key or not sender or not recipient or '\n' in recipient or '\r' in recipient:
        print('Backup alert configuration is missing or invalid.', file=sys.stderr)
        return 1
    timestamp = datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='seconds')
    payload = json.dumps({
        'from': sender, 'to': [recipient],
        'subject': 'EmmyBet: backup failed — action required',
        'text': (
            f'The balls49-backup service reported a failure.\nTime: {timestamp}\n\n'
            'A new verified backup is not confirmed for this run. Existing backups may still be available.\n\n'
            'Sign in to your VPS and inspect:\n'
            'sudo journalctl -u balls49-backup.service -n 50 --no-pager\n\n'
            'After correcting the problem, retry:\n'
            'sudo systemctl start balls49-backup.service\n\n'
            'This email contains no logs, credentials, account records, or backup contents.'
        ),
    }).encode()
    request = urllib.request.Request('https://api.resend.com/emails', data=payload, headers={
        'Authorization': f'Bearer {api_key}', 'Content-Type': 'application/json',
        'User-Agent': 'EmmyBet-Backup-Alerts/1.0',
        'Idempotency-Key': 'backup-alert-' + str(uuid.uuid4()),
    }, method='POST')
    for attempt in range(3):
        try:
            with urllib.request.urlopen(request, timeout=20) as response:
                if response.status not in (200, 201, 202):
                    raise ValueError('Unexpected response')
                result = json.load(response)
                if not result.get('id'):
                    raise ValueError('Missing email ID')
            print('Backup failure email accepted by Resend; inbox delivery is not yet confirmed.')
            return 0
        except urllib.error.HTTPError as error:
            print(f'Backup email request failed (HTTP {error.code}); response body withheld.', file=sys.stderr)
            if error.code != 429 and error.code < 500:
                return 1
        except (urllib.error.URLError, TimeoutError, OSError, ValueError):
            print('Backup email request failed; sensitive details withheld.', file=sys.stderr)
        if attempt < 2:
            time.sleep(5 * (attempt + 1))
    return 1


if __name__ == '__main__':
    sys.exit(main())
