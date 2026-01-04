import React, { useMemo, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MapContainer, TileLayer, Polyline, Marker, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';

// Fix for default icon issues with Webpack
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.7.1/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.7.1/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.7.1/dist/images/marker-shadow.png',
});

interface MapPoint {
  lat: number;
  lon: number;
  speed_mps?: number | null;
  heart_rate?: number | null;
}

interface ActivityReportMapProps {
  polylineData?: MapPoint[];
  colorMode?: 'none' | 'speed' | 'heartRate';
}

// Fit map bounds to show entire route
const FitBounds: React.FC<{ positions: [number, number][] }> = ({ positions }) => {
  const map = useMap();
  useEffect(() => {
    if (positions.length > 0) {
      const bounds = L.latLngBounds(positions);
      map.fitBounds(bounds, { padding: [20, 20] });
    }
  }, [map, positions]);
  return null;
};

// Garmin-style color scale: blue (slow) → cyan → green → yellow → orange → red (fast)
const getColorFromNormalized = (normalized: number): string => {
  // Color stops: blue → cyan → green → yellow → orange → red
  const colors = [
    { pos: 0, r: 0, g: 0, b: 255 },      // blue
    { pos: 0.2, r: 0, g: 255, b: 255 },  // cyan
    { pos: 0.4, r: 0, g: 255, b: 0 },    // green
    { pos: 0.6, r: 255, g: 255, b: 0 },  // yellow
    { pos: 0.8, r: 255, g: 165, b: 0 },  // orange
    { pos: 1, r: 255, g: 0, b: 0 },      // red
  ];

  const clamped = Math.max(0, Math.min(1, normalized));

  // Find the two colors to interpolate between
  let lower = colors[0];
  let upper = colors[colors.length - 1];
  for (let i = 0; i < colors.length - 1; i++) {
    if (clamped >= colors[i].pos && clamped <= colors[i + 1].pos) {
      lower = colors[i];
      upper = colors[i + 1];
      break;
    }
  }

  // Interpolate
  const range = upper.pos - lower.pos;
  const t = range === 0 ? 0 : (clamped - lower.pos) / range;
  const r = Math.round(lower.r + (upper.r - lower.r) * t);
  const g = Math.round(lower.g + (upper.g - lower.g) * t);
  const b = Math.round(lower.b + (upper.b - lower.b) * t);

  return `rgb(${r}, ${g}, ${b})`;
};

// Calculate percentile value from sorted array
const percentile = (arr: number[], p: number): number => {
  if (arr.length === 0) return 0;
  const index = (p / 100) * (arr.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return arr[lower];
  return arr[lower] + (arr[upper] - arr[lower]) * (index - lower);
};

// Calculate distance between two GPS points in meters (Haversine formula)
const getDistanceMeters = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
  const R = 6371000; // Earth radius in meters
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

// Filter out GPS outliers (points too far from neighbors)
const filterGpsOutliers = (points: MapPoint[]): MapPoint[] => {
  if (points.length < 3) return points;

  const filtered: MapPoint[] = [];
  const maxJumpMeters = 500; // Max 500m jump between consecutive points

  for (let i = 0; i < points.length; i++) {
    const curr = points[i];
    const prev = i > 0 ? points[i - 1] : null;
    const next = i < points.length - 1 ? points[i + 1] : null;

    let isOutlier = false;

    if (prev && next) {
      const distToPrev = getDistanceMeters(prev.lat, prev.lon, curr.lat, curr.lon);
      const distToNext = getDistanceMeters(curr.lat, curr.lon, next.lat, next.lon);
      const distPrevToNext = getDistanceMeters(prev.lat, prev.lon, next.lat, next.lon);

      // If jumping to this point and back is much longer than skipping it, it's an outlier
      if (distToPrev > maxJumpMeters && distToNext > maxJumpMeters && distPrevToNext < maxJumpMeters) {
        isOutlier = true;
      }
    } else if (prev) {
      const distToPrev = getDistanceMeters(prev.lat, prev.lon, curr.lat, curr.lon);
      if (distToPrev > maxJumpMeters * 2) {
        isOutlier = true;
      }
    }

    if (!isOutlier) {
      filtered.push(curr);
    }
  }

  return filtered;
};

const ActivityReportMap: React.FC<ActivityReportMapProps> = ({
  polylineData,
  colorMode = 'speed'
}) => {
  const { t } = useTranslation();

  const { positions, segments, stats } = useMemo(() => {
    if (!polylineData || polylineData.length === 0) {
      return { positions: [], segments: [], stats: null };
    }

    // Filter out GPS outliers first
    const filteredData = filterGpsOutliers(polylineData);

    const pos: [number, number][] = filteredData.map(p => [p.lat, p.lon]);

    // Get valid speeds and heart rates from filtered data
    const speeds = filteredData
      .map(p => p.speed_mps)
      .filter((s): s is number => s != null && s > 0.5); // Ignore very slow (< 0.5 m/s = 1.8 km/h)
    const heartRates = filteredData
      .map(p => p.heart_rate)
      .filter((hr): hr is number => hr != null && hr > 40 && hr < 220);

    // Sort for percentile calculations
    const sortedSpeeds = [...speeds].sort((a, b) => a - b);
    const sortedHRs = [...heartRates].sort((a, b) => a - b);

    // Use 5th and 95th percentile for scaling (like Garmin does)
    const minSpeed = percentile(sortedSpeeds, 5);
    const maxSpeed = percentile(sortedSpeeds, 95);
    const minHR = percentile(sortedHRs, 5);
    const maxHR = percentile(sortedHRs, 95);

    // Create colored segments
    const segs: { positions: [number, number][]; color: string }[] = [];

    for (let i = 0; i < filteredData.length - 1; i++) {
      const p1 = filteredData[i];
      const p2 = filteredData[i + 1];

      let color = '#3b82f6'; // default blue

      if (colorMode === 'speed' && sortedSpeeds.length > 0) {
        const speed = p1.speed_mps ?? p2.speed_mps ?? 0;
        if (speed > 0.5 && maxSpeed > minSpeed) {
          const normalized = (speed - minSpeed) / (maxSpeed - minSpeed);
          color = getColorFromNormalized(normalized);
        }
      } else if (colorMode === 'heartRate' && sortedHRs.length > 0) {
        const hr = p1.heart_rate ?? p2.heart_rate ?? 0;
        if (hr > 40 && maxHR > minHR) {
          const normalized = (hr - minHR) / (maxHR - minHR);
          color = getColorFromNormalized(normalized);
        }
      }

      segs.push({
        positions: [[p1.lat, p1.lon], [p2.lat, p2.lon]],
        color
      });
    }

    return {
      positions: pos,
      segments: segs,
      stats: {
        minSpeed: minSpeed * 3.6,
        maxSpeed: maxSpeed * 3.6,
        minHR,
        maxHR,
        hasSpeed: sortedSpeeds.length > 0,
        hasHR: sortedHRs.length > 0
      }
    };
  }, [polylineData, colorMode]); // colorMode is now in dependencies

  if (!polylineData || polylineData.length === 0) {
    return <div>{t('reports.noMapDataAvailable', 'No map data available.')}</div>;
  }

  const startPoint = positions[0];
  const endPoint = positions[positions.length - 1];

  return (
    <div className="relative">
      <div style={{ height: '400px', width: '100%' }}>
        <MapContainer
          key={`map-${colorMode}`} // Force re-mount when colorMode changes
          center={startPoint}
          zoom={13}
          style={{ height: '100%', width: '100%' }}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <FitBounds positions={positions} />

          {/* Border/outline layer (dark, slightly wider) */}
          {segments.map((seg, idx) => (
            <Polyline
              key={`border-${colorMode}-${idx}`}
              positions={seg.positions}
              color="#333333"
              weight={7}
              opacity={0.6}
              lineCap="round"
              lineJoin="round"
            />
          ))}

          {/* Main colored segments */}
          {segments.map((seg, idx) => (
            <Polyline
              key={`main-${colorMode}-${idx}`}
              positions={seg.positions}
              color={seg.color}
              weight={4}
              opacity={1}
              lineCap="round"
              lineJoin="round"
            />
          ))}

          {/* Start marker (green) */}
          {startPoint && (
            <Marker position={startPoint} icon={new L.DivIcon({
              className: 'custom-div-icon',
              html: "<div style='background-color: #22c55e; width: 14px; height: 14px; border-radius: 50%; border: 3px solid white; box-shadow: 0 2px 6px rgba(0,0,0,0.4);'></div>",
              iconSize: [20, 20],
              iconAnchor: [10, 10]
            })} />
          )}

          {/* End marker */}
          {endPoint && (
            <Marker position={endPoint} icon={new L.DivIcon({
              className: 'custom-div-icon',
              html: "<div style='background-color: #ef4444; width: 14px; height: 14px; border-radius: 50%; border: 3px solid white; box-shadow: 0 2px 6px rgba(0,0,0,0.4);'></div>",
              iconSize: [20, 20],
              iconAnchor: [10, 10]
            })} />
          )}
        </MapContainer>
      </div>

      {/* Legend */}
      {stats && colorMode !== 'none' && (
        <div className="absolute bottom-4 right-4 bg-white dark:bg-gray-800 rounded-lg shadow-lg p-3 text-sm z-[1000]">
          {colorMode === 'speed' && stats.hasSpeed && (
            <div className="flex items-center gap-2">
              <div
                className="w-28 h-4 rounded"
                style={{
                  background: 'linear-gradient(to right, rgb(0,0,255), rgb(0,255,255), rgb(0,255,0), rgb(255,255,0), rgb(255,165,0), rgb(255,0,0))'
                }}
              />
              <span className="text-xs text-gray-600 dark:text-gray-300 whitespace-nowrap">
                {stats.minSpeed.toFixed(1)} - {stats.maxSpeed.toFixed(1)} km/h
              </span>
            </div>
          )}
          {colorMode === 'heartRate' && stats.hasHR && (
            <div className="flex items-center gap-2">
              <div
                className="w-28 h-4 rounded"
                style={{
                  background: 'linear-gradient(to right, rgb(0,0,255), rgb(0,255,255), rgb(0,255,0), rgb(255,255,0), rgb(255,165,0), rgb(255,0,0))'
                }}
              />
              <span className="text-xs text-gray-600 dark:text-gray-300 whitespace-nowrap">
                {stats.minHR.toFixed(0)} - {stats.maxHR.toFixed(0)} bpm
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default ActivityReportMap;
