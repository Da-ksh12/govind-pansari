# Map Architecture (Phase 09)

## Provider: MapLibre + OpenStreetMap raster tiles, not react-native-maps

The first implementation attempt used `react-native-maps`, matching
the user's "free/no-key" answer at face value. That turned out to be
wrong on inspection, not just untested: on Android, `react-native-maps`'
*only* provider is the Google Maps SDK, which requires a Google Maps
API key to initialize the base `MapView` at all — even when every tile
and overlay drawn on top of it is custom. Since Android is this
project's primary target platform, that path would not actually have
delivered "no key." This was caught and corrected before writing
screen code against it, not after: switched to
`@maplibre/maplibre-react-native`, which genuinely supports an
arbitrary tile source (including OSM raster tiles) keylessly on both
iOS and Android.

`services/map/osmStyle.ts` is the entire map style — an inline
MapLibre style-spec object with one raster source (OSM's `a/b/c` tile
subdomains) and one raster layer. No vector basemap, no styling engine
dependency, nothing that needs a key.

**OSM tile usage policy caveat**: OpenStreetMap's own tile servers
have a documented usage policy that discourages heavy, sustained
production traffic without a custom `User-Agent` and reasonable
caching — the same "free tier, no SLA" tradeoff already accepted for
OSRM routing (`docs/routing-and-eta.md`). Fine for this project's
current scale; the first thing to swap before any real production
volume is this one file, to a paid raster/vector tile provider
(MapTiler, Mapbox, Stadia, etc.) — again, a config change to
`osmStyle.ts`, not a rewrite of any screen.

## Component shapes (verified against the installed package's `.d.ts`, not guessed)

- `Map` — `mapStyle: string | StyleSpecification` (a JSON object here, not a URL)
- `Camera` — imperative `ref.fitBounds(bounds: LngLatBounds, options)` /
  `.flyTo` / `.easeTo` / `.jumpTo`; `LngLatBounds` is `[west, south, east, north]`
- `Marker` — `lngLat: [longitude, latitude]` (a tuple, not `{lat, lng}`), single `children` element
- `GeoJSONSource` + `Layer` — `Layer` takes the *current* (non-deprecated) API: `type`, `source`, `paint`/`layout` with real MapLibre style-spec keys (`'line-color'`, `'line-width'`, kebab-case) — not the legacy camelCase `style` prop, which the package marks deprecated-for-removal-in-v12

## Custom markers (section 29/66)

Three small components, each a plain React Native `View` rendered as a
`Marker`'s child (MapLibre markers are real native views, not sprite
images, so ordinary RN styling/icons work directly):
- `RiderMapMarker` — a bearing arrow (lucide's `Navigation` icon) in a
  circular badge, dimmed when the underlying location is stale
- `StoreMapMarker` / `CustomerMapMarker` — static badges (store/home
  icons), no animation needed since they don't move

## Smooth interpolation, not teleporting (section 30/31)

`Marker.lngLat` is a plain prop consumed by a native view — not
something Reanimated can drive on the UI thread the way it drives a
style transform. Rather than build uncertain native-driver wiring
(the package's `MarkerRef.getAnimatableRef()` hints at Reanimated v4
compatibility, but using it correctly is more scope than this phase's
budget and, more importantly, untestable in this environment with no
device/simulator), `hooks/useSmoothedPosition.ts` uses a
straightforward, verifiable technique: on each new GPS sample, a
`requestAnimationFrame` loop interpolates a local `useState` value from
its current position to the new one over ~2.5s, and the `Marker`
re-renders each frame with the interpolated point. At this app's ~4s
GPS sample rate, a JS-thread rAF loop has no jank concern — this isn't
a 60fps-critical animation, it's a slow-moving delivery bike updating a
few times a minute.

Heading uses the same technique (`useSmoothedHeading`) but interpolates
around the *shortest* angular arc (`shortestAngleDelta`), so a bearing
change from 350° to 10° animates as a 20° turn, not a 340° spin the
long way round.

## Camera behaviour (section 34)

The camera auto-fits to bounds containing the rider/store/destination
markers **once**, the first time enough points are known for a given
delivery (`hasAutoFitted` ref, reset per `orderId`). After that, GPS
updates never re-trigger a fit — only an explicit tap on the recenter
button does. This is a deliberate imperative `cameraRef.fitBounds()`
call rather than a declarative `bounds` prop, specifically so ordinary
position updates don't fight a customer who has manually panned the
map to look at something else.
