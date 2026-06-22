"""
SafeTruck — Descarga grafo OSM del AMBA y lo sube a Supabase para pgRouting
Ejecutar: python3 download_graph.py

CAMBIOS vs versión anterior:
1. Descarga el AMBA completo con bbox en lugar de municipio por municipio
   → garantiza nodos compartidos en bordes y grafo continuo
2. is_allowed() retorna False (no None) para calles prohibidas en municipios con datos
   → None solo para municipios sin datos oficiales (modo colaborativo)
"""
import osmnx as ox
import geopandas as gpd
import psycopg2
import psycopg2.extras
import json
import math
import time
import numpy as np
from shapely.geometry import Point, mapping
import psycopg2.extensions

psycopg2.extensions.register_adapter(np.float64, lambda x: psycopg2.extensions.AsIs(float(x)))
psycopg2.extensions.register_adapter(np.int64, lambda x: psycopg2.extensions.AsIs(int(x)))
psycopg2.extensions.register_adapter(np.bool_, lambda x: psycopg2.extensions.AsIs(bool(x)))

# ── Config ────────────────────────────────────────────────────────────────
import os
DB_URL = os.environ.get("SAFETRUCK_DB_URL", "postgresql://postgres:camionesInge2026@db.bxhduayxffanioaclzrd.supabase.co:5432/postgres")

# Restricciones por municipio (de los JSONs oficiales)
RESTRICTIONS = {
    "CABA": {
        "allowed_keywords": [
            "alberdi","oliden","murguiondo","directorio","larrazabal","peron","eva peron",
            "lacarra","dellepiane","lafuente","moreno","perito moreno","beazley","saenz",
            "alcorta","amancio alcorta","velez sarsfield","australia","quinquela","pinedo",
            "vieytes","herrera","iriarte","cantilo","lugones","figueroa alcorta","dorrego",
            "bullrich","cordoba","newbery","vega","alvarez thomas","balbin","holmberg",
            "donado","paz","galvan","incas","constituyentes","chorroarin","warnes",
            "san martin","beiro","nazca","escalada","zuviria","san pedrito","brandsen",
            "pedro de mendoza","perdriel","fernandez de la cruz","sarmiento","argentina",
            "bauness","triunvirato","castillo","obligado","paseo del bajo","illia",
            "piedra buena","california","9 de julio","hornos","suarez","lafayette",
            "rabanal","roca","regimiento","remedios","elcano","27 de febrero",
        ],
        "max_weight_kg": None,
        "max_height_m": 4.10,
        "highway_always_allowed": ["motorway","motorway_link","trunk","trunk_link"],
    },
    "lanus": {
        "allowed_keywords": [
            "remedios de escalada","viamonte","rincon","coronel sayos","25 de mayo",
            "marco avellaneda","caferata","general hornos","uriarte","hipolito yrigoyen",
            "malabia","aconcagua","granaderos","roma","coronel lynch","belgrano",
            "madariaga","san martin","rivadavia","olazabal","enrique fernandez",
            "alfonsín","centenario uruguayo","coronel osorio","quindimil","alvarez",
        ],
        "max_weight_kg": 10000,
        "max_height_m": 4.10,
        "highway_always_allowed": ["motorway","motorway_link","trunk","trunk_link"],
    },
    "la_matanza": {
        "allowed_keywords": [
            "ruta 3","ruta nacional 3","camino de cintura","riccheri","ruta 21",
            "ruta 17","crovara","christiania","juan manuel de rosas","illia","arieta",
        ],
        "max_weight_kg": 10000,
        "max_height_m": 4.10,
        "highway_always_allowed": ["motorway","motorway_link","trunk","trunk_link"],
    },
    "moron": {
        "allowed_keywords": [
            "acceso oeste","rivadavia","camino de cintura","don bosco","pierrestegui",
            "hipolito yrigoyen",
        ],
        "max_weight_kg": 12000,
        "max_height_m": 4.10,
        "highway_always_allowed": ["motorway","motorway_link","trunk","trunk_link"],
    },
    "ezeiza": {
        "allowed_keywords": [
            "ezeiza canuelas","ruta 205","ruta 52","jorge newbery","12 de octubre",
        ],
        "max_weight_kg": 10000,
        "max_height_m": 4.10,
        "highway_always_allowed": ["motorway","motorway_link","trunk","trunk_link"],
    },
    "esteban_echeverria": {
        "allowed_keywords": [
            "camino de cintura","ruta 205","valette","fair","castex","cervetti",
        ],
        "max_weight_kg": 12000,
        "max_height_m": 4.10,
        "highway_always_allowed": ["motorway","motorway_link","trunk","trunk_link"],
    },
    "florencio_varela": {
        "allowed_keywords": [
            "jorge novak","ruta 36","eva peron","hudson","cariboni","lujan","calchaqui",
        ],
        "max_weight_kg": 12000,
        "max_height_m": 4.10,
        "highway_always_allowed": ["motorway","motorway_link","trunk","trunk_link"],
    },
    "escobar": {
        "allowed_keywords": [
            "ruta 25","inmigrantes","constituyentes","general guemes","villanueva",
        ],
        "max_weight_kg": 3500,
        "max_height_m": 4.10,
        "highway_always_allowed": ["motorway","motorway_link","trunk","trunk_link"],
    },
    "tigre": {
        "allowed_keywords": [
            "ruta 197","ruta 27","henry ford","constituyentes","sarmiento",
            "italia","benavídez","benavidez",
        ],
        "max_weight_kg": 7000,
        "max_height_m": 4.10,
        "highway_always_allowed": ["motorway","motorway_link","trunk","trunk_link"],
    },
    "san_isidro": {
        "allowed_keywords": [
            "panamericana","ramal tigre","avelino rolon","bernabe marquez","uruguay",
            "sucre","centenario","santa fe","amancio alcorta","de mayo","camino real",
            "unidad nacional",
        ],
        "max_weight_kg": 12000,
        "max_height_m": 4.10,
        "highway_always_allowed": ["motorway","motorway_link","trunk","trunk_link"],
    },
    "lomas_de_zamora": {
        "allowed_keywords": [
            "camino negro","pte peron","camino de cintura","hipolito yrigoyen","alsina",
            "juan xxiii","antartida argentina","eva peron","general frias","garibaldi",
        ],
        "max_weight_kg": 10000,
        "max_height_m": 4.10,
        "highway_always_allowed": ["motorway","motorway_link","trunk","trunk_link"],
    },
}

# Polígonos aproximados por municipio para asignar muni_key a cada arista
# (lat_min, lat_max, lng_min, lng_max)
MUNI_BBOX = {
    "CABA":               (-34.705, -34.527, -58.531, -58.334),
    "lanus":              (-34.730, -34.670, -58.420, -58.340),
    "lomas_de_zamora":    (-34.780, -34.700, -58.430, -58.340),
    "la_matanza":         (-34.800, -34.580, -58.700, -58.480),
    "moron":              (-34.680, -34.600, -58.650, -58.540),
    "ezeiza":             (-34.900, -34.790, -58.600, -58.450),
    "esteban_echeverria": (-34.860, -34.770, -58.510, -58.360),
    "florencio_varela":   (-34.870, -34.770, -58.330, -58.170),
    "escobar":            (-34.380, -34.270, -58.780, -58.630),
    "tigre":              (-34.530, -34.350, -58.720, -58.530),
    "san_isidro":         (-34.540, -34.440, -58.580, -58.480),
}

def get_muni_key(lat: float, lng: float) -> str | None:
    """Determina el municipio de una arista por el centroide de sus coordenadas"""
    for muni, (lat_min, lat_max, lng_min, lng_max) in MUNI_BBOX.items():
        if lat_min <= lat <= lat_max and lng_min <= lng <= lng_max:
            return muni
    return None  # Fuera de todos los bbox conocidos


def is_allowed(name: str, highway: str, muni_key: str | None) -> bool | None:
    """
    Determina si una calle está habilitada para camiones.
    
    Returns:
        True  → habilitada
        False → prohibida (municipio con datos, calle no en lista)  ← CORREGIDO
        None  → sin datos (municipio sin restricciones oficiales → modo colaborativo)
    """
    if muni_key is None or muni_key not in RESTRICTIONS:
        return None  # Sin datos → modo colaborativo

    restr = RESTRICTIONS[muni_key]

    # Autopistas y rutas siempre habilitadas
    if highway in restr.get("highway_always_allowed", []):
        return True

    # Municipio con datos pero calle sin nombre → prohibida
    if not name:
        return False  # ← CORREGIDO (antes era None)

    name_lower = name.lower()
    for kw in restr["allowed_keywords"]:
        if kw in name_lower:
            return True

    return False  # ← CORREGIDO: municipio con datos, calle no en lista → PROHIBIDA


def haversine(lat1, lng1, lat2, lng2):
    R = 6371000
    dLat = math.radians(lat2 - lat1)
    dLng = math.radians(lng2 - lng1)
    a = (math.sin(dLat/2)**2 +
         math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dLng/2)**2)
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1-a))


# ── Función de costo ──────────────────────────────────────────────────────
PENALTY_UNKNOWN   = 3.0   # None  → sin datos, posible pero costoso
PENALTY_FORBIDDEN = 50.0  # False → prohibido, casi imposible
PENALTY_ALLOWED   = 1.0   # True  → habilitado, normal

def calc_cost(length_m, speed_kmh, allowed):
    base = length_m / (speed_kmh / 3.6)  # segundos reales
    if allowed is True:
        return base * PENALTY_ALLOWED
    elif allowed is False:
        return base * PENALTY_FORBIDDEN
    else:  # None = sin datos
        return base * PENALTY_UNKNOWN


# ── Setup BD ──────────────────────────────────────────────────────────────
print("Conectando a Supabase...")
conn = psycopg2.connect(DB_URL)
cur = conn.cursor()

print("Recreando tablas pgr_edges y pgr_nodes...")
cur.execute("""
DROP TABLE IF EXISTS pgr_edges CASCADE;
DROP TABLE IF EXISTS pgr_nodes CASCADE;

CREATE TABLE pgr_edges (
    id BIGSERIAL PRIMARY KEY,
    osm_id BIGINT,
    source BIGINT NOT NULL,
    target BIGINT NOT NULL,
    cost FLOAT NOT NULL,
    reverse_cost FLOAT NOT NULL,
    length_m FLOAT NOT NULL,
    speed_kmh FLOAT DEFAULT 40,
    street_name TEXT,
    municipality TEXT,
    highway TEXT,
    heavy_vehicle_allowed BOOLEAN,
    max_weight_kg FLOAT,
    max_height_m FLOAT,
    oneway BOOLEAN DEFAULT FALSE,
    geom GEOMETRY(LINESTRING, 4326)
);

CREATE TABLE pgr_nodes (
    id BIGSERIAL PRIMARY KEY,
    osm_id BIGINT UNIQUE,
    geom GEOMETRY(POINT, 4326)
);

CREATE INDEX idx_pgr_edges_source ON pgr_edges(source);
CREATE INDEX idx_pgr_edges_target ON pgr_edges(target);
CREATE INDEX idx_pgr_edges_geom   ON pgr_edges USING GIST(geom);
CREATE INDEX idx_pgr_nodes_geom   ON pgr_nodes USING GIST(geom);
CREATE INDEX idx_pgr_edges_muni   ON pgr_edges(municipality);
""")
conn.commit()
print("Tablas creadas.")


# ── Descargar AMBA completo de una sola vez ───────────────────────────────
# Este bbox cubre CABA + todos los municipios del AMBA
# Al descargarse juntos, los nodos en bordes de municipios son COMPARTIDOS
# → el grafo es continuo y se puede rutear entre municipios

print("\nDescargando grafo OSM del AMBA completo (bbox único)...")
print("Esto puede tardar varios minutos...")

G = ox.graph_from_bbox(
    bbox=(-35.05, -58.85, -34.20, -58.20),  # (sur, oeste, norte, este) del AMBA
    network_type='drive',
    simplify=True,
    retain_all=False,
)

print(f"✓ Grafo descargado: {len(G.nodes)} nodos, {len(G.edges)} aristas")


# ── Procesar nodos ────────────────────────────────────────────────────────
print("\nProcesando nodos...")
node_id_map = {}  # osm_id → pgr_node id
next_node_id = 1
node_rows = []

for osm_id, data in G.nodes(data=True):
    node_id_map[osm_id] = next_node_id
    next_node_id += 1
    node_rows.append((
        node_id_map[osm_id],
        int(osm_id),
        float(data['x']),
        float(data['y']),
    ))

# Insertar en lotes de 5000
BATCH = 5000
for i in range(0, len(node_rows), BATCH):
    batch = node_rows[i:i+BATCH]
    psycopg2.extras.execute_values(cur, """
        INSERT INTO pgr_nodes (id, osm_id, geom)
        VALUES %s
        ON CONFLICT (osm_id) DO NOTHING
    """, batch,
    template="(%s, %s, ST_SetSRID(ST_MakePoint(%s, %s), 4326))")
    conn.commit()
    print(f"  Nodos: {min(i+BATCH, len(node_rows))}/{len(node_rows)}", end='\r')

print(f"\n✓ {len(node_rows)} nodos insertados")


# ── Procesar aristas ──────────────────────────────────────────────────────
print("\nProcesando aristas...")

speed_map = {
    'motorway': 110, 'motorway_link': 80,
    'trunk': 90,     'trunk_link': 70,
    'primary': 60,   'primary_link': 50,
    'secondary': 50, 'secondary_link': 40,
    'tertiary': 40,  'tertiary_link': 35,
    'residential': 30, 'living_street': 20,
    'unclassified': 35,
}

edge_rows = []
skipped = 0

for u, v, data in G.edges(data=True):
    if u not in node_id_map or v not in node_id_map:
        skipped += 1
        continue

    source = node_id_map[u]
    target = node_id_map[v]

    # Nombre
    name = data.get('name', '')
    if isinstance(name, list):
        name = ' / '.join(name)
    name = name[:200] if name else None

    # Tipo de vía
    highway = data.get('highway', '')
    if isinstance(highway, list):
        highway = highway[0]

    length_m  = float(data.get('length', 100))
    oneway    = bool(data.get('oneway', False))
    speed_kmh = float(speed_map.get(highway, 35))

    # Determinar municipio por centroide de la arista
    u_data = G.nodes[u]
    v_data = G.nodes[v]
    center_lat = (u_data['y'] + v_data['y']) / 2
    center_lng = (u_data['x'] + v_data['x']) / 2
    muni_key = get_muni_key(center_lat, center_lng)

    # Restricción para camiones
    allowed    = is_allowed(name, highway, muni_key)
    restr      = RESTRICTIONS.get(muni_key, {}) if muni_key else {}
    max_weight = restr.get('max_weight_kg')
    max_height = restr.get('max_height_m')

    cost         = calc_cost(length_m, speed_kmh, allowed)
    reverse_cost = cost if not oneway else -1.0

    # Geometría
    if 'geometry' in data:
        coords = list(data['geometry'].coords)
        wkt = "LINESTRING(" + ", ".join(f"{c[0]} {c[1]}" for c in coords) + ")"
    else:
        wkt = f"LINESTRING({u_data['x']} {u_data['y']}, {v_data['x']} {v_data['y']})"

    osm_id = data.get('osmid')
    if isinstance(osm_id, list):
        osm_id = osm_id[0]

    edge_rows.append((
        osm_id, source, target, cost, reverse_cost,
        length_m, speed_kmh, name,
        muni_key, highway, allowed,
        max_weight, max_height, oneway, wkt
    ))

    # Insertar en lotes
    if len(edge_rows) >= BATCH:
        psycopg2.extras.execute_values(cur, """
            INSERT INTO pgr_edges
              (osm_id, source, target, cost, reverse_cost,
               length_m, speed_kmh, street_name,
               municipality, highway, heavy_vehicle_allowed,
               max_weight_kg, max_height_m, oneway, geom)
            VALUES %s
        """, edge_rows,
        template="(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,ST_GeomFromText(%s,4326))")
        conn.commit()
        print(f"  Aristas insertadas: {len(edge_rows)} lote...", end='\r')
        edge_rows = []

# Insertar el resto
if edge_rows:
    psycopg2.extras.execute_values(cur, """
        INSERT INTO pgr_edges
          (osm_id, source, target, cost, reverse_cost,
           length_m, speed_kmh, street_name,
           municipality, highway, heavy_vehicle_allowed,
           max_weight_kg, max_height_m, oneway, geom)
        VALUES %s
    """, edge_rows,
    template="(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,ST_GeomFromText(%s,4326))")
    conn.commit()

print(f"\n✓ Aristas insertadas (skipped: {skipped})")


# ── Verificación ──────────────────────────────────────────────────────────
cur.execute("""
    SELECT municipality, 
           COUNT(*) as total,
           SUM(CASE WHEN heavy_vehicle_allowed = TRUE  THEN 1 ELSE 0 END) as allowed,
           SUM(CASE WHEN heavy_vehicle_allowed = FALSE THEN 1 ELSE 0 END) as forbidden,
           SUM(CASE WHEN heavy_vehicle_allowed IS NULL THEN 1 ELSE 0 END) as unknown
    FROM pgr_edges 
    GROUP BY municipality 
    ORDER BY municipality
""")
print("\n=== RESULTADO FINAL ===")
print(f"{'Municipio':<25} {'Total':>8} {'✓ OK':>8} {'✗ Prohib':>10} {'? Sin datos':>12}")
print("-" * 65)
for row in cur.fetchall():
    muni = row[0] or "Sin municipio"
    print(f"{muni:<25} {row[1]:>8} {row[2]:>8} {row[3]:>10} {row[4]:>12}")

cur.execute("SELECT COUNT(*) FROM pgr_nodes")
print(f"\nNodos totales: {cur.fetchone()[0]}")


# ── Crear función RPC pgr_route_truck ─────────────────────────────────────
print("\nCreando función de ruteo...")
cur.execute("""
CREATE OR REPLACE FUNCTION pgr_route_truck(
    start_lat FLOAT, start_lng FLOAT,
    end_lat FLOAT, end_lng FLOAT
)
RETURNS TABLE(
    seq INT, edge_id BIGINT, source BIGINT, target BIGINT,
    cost FLOAT, agg_cost FLOAT,
    street_name TEXT, municipality TEXT,
    heavy_vehicle_allowed BOOLEAN,
    max_weight_kg FLOAT, max_height_m FLOAT,
    length_m FLOAT,
    geom GEOMETRY
) AS $$
DECLARE
    start_node BIGINT;
    end_node   BIGINT;
BEGIN
    SELECT n.id INTO start_node
    FROM pgr_nodes n
    ORDER BY n.geom <-> ST_SetSRID(ST_MakePoint(start_lng, start_lat), 4326)
    LIMIT 1;

    SELECT n.id INTO end_node
    FROM pgr_nodes n
    ORDER BY n.geom <-> ST_SetSRID(ST_MakePoint(end_lng, end_lat), 4326)
    LIMIT 1;

    RETURN QUERY
    SELECT
        r.seq,
        r.edge          AS edge_id,
        r.node          AS source,
        r.node          AS target,
        r.cost,
        r.agg_cost,
        e.street_name,
        e.municipality,
        e.heavy_vehicle_allowed,
        e.max_weight_kg,
        e.max_height_m,
        e.length_m,
        e.geom
    FROM pgr_aStar(
        'SELECT id, source, target, cost, reverse_cost,
                ST_X(ST_StartPoint(geom)) AS x1,
                ST_Y(ST_StartPoint(geom)) AS y1,
                ST_X(ST_EndPoint(geom))   AS x2,
                ST_Y(ST_EndPoint(geom))   AS y2
         FROM pgr_edges
         WHERE cost > 0',
        start_node,
        end_node,
        directed  := true,
        heuristic := 4
    ) r
    LEFT JOIN pgr_edges e ON r.edge = e.id;
END;
$$ LANGUAGE plpgsql;
""")
conn.commit()
print("✓ Función pgr_route_truck creada")

cur.close()
conn.close()
print("\n✅ Todo listo. El grafo del AMBA está conectado y las restricciones correctas.")