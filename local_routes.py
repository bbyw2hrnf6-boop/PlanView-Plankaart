"""Bounded route matrices: account-free FOSSGIS OSRM, or optional keyed ORS."""
import json
import math
import threading
import time
import urllib.error
import urllib.request

PROFILES = {'walking': 'foot-walking', 'cycling': 'cycling-regular', 'driving': 'driving-car'}
OSRM_PROFILES = {'walking': 'foot', 'cycling': 'bike', 'driving': 'car'}
PLANVIEW_URL = 'https://planview-maastricht-spatial.dannhir.chatgpt.site'
OSRM_MIN_INTERVAL = 1.1
_LOCK = threading.Lock()
_REQUESTS = []
_OSRM_LAST_START = None


class RoutingError(Exception):
    def __init__(self, status, code):
        super().__init__(code)
        self.status, self.code = status, code


def _point(value, label=False):
    if (not isinstance(value, dict) or set(value) - ({'lat', 'lng', 'label'} if label else {'lat', 'lng'})
            or any(type(value.get(k)) not in (int, float) or not math.isfinite(value[k]) for k in ('lat', 'lng'))
            or not 50.6 <= value['lat'] <= 53.8 or not 3 <= value['lng'] <= 7.6
            or 'label' in value and (not isinstance(value['label'], str) or len(value['label']) > 160)):
        raise RoutingError(400, 'invalid_route_point')
    return {k: value[k] for k in ('lat', 'lng')} | ({'label': value['label'].strip()} if label and value.get('label') else {})


def clean_route_input(payload):
    if (not isinstance(payload, dict) or set(payload) - {'origins', 'target', 'mode'}
            or not isinstance(payload.get('origins'), list) or not 1 <= len(payload['origins']) <= 3
            or not isinstance(payload.get('mode'), str) or payload['mode'] not in PROFILES):
        raise RoutingError(400, 'invalid_route_request')
    return {'origins': [_point(p) for p in payload['origins']], 'target': _point(payload.get('target'), True), 'mode': payload['mode']}


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def route_matrix(payload, key=None, *, opener=None):
    global _OSRM_LAST_START
    value = clean_route_input(payload)
    provider = 'ors' if key else 'osrm'
    if not _LOCK.acquire(blocking=False):
        raise RoutingError(429, 'routing_limit')
    try:
        now = time.monotonic()
        _REQUESTS[:] = [at for at in _REQUESTS if now - at < 300]
        if len(_REQUESTS) >= 12 or provider == 'osrm' and _OSRM_LAST_START is not None and now - _OSRM_LAST_START < OSRM_MIN_INTERVAL:
            raise RoutingError(429, 'routing_limit')
        _REQUESTS.append(now)
        if provider == 'osrm':
            _OSRM_LAST_START = now
        points = value['origins'] + [value['target']]
        if provider == 'ors':
            body = {'locations': [[p['lng'], p['lat']] for p in points],
                    'sources': [str(i) for i in range(len(value['origins']))],
                    'destinations': [str(len(value['origins']))], 'metrics': ['duration', 'distance'], 'units': 'm'}
            request = urllib.request.Request('https://api.heigit.org/openrouteservice/v2/matrix/' + PROFILES[value['mode']],
                                             data=json.dumps(body).encode(), method='POST',
                                             headers={'Authorization': key, 'Content-Type': 'application/json', 'Accept': 'application/json'})
        else:
            # The fixed host, endpoint and validated coordinates are the entire
            # outbound request. Labels and credentials never leave this server.
            coordinates = ';'.join(str(p['lng']) + ',' + str(p['lat']) for p in points)
            sources = ';'.join(str(i) for i in range(len(value['origins'])))
            url = ('https://routing.openstreetmap.de/routed-' + OSRM_PROFILES[value['mode']]
                   + '/table/v1/driving/' + coordinates + '?sources=' + sources
                   + '&destinations=' + str(len(value['origins']))
                   + '&annotations=duration,distance&generate_hints=false')
            request = urllib.request.Request(url, method='GET', headers={
                'Accept': 'application/json', 'User-Agent': 'PlanView/1.0 (' + PLANVIEW_URL + ')', 'Referer': PLANVIEW_URL})
        try:
            with (opener or urllib.request.build_opener(_NoRedirect()).open)(request, timeout=12) as response:
                raw = response.read(64001)
            if len(raw) > 64000:
                raise ValueError()
            data = json.loads(raw)
            if provider == 'osrm' and (not isinstance(data, dict) or data.get('code') != 'Ok' or 'fallback_speed_cells' in data):
                raise ValueError()
            for field in ('durations', 'distances'):
                if not isinstance(data.get(field), list) or len(data[field]) != len(value['origins']):
                    raise ValueError()
                for row in data[field]:
                    if not isinstance(row, list) or len(row) != 1 or row[0] is not None and (type(row[0]) not in (int, float) or not math.isfinite(row[0]) or row[0] < 0):
                        raise ValueError()
        except urllib.error.HTTPError as error:
            status = error.code
            error.close()
            raise RoutingError(429 if status == 429 else 502, 'routing_key_rejected' if provider == 'ors' and status in (401, 403) else 'routing_limit' if status == 429 else 'routing_unavailable') from None
        except (OSError, urllib.error.URLError):
            raise RoutingError(502, 'routing_unavailable') from None
        except (ValueError, KeyError, TypeError, AttributeError):
            raise RoutingError(502, 'invalid_routing_response') from None
        routes = []
        for i, origin in enumerate(value['origins']):
            duration, distance = data['durations'][i][0], data['distances'][i][0]
            available = duration is not None and distance is not None
            routes.append({'origin': origin, 'status': 'available' if available else 'unavailable',
                           'durationSeconds': duration if available else None, 'distanceMeters': distance if available else None})
        return {'mode': value['mode'], 'profile': PROFILES[value['mode']] if provider == 'ors' else OSRM_PROFILES[value['mode']],
                'provider': provider, 'target': value['target'], 'routes': routes,
                'source': 'openrouteservice / HeiGIT · OpenStreetMap' if provider == 'ors' else 'OSRM / FOSSGIS · OpenStreetMap',
                'sourceUrl': 'https://openrouteservice.org/' if provider == 'ors' else 'https://routing.openstreetmap.de/about.html',
                'attribution': '© OpenStreetMap contributors', 'attributionUrl': 'https://www.openstreetmap.org/copyright',
                'editUrl': 'https://www.openstreetmap.org/fixthemap',
                'retrievedAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), 'modeled': True, 'liveTraffic': False}
    finally:
        _LOCK.release()
