# Daily

Open **Settings → Integrations → Daily**. Settings belong to your account and are stored in the database; API keys are encrypted and never returned by the settings API. Choose which Daily cards appear on Home, then save.

## News

Add up to 12 HTTPS RSS or Atom feeds with names. Daily merges headlines, removes duplicate article links and lets you filter by source. Article links open the publisher's site. A failed source keeps its saved headlines and reports the error.

## Weather

Enable weather and search for a location. Pick a suggestion to save its name and coordinates together, or use the browser's **Use current location** button. Choose Celsius or Fahrenheit. Location autocomplete uses Open-Meteo/GeoNames.

The default source is [Open-Meteo](https://open-meteo.com/en/docs). Its public endpoint needs no key. A custom endpoint must accept the same query parameters and return Open-Meteo's `current` and `daily` forecast format. A configured weather key is sent as `apikey`. Seven forecast days are requested.

## Transport

TfL is the default source for Tube, DLR, London Overground, Elizabeth line and tram status. Choose all lines or use the searchable train-line dropdown to select the lines you use. Choices come from the configured source; no line IDs need to be typed.

An optional TfL key is sent as `app_key`. Custom endpoints must return the [TfL line-status format](https://api.tfl.gov.uk/swagger/docs/v1): an array of lines with `id`, `name` and `lineStatuses` containing severity, description and optional reason. Status applies to the selected lines; this is not a national rail departures board.

## Walking loops

Walking is under **Health → Walking loops** and has no homepage card. It uses a local OpenStreetMap graph and Omnix's own algorithm, with no external routing API or key. See the [walking-map guide](./walking.md).

## Refresh and source rules

Configured sources refresh in the existing worker: transport about once per minute, news and weather about every 15 minutes. **Refresh** queues an earlier update, limited to once per minute per account. Data pages show the last successful refresh and retain saved data on failure; they do not invent current readings.

Custom fetches require public HTTPS on port 443, with no URL username/password. Downloads, redirects and response sizes are bounded. Private and loopback addresses are blocked, including addresses returned by DNS. Credential-bearing POST requests are not redirected, and authorization headers are not forwarded across hosts. Changing an endpoint clears its saved key unless you explicitly supply a new key.

No extra container, `.env` entry, proxy or database migration is required. Daily uses the existing encrypted settings storage, PostgreSQL, Redis, worker and scheduler. The authenticated Daily REST endpoints are also available to account-bound API/MCP tokens; provider configuration remains browser-only.
