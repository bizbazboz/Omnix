import { useQuery } from "@tanstack/react-query";
import { NavLink } from "react-router-dom";
import { HeartPulse, Footprints } from "lucide-react";
import { api } from "../../lib/api";
import type { Statistics } from "./api";
import { healthViews } from "./catalog";
export default function HealthNavigation({ onClose }: { onClose: () => void }) {
  const query = useQuery<Statistics>({
    queryKey: ["health-statistics"],
    queryFn: () => api("/health/statistics")
  });
  return (
    <nav aria-label="Health navigation">
      {healthViews
        .filter(
          (view) =>
            view.id === "overview" ||
            view.metrics.some(
              (id) => Object.keys(query.data?.metrics[id]?.points || {}).length
            )
        )
        .map((view) => (
          <NavLink
            key={view.id}
            to={"/health" + (view.id === "overview" ? "" : "/" + view.id)}
            end
            onClick={onClose}
          >
            <HeartPulse size={17} />
            {view.name}
          </NavLink>
        ))}
      <NavLink to="/health/walks" end onClick={onClose}>
        <Footprints size={17} />
        Walking loops
      </NavLink>
    </nav>
  );
}
