import { lazy, type ComponentType, type LazyExoticComponent } from "react";
import type { Account, Draft } from "../lib/api";
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
  Entry: LazyExoticComponent<ComponentType<ProductProps>>;
};
export const productRegistry: ProductModule[] = [
  {
    id: "email",
    name: "Email",
    routePrefix: "/app/email",
    requiredCapabilities: ["mail.read"],
    Entry: lazy(() => import("./email/Email"))
  }
];
