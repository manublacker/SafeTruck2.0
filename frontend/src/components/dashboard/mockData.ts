// mockData.ts — datos placeholder para vistas que aún no tienen backend.
// DRIVERS fue removido: los conductores ahora vienen del AuthContext.

export const TRUCKS = [
  { id: "t1", plate: "AC-742-PT", model: "Iveco Tector" },
  { id: "t2", plate: "AB-118-NX", model: "Mercedes Atego" },
  { id: "t3", plate: "AD-559-KQ", model: "Scania P310" },
  { id: "t4", plate: "AA-902-ZR", model: "Volkswagen Constellation" },
];

export const TRIPS = [
  { id: "v1", from: "Avellaneda",   to: "La Plata",     driver: "Martín Acuña",     truck: "AC-742-PT", date: "06 May 2026", duration: "1h 48m", status: "En curso" },
  { id: "v2", from: "Tigre",        to: "Pilar",         driver: "Sofía Ramírez",    truck: "AB-118-NX", date: "06 May 2026", duration: "0h 52m", status: "En curso" },
  { id: "v3", from: "Mar del Plata",to: "Buenos Aires",  driver: "Nicolás Iturbide", truck: "AD-559-KQ", date: "04 May 2026", duration: "4h 21m", status: "Completado" },
  { id: "v4", from: "Rosario",      to: "Buenos Aires",  driver: "Martín Acuña",     truck: "AC-742-PT", date: "02 May 2026", duration: "3h 47m", status: "Completado" },
  { id: "v5", from: "San Justo",    to: "Lanús",         driver: "Carolina Vera",    truck: "AA-902-ZR", date: "30 Abr 2026", duration: "0h 38m", status: "Cancelado" },
  { id: "v6", from: "Quilmes",      to: "San Isidro",    driver: "Sofía Ramírez",    truck: "AB-118-NX", date: "28 Abr 2026", duration: "1h 12m", status: "Completado" },
];
