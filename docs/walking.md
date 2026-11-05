# Local walking loops

Walking loops live under **Health**, independently of the Google Health connection. They are not part of Daily or its homepage cards.

## Install a map

An administrator opens **Settings → Integrations → Walking map**, chooses a region name and a public HTTPS `.osm.pbf` extract, then selects **Download and build map**. The default is the [Greater London extract from Geofabrik](https://download.geofabrik.de/europe/united-kingdom/england/greater-london.html), approximately 124 MB. Other regional PBF files can be used, up to 512 MB and four million walking-network nodes.

This downloads a static data file, not a routing response. A background job imports walkable ways and a searchable place/street/address index into a local SQLite database. The old database stays available until the replacement is complete. An import lock prevents overlapping jobs, and indexing uses temporary container storage before atomically publishing the result to the persistent bind mount.

The graph is stored at `/data/maps/walking.sqlite`, normally `./data/app/maps/walking.sqlite` on the host. Keep that file in backups. No additional container, API key or `.env` setting is needed. Reimport explicitly to update the map snapshot.

To import an already-downloaded file without any network access, put it inside the existing data bind mount and run:

```bash
docker compose run --rm --no-deps api python -m app.walking_map /data/maps/region.osm.pbf --name "My region"
```

## Generate a loop

1. Open **Health → Walking loops**.
2. Search the local OSM index for a street, park, place or address in the installed region, or select **Use current location**.
3. Choose **Distance**, or **Speed / time**. Time targets derive distance from walking speed and minutes.
4. Generate the loop, inspect its actual distance/duration and outline, then download GPX if needed.

Targets range from 0.5 to 30 km. Routing and start-location search require no external service once a regional map has been imported. Weather autocomplete is separate and uses Open-Meteo/GeoNames.

## Algorithm and limits

The importer excludes ways with prohibited pedestrian/private access and respects explicit pedestrian one-way restrictions and blocked access nodes. Omnix snaps the chosen point to the nearby walking network, uses Dijkstra searches through several seeded anchor candidates, penalises reused edges, and scores distance fit and repeated path length. A result must close on the graph; the generator rejects unsuitable networks rather than drawing straight-line connections or returning an out-and-back as a loop.

Actual distance varies with the available network. Search and generation stay within the installed region. Dense areas or disconnected paths may require a shorter target or another start. This is a map snapshot rather than a live closure feed.

The latest successful result is stored encrypted per account, including its start label and geometry. A failed generation retains it. Versioned GPX links prevent downloading another tab's replacement route by mistake. Previously saved routes remain accessible until replaced, but the removed external routing credentials are never used.

Map data: [© OpenStreetMap contributors](https://www.openstreetmap.org/copyright), ODbL.
