import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { AccountProvider, useAccount } from "@/contexts/AccountContext";
import Loading from "@/components/loading";
import { adminLoginPath } from "@/utils/loginRedirect";

function SessionGate({ children }: { children: ReactNode }) {
  const { account, loading } = useAccount();
  const { pathname, search, hash } = useLocation();

  if (loading) return <Loading />;
  if (!account?.logged_in) {
    return <Navigate to={adminLoginPath(pathname, search, hash)} replace />;
  }
  return children;
}

export default function RequireAdminSession({ children }: { children: ReactNode }) {
  return <AccountProvider><SessionGate>{children}</SessionGate></AccountProvider>;
}
