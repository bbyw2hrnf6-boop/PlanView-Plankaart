# Climate evidence in the comparison

Verified on **17 October 2026** against primary, publicly linked source services. Browser API: `PlanViewCompareClimate.inspect({lat,lng}, {signal})`. Both components return `state`, `value` in **cm**, `scenario`, `scope: "point"`, and source provenance. Only `state: "complete"` contains a numeric depth. No pass/fail or parcel-wide safety conclusion is derived.

## Source selection and edition

The official [data access page](https://www.klimaateffectatlas.nl/nl/data-opvragen) links the public [KEA WMS](https://cas.cloud.sogelink.com/public/data/org/gws/YWFMLMWERURF/kea_public/wms?request=GetCapabilities&service=WMS). Attribution is **Klimaateffectatlas, 2026**, CC BY 4.0.

- Flood: `maximale_waterdiepte_nederland_kleine_kans_20260128`, current-condition river/sea maximum depths for the “kleine kans” scenario, approximately 1:1,000 per year. This is one selected scenario, not every possible flood. [Official flood explanation](https://www.klimaateffectatlas.nl/nl/overstromingsdiepte), [official StoryMap data](https://www.arcgis.com/sharing/rest/content/items/907a10fccc314bb0a7dab295ef856e02/data?f=json).
- Rain: `klimaateffectatlas:nl_waterdiepte_hevige_neerslag_70mm_1h_v20260810` on `https://climate-adaptation-services.geospatialhosting.com/geoserver/wms`, as linked by the current official StoryMap’s [webmap](https://www.arcgis.com/sharing/rest/content/items/1d13bae48165432b99b425ca67cea79f/data?f=json). Scenario: **70 mm in one hour**, maximum modeled water depth during/after that storm. Rainwater infrastructure is simplified; height-source date differs by area. [Official rain explanation](https://www.klimaateffectatlas.nl/nl/waterdiepte-bij-korte-extreme-regen), [StoryMap data](https://www.arcgis.com/sharing/rest/content/items/b4441896915d4c109dba95cb979efff0/data?f=json).

The [official update log](https://www.klimaateffectatlas.nl/nl/updates) states that the previous 70 mm/2 h and 140 mm/2 h layers were removed in September 2026. Their replacements are 70 mm/1 h, 90 mm/1 h and 155 mm/2 h. The adapter deliberately pins the verified 70 mm/1 h edition; it does not silently query the obsolete layer.

## Query and interpretation

Live `GetCapabilities`, WCS 1.0 `DescribeCoverage`, JSON `GetLegendGraphic`, native TIFF `GetCoverage` and JSON `GetFeatureInfo` requests were checked. Both servers returned `Access-Control-Allow-Origin: *` for requests with a localhost Origin header. No API key is required. Native grids are EPSG:28992, **5 m for flood** and **0.5 m for rain**. Legends establish raw metres; sampled TIFFs declare `GDAL_NODATA=-9999.0`.

The selected point is converted using the app’s WGS84-to-RD polynomial and mapped to its containing native grid cell. WMS 1.3.0 `GetFeatureInfo` requests that exact cell at `width=1,height=1,i=0,j=0`, JSON, one feature. No overview sampling, aggregation, nearby-cell search, or color interpretation is used. The source includes the exact query URL, sampled RD cell, original point, source edition, resolution and retrieval timestamp.

`-9999`, absent values, invalid responses and unverified zero are **unknown**, never 0 cm or “safe”. The rain source notes that depths below 2 cm may be absent from the displayed map; missing pixels cannot establish dryness. Positive raw depths below 100 m are retained without rounding or clamping. The upper bound is a defensive plausibility check, not a source-validity assertion. Values beyond it remain unknown. The result concerns a **raster cell at the selected point**, not the whole parcel, a parcel maximum, groundwater, a return-period estimate for rainfall, building vulnerability, or a building-permission assessment.

## Manual checks

Native-grid requests on actual Dutch coordinates yielded positive values:

| Component | WGS84 point (lat, lng) | Raw metres | Returned centimetres |
|---|---|---|---|
| Flood | 51.901, 4.482 | 0.07757949829101562 | 7.757949829101562 |
| Flood | 52.002, 5.569 | 2.571500062942505 | 257.1500062942505 |
| Rain | 51.807, 4.68 | 0.04399999976158142 | 4.399999976158142 |

Tested Maastricht city-center and Eindhoven points returned `-9999`; these remain unknown. A source or network failure affects only its own component.

Requests time out after 8 seconds, responses are limited to 384 KiB, and credentials are omitted. Each component uses an exact-coordinate cache of at most 128 entries: complete results for 15 minutes, unknowns for 30 seconds. Caller cancellation propagates and is not cached. Unit tests use deterministic recorded response shapes, never live network traffic.

Fallback: [official KEA viewer](https://www.klimaateffectatlas.nl/nl/kaartviewer) and the component’s official explanation. A stable documented coordinate deep link was not verified, so none is invented. The source data are national screening models; the [official FAQ](https://www.klimaateffectatlas.nl/nl/faq) explains their limits for local decisions.


## Desktop integration · 18 October 2026

Climate checks remain optional in the comparison, separate from automatic search filters. Individual source outcomes and unknown values remain visible. Comparison maps, expanded evidence and focus survive updates. Counted progress reports locations checked, not the probability or completeness of a climate assessment.
