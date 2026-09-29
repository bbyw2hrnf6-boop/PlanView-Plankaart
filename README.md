# PlanView Plankaart

A static, local-first research prototype for Limburg planning maps. The street basemap stays visible at every zoom; the map button cycles Street, BGT detail and Aerial. The default clean rendering keeps plan fills translucent so roads and building outlines remain legible. Open with a local HTTP server (for example `python3 -m http.server 4174`) and visit `http://localhost:4174/`. The project can be published as static files on GitHub Pages; live maps and searches depend on external PDOK, OpenStreetMap and Esri services. No API keys or backend are included.

## Project files

- `index.html` — app shell and controls.
- `styles.css` — responsive design.
- `app.js` — map, PDOK requests, source ranking and area search.
- `i18n.js` — English, Dutch and German interface labels; official plan names and legal values remain in Dutch.
- `limburg.json` — province and municipality boundaries.
- `vendor/`, `legend/` — bundled map libraries and legend images.

## Data method and limits

A click sends PDOK `GetFeatureInfo` requests for the exact point. The returned `enkelbestemming` geometry supplies the main designation and IMRO plan ID. The app matches that ID to the `plangebied` document metadata and ranks the direct geometry-linked plan above unrelated municipality documents. Parcel geometry comes from the cadastral WMS. Other enabled planning overlays are fetched after the primary result. Check current legal effect and supplementary rules in the Omgevingsloket.

The **Area search** samples up to 24 points in the visible map, restricted to the selected municipality if one is selected. It requires an exact zoning-polygon intersection, filters primary designations by category, plan status, optional IMRO ID and optional building-envelope intersection, then deduplicates feature IDs. This is a scouting tool, not an exhaustive polygon or parcel search; zoom in and scan again to inspect a smaller area. A production search should use indexed polygon data and true geometry intersections instead of point sampling.

The optional [**NOVEX planned housing locations** WMS](https://www.pdok.nl/-/regionale-woondeals-en-novex-woningbouwlocaties-beschikbaar-op-pdok) draws officially published housing locations across its available coverage. It does not cover all potential sites in Limburg. The **Building land screening** draws numbered markers at sampled residential or mixed-use points. Each score counts four signals: zoning category, plan status, whether a building envelope intersects the point, and whether the cadastral building layer maps a footprint at the point. The top 4/4 score requires a building envelope and no mapped building at the sampled point; an empty point outside a building envelope remains lower priority. This is a research priority, not a probability or permission to build. The markers deliberately avoid colouring an entire zoning polygon as vacant land. A residential designation does not prove that land is vacant, available, buildable, or permissible for a particular proposal. Assessment requires current Omgevingsplan rules, building envelopes, parcels, existing buildings, environmental constraints and the competent authority's review. PDOK also publishes [planned land use from DSO](https://www.pdok.nl/ogc-webservices/-/article/gepland-landgebruik-dso-lv-omgevingswet-inspire-geharmoniseerd), but its designations likewise do not certify buildability. The Wro spatial plans service used by this prototype is [updated semiannually](https://www.pdok.nl/ogc-webservices/-/article/ruimtelijke-plannen).
