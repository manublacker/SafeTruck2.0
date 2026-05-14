import osmnx as ox
import psycopg2
import psycopg2.extras
import psycopg2.extensions
import numpy as np

psycopg2.extensions.register_adapter(np.float64, lambda x: psycopg2.extensions.AsIs(float(x)))
psycopg2.extensions.register_adapter(np.int64, lambda x: psycopg2.extensions.AsIs(int(x)))
psycopg2.extensions.register_adapter(np.bool_, lambda x: psycopg2.extensions.AsIs(bool(x)))

DB_URL = "postgresql://postgres:camionesInge2026@db.bxhduayxffanioaclzrd.supabase.co:5432/postgres"

LANUS_KEYWORDS = [
    "remedios","viamonte","rincon","rincón","sayos","25 de mayo",
    "hornos","uriarte","yrigoyen","malabia","aconcagua","granaderos",
    "roma","lynch","belgrano","madariaga","martin","martín","rivadavia",
    "olazabal","olazábal","fernandez","fernández","alfonsin","alfonsín",
    "centenario","osorio","quindimil","alvarez","álvarez","caferata",
]
ALWAYS_ALLOWED = ["motorway","motorway_link","trunk","trunk_link"]
SPEED_MAP = {
    'motorway':110,'motorway_link':80,'trunk':90,'trunk_link':70,
    'primary':60,'primary_link':50,'secondary':50,'secondary_link':40,
    'tertiary':40,'tertiary_link':35,'residential':30,'unclassified':35,
}

def is_allowed(name, highway):
    if highway in ALWAYS_ALLOWED: return True
    if not name: return False
    nl = name.lower()
    for kw in LANUS_KEYWORDS:
        if kw in nl: return True
    return False

def calc_cost(length_m, speed_kmh, allowed):
    base = length_m / (speed_kmh / 3.6)
    return base * (1.0 if allowed else 50.0)

conn = psycopg2.connect(DB_URL)
cur = conn.cursor()

# Borrar aristas y nodos viejos de Lanús
print("Borrando aristas viejas de Lanús...")
cur.execute("DELETE FROM pgr_edges WHERE municipality = 'lanus'")
conn.commit()

# Descargar Lanús
print("Descargando Lanús...")
G = ox.graph_from_place("Lanús, Buenos Aires, Argentina", network_type='drive', simplify=True)
print(f"Nodos: {len(G.nodes)}, Aristas: {len(G.edges)}")

# Obtener IDs de nodos existentes en la BD
print("Cargando nodos existentes...")
cur.execute("SELECT osm_id, id FROM pgr_nodes")
existing_nodes = {row[0]: row[1] for row in cur.fetchall()}
print(f"Nodos existentes en BD: {len(existing_nodes)}")

# Insertar nodos nuevos
new_nodes = []
next_id_cur = cur
cur.execute("SELECT MAX(id) FROM pgr_nodes")
max_id = cur.fetchone()[0] or 0
next_node_id = max_id + 1

for osm_id, data in G.nodes(data=True):
    if osm_id not in existing_nodes:
        existing_nodes[osm_id] = next_node_id
        new_nodes.append((next_node_id, int(osm_id), float(data['x']), float(data['y'])))
        next_node_id += 1

if new_nodes:
    psycopg2.extras.execute_values(cur, """
        INSERT INTO pgr_nodes (id, osm_id, geom)
        VALUES %s ON CONFLICT (osm_id) DO NOTHING
    """, new_nodes, template="(%s, %s, ST_SetSRID(ST_MakePoint(%s, %s), 4326))")
    conn.commit()
    print(f"Nuevos nodos insertados: {len(new_nodes)}")

# Insertar aristas
edge_rows = []
for u, v, data in G.edges(data=True):
    if u not in existing_nodes or v not in existing_nodes: continue
    source = existing_nodes[u]
    target = existing_nodes[v]

    name = data.get('name','')
    if isinstance(name, list): name = ' / '.join(name)
    highway = data.get('highway','')
    if isinstance(highway, list): highway = highway[0]

    length_m = float(data.get('length', 100))
    oneway = bool(data.get('oneway', False))
    speed_kmh = float(SPEED_MAP.get(highway, 35))
    allowed = is_allowed(name, highway)
    cost = calc_cost(length_m, speed_kmh, allowed)
    # Bidireccional por defecto para garantizar conectividad
    reverse_cost = cost

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
        'lanus', highway, allowed, 10000.0, 4.10, oneway, wkt
    ))

print(f"Insertando {len(edge_rows)} aristas...")
for i in range(0, len(edge_rows), 500):
    psycopg2.extras.execute_values(cur, """
        INSERT INTO pgr_edges
          (osm_id,source,target,cost,reverse_cost,length_m,speed_kmh,
           street_name,municipality,highway,heavy_vehicle_allowed,
           max_weight_kg,max_height_m,oneway,geom)
        VALUES %s ON CONFLICT DO NOTHING
    """, edge_rows[i:i+500],
    template="(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,ST_GeomFromText(%s,4326))")
    conn.commit()

# Verificar
cur.execute("SELECT COUNT(*) FROM pgr_edges WHERE municipality = 'lanus'")
print(f"Aristas Lanús en BD: {cur.fetchone()[0]}")

# También hacer todas las aristas bidireccionales
print("Haciendo todo bidireccional...")
cur.execute("UPDATE pgr_edges SET reverse_cost = cost WHERE reverse_cost <= 0")
conn.commit()

# Test de conectividad
cur.execute("""
    SELECT component, COUNT(*) as nodos
    FROM pgr_connectedComponents(
        'SELECT id, source, target, cost, reverse_cost 
         FROM pgr_edges WHERE cost > 0 
         AND municipality IN (''CABA'', ''lanus'')'
    )
    GROUP BY component ORDER BY nodos DESC LIMIT 5
""")
print("\nComponentes CABA+Lanús:")
for row in cur.fetchall():
    print(f"  Componente {row[0]}: {row[1]} nodos")

cur.close()
conn.close()
print("\n✅ Listo")
