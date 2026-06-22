"""
SafeTruck — Importación de red vial AMBA
Ejecutar desde la carpeta SafeTruck2:

  python3 import_segments.py

Requiere: pip install supabase
"""

import json, time, sys
from supabase import create_client

SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY")

supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

import math, os

# ── Helpers ────────────────────────────────────────────────────────────────

def line_length_m(coords):
    total = 0; R = 6371000
    for i in range(len(coords) - 1):
        lng1, lat1 = coords[i][0], coords[i][1]
        lng2, lat2 = coords[i+1][0], coords[i+1][1]
        phi1, phi2 = math.radians(lat1), math.radians(lat2)
        a = (math.sin(math.radians(lat2-lat1)/2)**2 +
             math.cos(phi1)*math.cos(phi2)*math.sin(math.radians(lng2-lng1)/2)**2)
        total += R * 2 * math.atan2(math.sqrt(a), math.sqrt(1-a))
    return round(total, 2)

def e(s):
    if isinstance(s, list): s = ' / '.join(str(x) for x in s)
    return str(s or '').replace("'", "''").strip()[:200]

def sup(s):
    if isinstance(s, list): s = ' '.join(str(x) for x in s)
    return str(s or '').upper()

def wkt(coords):
    return "LINESTRING(" + ", ".join(f"{c[0]} {c[1]}" for c in coords) + ")"

# ── Cargar datos ───────────────────────────────────────────────────────────
rows = []
BASE = os.path.dirname(os.path.abspath(__file__))

KW = {
    'ALBERDI','OLIDEN','MURGUIONDO','TORRE','DIRECTORIO','LARRAZABAL','PERÓN',
    'LACARRA','DELLEPIANE','LAFUENTE','MORENO','BEAZLEY','SAENZ','ALCORTA',
    'VÉLEZ','AUSTRALIA','QUINQUELA','PINEDO','VIEYTES','HERRERA','IRIARTE',
    'CANTILO','LUGONES','FIGUEROA','DORREGO','BULLRICH','CÓRDOBA','NEWBERY',
    'VEGA','ÁLVAREZ','BALBÍN','HOLMBERG','DONADO','GALVÁN','INCAS',
    'CONSTITUYENTES','CHORROARÍN','WARNES','MARTÍN','BEIRÓ','NAZCA',
    'ESCALADA','ZUVIRÍA','PEDRITO','BRANDSEN','MENDOZA','PERDRIEL',
    'FERNÁNDEZ','SARMIENTO','ARGENTINA','BAUNESS','TRIUNVIRATO','CASTILLO',
    'OBLIGADO','BAJO','ILLIA','PIEDRA','CALIFORNIA','JULIO','HORNOS',
    'SUÁREZ','LAFAYETTE','RABANAL','ROCA','REGIMIENTO','REMEDIOS','ELCANO',
}
EX_TIPO = {'PASAJE PEATONAL','CALLE PEATONAL','SENDERO','PASAJE PÚBLICO'}
EX_SENT = {'PEATONAL','PJE. PRIVADO'}

# CABA
print("Procesando CABA...")
caba_path = os.path.join(BASE, 'src', 'data', 'red-vial-CABA.geojson')
with open(caba_path) as f:
    caba = json.load(f)
for feat in caba['features']:
    p = feat['properties']; g = feat.get('geometry')
    if not g or g['type'] != 'LineString': continue
    if p.get('tipo_c') in EX_TIPO or p.get('sentido') in EX_SENT: continue
    coords = g['coordinates']
    if len(coords) < 2: continue
    nr = p.get('nomoficial','') or ''; nu = sup(nr)
    tipo = p.get('tipo_c','') or ''; jerarq = p.get('red_jerarq','') or ''
    allowed = True if tipo == 'AUTOPISTA' else (True if any(k in nu for k in KW) else None)
    speed = 80 if tipo == 'AUTOPISTA' else (50 if 'TRONCAL' in jerarq else (40 if 'PRINCIPAL' in jerarq else 30))
    length = float(p.get('long') or line_length_m(coords))
    rows.append({
        'osm_id': p.get('id'), 'street_name': e(nr), 'municipality': 'CABA',
        'geom': f"SRID=4326;{wkt(coords)}", 'heavy_vehicle_allowed': allowed,
        'max_weight_kg': None, 'max_height_m': 4.10 if allowed else None,
        'length_m': round(length, 2), 'speed_kmh': speed,
        'ordinance_ref': e(jerarq), 'data_source': 'idecaba'
    })
print(f"  CABA: {len(rows)} segmentos")

# Lanús
print("Procesando Lanús...")
lanus_path = os.path.join(BASE, 'src', 'data', 'red-vial-lanus.geojson')
lanus_rest_path = os.path.join(BASE, 'src', 'data', 'lanus-parsed.json')
with open(lanus_path) as f: lv = json.load(f)
with open(lanus_rest_path) as f: lr = json.load(f)
LA = set()
for c in lr.get('calles', []):
    for w in sup(c.get('nombre','')).split():
        if len(w) > 4: LA.add(w)
SKIP = {'footway','cycleway','pedestrian','steps','path'}
lanus_start = len(rows)
for feat in lv['features']:
    p = feat['properties']; g = feat.get('geometry')
    if not g or g['type'] != 'LineString': continue
    hw = str(p.get('highway',''))
    if hw in SKIP: continue
    coords = g['coordinates']
    if len(coords) < 2: continue
    nr = p.get('name') or ''; nu = sup(nr)
    allowed = True if any(k in nu for k in LA) else None
    speed = {'primary':60,'secondary':50,'tertiary':40,'residential':30}.get(hw, 40)
    length = float(p.get('length') or line_length_m(coords))
    rows.append({
        'osm_id': p.get('osmid'), 'street_name': e(nr), 'municipality': 'lanus',
        'geom': f"SRID=4326;{wkt(coords)}", 'heavy_vehicle_allowed': allowed,
        'max_weight_kg': 10000 if allowed else None,
        'max_height_m': 4.10 if allowed else None,
        'length_m': round(length, 2), 'speed_kmh': speed,
        'ordinance_ref': e(hw), 'data_source': 'osm'
    })
print(f"  Lanús: {len(rows)-lanus_start} segmentos")

# Rutas nacionales
print("Procesando rutas nacionales...")
nac_path = os.path.join(BASE, 'src', 'data', 'rutas-nacionales.geojson')
with open(nac_path) as f: nac = json.load(f)
def in_amba(feat):
    for cl in feat['geometry']['coordinates']:
        for pt in cl:
            if -35.5 <= pt[1] <= -33.5 and -59.5 <= pt[0] <= -57.5: return True
    return False
nac_start = len(rows)
for feat in nac['features']:
    if not in_amba(feat): continue
    p = feat['properties']
    rtn = str(p.get('NAM','')).lstrip('0') or p.get('NAM','')
    for cl in feat['geometry']['coordinates']:
        if len(cl) < 2: continue
        rows.append({
            'osm_id': p.get('id'), 'street_name': f"Ruta Nacional {rtn}",
            'municipality': 'amba', 'geom': f"SRID=4326;{wkt(cl)}",
            'heavy_vehicle_allowed': True, 'max_weight_kg': None, 'max_height_m': 4.10,
            'length_m': line_length_m(cl), 'speed_kmh': 110,
            'ordinance_ref': f"RN{rtn}", 'data_source': 'dnv'
        })
print(f"  Rutas nacionales: {len(rows)-nac_start} segmentos")
print(f"\nTOTAL: {len(rows)} segmentos listos para importar")

# ── Importar a Supabase en batches ─────────────────────────────────────────
BATCH = 100
total_ok = 0
total_err = 0
batches = [rows[i:i+BATCH] for i in range(0, len(rows), BATCH)]

print(f"\nImportando en {len(batches)} batches de {BATCH}...")
for idx, batch in enumerate(batches):
    try:
        result = supabase.table('st_street_segments').upsert(batch).execute()
        total_ok += len(batch)
        if (idx + 1) % 10 == 0:
            print(f"  Progreso: {idx+1}/{len(batches)} batches ({total_ok} segmentos)")
    except Exception as ex:
        total_err += len(batch)
        print(f"  Error batch {idx+1}: {ex}")
    time.sleep(0.05)  # Evitar rate limiting

print(f"\n✅ Importación completa: {total_ok} ok, {total_err} errores")

# Verificar
result = supabase.table('st_street_segments').select('municipality', count='exact').execute()
print(f"Total en BD: {result.count} segmentos")
