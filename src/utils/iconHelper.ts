import type React from "react";
import { buildPluginPageSrc } from "./pluginPage.ts";
import {
  Bolt,
  Home,
  BarChart2,
  CircleArrowRight,
  MessageCircleMore,
  Ellipsis,
  Bell,
  Unplug,
  TrendingUp,
  Users,
  UserCircle,
  FileText,
  AtSign,
  Book,
  Server,
  Activity,
  Palette,
  Code,
  Globe,
  Terminal,
  Database,
  Store,
  Blocks,
  Settings2,
  LayoutDashboard,
  Route,
  WifiOff,
  ChartNoAxesCombined,
  CircleDollarSign,
  ShieldCheck,
  ShieldAlert,
  UserPlus,
  SquareTerminal,
  MonitorCog, Paintbrush, ShoppingBag, Package, SlidersHorizontal, PanelsTopLeft,
} from "lucide-react";


// Map icon names defined in menuConfig.json to their components
export const iconMap: Record<string, React.ComponentType<any>> = {
  Server,
  Bolt,
  Home,
  BarChart2,
  CircleArrowRight,
  MessageCircleMore,
  Ellipsis,
  Bell,
  Unplug,
  TrendingUp,
  Users,
  UserCircle,
  FileText,
  AtSign,
  Book,
  Activity,
  Palette,
  Code,
  Globe,
  Terminal,
  Database,
  Store,
  Blocks,
  Settings2,
  LayoutDashboard,
  Route,
  WifiOff,
  ChartNoAxesCombined,
  CircleDollarSign,
  ShieldCheck,
  ShieldAlert,
  UserPlus,
  SquareTerminal,
  MonitorCog, Paintbrush, ShoppingBag, Package, SlidersHorizontal, PanelsTopLeft,
};
export function getBuiltInIcon(icon: string) {
  return Object.prototype.hasOwnProperty.call(iconMap, icon) ? iconMap[icon] : undefined;
}

export function resolvePluginIcon(short: string, icon?: string): string {
  if (!icon) return "";
  if (getBuiltInIcon(icon)) return icon;
  if (icon.startsWith("/") || /[:%]/.test(icon)) return "";
  return buildPluginPageSrc("/api/admin/plugin", short, icon.replace(/^\.\//, "")) ?? "";
}
