/*******************************************************
 * truck-routing.ts
 *
 * MVP académico de ruteo para camiones pesados usando A*
 * en TypeScript.
 *
 * Idea principal:
 * - Cada nodo representa una intersección/punto del mapa.
 * - Cada arista representa una calle o tramo entre nodos.
 * - El algoritmo A* busca la mejor ruta entre origen y destino.
 * - Antes de usar una calle, se valida si el camión puede pasar.
 * - El costo no depende solo de la distancia: también puede
 *   penalizar peajes, calles de tierra, tráfico, etc.
 *******************************************************/

//Identificador de nodo. Lo dejamos como string para simplificar el manejo de claves.
type NodeId = string;

//Nodo del grafo. Representa un punto geográfico con latitud y longitud.
interface GraphNode {
  id: NodeId;
  lat: number;
  lon: number;
}

//Arista del grafo. Representa una conexión desde un nodo hacia otro.
// Además de la distancia, agregamos restricciones y propiedades importantes para camiones.
interface GraphEdge {
  to: NodeId;                  // nodo destino de la arista
  lengthM: number;             // longitud en metros
  aristaId?: number;           // id de la arista en la tabla aristas (para historial cooperativo)
  trustScore?: number;         // score cooperativo de la arista (-inf a +inf)
  trustStatus?: string;        // 'habilitada' | 'bloqueada' | 'desconocida'
  incidentType?: string;       // tipo de incidente activo en la arista
  incidentCount?: number;      // cantidad de confirmaciones del incidente

  // Restricciones físicas / legales
  truckAllowed?: boolean;      // si false, el camión no puede circular
  maxWeightKg?: number;        // peso máximo permitido en la calle/puente
  maxHeightM?: number;         // altura máxima permitida
  maxWidthM?: number;          // ancho máximo permitido
  maxLengthM?: number;         // largo máximo permitido

  // Características del tramo
  toll?: boolean;              // si tiene peaje
  highway?: boolean;           // si es autopista/corredor principal
  surface?: "asphalt" | "gravel" | "dirt"; // tipo de superficie

  // Penalización adicional por tráfico, demoras, etc.
  trafficPenalty?: number;
}

//Grafo vial.
//nodes: diccionario de nodos por id
//adjacency: 
//lista de adyacencia: para cada nodo, un array con las aristas salientes
interface Graph {
  nodes: Record<NodeId, GraphNode>;
  adjacency: Record<NodeId, GraphEdge[]>;
}

//Perfil del vehículo. Define las características del camión.
interface VehicleProfile {
  maxWeightKg: number;
  maxHeightM: number;
  maxWidthM: number;
  maxLengthM: number;
  hazardousMaterial?: boolean;
}

//Opciones de ruteo. Sirven para cambiar el comportamiento del costo.
interface RoutingOptions {
  avoidTolls?: boolean;        // evitar peajes
  preferHighways?: boolean;    // preferir autopistas
  avoidDirt?: boolean;         // evitar tierra
  avoidGravel?: boolean;       // evitar ripio
}

//Resultado del algoritmo A*.
interface AStarResult {
  prev: Record<NodeId, NodeId | null>;
  distance: number;
  found: boolean;
}

//Estado dentro del heap.
//f = g + h
//g = costo real acumulado desde origen
//h = heurística estimada hasta destino
interface HeapState {
  node: NodeId; //es un string que sirve como identificador como nodo
  f: number;
  g: number;
}


//En A* tenés muchos nodos para explorar, pero no querés cualquiera: querés el que tenga el menor costo total (f = g + h). 
//Entonces: guardás nodos en el heap y te devuelve el más conveniente primero
class MinHeap<T> {
//data es una variable interna de la clase, guarda elementos de tipo T, arranca como un arreglo vacío []
    private data: T[] = [];
// Constructor de la clase: recibe una función compare que sirve para decidir cuál de dos elementos tiene mayor prioridad dentro del heap
    constructor(private compare: (a: T, b: T) => number) {} 

//push recibe un valor value de tipo T para agregarlo al heap. Devuelve void, osea nada
    push(value: T): void { 
        this.data.push(value); //push ya existe por defecto en arreglos y lo que hace es agregar al arreglo data value
        this.bubbleUp(this.data.length - 1); // Compara el nuevo elemento con su padre y lo sube si debe ir antes y se pasa this.data.length - 1 porque esa es la posición donde se insertó
    }

//pop se usa para extraer el elemento mínimo
    pop(): T | undefined { //define el metodo pop que no recibe parametros y devuelve un elemento tipo T o un elemento no definido
        if (this.data.length === 0){ //si el array esta vacío no devuelve nada
        return undefined; 
        }
        const top = this.data[0]; //guarda el primer elemento del array en top que es el que va a devolver
        const last = this.data.pop()!; //saca el último elemento del array con pop y lo guarda en last

        if (this.data.length > 0) { //si todavía quedan elementos pongo el ultimo elemento en la primera posición y se acomoda hacia abajo
            this.data[0] = last;
            this.bubbleDown(0);
        }

        return top;
    }

//Retorna la longitud del array
    get size(): number {
        return this.data.length; 
    }

//bubbleUp recibe index, que es la posición del elemento que quiere acomodar y no devuelve nada
    private bubbleUp(index: number): void {
        while (index > 0) { //mientras el elemento no esté en la posición 0 sigue intentando subirlo si index es 0, ya llegó arriba de todo y no puede subir más
            const parent = Math.floor((index - 1) / 2); //calcula la posición del padre del elemento actual

            if (this.compare(this.data[index], this.data[parent]) >= 0) { //compara el hijo con el padre
                break;
            }

            [this.data[index], this.data[parent]] = [this.data[parent], this.data[index]]; //Si el resultado es < 0, significa que el hijo tiene que ir antes que el padre
            index = parent;
        }
    }

//bubbleDown recibe index, que es la posición del elemento que quiere acomodar y no devuelve nada
    private bubbleDown(index: number): void {
        const length = this.data.length; //guarda en length la cantidad de elementos del array

        while (true) {
            let smallest = index; //asume que el elemento actual ya es el menor, va a guardar la posición del menor entre: el actual, el hijo izquierdo y el hijo derecho
            const left = index * 2 + 1;
            const right = index * 2 + 2;

        if (left < length && this.compare(this.data[left], this.data[smallest]) < 0) { //primero verifica si el hijo izquierdo existe después compara el hijo izquierdo con el que hasta ahora era el menor y si el izquierdo debe ir antes, entonces pasa a ser el nuevo menor
            smallest = left;
        }

        if (right < length && this.compare(this.data[right], this.data[smallest]) < 0) { //verifica si el hijo derecho existe después compara el hijo derecho con el menor actual y si el derecho debe ir antes, entonces pasa a ser el nuevo menor
            smallest = right;
        }

        if (smallest === index) { //chequea si el menor siguió siendo el elemento actual que significa que no hace falta moverlo y corta el bucle porque el elemento ya está bien ubicado
            break;
        }

        [this.data[index], this.data[smallest]] = [this.data[smallest], this.data[index]]; //si no, intercambia el elemento actual con el menor de sus hijos así el elemento baja un nivel
        index = smallest; //actualiza index, ahora el elemento está en la nueva posición y en la próxima vuelta sigue comparándolo desde ahí
        }
    }
}

//Calcula la distancia en línea recta entre dos puntos geográficos usando la fórmula Haversine. Devuelve la distancia en metros.
function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number { //función que recibe 4 numeros y devuelve un número. Recibe 2 puntos del mapa
    const toRad = (deg: number): number => (deg * Math.PI) / 180; //función de 1 línea que recibe un número y lo pasa a radián

    const aLat = toRad(lat1); //pasa todos los valores a radianes
    const aLon = toRad(lon1);
    const bLat = toRad(lat2);
    const bLon = toRad(lon2);

    const dLat = bLat - aLat; //calcula la diferencia entre latitut
    const dLon = bLon - aLon; //calcula la diferencia entre longitud

    const R = 6371000; // radio de la Tierra en metros

    const a = Math.sin(dLat / 2) ** 2 + Math.cos(aLat) * Math.cos(bLat) * Math.sin(dLon / 2) ** 2; //calcula la distancia en línea recta sobre la superficie de la Tierra entre dos puntos dados por latitud y longitud.

    return 2 * R * Math.asin(Math.sqrt(a)); //transforma en la distancia real entre los dos puntos
}

//Verifica si una arista puede ser recorrida por el camión. Si alguna restricción se viola, devuelve false.
function isEdgeAllowed(edge: GraphEdge, vehicle: VehicleProfile): boolean {
    // Restricciones físicas siguen siendo prohibiciones absolutas
    if (edge.maxWeightKg !== undefined && vehicle.maxWeightKg > edge.maxWeightKg) {
      return false;
    }
    if (edge.maxHeightM !== undefined && vehicle.maxHeightM > edge.maxHeightM) {
      return false;
    }
    if (edge.maxWidthM !== undefined && vehicle.maxWidthM > edge.maxWidthM) {
      return false;
    }
    if (edge.maxLengthM !== undefined && vehicle.maxLengthM > edge.maxLengthM) {
      return false;
    }
    // truckAllowed ya no bloquea — se penaliza en el costo
    return true;
  }
  
  function edgeCost(edge: GraphEdge, options: RoutingOptions = {}, mode: 'normal' | 'alternative' = 'normal'): number {    
    let cost = edge.lengthM;
  
    // Si la calle no está habilitada para camiones, penalizo fuerte
    // El camión la puede usar solo si no hay otra opción
    if (edge.truckAllowed === false) {
      cost += 10000;
    }
  
    if (options.avoidTolls && edge.toll) cost += 2000;
    if (options.avoidDirt && edge.surface === "dirt") cost += 5000;
    if (options.avoidGravel && edge.surface === "gravel") cost += 1500;
    if (options.preferHighways && edge.highway) cost -= 300;
    if (edge.trafficPenalty !== undefined) cost += edge.trafficPenalty;

    // penalización del sistema cooperativo
    if (edge.trustStatus === 'bloqueada') {
        return Infinity; // excluye la arista del ruteo
    }
    if (edge.trustScore !== undefined && edge.trustScore < 0) {
        // penalización proporcional al score negativo
        cost += Math.abs(edge.trustScore) * 500;
    }
    // penalización por incidentes temporales
    if (edge.incidentType) {
        if (mode === 'alternative') {
          // en modo alternativo, evita completamente los incidentes
          return Infinity;
        } else {
          // en modo normal, solo advierte con una penalización leve
          const basePenalty: Record<string, number> = {
            accidente:        500,
            corte:            2000,
            trafico:          200,
            obra:             300,
            control_policial: 100,
            objeto_en_via:    200,
          };
          cost += (basePenalty[edge.incidentType] ?? 200) * (edge.incidentCount ?? 1);
        }
      }

    return Math.max(cost, 1);
  }
//Valida que el origen y destino existan dentro del grafo.
function validateGraphInput(graph: Graph, origin: NodeId, destination: NodeId): void {
    if (!graph || !graph.nodes || !graph.adjacency) {
        throw new Error("El grafo es inválido.");
    }

    if (!graph.nodes[origin]) {
        throw new Error(`El nodo origen "${origin}" no existe en el grafo.`);
    }

    if (!graph.nodes[destination]) {
        throw new Error(`El nodo destino "${destination}" no existe en el grafo.`);
    }
}

//Implementación de A* para ruteo de camiones.
//Parámetros:
//graph: grafo vial
//origin: nodo de origen
//destination: nodo destino
//vehicle: perfil del camión
//options: preferencias de ruteo
//Devuelve:
//prev: diccionario para reconstruir la ruta
//distance: costo total hasta destino
//found: indica si se encontró una ruta

//Función que busca la ruta más corta entre el origen y el destino teniendo en cuenta el grafo y las restricciones del camión
export function astar(graph: Graph, origin: NodeId, destination: NodeId, vehicle: VehicleProfile, mode: 'normal' | 'alternative' = 'normal'): AStarResult {    validateGraphInput(graph, origin, destination); //verifica que el grafo y los nodos existan

    //si el origen y el destino son el mismo nodo, no hace falta buscar una ruta
    if (origin === destination) {
        const prev: Record<NodeId, NodeId | null> = {}; //la clave es el nodo actual y el valor es el nodo anterior desde el que llegaste, o null en este caso

        //inicializa todos los nodos con null porque no hace falta venir desde ningún lado
        //Recorre todos los nodos del grafo y les asigna null en prev al inicio
        // Inicializa prev dejando todos los nodos con valor null al principio
        //Se inicializa todo en null para que todas las claves existan, no haya errores tipo “no existe esa clave” y el objeto esté completo desde el principio. Pero después solo se usan las que forman parte del camino real.
        for (const nodeId of Object.keys(graph.nodes)) {
            prev[nodeId] = null;
        }

        return {
            prev,
            distance: 0,
            found: true,
        };
    }

    //cola de prioridad que siempre procesa primero el nodo con menor f
    const heap = new MinHeap<HeapState>((a, b) => {
        if (a.f !== b.f){ //compara lo recorrido hasta ahora + lo que se estima que falta
             return a.f - b.f; // Resta los valores para saber cuál es menor: si da negativo, a va antes; si da positivo, b va antes
        }
        return a.g - b.g; //Si empatan en f, compara lo recorrido hasta ahora y prioriza el menor
    });

    const prev: Record<NodeId, NodeId | null> = {}; //guarda desde qué nodo se llegó a cada nodo
    const gScore: Record<NodeId, number> = {}; //guarda la distancia mínima conocida desde el origen hasta cada nodo
    const visited = new Set<NodeId>(); //guarda los nodos ya procesados para no repetirlos

    // Inicializa todos los nodos sin nodo anterior y con distancia infinita porque al empezar
    // todavía no se sabe desde dónde se llega a cada nodo ni cuál es la distancia mínima hasta ellos
    for (const nodeId of Object.keys(graph.nodes)) {
        prev[nodeId] = null;
        gScore[nodeId] = Infinity;
    }
    gScore[origin] = 0; //la distancia desde el origen hasta sí mismo es 0

    //agrega el origen al heap con g = 0 y f = 0
    heap.push({
        node: origin,
        g: 0,
        f: 0,
    });

    // Mientras queden nodos por procesar en el heap, sigue buscando
    while (heap.size > 0) {
        const current = heap.pop()!; //Saca del heap el nodo con mayor prioridad (el mejor en ese momento). El ! significa confío en que esto no es undefined
        const currentNode = current.node; //guarda el id del nodo actual

        //// Si el nodo ya fue procesado, lo saltea
        if (visited.has(currentNode)) {
            continue;
        }

        //si llegó al destino, devuelve el resultado
        if (currentNode === destination) {
            return {
                prev,
                distance: gScore[destination],
                found: true,
            };
        }

        visited.add(currentNode); //marca el nodo actual como visitado

        const edges = graph.adjacency[currentNode] ?? []; //obtiene las aristas que salen desde el nodo actual

        //recorre todas las aristas del nodo actual
        for (const edge of edges) {
            //si el camión no puede pasar por esa arista, la ignora
            if (!isEdgeAllowed(edge, vehicle)) {
                continue;
            }

            const neighbor = edge.to; //guarda el nodo vecino al que lleva esa arista

            //si el nodo vecino no existe en el grafo, ignora esa arista
            if (!graph.nodes[neighbor]) {
                continue;
            }

            const tentativeG = gScore[currentNode] + edgeCost(edge, {}, mode);//calcula la nueva distancia acumulada usando la longitud de la arista

            //si encontró un camino más corto hacia el vecino, actualiza los datos
            if (tentativeG < gScore[neighbor]) {
                gScore[neighbor] = tentativeG;
                prev[neighbor] = currentNode;

                //estima la distancia que falta hasta el destino en línea recta
                const h = haversine(graph.nodes[neighbor].lat, graph.nodes[neighbor].lon, graph.nodes[destination].lat, graph.nodes[destination].lon);

                const f = tentativeG + h; //calcula la prioridad total del nodo

                //agrega el vecino al heap para procesarlo después
                heap.push({
                    node: neighbor,
                    g: tentativeG,
                    f,
                });
            }
        }
    }

    //si termina el while y no llegó al destino, significa que no encontró una ruta
    return {
        prev,
        distance: Infinity,
        found: false,
    };
}
// function astar(graph: Graph, origin: NodeId, destination: NodeId, vehicle: VehicleProfile, options: RoutingOptions = {} ): AStarResult {
//     validateGraphInput(graph, origin, destination);
// 
//         // Caso trivial: origen y destino iguales
//         if (origin === destination) {
//             const prev: Record<NodeId, NodeId | null> = {};
//             for (const nodeId of Object.keys(graph.nodes)) {
//             prev[nodeId] = null;
//             }
// 
//             return {
//             prev,
//             distance: 0,
//             found: true,
//             };
//         }
// 
//     // Cola de prioridad ordenada por f y, en empate, por g
//     const heap = new MinHeap<HeapState>((a, b) => {
//         if (a.f !== b.f) return a.f - b.f;
//         return a.g - b.g;
//     });
// 
//     // prev[n] guarda desde qué nodo llegamos a n
//     const prev: Record<NodeId, NodeId | null> = {};
// 
//     // gScore[n] = costo real mínimo conocido desde origen hasta n
//     const gScore: Record<NodeId, number> = {};
// 
//     // visited evita reprocesar nodos ya cerrados
//     const visited = new Set<NodeId>();
// 
//     // Inicialización
//     for (const nodeId of Object.keys(graph.nodes)) {
//         prev[nodeId] = null;
//         gScore[nodeId] = Infinity;
//     }
// 
//     gScore[origin] = 0;
//     heap.push({
//         node: origin,
//         g: 0,
//         f: 0,
//     });
// 
//     while (heap.size > 0) {
//         const current = heap.pop()!;
//         const currentNode = current.node;
// 
//         // Si ya fue procesado, lo salteamos
//         if (visited.has(currentNode)) {
//         continue;
//         }
// 
//         // Si llegamos al destino, terminamos
//         if (currentNode === destination) {
//         return {
//             prev,
//             distance: gScore[destination],
//             found: true,
//         };
//         }
// 
//         visited.add(currentNode);
// 
//         // Obtenemos vecinos
//         const edges = graph.adjacency[currentNode] ?? [];
// 
//         for (const edge of edges) {
//         // Primero vemos si el camión puede pasar por esa calle
//         if (!isEdgeAllowed(edge, vehicle)) {
//             continue;
//         }
// 
//         const neighbor = edge.to;
// 
//         // Por seguridad, si el nodo destino de la arista no existe, la ignoramos
//         if (!graph.nodes[neighbor]) {
//             continue;
//         }
// 
//         // Nuevo costo acumulado
//         const tentativeG = gScore[currentNode] + edgeCost(edge, options);
// 
//         // Si encontramos un mejor camino al vecino, actualizamos
//         if (tentativeG < gScore[neighbor]) {
//             gScore[neighbor] = tentativeG;
//             prev[neighbor] = currentNode;
// 
//             // Heurística: distancia geográfica en línea recta hasta destino
//             const h = haversine(
//             graph.nodes[neighbor].lat,
//             graph.nodes[neighbor].lon,
//             graph.nodes[destination].lat,
//             graph.nodes[destination].lon
//             );
// 
//             const f = tentativeG + h;
// 
//             heap.push({
//             node: neighbor,
//             g: tentativeG,
//             f,
//             });
//         }
//         }
//     }
// 
//     // Si el heap se vació sin llegar al destino, no hay ruta
//     return {
//         prev,
//         distance: Infinity,
//         found: false,
//     };
// }


//Reconstruye la ruta desde origin hasta destination usando el diccionario prev. Si no hay camino, devuelve [].
function reconstructRoute(prev: Record<NodeId, NodeId | null>, origin: NodeId, destination: NodeId): NodeId[] {
    // Caso trivial
    if (origin === destination) {
        return [origin];
    }

    // Si destination no tiene previo, es probable que no haya camino
    if (!prev[destination]) {
        return [];
    }

    const path: NodeId[] = [];
    let current: NodeId | null = destination;

    // Retrocedemos desde el destino hasta el origen
    while (current !== null) {
        path.push(current);

        if (current === origin) {
        break;
        }

        current = prev[current];
    }

    // Damos vuelta para que quede origen -> destino
    path.reverse();

    // Validamos que realmente empiece en origin
    if (path.length === 0 || path[0] !== origin) {
        return [];
    }

    return path;
}

//Función completa de ruteo:
//ejecuta A*
//reconstruye la ruta
//devuelve todo listo para usar

//Esta función puede llegar a ser para mas adelante (la que esta comentada) que es la misma pero recibiendo un parámetro mas
//function findTruckRoute(graph: Graph, origin: NodeId, destination: NodeId, vehicle: VehicleProfile, //options: RoutingOptions = {}
export function findTruckRoute(
    graph: Graph,
    origin: NodeId,
    destination: NodeId,
    vehicle: VehicleProfile,
    mode: 'normal' | 'alternative' = 'normal'
  ): { path: NodeId[]; distance: number; found: boolean } {
    const result = astar(graph, origin, destination, vehicle, mode);    
    if (!result.found) {
        return {
        path: [],
        distance: Infinity,
        found: false,
        };
    }

    const path = reconstructRoute(result.prev, origin, destination);

    if (path.length === 0) {
        return {
        path: [],
        distance: Infinity,
        found: false,
        };
    }

    return {
        path,
        distance: result.distance,
        found: true,
    };
}

export {};
