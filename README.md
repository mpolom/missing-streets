# Finds streets that are missing in OpenStreetMap

![build](https://github.com/osm-nz/missing-streets/workflows/ci/badge.svg)
![](https://github.com/osm-nz/missing-streets/workflows/Request%20Export/badge.svg)
![](https://github.com/osm-nz/missing-streets/workflows/Weekly%20Sync/badge.svg)
![Lines of code](https://sloc.xyz/github/osm-nz/missing-streets)

Please see [the wiki page](https://wiki.osm.org/New_Zealand/Missing_Streets) for information about this project.
Or [click here](https://osm-nz.github.io/missing-streets) to open the tool.

If all three status badges above are green, then the script is automatically running once a week (on Wednesday morning NZ time)

<img src="https://wiki.openstreetmap.org/w/images/0/07/NZ_missing_streets.png" width="300" />

<details>
<summary>Documentation for software developers (click to expand)</summary>

Running the script:

```sh
# first install nodejs and yarn

# For some regions, you don't need any API keys.
# For other networks like NZ, you will need to:
# Then generate an API from https://data.linz.govt.nz/my/api
# with "Full access to Exports Access"
# create a file called `.env.local` in this folder, and add
# REACT_APP_LDS_KEY=XXXXX
# where XXXXX is the token you just generated.

npm start NZ preprocess # this will request an export of the dataset from LINZ

# now wait up to 1 hour for the export to be generated.
# Login to https://data.linz.govt.nz to check progress

npm start NZ downloadPlanet
npm start NZ downloadSourceData
npm start NZ preprocessPlanet
npm start NZ preprocessSourceData
npm start NZ conflate
# generates the final file: ./public/conflationResult.geo.json

# finally, the results should be uploaded to the CDN. This is done by the GitHub CI


# to run the process for other regions, just replace "NZ"
# with the region ID like "AU_NSW"
```

Running the client:

```sh
# first, run the script above
yarn client:start --host 127.0.0.1 --port 3000 --base /

# then visit http://127.0.0.1:3000/?no_redirect=1
# use 127.0.0.1 (not localhost) for the configured local OSM OAuth client
```

The client is automatically deployed to github pages.

## Shared review confirmations

The app stores shared confirmations in Cloudflare Workers KV. The Worker
validates the reviewer’s OpenStreetMap login before accepting a confirmation or
restoring a result to the review list.

To enable this feature:

1. Install the project dependencies and create a KV namespace:

   ```sh
   yarn
   yarn wrangler kv namespace create CONFIRMATIONS
   ```

2. Copy the namespace ID from Wrangler’s output into
   `cloudflare/wrangler.jsonc` in place of `REPLACE_WITH_KV_NAMESPACE_ID`.
   Add any other frontend origins to `REVIEW_ALLOWED_ORIGINS` there as a
   comma-separated list. `https://osm-nz.github.io` is allowed by default.
3. Deploy the Worker:

   ```sh
   yarn wrangler deploy --config cloudflare/wrangler.jsonc
   ```

4. Set the GitHub Actions repository variable `REVIEW_API_URL` to the Worker
   endpoint, including `/confirmations`, for example
   `https://missing-streets-confirmations.<account>.workers.dev/confirmations`.
   The CI and weekly sync workflows use this variable when building the app.
5. To test locally, start the Worker in a terminal:

   ```sh
   yarn wrangler dev --config cloudflare/wrangler.jsonc
   ```

   Start the frontend as described above and open
   `http://127.0.0.1:3000/?no_redirect=1`. The app uses the local Worker
   automatically, and Wrangler stores test confirmations in its local KV state.
   Localhost origins are accepted only by a locally running Worker; they are
   not allowed by the deployed Worker.

The main review list remains available if the confirmations API is unavailable,
but shared confirmations will not be applied until it responds successfully.
Use **Show confirmed roads** to include confirmed results in the map; they are
shown in grey and can be returned to the review list from their popup. The
GeoJSON export follows the same toggle.
Confirmation records include the source and OSM road names, confirmation time,
and reviewer’s OpenStreetMap account for audit purposes. KV changes can take up
to 60 seconds to become visible everywhere.

## Other Regions

This tool supports many different regions.
You can add your local area by:

- adding a new folder in [script/regions](./script/regions/) which exports an object conforming to the standard structure.
- Implementing the code for downloading and preprocessing your region's dataset
- Adding other fields like the URL to download an extract of the planet file for your region.
- Exporting that folder from [script/regions/index.ts](./script/regions/index.ts) and choose a region ID.
- Adding the same region ID to the matrix in [.github/workflows/sync.yml](./.github/workflows/sync.yml).

</details>
