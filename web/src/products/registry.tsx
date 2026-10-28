import { lazy, type ComponentType, type LazyExoticComponent } from "react";
import type { Account, Draft } from "../lib/api";
import { Mail, CalendarDays, HeartPulse, type LucideIcon } from "lucide-react";
export type ProductProps = {
  accounts: Account[];
  onCompose: (draft: Draft) => void;
  notify: (text: string) => void;
};
export type ProductModule = {
  id: string;
  name: string;
  routePrefix: string;
  requiredCapabilities: string[];
  Icon: LucideIcon;
  Entry: LazyExoticComponent<ComponentType<ProductProps>>;
};
export const productRegistry: ProductModule[] = [
  {
    id: "email",
    name: "Mail",
    routePrefix: "/app/email",
    requiredCapabilities: ["mail.read"],
    Icon: Mail,
    Entry: lazy(() => import("./email/Email"))
  },
  {
    id: "calendar",
    name: "Calendar",
    routePrefix: "/app/calendar",
    requiredCapabilities: ["calendar.read"],
    Icon: CalendarDays,
    Entry: lazy(() => import("./calendar/Calendar"))
  },
  {
    id: "health",
    name: "Health",
    routePrefix: "/app/health",
    requiredCapabilities: ["health.read"],
    Icon: HeartPulse,
    Entry: lazy(() => import("./health/Health"))
  }
];
