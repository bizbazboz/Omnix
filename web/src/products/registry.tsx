import { lazy, type ComponentType, type LazyExoticComponent } from "react";
import type { Account, Draft } from "../lib/api";
import {
  Mail,
  CalendarDays,
  HeartPulse,
  NotebookPen,
  Newspaper,
  Lightbulb,
  type LucideIcon
} from "lucide-react";
export type ProductProps = {
  accounts: Account[];
  onCompose: (draft: Draft) => void;
  notify: (text: string) => void;
};
export type ProductModule = {
  id: string;
  name: string;
  routePrefix: string;
  homePath?: string;
  requiredCapabilities: string[];
  Icon: LucideIcon;
  Entry: LazyExoticComponent<ComponentType<ProductProps>>;
};
export const productRegistry: ProductModule[] = [
  {
    id: "email",
    name: "Mail",
    routePrefix: "/email",
    requiredCapabilities: ["mail.read"],
    Icon: Mail,
    Entry: lazy(() => import("./email/Email"))
  },
  {
    id: "calendar",
    name: "Calendar",
    routePrefix: "/calendar",
    requiredCapabilities: ["calendar.read"],
    Icon: CalendarDays,
    Entry: lazy(() => import("./calendar/Calendar"))
  },
  {
    id: "health",
    name: "Health",
    routePrefix: "/health",
    requiredCapabilities: ["health.read"],
    Icon: HeartPulse,
    Entry: lazy(() => import("./health/Health"))
  },
  {
    id: "daily",
    name: "Daily",
    routePrefix: "/daily",
    homePath: "/daily/news",
    requiredCapabilities: ["daily.read"],
    Icon: Newspaper,
    Entry: lazy(() => import("./daily/Daily"))
  },
  {
    id: "iot",
    name: "IoT",
    routePrefix: "/iot",
    requiredCapabilities: ["iot.read"],
    Icon: Lightbulb,
    Entry: lazy(() => import("./iot/IoT"))
  },
  {
    id: "notes",
    name: "Notes & Projects",
    routePrefix: "/notes",
    requiredCapabilities: ["notes.read"],
    Icon: NotebookPen,
    Entry: lazy(() => import("./notes/Notes"))
  }
];
