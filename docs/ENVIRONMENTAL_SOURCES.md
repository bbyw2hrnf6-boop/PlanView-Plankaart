# Environmental point sources

Verified 2026-10-17. `environmental-sources.js` queries official public services directly. These are modeled values at the candidate point; they do not establish conditions throughout a parcel. Retrieval time is separate from the model edition and the years represented by its inputs.

## Browser contract

```js
const result = await PlanViewEnvironmentalSources.inspect(
  {lat: 52.2, lng: 5.5},
  {noise: true, soil: true, groundwater: true, signal}
);
```

Only requested properties are returned. Each has `state: 'complete' | 'unknown'`, provenance in `source`, and a `reason` when unknown. Only complete values may certify an active search criterion. Unknown is neither zero nor a pass. Aborting the caller rejects with `AbortError`; individual service/network/JSON/time-out failures produce an independent unknown result.

- Noise: `valueDb`, `metric: 'Lden'`, `label`. Source metadata separately retains catalogue product name `Geluid in Nederland (Lg)`.
- Soil: `classes: [{id, code, label}]`, `rawSoilCodes`, `descriptions`. IDs match the search schema's 14 main groups.
- Groundwater: `highWaterDepthCm` (GHG), `lowWaterDepthCm` (GLG). A partial result may retain one value for display, but remains unknown.

Queries use WMS 1.1.1 GetFeatureInfo, EPSG:4326 in longitude/latitude order, JSON, a 3×3 viewport centered on the requested point, and at most 20 features. Soil polygon containment is checked locally, including holes. No interpolation or parcel-wide sampling is claimed. The caller bounds scan batches; each point makes at most four requests. Requests have an 8-second timeout; complete results alone are cached for 15 minutes, at exact coordinates, with a 256-entry bound. No credentials are sent. CORS denial, unavailable services and unsupported responses remain unknown. There is no synthetic or stale-success fallback.

## RIVM combined noise

- Endpoint: `https://data.rivm.nl/geo/alo/wms`
- Pinned layer: `rivm_20250801_Geluid_lden_allebronnen_2022`
- JSON field: `features[].properties.GRAY_INDEX`, finite numeric dB.
- Metadata product title: **Geluid in Nederland (Lg)**; numeric metric **Lden**. The exact original archive's readme specifies combined annual Lden in 1 dB classes. The JSON pixel contains no metric or unit metadata; these are associated with the configured source, not inferred from its number.
- Resolution: 10 m. Inputs: road/aviation 2022, rail 2023, industry 2024, wind turbines 2025; model publication identifier 20250801.
- Source links: [official catalogue with exact layer linkage](https://data.overheid.nl/dataset/69286913-abe8-47a0-8860-ab876f1ab545), [RIVM/Atlas explanation](https://www.atlasleefomgeving.nl/geluid-in-nederland-lcum), [official metadata](https://www.nationaalgeoregister.nl/geonetwork/srv/api/records/68711fca-7589-4b83-829c-42550803c287/formatters/xml), [Atlas FAQ](https://www.atlasleefomgeving.nl/veelgestelde-vragen).

**Naming evidence:** the XML fetched on 2026-10-17 has `dateStamp=2026-10-06`, `title=Geluid in Nederland (Lg)`, and in the same record `CI_OnlineResource/name=rivm_20250801_Geluid_lden_allebronnen_2022`. The official data.overheid.nl mirror displays the same pairing. The Atlas explanation describes an Lden calculation basis. A bounded HTTP range read of the [exact official source archive](https://data.rivm.nl/data/alo/rivm_20250801_Geluid_lden_allebronnen_2022.zip), file `readme_geluid in nederland.txt`, resolves the numeric interpretation explicitly: “gezamenlijke geluidbelasting in Lden (gemiddeld over een jaar)”. Consequently `metric` and `source.numericMetric` are **Lden**, while `source.catalogueName` retains **Geluid in Nederland (Lg)**. `source.metricBasis`, `rasterArchiveUrl` and `rasterReadme` retain the evidence. There is no numeric conversion. Neither this aggregate label nor the legacy explainer URL's `lcum` establishes a facade measurement.

This is a broad indication from several combined noise sources without weighting their contributions. It is unsuitable for demonstrating compliance with facade noise limits. The adapter accepts finite positive values up to 140 dB as a conservative application domain and rejects missing, conflicting, nonnumeric or out-of-domain pixels. It never clamps them to a quiet value.

**No-data limitation:** the original TIFF's full IFD was inspected through bounded ZIP ranges. It declares signed Int16 samples (`BitsPerSample=16`, `SampleFormat=2`) but no `GDAL_NODATA` tag 42113; its GDAL metadata contains only a dataset identifier. Thus neither `0` nor `255` is verified as its declared no-data code. `255` is already outside the accepted dB domain. Zero remains unknown with an explicit reason because its valid-data meaning has not been established, and cannot certify quiet conditions. A user threshold of zero remains valid; this does not make an ambiguous source zero valid evidence. Sampled original strips contain positive values including 8 dB; the adapter does not invent an 8 dB no-data rule. WMS-specific no-data behavior must still be checked when that service reliably responds.

During research, GetFeatureInfo returned `GRAY_INDEX: 48` at 50.85 N, 5.70 E. Later requests to both the pinned layer and the current-layer alias repeatedly timed out/reset. The final live adapter check therefore returned `unknown` for RIVM while both BRO sources completed. RIVM browser CORS still needs confirmation when the service responds; no server proxy is silently substituted.

## BRO Bodemkaart (SGM)

- Endpoint: `https://service.pdok.nl/tno/bro-bodemkaart/wms/v1_0`
- Layer: `soilarea`
- Fields: `soilcode`, fallback `first_soilcode`, descriptive `first_soilname`, edition-bearing `maparea_id`; response geometry is used for point containment.
- Model scale 1:50,000; soil profile to 1.2 m. Catalogue edition 2025-01, revision 2025-10-28. A returned `V2025-1...` ID provides the per-result version.
- Sources: [BRO model purpose and limitations](https://basisregistratieondergrond.nl/inhoud-bro/registratieobjecten/modellen/bodemkaart-sgm/), [BRO classification catalogue, sections 5.3 and 6.3.3](https://docs.geostandaarden.nl/bro/cv-im-SGM-20230223/).

The filter concerns the mapped **main soil class**, not a topsoil material, bearing capacity or construction suitability. Lowercase additions describe covering/substrate layers and must not replace the main class: `kVz` remains peat despite its sand substrate. `hEV` is also peat. Unmapped codes, conflicting boundary classes, mixed associations, missing polygons or truncated responses remain unknown. The API retains raw codes and descriptions for interpretation.

| Stable ID | Catalogue code family |
| --- | --- |
| peat | V; EV (Aarveengronden) |
| peaty | W |
| podzol | H, Y |
| brik | B |
| thick_earth | EZ, EL, EK |
| sand | Z, including Z…A |
| calcareous_silt | S…A |
| unripe_mineral | MO, RO |
| marine_clay | M |
| river_clay | R |
| old_river_clay | KR |
| old_clay | KX, KT |
| loam | L |
| old_limburg | MZ, MK, MA, FK, FG, KM, KK, KS |

The BRO model has limited coverage under urban development and none under open water. Its regional scale does not support a plot-level soil assessment without further evidence. At 52.2 N, 5.5 E the live adapter returned `zEZ21`, `thick_earth`, and version `V2025-1`. PDOK returned `Access-Control-Allow-Origin: *`.

## BRO Model Grondwaterspiegeldiepte (WDM)

- Endpoint: `https://service.pdok.nl/tno/bro-model-grondwaterspiegeldiepte/wms/v2_0`
- GHG layer: `bro-grondwaterspiegeldieptemetingen-GHG`
- GLG layer: `bro-grondwaterspiegeldieptemetingen-GLG`
- JSON field: `features[].properties.value_list`, a numeric string in the live responses.
- Units: **centimeters below local ground level**, not elevation relative to NAP. Resolution 50 m; catalogue edition 2025-01, revision 2025-10-28.
- Sources: [PDOK model definition, units and coverage](https://www.pdok.nl/introductie/-/article/bro-model-grondwaterspiegeldiepte-wdm-), [official service listing](https://www.pdok.nl/ogc-webservices/-/article/bro-model-grondwaterspiegeldiepte-wdm-), [official download feed](https://service.pdok.nl/tno/bro-model-grondwaterspiegeldiepte/atom/grondwaterspiegeldieptemodel.xml).

GHG is the average smallest depth, indicating the seasonally high groundwater level; GLG is the average greatest depth, indicating the low level. These describe long-term fluctuation, not today's groundwater. A minimum-depth criterion compares GHG: 63 cm passes a 50 cm minimum and fails a 100 cm minimum. Values primarily cover unpaved/unbuilt land. Permanently deep groundwater (over 2.5 m) and floodplains may have no values; absence must not mean dry ground.

**Source-specific no-data verification:** HTTP range reads of the TIFF headers for the published [GHG median raster](https://service.pdok.nl/tno/bro-model-grondwaterspiegeldiepte/atom/downloads/ghg-mediaan.tif) and [GLG median raster](https://service.pdok.nl/tno/bro-model-grondwaterspiegeldiepte/atom/downloads/glg-mediaan.tif) showed unsigned 8-bit samples, GDAL_NODATA tag 42113 equal to `255`, and statistics minimum `0`, maximum `254`. The adapter therefore rejects `255` explicitly and accepts only this current encoding's 0–254 cm domain. Negative physical depths can exist above ground, but this published unsigned raster cannot encode them; unexpected negative or larger values trigger unknown instead of silently accepting a changed encoding. A future source encoding change requires re-verifying this rule. Placeholder `-9999` statistics are not valid pixels. GHG greater than GLG is inconsistent and unknown.

The final live adapter check at 52.2 N, 5.5 E returned GHG **63 cm**, GLG **152 cm**. An offshore check returned an empty feature collection. PDOK returned `Access-Control-Allow-Origin: *`.

## Verification

`node --test tests/environmental-sources.test.cjs` passes 9 tests covering observed field conventions, all main-class mappings, geometry containment, source no-data, malformed and mixed responses, exact query coordinates, enabled-only requests, cache expiry/isolation, independent failure, timeouts and abort propagation. Test fixtures are unit-test inputs only; they are never shipped as replacement environmental data.


## Desktop integration · 18 October 2026

The desktop picker exposes the same four validated fields. Inspector and comparison use shared loading indicators and retain existing evidence while loading. NoData and failed requests remain visible; no percentage implies source completeness. Noise, soil and GHG are point models; AHN slope retains its whole-parcel contract.
