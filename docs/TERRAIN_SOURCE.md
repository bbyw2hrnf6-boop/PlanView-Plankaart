# AHN terrain screening

`terrain-screen.js` reads actual AHN DTM heights through the public PDOK WCS 2.0.1 service. It derives terrain slope; it does not interpret map colours. Load `vendor/geotiff-2.1.3.js` before `terrain-screen.js`. Both are local assets. No key or external script/CDN is needed at runtime.

## Source and provenance

- [PDOK AHN service](https://www.pdok.nl/ogc-webservices/-/article/actueel-hoogtebestand-nederland-ahn)
- [WCS capabilities](https://service.pdok.nl/rws/actueel-hoogtebestand-nederland/wcs/v1_0?service=WCS&version=2.0.1&request=GetCapabilities)
- [DTM coverage description](https://service.pdok.nl/rws/actueel-hoogtebestand-nederland/wcs/v1_0?service=WCS&version=2.0.1&request=DescribeCoverage&coverageId=dtm_05m)
- [AHN product description](https://www.ahn.nl/dataroom)
- [Rijkswaterstaat AHN information](https://www.rijkswaterstaat.nl/zakelijk/open-data/actueel-hoogtebestand-nederland)

Coverage `dtm_05m` is the ground surface raster, in metres relative to NAP, on the native 0.5 m RD New grid (EPSG:28992). It is **not** the building/tree surface (`dsm_05m`). Capabilities checked on 2026-10-17 identify AHN4, acquired in 2020, 2021 and 2022. The client fetches this metadata and records its stated years/version rather than calling the retrieval date a measurement date. If metadata is unavailable, `dataDate` is null. The service URL is version `v1_0`; that service-path version does not identify the AHN acquisition generation. Capabilities state CC0, no fee.

Each evidence object preserves the exact GetCoverage URL, dataset/coverage ID, grid resolution, CRS, vertical datum, source metadata URL, metadata years and the raster retrieval timestamp. A cached raster retains its original retrieval timestamp. Capabilities cache lasts one hour; up to four rasters are cached for ten minutes. Inspect is demand driven; no background polling.

## Metric and coverage

The [Horn 3×3 method](https://gdal.org/en/stable/programs/gdaldem.html#slope) estimates the two ground-surface derivatives from the eight neighbours of each native raster cell. This implementation calculates `atan(hypot(dz/dx, dz/dy)) × 180 / π`, in degrees. Both horizontal and vertical inputs are metres. `maxSlopeDeg` is the maximum and `meanSlopeDeg` the arithmetic mean over the mask. The metric is resolution dependent: a 0.5 m raster maximum includes local steep banks and other small terrain changes. It is not an average site grade or a guarantee about future earthworks.

With `geometry`, inspect uses the entire GeoJSON Polygon/MultiPolygon, including holes and disconnected parts. WGS84 vertices are transformed to RD New using the app's standard Dutch polynomial conversion; the measurement is screening precision, not a boundary survey. Every native cell intersecting the parcel is included, even narrow pieces that miss cell centres. Cells touching a boundary are included conservatively. Hole interiors are omitted, while cells touching their boundary remain included. A 1 m outside halo supplies neighbouring heights. The derivative footprint therefore uses heights immediately outside the parcel too. This boundary treatment can increase the reported maximum; it never discards a narrow steep part just because its cell centre falls outside.

The requested native raster is never resampled, smoothed, interpolated or downsampled. Returned dimensions, extent, 0.5 m spacing, pixel-area reference, RD metre CRS and Float32 band format are checked before analysis. Each tested cell requires all nine heights, including its centre, to be finite and non-NoData. AHN Float32 NoData is commonly `3.4028234663852886e+38`. Gaps under buildings, water or missing ground returns are **unknown**, not flat terrain. A valid observed maximum in an incomplete result is only a lower bound; it cannot satisfy a maximum-slope filter.

Without `geometry`, the API deliberately reports `coverage.scope: 'point-neighborhood'`: a 40 × 40 m square around the point. This result must never satisfy a whole-parcel filter. The search integration resolves BRK first and requires `scope === 'parcel'`, `state === 'complete'`, and complete native coverage before a positive filter result.

## API

```js
const evidence = await PlanViewTerrainScreen.inspect(
  { lng: 5.684, lat: 50.823 },
  { geometry: parcelGeoJSON, signal: abortController.signal }
);
```

Evidence has `state`, `method`, `metric: 'slope_degrees'`, `maxSlopeDeg`, `meanSlopeDeg`, `coverage`, `source`, and on incomplete results `reason`/`missing`. `coverage` records scope, resolution, expected cells, valid cells, missing cells, ratio and completeness. `lowerBound` marks a partial maximum. Do not convert a missing maximum to zero.

Requests stop at 1,048,576 native pixels (including the bounding box and halo), at 4,096 pixels on either dimension, 16 MiB per response, 100,000 geometry vertices or a 20-million row/vertex mask-work budget. Large/complex parcels return an explicit budget reason, with no coarsening and no fetch if the size is known in advance. Request timeout is 25 seconds. Abort signals propagate as `AbortError`; network/format/missing-data conditions become unknown evidence. The pixel budget is a bounding-box budget: elongated or disjoint parcels can hit it earlier than their land area suggests.

## Verification

`node --test tests/terrain-screen.test.cjs` checks the real vendored GeoTIFF decoder using a generated Float32, RD-georeferenced TIFF, known two-axis gradients, holes, multipolygon parts and thin slivers, NoData neighbourhoods, cache/provenance, whole-parcel scope, invalid CRS/resolution, budget rejection and cancellation.

Live verification on 2026-10-17:

- Sint Pietersberg point `(5.684, 50.823)`: real native TIFF, 6,561/6,561 valid slope neighbourhoods in the explicit 40 m square; maximum 15.66331475°, mean 3.41131930°; first call about 570 ms.
- Utrecht point `(5.122, 52.09)`: 3,134/6,561 valid slope neighbourhoods (47.77%); correctly unknown, with observed maximum 29.90064169°. Urban ground-data gaps do not produce a pass.
- The BRK parcel at the Sint Pietersberg point is 474,515 m². Whole-parcel inspection correctly returns `native-raster-budget-exceeded` before downloading a raster.
- Whole BRK parcels at `(5.69, 50.84)` (1,637 m²), `(5.7, 50.82)` (75,791 m²) and `(5.8, 50.9)` (15,060 m²) returned real native raster results in about 225–1,312 ms. Valid slope-neighbourhood coverage was respectively 14.02%, 39.60% and 97.33%; all correctly remain unknown, even the nearly complete last case. Parcel IDs were `71f8e2df-9844-5a49-a2b3-a8c560d5a1e1`, `1ea8517e-b967-538b-8ebb-c589da14b5b9` and `e671963e-dfb0-5f0e-b30e-ef7405722c47`.
- Public WCS capabilities and TIFF requests with an Origin header returned HTTP 200 and `Access-Control-Allow-Origin: *`; browser fetch is CORS enabled by the source.

## Decoder licensing

GeoTIFF.js is pinned to 2.1.3, obtained from its published npm browser distribution at `https://cdn.jsdelivr.net/npm/geotiff@2.1.3/dist-browser/geotiff.js`. Runtime has no CDN dependency. The MIT notice is in `vendor/geotiff-LICENSE.txt`; included dependency notices are in `vendor/geotiff-THIRD-PARTY-LICENSES.txt`. The browser bundle decodes compressed Float32 GeoTIFF. No worker pool is instantiated. Tests stub only the bundle's Worker global at module-load time in Node; raster decoding remains real.


## Desktop integration · 18 October 2026

The criterion editor displays the maximum slope in degrees and explains whole-parcel/native-resolution coverage. Shared progress describes the request state without fabricating a raster completion percentage. Unexamined/oversized parcels and NoData remain unknown. No terrain algorithm or resolution was weakened for the UI.
