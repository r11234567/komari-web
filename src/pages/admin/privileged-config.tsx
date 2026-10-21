import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import NodeSelector from "@/components/NodeSelector";
import { PrivilegedDeliveryPanel } from "@/components/admin/PrivilegedDeliveryPanel";

export default function PrivilegedConfigPage() {
  const [params] = useSearchParams();
  const [agentId, setAgentId] = useState(params.get("agent") ?? "");
  return <div className="max-w-2xl mx-auto p-6 flex flex-col gap-6">
    <h1>特权配置下发</h1>
    <NodeSelector value={agentId ? [agentId] : []} onChange={(ids) => setAgentId(ids[0] ?? "")} />
    {agentId && <PrivilegedDeliveryPanel key={agentId} agentId={agentId} history />}
  </div>;
}
