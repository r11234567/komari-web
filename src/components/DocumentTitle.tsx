import { useEffect } from "react";
import { useLocation } from "react-router-dom";

import { usePublicInfo } from "@/contexts/PublicInfoContext";

const ADMIN_TITLE = "Komari Monitor";
const PUBLIC_TITLE = "Komari";

export default function DocumentTitle() {
  const { pathname } = useLocation();
  const { publicInfo } = usePublicInfo();

  useEffect(() => {
    if (pathname === "/terminal") return;

    document.title =
      pathname === "/admin" || pathname.startsWith("/admin/")
        ? ADMIN_TITLE
        : publicInfo?.sitename?.trim() || PUBLIC_TITLE;
  }, [pathname, publicInfo?.sitename]);

  return null;
}
