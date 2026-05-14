"""
SafeTruck — Descarga los 11 municipios con datos oficiales
como UNA SOLA red continua usando ox.graph_from_place con lista.
"""
import osmnx as ox
import psycopg2
import psycopg2.extras
import psycopg2.extensions
import numpy as np
import math

psycopg2.extensions.register_adapter(np.float64, lambda x: psycopg2.extensions.AsIs(float(x)))
psycopg2.extensions.register_adapter(np.int64, lambda x: psycopg2.extensions.AsIs(int(x)))
psycopg2.extensions.register_adapter(np.bool_, lambda x: psycopg2.extensions.AsIs(bool(x)))

DB_URL = "postgresql://postgres:camionesInge2026@db.bxhduayxffanioaclzrd.supabase.co:5432/postgres"

PLACES = [
    "Ciudad Autónoma de Buenos Aires, Argentina",
    "Lanús, Buenos Aires, Argentina",
    "La Matanza, Buenos Aires, Argentina",
    "Morón, Buenos Aires, Argentina",
    "Ezeiza, Buenos Aires, Argentina",
    "Esteban Echeverría, Buenos Aires, Argentina",
    "Florencio Varela, Buenos Aires, Argentina",
    "Escobar, Buenos Aires, Argentina",
    "Tigre, Buenos Aires, Argentina",
    "San Isidro, Buenos Aires, Argentina",
    "Lomas de Zamora, Buenos Aires, Argentina",
]

MUNI_BBOXES = {
    "CABA":               (-34.705, -58.532, -34.527, -58.335),
    "lanus":              (-34.740, -58.420, -34.660, -58.330),
    "la_matanza":         (-34.870, -58.760, -34.580, -58.480),
    "moron":              (-34.680, -58.650, -34.580, -58.540),
    "ezeiza":             (-34.920, -58.620, -34.780, -58.430),
    "esteban_echeverria": (-34.860, -58.560, -34.720, -58.390),
    "florencio_varela":   (-34.920, -58.380, -34.770, -58.190),
    "escobar":            (-34.420, -58.870, -34.250, -58.620),
    "tigre":              (-34.560, -58.780, -34.310, -58.490),
    "san_isidro":         (-34.530, -58.600, -34.420, -58.470),
    "lomas_de_zamora":    (-34.800, -58.450, -34.670, -58.310),
}

RESTRICTIONS = {
    "CABA": {
        "keywords": ["alberdi","oliden","murguiondo","directorio","larrazabal","peron","perón",
            "lacarra","dellepiane","lafuente","moreno","perito","beazley","saenz","sáenz",
            "alcorta","velez","vélez","australia","quinquela","pinedo","vieytes","herrera",
            "iriarte","cantilo","lugones","figueroa","dorrego","bullrich","cordoba","córdoba",
            "newbery","vega","alvarez","álvarez","balbin","balbín","holmberg","donado","galvan",
            "galván","incas","constituyentes","chorroarin","chorroarín","warnes","martin","martín",
            "beiro","beiró","nazca","escalada","zuviria","zuviría","pedrito","brandsen","mendoza",
            "perdriel","fernandez","fernández","sarmiento","argentina","bauness","triunvirato",
            "castillo","obligado","bajo","illia","piedra","california","julio","hornos","suarez",
            "suárez","lafayette","rabanal","roca","regimiento","remedios","elcano","febrero",
            "eva peron","eva perón","autopista","au1","au6","au7"],
        "always_allowed": ["motorway","motorway_link","trunk","trunk_link"],
        "max_weight_kg": None, "max_height_m": 4.10,
    },
    "lanus": {
        "keywords": ["remedios","viamonte","rincon","rincón","sayos","25 de mayo","avellaneda",
            "avellaneda","hornos","uriarte","yrigoyen","malabia","aconcagua","granaderos",
            "roma","lynch","belgrano","madariaga","martin","martín","rivadavia","olazabal",
            "olazábal","fernandez","fernández","alfonsin","alfonsín","centenario","osorio",
            "quindimil","alvarez","álvarez","marco avellaneda","caferata"],
        "always_allowed": ["motorway","motorway_link","trunk","trunk_link"],
        "max_weight_kg": 10000, "max_height_m": 4.10,
    },
    "la_matanza": {
        "keywords": ["ruta 3","cintura","riccheri","ruta 21","ruta 17","crovara",
            "christiania","rosas","illia","arieta","don bosco","crovara"],
        "always_allowed": ["motorway","motorway_link","trunk","trunk_link"],
        "max_weight_kg": 10000, "max_height_m": 4.10,
    },
    "moron": {
        "keywords": ["acceso oeste","rivadavia","cintura","don bosco","pierrestegui","yrigoyen"],
        "always_allowed": ["motorway","motorway_link","trunk","trunk_link"],
        "max_weight_kg": 12000, "max_height_m": 4.10,
    },
    "ezeiza": {
        "keywords": ["riccheri","ruta 205","ruta 52","newbery","12 de octubre","ezeiza"],
        "always_allowed": ["motorway","motorway_link","trunk","trunk_link"],
        "max_weight_kg": 10000, "max_height_m": 4.10,
    },
    "esteban_echeverria": {
        "keywords": ["cintura","ruta 205","valette","fair","castex","cervetti"],
        "always_allowed": ["motorway","motorway_link","trunk","trunk_link"],
        "max_weight_kg": 12000, "max_height_m": 4.10,
    },
    "florencio_varela": {
        "keywords": ["novak","ruta 36","eva peron","eva perón","hudson","cariboni","lujan","luján","calchaqui","calchaquí"],
        "always_allowed": ["motorway","motorway_link","trunk","trunk_link"],
        "max_weight_kg": 12000, "max_height_m": 4.10,
    },
    "escobar": {
        "keywords": ["ruta 25","inmigrantes","constituyentes","guemes","güemes","villanueva"],
        "always_allowed": ["motorway","motorway_link","trunk","trunk_link"],
        "max_weight_kg": 3500, "max_height_m": 4.10,
    },
    "tigre": {
        "keywords": ["ruta 197","ruta 27","henry ford","constituyentes","sarmiento",
            "italia","benavidez","benavídez","panamericana"],
        "always_allowed": ["motorway","motorway_link","trunk","trunk_link"],
        "max_weight_kg": 7000, "max_height_m": 4.10,
    },
    "san_isidro": {
        "keywords": ["panamericana","ramal tigre","rolon","rolón","marquez","márquez",
            "uruguay","sucre","centenario","santa fe","alcorta","de mayo","camino real","unidad nacional"],
        "always_allowed": ["motorway","motorway_link","trunk","trunk_link"],
        "max_weight_kg": 12000, "max_height_m": 4.10,
    },
    "lomas_de_zamora": {
        "keywords": ["camino negro","peron","perón","cintura","yrigoyen","alsina",
            "juan xxiii","antartida","antártida","eva peron","eva perón","frias","frías","garibaldi"],
        "always_allowed": ["motorway","motorway_link","trunk","trunk_link"],
        "max_weight_kg": 10000, "max_height_m": 4.10,
    },
}

def get_municipality(lat, lng):
    for muni, (s, w, n, e) in MUNI_BBOXES.items():
        if s <= lat <= n and w <= lng <= e:
            return muni
    return None  # Fuera de zona con datos

def is_allowed(name, highway, muni_key):
    if muni_key is None:
        return None  # Fuera de zona → colaborativo
    restr = RESTRICTIONS.get(muni_key)
    if not restr:
        return None
    if highway in restr.get("always_allowed", []):
        return True
    if not name:
        return False  # Municipio con datos, sin nombre → prohibida
    name_lower = name.lower()
    for kw in restr["keywords"]:
        if kw in name_lower:
            return True
    return False  # No está en lista → PROHIBIDA

def calc_cost(length_m, speed_kmh, allowed):
    base = length_m / (speed_kmh / 3.6)
    if allowed is True:  return base * 1.0
    if allowed is False: return base * 50.0
    return base * 3.0

SPEED_MAP = {
    'motorway':110,'motorway_link':80,'trunk':90,'trunk_link':70,
    'primary':60,'primary_link':50,'secondary':50,'secondary_link':40,
    'tertiary':40,'tertiary_link':35,'residential':30,'living_street':20,'unclassified':35,
}

# ── Conexión BD ───────────────────────────────────────────────────────────
print("Conectando...")
conn = psycopg2.connect(DB_URL)
cur = conn.cursor()

print("Limpiando tablas...")
cur.execute("TRUNCATE pgr_edges CASCADE;")
cur.execute("TRUNCATE pgr_nodes CASCADE;")
conn.commit()

# ── Descargar grafos por municipio y combinar ─────────────────────────────
print(f"\nDescargando {len(PLACES)} municipios de OSM...")
graphs = []
for place in PLACES:
    try:
        print(f"  Descargando {place.split(',')[0]}...", end=' ', flush=True)
        G_muni = ox.graph_from_place(place, network_type='drive', simplify=True, retain_all=False)
        graphs.append(G_muni)
        print(f"✓ ({len(G_muni.nodes)} nodos, {len(G_muni.edges)} aristas)")
    except Exception as e:
        print(f"✗ Error: {e}")

print(f"\nCombinando {len(graphs)} grafos...")
import networkx as nx
G = nx.compose_all(graphs)
print(f"Grafo combinado: {len(G.nodes)} nodos, {len(G.edges)} aristas")

# ── Nodos ─────────────────────────────────────────────────────────────────
print("\nInsertando nodos...")
node_id_map = {}
node_rows = []
for i, (osm_id, data) in enumerate(G.nodes(data=True)):
    nid = i + 1
    node_id_map[osm_id] = nid
    node_rows.append((nid, int(osm_id), float(data['x']), float(data['y'])))

for i in range(0, len(node_rows), 500):
    psycopg2.extras.execute_values(cur, """
        INSERT INTO pgr_nodes (id, osm_id, geom)
        VALUES %s ON CONFLICT (osm_id) DO NOTHING
    """, node_rows[i:i+500],
    template="(%s, %s, ST_SetSRID(ST_MakePoint(%s, %s), 4326))")
    if i % 10000 == 0:
        conn.commit()
        print(f"  {min(i+500,len(node_rows))}/{len(node_rows)}")
conn.commit()
print(f"✓ {len(node_rows)} nodos")

# ── Aristas ───────────────────────────────────────────────────────────────
print("\nInsertando aristas...")
edge_rows = []
for u, v, data in G.edges(data=True):
    if u not in node_id_map or v not in node_id_map: continue
    source = node_id_map[u]
    target = node_id_map[v]

    name = data.get('name','')
    if isinstance(name, list): name = ' / '.join(name)
    highway = data.get('highway','')
    if isinstance(highway, list): highway = highway[0]

    length_m = float(data.get('length', 100))
    oneway = bool(data.get('oneway', False))
    speed_kmh = float(SPEED_MAP.get(highway, 35))

    u_data = G.nodes[u]
    muni_key = get_municipality(float(u_data['y']), float(u_data['x']))
    allowed = is_allowed(name, highway, muni_key)
    restr = RESTRICTIONS.get(muni_key or '', {})

    cost = calc_cost(length_m, speed_kmh, allowed)
    reverse_cost = cost if not oneway else -1.0

    if 'geometry' in data:
        coords = list(data['geometry'].coords)
        wkt = "LINESTRING(" + ", ".join(f"{c[0]} {c[1]}" for c in coords) + ")"
    else:
        u_d = G.nodes[u]; v_d = G.nodes[v]
        wkt = f"LINESTRING({u_d['x']} {u_d['y']}, {v_d['x']} {v_d['y']})"

    osm_id = data.get('osmid')
    if isinstance(osm_id, list): osm_id = osm_id[0]
    try: osm_id = int(osm_id)
    except: osm_id = None

    edge_rows.append((
        osm_id, source, target, cost, reverse_cost,
        length_m, speed_kmh, name[:200] if name else None,
        muni_key or 'amba_other', highway, allowed,
        restr.get('max_weight_kg'), restr.get('max_height_m'), oneway, wkt
    ))

print(f"Total aristas: {len(edge_rows)}")
for i in range(0, len(edge_rows), 500):
    try:
        psycopg2.extras.execute_values(cur, """
            INSERT INTO pgr_edges
              (osm_id,source,target,cost,reverse_cost,length_m,speed_kmh,
               street_name,municipality,highway,heavy_vehicle_allowed,
               max_weight_kg,max_height_m,oneway,geom)
            VALUES %s ON CONFLICT DO NOTHING
        """, edge_rows[i:i+500],
        template="(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,ST_GeomFromText(%s,4326))")
        conn.commit()
        if i % 10000 == 0:
            print(f"  {min(i+500,len(edge_rows))}/{len(edge_rows)}")
    except Exception as e:
        print(f"  Error: {e}")
        conn.rollback()

conn.commit()

# ── Verificación ──────────────────────────────────────────────────────────
cur.execute("""
    SELECT municipality, COUNT(*) total,
           COUNT(*) FILTER (WHERE heavy_vehicle_allowed=TRUE) hab,
           COUNT(*) FILTER (WHERE heavy_vehicle_allowed=FALSE) proh,
           COUNT(*) FILTER (WHERE heavy_vehicle_allowed IS NULL) sin_datos
    FROM pgr_edges GROUP BY municipality ORDER BY total DESC
""")
print("\n=== RESULTADO ===")
for row in cur.fetchall():
    print(f"  {row[0]}: {row[1]} total | ✅{row[2]} hab | 🚫{row[3]} proh | ❓{row[4]} sin datos")

cur.close()
conn.close()
print("\n✅ Listo.")
