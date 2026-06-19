/*******************************************************
 * route.ts
 *
 * Endpoint POST /api/routes (lo consume el panel web).
 *
 * Desde la unificación de motores, este endpoint NO calcula con el A* propio
 * (aristas/nodos en Supabase). Delega en el MISMO motor que usa la app mobile:
 * pgRouting (`pgr_route_truck`) sobre Aiven, vía `calculateRoute` de ../router.
 * Acá solo se adapta el request/response al contrato `RouteResponse` que ya
 * espera el frontend, para no tener que tocar el web.
 *
 * (El A* legacy — algorithm/astar.ts, graphCache.ts, tablas aristas/nodos —
 *  queda sin usar; se puede limpiar aparte.)
 *******************************************************/

import { Router, Request, Response } from "express";
import { calculateRoute } from "../router";

const router = Router();

// Velocidad media asumida para estimar duración cuando no viene del motor.
const AVG_SPEED_KMH = 30;

router.post("/", async (req: Request, res: Response) => {
  const { originLabel, destinationLabel, vehicle, origin, destination } = req.body;

  const emptyResponse = (summary: string, warnings: string[], status = 200) =>
    res.status(status).json({
      found: false, routeId: null, tripId: null,
      originLabel: originLabel ?? "", destinationLabel: destinationLabel ?? "",
      distanceM: 0, estimatedDurationMin: 0,
      routeSummary: summary, path: [], snappedPoints: [],
      alternativeRoute: null, warnings,
    });

  if (!origin || !destination || !vehicle) {
    return emptyResponse("Faltan campos obligatorios.",
      ["Enviá origin, destination y vehicle en el body."], 400);
  }

  try {
    // ── Adaptador de request: el web manda {lat, lon} y vehicle {maxWeightKg…};
    //    el motor de Aiven espera {lat, lng} y vehicle {weight_kg…}.
    const aivenOrigin = { lat: Number(origin.lat), lng: Number(origin.lon ?? origin.lng) };
    const aivenDest   = { lat: Number(destination.lat), lng: Number(destination.lon ?? destination.lng) };
    const aivenVehicle = {
      weight_kg: Number(vehicle.maxWeightKg ?? vehicle.weight_kg ?? 0),
      height_m:  Number(vehicle.maxHeightM  ?? vehicle.height_m  ?? 0),
      width_m:   Number(vehicle.maxWidthM   ?? vehicle.width_m   ?? 0),
    };

    const route = await calculateRoute(aivenOrigin, aivenDest, aivenVehicle);

    // ── Adaptador de response: aplanamos los `segments` de Aiven al `path[]`
    //    de nodos que dibuja el web. Cada nodo lleva el `status` de su tramo,
    //    así MapDisplay puede colorear por aptitud (verde/rojo/naranja) sobre
    //    la geometría real de la calle.
    const path = route.segments.flatMap((seg) =>
      (seg.coordinates ?? []).map((c) => ({
        nodeId: "",
        lat: c.lat,
        lon: c.lng,
        label: seg.street_name ?? "",
        status: seg.status,
      }))
    );

    if (path.length < 2) {
      return emptyResponse(
        "No se encontró una ruta compatible con el perfil del camión.",
        ["Probá modificar restricciones o seleccionar otro destino."]
      );
    }

    const distanceM = Math.round((route.total_distance_km ?? 0) * 1000);
    const estimatedDurationMin = route.total_duration_min
      ?? Math.round(distanceM / 1000 / AVG_SPEED_KMH * 60);

    const warnings: string[] = [
      ...(route.has_unauthorized ? ["La ruta incluye tramos no habilitados para vehículos pesados."] : []),
      ...(route.has_unknown ? ["Algunos tramos no tienen datos de habilitación."] : []),
    ];

    res.status(200).json({
      found: true,
      routeId: `route-${Date.now()}`,
      tripId: null,
      originLabel: originLabel ?? "",
      destinationLabel: destinationLabel ?? "",
      distanceM,
      estimatedDurationMin,
      routeSummary: "Ruta calculada correctamente.",
      path,
      snappedPoints: [],
      alternativeRoute: null,
      warnings,
    });
  } catch (error: any) {
    // calculateRoute lanza cuando no hay ruta entre los puntos.
    const msg = String(error?.message ?? "");
    if (/no se encontró ruta|ruta vacía/i.test(msg)) {
      return emptyResponse(
        "No se encontró una ruta compatible con el perfil del camión.",
        ["Probá modificar restricciones o seleccionar otro destino."]
      );
    }
    console.error("Error en /api/routes:", error);
    return emptyResponse("Error interno del servidor.",
      ["Contactá al equipo de backend."], 500);
  }
});

export default router;
