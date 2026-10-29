import type { ReactNode } from "react";
import { LiveDataProvider } from "@/contexts/LiveDataContext";
import WorkspaceBoundary from "./WorkspaceBoundary";

// The standalone terminal route is outside the public layout's live provider.
// One shared stream feeds both editor and terminal monitors, including portals.
export default function TerminalPageBoundary({ children }: { children: ReactNode }) {
  return <LiveDataProvider><WorkspaceBoundary>{children}</WorkspaceBoundary></LiveDataProvider>;
}
