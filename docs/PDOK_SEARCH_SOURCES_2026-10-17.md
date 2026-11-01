# Search data review — 17 October 2026

## Included in this search update

The TOP10NL context refresh retains the mapped Polygon/MultiPolygon boundaries, all holes, and every vertex (coordinates rounded to six decimals, approximately 0.1 m). Search distances can therefore use the mapped edge instead of a bounding rectangle. This removes false proximity/avoidance uncertainty for concave areas and multi-part sites. It does not turn a map distance into a road/travel distance or a surveyed boundary measurement.

Three additional executable nearby categories come from the existing official `functioneel_gebied_vlak` and `functioneel_gebied_multivlak` collections:

| Search key | Exact `typefunctioneelgebied` value | Default proximity |
| --- | --- | --- |
| `hospital` | `ziekenhuiscomplex` | 2 km |
| `allotments` | `volkstuinen` | 2 km |
| `recreation_area` | `recreatiegebied` | 3 km |

The campsite/holiday-park extraction now also includes `vakantiepark`, alongside `camping, kampeerterrein`, `caravanpark`, and `bungalowpark`. Hospitals mean mapped hospital complexes, not available appointments, emergency departments, or walking access. These collections do not establish complete school or shopping inventories.

Verified live [TOP10NL collections](https://api.pdok.nl/kadaster/brt-top10nl/ogc/v1/collections?f=json), [functional-area schema](https://api.pdok.nl/kadaster/brt-top10nl/ogc/v1/collections/functioneel_gebied_vlak/schema), and feature responses on 17 October 2026. Useful fields: `lokaal_id`, `naamnl`, `typefunctioneelgebied`, `bronactualiteit`. The last is an individual feature's source date, not necessarily the service publication date. The snapshot records download time separately. Coverage is mapped objects in European Netherlands, not cross-border amenities.

The refresh follows all pagination links, retries transient downloads, retains completed pages in an optional temporary cache, rejects duplicate source identifiers, and replaces each output atomically only after the complete extraction. Use a fresh cache directory for each later refresh. The `netherlands_context.json` index points through `geometryFiles` to compressed arrays in `data/context/`; the browser loads geometry for requested categories. Geometry filenames include a SHA-256 content hash and are immutable; the manifest is written last, so interrupted output cannot overwrite the geometry referenced by the previous manifest. Every TOP10NL record carries its exact feature UUID URL recovered from the source response. The largest compressed file is the town group (about 10 MB), within the hosting asset limit.

The refreshed snapshot contains 4,721 campsite/holiday areas, 3,383 populated places, 3,981 industrial areas, 425 stations, 2,163 parks, 4,616 sports complexes, 4,154 cemeteries, 812 pool complexes, 1,288 marinas, 105 hospital complexes, 2,433 allotment areas and 545 recreation areas. There are 909 additional holiday areas after including `vakantiepark`. Source pagination completed over 55,960 functional-area polygons, 1,904 functional-area multi-polygons, 14,651 place polygons and 332 place multi-polygons before classification; the source date of an individual object remains distinct from this download time.

The browser and cloud publication use `data/netherlands_context.json.gz`. The plain JSON remains a local maintenance/test source and is omitted from the published assets. Gzip decompression is verified to reproduce the maintenance file byte for byte, preserving every geometry reference, source URL and attribute. The updater writes both copies, with the compressed public manifest last.

## Modeled noise — initial research, subsequently implemented

The official [Atlas Leefomgeving noise map](https://www.atlasleefomgeving.nl/geluid-in-nederland-lcum) links to [RIVM metadata record 68711fca-7589-4b83-829c-42550803c287](https://www.nationaalgeoregister.nl/geonetwork/srv/api/records/68711fca-7589-4b83-829c-42550803c287/formatters/xml). The metadata lists:

- WMS: `https://data.rivm.nl/geo/alo/wms`
- Current layer: `rivm_Geluid_lden_allebronnen_actueel`
- Versioned layer: `rivm_20250801_Geluid_lden_allebronnen_2022`
- Download: `https://data.rivm.nl/data/alo/rivm_20250801_Geluid_lden_allebronnen_2022.zip`

During initial research, a live GetFeatureInfo request (WMS 1.1.1, EPSG:4326, JSON response) at 50.85 N, 5.70 E returned `features[0].properties.GRAY_INDEX = 48`. This proves a numeric pixel value is queryable; the production adapter subsequently added nodata/range handling, provenance, caching, failure classification and tests before applying thresholds.

The source describes the combined map as **Geluid in Nederland**, with an `Lcum` page URL and newer catalogue title **Lg**; the technical layer name contains `lden`. Do not infer an exact standardized metric from that name alone or present it as measured facade Lden. Use “combined modeled noise, dB” and confirm the raster metadata/units before numeric filtering. The [official explanation](https://www.atlasleefomgeving.nl/veelgestelde-vragen) says roads are from 2022, rail from 2023, aviation from 2022, industry from 2024, and wind turbines from 2025. Source categories are combined without source weighting; some sources, including trams, smaller rail lines, and heat pumps, are omitted. This is a broad screening model, not an acoustic survey or compliance assessment. **Superseded:** numeric modeled-noise thresholds were implemented later on 17 October. The verified raster readme defines the values as Lden; catalogue title Lg is retained as provenance. See `ENVIRONMENTAL_SOURCES.md` for the active adapter, NoData handling, units and limits. Qualitative quietness without a numeric threshold remains unverified.

## Other useful datasets, with implementation limits

1. **AHN terrain and slope.** The [current PDOK service listing](https://www.pdok.nl/ogc-webservices/-/article/actueel-hoogtebestand-nederland-ahn) uses `https://service.pdok.nl/rws/actueel-hoogtebestand-nederland/wcs/v1_0`. Live GetCapabilities returned `dtm_05m` and `dsm_05m`. Use the terrain model (DTM) for slope, never the surface model containing buildings/vegetation. Clip raster windows per parcel, check nodata and acquisition year, then compute elevation range/slope. [AHN documentation](https://www.ahn.nl/dataroom) defines elevations relative to NAP. Elevation alone is not flood risk.

2. **Flood scenario screening.** The old PDOK ROR v2 WFS was [retired on 5 December 2025](https://www.pdok.nl/-/dataset-richtlijn-overstromingsrisico-ror-per-vandaag-uit-productie). Current live collections are `hazard_area` at `https://api.pdok.nl/rws/overstromingen-gevarengebied/ogc/v1` and `risk_zone` at `https://api.pdok.nl/rws/overstromingen-risicogebied/ogc/v2`. Their current landing metadata still references the 2018 report and gives unknown update frequency. Do not equate absence from these reporting zones with no flood risk. For depth/probability criteria, resolve the appropriate current [LDO/LIWO scenarios](https://www.bij12.nl/onderwerp/landelijke-databank-overstromingsinformatie-ldo/) and their return periods first.

3. **Soil and groundwater.** [BRO Bodemkaart](https://www.pdok.nl/ogc-webservices/-/article/bro-bodemkaart-sgm-) is a 1:50,000 soil classification, with WMS `https://service.pdok.nl/tno/bro-bodemkaart/wms/v1_0`. It can flag mapped peat/clay/sand context, but cannot establish bearing capacity or contamination. The [groundwater-depth model](https://www.pdok.nl/introductie/-/article/bro-model-grondwaterspiegeldiepte-wdm-) targets mainly unpaved, unbuilt land and omits some areas, including permanently deep groundwater and floodplains. Missing data must remain unknown, not “dry/safe”.

4. **Water, forest, roads and actual agricultural use.** TOP10NL has live `waterdeel_vlak` (`typewater`), `terrein_vlak` (`typelandgebruik`), and `wegdeel_hartlijn` (`typeweg`, `hoofdverkeersgebruik`). These layers are much larger than the functional-area inventory. Add bounded geometry queries or a spatially partitioned download, then geometry-based distance tests. BRP crop parcels can add actual annual agricultural use, which is separate from planning designation. None of these is added merely by showing a map overlay.

## Parcel interpretation

[The official Kadaster documentation](https://www.kadaster.nl/zakelijk/producten/eigendom/kadastrale-kaart) says cadastral map boundaries are approximate and may differ from surveyed boundaries. Use the supplied BRK area for registered parcel-size criteria; label GIS overlap calculations as approximate mapped areas. Daily map updates do not make geometry a legal buildability determination. Union overlapping bouwvlak geometry from the same source plan before calculating area, inspect buildings over the whole parcel, preserve polygon holes, and distinguish an incomplete request from an empty result. Attribution: CC-BY Kadaster NL.


## Current UI status · 18 October 2026

Noise, native-resolution parcel slope, BRO soil classes and modeled GHG depth are active criteria in the searchable picker. Source explanations stay with the criterion and result. The AHN and BRO research recommendations above are historical; current contracts are in `TERRAIN_SOURCE.md` and `ENVIRONMENTAL_SOURCES.md`. Road-network times are a separate, user-triggered shortlist check. They do not replace the twelve mapped-distance criteria. See `DEMO_READINESS_2026-10-18.md`.
