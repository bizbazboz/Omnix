# Daily

Open **Settings → Integrations → Daily**. Settings belong to your account and are stored in the database; API keys are encrypted and never returned by the settings API. Choose which Daily cards appear on Home, then save.

## News

Add up to 12 HTTPS RSS or Atom feeds with names. Daily merges headlines, removes duplicate article links and lets you filter by source. Article links open the publisher's site. A failed source keeps its saved headlines and reports the error.

## Weather

Enable weather, name a location and enter its latitude/longitude, or use the browser's **Use current location** button. Choose Celsius or Fahrenheit.

The default source is [Open-Meteo](https://open-meteo.com/en/docs). Its public endpoint needs no key. A custom endpoint must accept the same query parameters and return Open-Meteo's `current` and `daily` forecast format. A configured weather key is sent as `apikey`. Seven forecast days are requested.

## Transport

TfL is the default source for Tube, DLR, London Overground, Elizabeth line and tram status. Save your settings to fetch the line catalogue, then choose all lines or select the lines you use. The line list comes from the source, rather than a hard-coded list of names.

An optional TfL key is sent as `app_key`. Custom endpoints must return the [TfL line-status format](https://api.tfl.gov.uk/swagger/docs/v1): an array of lines with `id`, `name` and `lineStatuses` containing severity, description and optional reason. Status applies to the selected lines; this is not a national rail departures board.

## Walking loops

Enter your [openrouteservice](https://openrouteservice.org/) API key in the walking source section, or configure a public HTTPS service compatible with its `foot-walking/geojson` endpoint. The default hosted endpoint requires your own key.

In **Daily → Walking loops**, choose a start point and target distance of 1–30 km. Generation sends this point to your configured routing provider, which calculates a route along its mapped network. The requested distance is a preference; the result shows the actual distance and estimated duration. Subsequent generations use a different seed. See the [round-trip options](https://giscience.github.io/openrouteservice/api-reference/endpoints/directions/routing-options).

The route outline, directions and GPX download use the provider's geometry. The latest successful route is saved privately. A failed generation keeps that route. A versioned GPX link refuses to download a different route if another tab has replaced it. Export a route before generating another if you want to retain it.

## Refresh and source rules

Configured sources refresh in the existing worker: transport about once per minute, news and weather about every 15 minutes. **Refresh** queues an earlier update, limited to once per minute per account. Data pages show the last successful refresh and retain saved data on failure; they do not invent current readings.

Custom fetches require public HTTPS on port 443, with no URL username/password. Downloads, redirects and response sizes are bounded. Private and loopback addresses are blocked, including addresses returned by DNS. Credential-bearing POST requests are not redirected, and authorization headers are not forwarded across hosts. Changing an endpoint clears its saved key unless you explicitly supply a new key.

No extra container, `.env` entry, proxy or database migration is required. Daily uses the existing encrypted settings storage, PostgreSQL, Redis, worker and scheduler. The authenticated Daily REST endpoints are also available to account-bound API/MCP tokens; provider configuration remains browser-only.
