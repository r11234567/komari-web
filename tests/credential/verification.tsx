// Only the credential device/transport is peripheral to these component units.
// Production trusted verification and proof-consumer security run in backend CI.
import { useEffect, useRef } from "react";
export default function Verification({ resource, purpose, onAuthorized }: { resource: string; purpose: number; onAuthorized: (token: string, signal: AbortSignal) => Promise<void> }) {
  const controller=useRef(new AbortController());
  useEffect(()=>()=>controller.current.abort(),[]);
  return <button data-proof-resource={resource} data-proof-purpose={purpose} onClick={()=>void onAuthorized("synthetic-completed-proof",controller.current.signal)}>complete-unit-proof</button>;
}
