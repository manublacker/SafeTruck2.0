import React, { useMemo, useRef, useEffect } from 'react';
import { Platform, StyleSheet, View, Text } from 'react-native';
import MapView, {
  Polyline,
  Marker,
  Callout,
  PROVIDER_GOOGLE,
  PROVIDER_DEFAULT,
  Region,
} from 'react-native-maps';
import {
  Coordinate,
  StreetSegment,
  CollaborativeReport,
  RouteResponse,
  ReportType,
} from './types';

const COLORS = {
  routeActive: '#2563eb',
  segmentEnabled: '#22c55e',
  segmentBlocked: '#ef4444',
  segmentBlockedDash: [10, 6] as [number, number],
};

const REPORT_PIN_COLOR: Record<ReportType, string> = {
  multa: '#ef4444',
  control: '#f97316',
  obra: '#eab308',
  accidente: '#dc2626',
};

const REPORT_LABEL: Record<ReportType, string> = {
  multa: 'Multa reportada',
  control: 'Control policial',
  obra: 'Obra en la vía',
  accidente: 'Accidente',
};

interface TruckMapProps {
  routeData: RouteResponse | null;
  reports: CollaborativeReport[];
  initialRegion?: Region;
  onSegmentPress?: (segment: StreetSegment) => void;
  onReportPress?: (coordinate: Coordinate) => void;
}

const DEFAULT_REGION: Region = {
  latitude: -34.6037,
  longitude: -58.3816,
  latitudeDelta: 0.15,
  longitudeDelta: 0.15,
};

export default function TruckMap({
  routeData,
  reports,
  initialRegion = DEFAULT_REGION,
  onSegmentPress,
  onReportPress,
}: TruckMapProps) {
  const mapRef = useRef<MapView>(null);

  const provider = Platform.OS === 'android' ? PROVIDER_GOOGLE : PROVIDER_DEFAULT;

  const { enabledSegments, blockedSegments } = useMemo(() => {
    const segments = routeData?.segments ?? [];
    return {
      enabledSegments: segments.filter((s) => s.habilitada),
      blockedSegments: segments.filter((s) => !s.habilitada),
    };
  }, [routeData]);

  useEffect(() => {
    if (routeData?.startsOnRestrictedStreet && routeData.route.length > 0 && mapRef.current) {
      mapRef.current.animateToRegion(
        {
          latitude: routeData.route[0].latitude,
          longitude: routeData.route[0].longitude,
          latitudeDelta: 0.01,
          longitudeDelta: 0.01,
        },
        500
      );
    }
  }, [routeData]);

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        provider={provider}
        style={styles.map}
        initialRegion={initialRegion}
        showsUserLocation
        showsMyLocationButton
        showsCompass
        onLongPress={(e) => onReportPress?.(e.nativeEvent.coordinate)}
      >
        {enabledSegments.map((segment) => (
          <Polyline
            key={segment.id}
            coordinates={segment.coordinates}
            strokeColor={COLORS.segmentEnabled}
            strokeWidth={3}
            tappable
            onPress={() => onSegmentPress?.(segment)}
          />
        ))}

        {blockedSegments.map((segment) => (
          <Polyline
            key={segment.id}
            coordinates={segment.coordinates}
            strokeColor={COLORS.segmentBlocked}
            strokeWidth={4}
            lineDashPattern={COLORS.segmentBlockedDash}
            tappable
            onPress={() => onSegmentPress?.(segment)}
            zIndex={10}
          />
        ))}

        {routeData?.route && routeData.route.length > 0 && (
          <Polyline
            coordinates={routeData.route}
            strokeColor={COLORS.routeActive}
            strokeWidth={5}
            zIndex={20}
          />
        )}

        {reports.map((report) => (
          <Marker
            key={report.id}
            coordinate={report.coordinate}
            pinColor={REPORT_PIN_COLOR[report.type]}
          >
            <Callout tooltip>
              <View style={styles.callout}>
                <Text style={styles.calloutTitle}>{REPORT_LABEL[report.type]}</Text>
                {report.description ? (
                  <Text style={styles.calloutDesc}>{report.description}</Text>
                ) : null}
                {report.reportedAt ? (
                  <Text style={styles.calloutDate}>
                    {new Date(report.reportedAt).toLocaleString('es-AR')}
                  </Text>
                ) : null}
              </View>
            </Callout>
          </Marker>
        ))}
      </MapView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  map: {
    flex: 1,
  },
  callout: {
    backgroundColor: 'white',
    borderRadius: 8,
    padding: 10,
    minWidth: 160,
    maxWidth: 240,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 4,
  },
  calloutTitle: {
    fontWeight: '700',
    fontSize: 14,
    marginBottom: 2,
  },
  calloutDesc: {
    fontSize: 12,
    color: '#444',
  },
  calloutDate: {
    fontSize: 10,
    color: '#888',
    marginTop: 4,
  },
});
