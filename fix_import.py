"""
SafeTruck — Reimportar segmentos de Lanús con osmid problemáticos
Ejecutar desde SafeTruck2 con el venv activado:
  python3 fix_import.py
"""
import json, math, time, os
from supabase import create_client

SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY")
supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

def line_length_m(coords):
    total = 0; R = 6371000
    for i in range(len(coords)-1):
        lng1,lat1=coords[i][0],coords[i][1]; lng2,lat2=coords[i+1][0],coords[i+1][1]
        phi1,phi2=math.radians(lat1),math.radians(lat2)
        a=(math.sin(math.radians(lat2-lat1)/2)**2+
           math.cos(phi1)*math.cos(phi2)*math.sin(math.radians(lng2-lng1)/2)**2)
        total+=R*2*math.atan2(math.sqrt(a),math.sqrt(1-a))
    return round(total,2)

def wkt(coords): return "LINESTRING("+", ".join(f"{c[0]} {c[1]}" for c in coords)+")"
def e(s):
    if isinstance(s,list): s=' / '.join(str(x) for x in s)
    return str(s or '').replace("'","''").strip()[:200]
def sup(s):
    if isinstance(s,list): s=' '.join(str(x) for x in s)
    return str(s or '').upper()

BASE = os.path.dirname(os.path.abspath(__file__))

lanus_rest_path = os.path.join(BASE, 'src', 'data', 'lanus-parsed.json')
lanus_path = os.path.join(BASE, 'src', 'data', 'red-vial-lanus.geojson')

with open(lanus_path) as f: lv = json.load(f)
with open(lanus_rest_path) as f: lr = json.load(f)

LA = set()
for c in lr.get('calles', []):
    for w in sup(c.get('nombre','')).split():
        if len(w) > 4: LA.add(w)

SKIP = {'footway','cycleway','pedestrian','steps','path'}
rows = []

for feat in lv['features']:
    p = feat['properties']; g = feat.get('geometry')
    if not g or g['type'] != 'LineString': continue
    hw = str(p.get('highway',''))
    if hw in SKIP: continue
    coords = g['coordinates']
    if len(coords) < 2: continue

    # Fix: osmid puede ser lista → tomar el primero o None
    osmid = p.get('osmid')
    if isinstance(osmid, list):
        osmid = osmid[0] if osmid else None
    try:
        osmid = int(osmid) if osmid is not None else None
    except (ValueError, TypeError):
        osmid = None

    nr = p.get('name') or ''; nu = sup(nr)
    allowed = True if any(k in nu for k in LA) else None
    speed = {'primary':60,'secondary':50,'tertiary':40,'residential':30}.get(hw, 40)
    length = float(p.get('length') or line_length_m(coords))

    rows.append({
        'osm_id': osmid,
        'street_name': e(nr),
        'municipality': 'lanus',
        'geom': f"SRID=4326;{wkt(coords)}",
        'heavy_vehicle_allowed': allowed,
        'max_weight_kg': 10000 if allowed else None,
        'max_height_m': 4.10 if allowed else None,
        'length_m': round(length, 2),
        'speed_kmh': speed,
        'ordinance_ref': e(hw),
        'data_source': 'osm'
    })

print(f"Lanús: {len(rows)} segmentos a reimportar")

BATCH = 100
batches = [rows[i:i+BATCH] for i in range(0, len(rows), BATCH)]
ok = 0; err = 0

for idx, batch in enumerate(batches):
    try:
        supabase.table('st_street_segments').upsert(batch).execute()
        ok += len(batch)
    except Exception as ex:
        err += len(batch)
        print(f"  Error batch {idx+1}: {ex}")
    time.sleep(0.05)

print(f"\n✅ Reimportación Lanús: {ok} ok, {err} errores")

# Verificar total
result = supabase.table('st_street_segments').select('municipality', count='exact').execute()
print(f"Total en BD: {result.count} segmentos")
