# Telegram and website streak synchronization

The VPS calculates live market statistics from its saved prediction history.
Telegram and the website prediction cards use those statistics, including the
current step, maximum losing streak and summary statistics.

Each current snapshot includes its market-statistics reset timestamp. The public
website accepts those statistics only when that timestamp matches its own reset
timestamp. Immediately after an owner reset, it temporarily calculates statistics
locally until the VPS acknowledges the new tracking period.

History rows are synchronized in batches of up to 100 records. Only successful
requests mark records as delivered. At startup and every 15 minutes the publisher
reconciles its saved history again, allowing the website to recover missing rows.
Existing draw IDs are updated rather than duplicated. Records no longer present
on the VPS cannot be recovered by this process.

The History page continues to calculate worst losing streaks over the selected
draw range, respecting its separate history-only reset. Those numbers can differ
from Telegram's full tracking-period statistics even after synchronization.

## Deployment

Deploy the updated code to both the Render web service and the VPS bot. Restart
the VPS bot after updating to begin history reconciliation immediately. Recovery
takes multiple publishing cycles for larger histories. No database deletion,
streak reset, extension reset or martingale change is required.

Until both services are updated, the website may continue using locally calculated
statistics. Compare Telegram and website prediction cards for the same draw.
