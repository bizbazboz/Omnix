import { useEffect, useRef, useState } from "react";
import * as L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { Point, Walk } from "./graph";
export default function StreetMap({
  start,
  route,
  onPick
}: {
  start: Point | null;
  route: Walk | null;
  onPick: (point: Point) => void;
}) {
  const root = useRef<HTMLDivElement>(null),
    map = useRef<L.Map | null>(null),
    marker = useRef<L.CircleMarker | null>(null),
    line = useRef<L.Polyline | null>(null),
    pick = useRef(onPick);
  const [tileError, setTileError] = useState(false);
  pick.current = onPick;
  useEffect(() => {
    const instance = L.map(root.current!, {
      center: [54, -2],
      zoom: 6,
      scrollWheelZoom: false,
      zoomControl: true
    });
    map.current = instance;
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      referrerPolicy: "strict-origin-when-cross-origin",
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors</a>'
    })
      .on("tileerror", () => setTileError(true))
      .on("tileload", () => setTileError(false))
      .addTo(instance);
    instance.attributionControl.setPrefix(false);
    instance.on("click", (event) =>
      pick.current([event.latlng.lng, event.latlng.lat])
    );
    const observer = new ResizeObserver(() =>
      instance.invalidateSize({ pan: false })
    );
    observer.observe(root.current!);
    return () => {
      observer.disconnect();
      instance.remove();
      map.current = null;
    };
  }, []);
  useEffect(() => {
    const instance = map.current;
    if (!instance || !start) return;
    marker.current?.remove();
    marker.current = L.circleMarker([start[1], start[0]], {
      radius: 7,
      color: "#fff",
      weight: 3,
      fillColor: "#000",
      fillOpacity: 1
    })
      .bindTooltip("Start / finish")
      .addTo(instance);
    instance.setView([start[1], start[0]], 14);
  }, [start]);
  useEffect(() => {
    const instance = map.current;
    if (!instance) return;
    line.current?.remove();
    if (route) {
      line.current = L.polyline(
        route.coordinates.map(([x, y]) => [y, x] as L.LatLngTuple),
        { color: "#d71921", weight: 5, opacity: 1 }
      ).addTo(instance);
      instance.fitBounds(line.current.getBounds(), {
        padding: [32, 32],
        maxZoom: 17
      });
    }
  }, [route]);
  function fit() {
    if (line.current)
      map.current?.fitBounds(line.current.getBounds(), {
        padding: [32, 32],
        maxZoom: 17
      });
    else if (start) map.current?.setView([start[1], start[0]], 14);
  }
  return (
    <div className="walking-map-wrap">
      <div className="walking-map-toolbar">
        <span className="eyebrow">CLICK THE MAP TO SET YOUR START</span>
        <button
          type="button"
          className="text-button"
          onClick={fit}
          disabled={!start && !route}
        >
          Fit route
        </button>
      </div>
      {tileError && (
        <p className="notice" role="status">
          Some map tiles could not load. You can still calculate and export a
          route.
        </p>
      )}
      <div
        className="walking-street-map"
        ref={root}
        role="region"
        aria-label="Walking street map"
      />
    </div>
  );
}
