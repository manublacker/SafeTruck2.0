import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { TRIPS } from "./mockData";
import { useAvailability } from "./useAvailability";
import MapDisplay from "./MapDisplay";
import EmptyStateManager from "./EmptyStateManager";
import TripCreator from "./TripCreator";
import type { AdminPage } from "./AdminSidebar";
import type { RouteResponse } from "@/types/route";
import type { Truck, Driver } from "@/types/auth";

const PANEL_PADDING = 12;
const PANEL_GAP = 16;
const MAP_COLUMN_BASIS = "minmax(420px, 2fr)";
const SIDE_COLUMN_BASIS = "minmax(380px, 1fr)";

interface Props {
  onNavigate: (page: AdminPage) => void;
}

export default function LiveMapContainer({ onNavigate }: Props) {
  const { user, drivers } = useAuth();
  const trucks = user?.trucks ?? [];

  const { availableTrucks, availableDrivers } = useAvailability(
    trucks,
    drivers,
    TRIPS,
  );

  const [routeResult, setRouteResult] = useState<RouteResponse | null>(null);
  const [selectedDriverId, setSelectedDriverId] = useState<number | null>(
    availableDrivers[0]?.id ?? null,
  );

  useEffect(() => {
    if (
      selectedDriverId !== null &&
      availableDrivers.some((d) => d.id === selectedDriverId)
    ) {
      return;
    }
    setSelectedDriverId(availableDrivers[0]?.id ?? null);
  }, [availableDrivers, selectedDriverId]);

  const assignedTruck =
    trucks.find((t) => t.driver?.id === selectedDriverId) ?? null;

  const hasTrucks = trucks.length > 0;
  const hasAvailableTrucks = availableTrucks.length > 0;
  const hasAvailableDrivers = availableDrivers.length > 0;

  const blocking = !hasTrucks;

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `${MAP_COLUMN_BASIS} ${SIDE_COLUMN_BASIS}`,
        gridTemplateRows: "1fr",
        gap: PANEL_GAP,
        padding: PANEL_PADDING,
        height: "100%",
        background: "#fff",
        boxSizing: "border-box",
        overflow: "hidden",
      }}
    >
      <div style={{ height: "100%", minHeight: 0 }}>
        <MapDisplay routeResponse={routeResult} />
      </div>

      <div
        style={{
          minHeight: 0,
          height: "100%",
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
          gap: PANEL_GAP,
        }}
      >
        {blocking ? (
          <EmptyStateManager
            hasTrucks={hasTrucks}
            hasAvailableDrivers={hasAvailableDrivers}
            hasAvailableTrucks={hasAvailableTrucks}
            onNavigate={onNavigate}
          />
        ) : (
          <NormalFlow
            availableDrivers={availableDrivers}
            assignedTruck={assignedTruck}
            selectedDriverId={selectedDriverId}
            onSelectDriver={setSelectedDriverId}
            hasTrucks={hasTrucks}
            hasAvailableDrivers={hasAvailableDrivers}
            hasAvailableTrucks={hasAvailableTrucks}
            routeResult={routeResult}
            onRouteCalculated={(res) => setRouteResult(res)}
            onNavigate={onNavigate}
          />
        )}
      </div>
    </div>
  );
}

interface NormalFlowProps {
  availableDrivers: Driver[];
  assignedTruck: Truck | null;
  selectedDriverId: number | null;
  onSelectDriver: (id: number | null) => void;
  hasTrucks: boolean;
  hasAvailableDrivers: boolean;
  hasAvailableTrucks: boolean;
  routeResult: RouteResponse | null;
  onRouteCalculated: (res: RouteResponse) => void;
  onNavigate: (page: AdminPage) => void;
}

function NormalFlow({
  availableDrivers,
  assignedTruck,
  selectedDriverId,
  onSelectDriver,
  hasTrucks,
  hasAvailableDrivers,
  hasAvailableTrucks,
  routeResult,
  onRouteCalculated,
  onNavigate,
}: NormalFlowProps) {
  const showNotice = !hasAvailableDrivers || !hasAvailableTrucks;

  return (
    <>
      {showNotice && (
        <EmptyStateManager
          hasTrucks={hasTrucks}
          hasAvailableDrivers={hasAvailableDrivers}
          hasAvailableTrucks={hasAvailableTrucks}
          onNavigate={onNavigate}
        />
      )}

      <TripCreator
        routeResult={routeResult}
        availableDrivers={availableDrivers}
        assignedTruck={assignedTruck}
        selectedDriverId={selectedDriverId}
        onSelectDriver={onSelectDriver}
        onRouteCalculated={onRouteCalculated}
      />
    </>
  );
}
