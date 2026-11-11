import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

const COLORS = { peer: '#1f6f50', me: '#175cd3' };

/** Small OpenStreetMap view with one marker per point ({ key, lat, lng, label }). */
export default function LiveMap({ points }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef(new Map());
  const fittedRef = useRef(false);

  useEffect(() => {
    const map = L.map(containerRef.current, { zoomControl: true, attributionControl: true }).setView([23.8103, 90.4125], 13);

    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);

    mapRef.current = map;
    const markers = markersRef.current;

    return () => {
      map.remove();
      mapRef.current = null;
      markers.clear();
      fittedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const markers = markersRef.current;
    const seen = new Set();

    points.forEach((point) => {
      seen.add(point.key);
      const position = [point.lat, point.lng];
      let marker = markers.get(point.key);

      if (!marker) {
        marker = L.circleMarker(position, {
          radius: 10,
          color: '#fff',
          weight: 3,
          fillColor: point.color || COLORS[point.key] || COLORS.peer,
          fillOpacity: 1,
        }).addTo(map);
        markers.set(point.key, marker);
      } else {
        marker.setLatLng(position);
      }

      marker.bindTooltip(point.label, { permanent: true, direction: 'top', offset: [0, -10] });
    });

    markers.forEach((marker, key) => {
      if (!seen.has(key)) {
        marker.remove();
        markers.delete(key);
      }
    });

    if (points.length) {
      const bounds = L.latLngBounds(points.map((point) => [point.lat, point.lng]));

      if (!fittedRef.current) {
        map.fitBounds(bounds, { padding: [50, 50], maxZoom: 16 });
        fittedRef.current = true;
      } else if (!map.getBounds().contains(bounds)) {
        map.fitBounds(bounds, { padding: [50, 50], maxZoom: 16, animate: true });
      }
    }
  }, [points]);

  return <div ref={containerRef} className="live-map" role="img" aria-label="Live location map" />;
}
