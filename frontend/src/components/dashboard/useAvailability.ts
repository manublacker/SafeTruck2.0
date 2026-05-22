import { useMemo } from "react";
import type { Truck, Driver } from "@/types/auth";

export type Trip = {
  id: string;
  from: string;
  to: string;
  driver: string;
  truck: string;
  date: string;
  duration: string;
  status: string;
};

const DRIVER_STATUS_ACTIVE = "Activo";
const TRIP_STATUS_IN_PROGRESS = "En curso";

export interface AvailabilityResult {
  availableTrucks: Truck[];
  availableDrivers: Driver[];
  busyTrucks: Truck[];
  busyDrivers: Driver[];
}

/**
 * Calcula la disponibilidad de camiones y conductores cruzando los datos
 * reales del usuario con los mocks de viajes.
 *
 * Nota: los TRIPS mock referencian camiones por placa (string) y los Truck
 * del usuario tienen id numérico — sin mapeo confiable, asumimos que todos
 * los camiones del usuario están libres salvo que el TRIP los marque ocupados
 * por nombre del conductor.
 */
export function useAvailability(
  trucks: Truck[],
  drivers: Driver[],
  trips: Trip[],
): AvailabilityResult {
  return useMemo(() => {
    const busyDriverNames = collectBusyDriverNames(trips);

    const availableDrivers = drivers.filter(
      (d) => d.estado === DRIVER_STATUS_ACTIVE && !busyDriverNames.has(d.nombre),
    );
    const busyDrivers = drivers.filter(
      (d) => d.estado !== DRIVER_STATUS_ACTIVE || busyDriverNames.has(d.nombre),
    );

    // Trucks reales del auth: sin mapeo a TRIPS, todos disponibles.
    const availableTrucks = trucks;
    const busyTrucks: Truck[] = [];

    return { availableTrucks, availableDrivers, busyTrucks, busyDrivers };
  }, [trucks, drivers, trips]);
}

function collectBusyDriverNames(trips: Trip[]): Set<string> {
  const names = new Set<string>();
  for (const trip of trips) {
    if (trip.status === TRIP_STATUS_IN_PROGRESS) {
      names.add(trip.driver);
    }
  }
  return names;
}
