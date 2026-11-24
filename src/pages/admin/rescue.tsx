import * as React from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import { Flex, Text, Tabs } from "@radix-ui/themes";
import { Activity, ShieldAlert } from "lucide-react";
import NodeSelector from "@/components/NodeSelector";
import { NodeDetailsProvider } from "@/contexts/NodeDetailsContext";
import { RescueConsole } from "@/components/admin/RescueConsole";
import { PerformanceDiagnostics } from "@/components/admin/PerformanceDiagnostics";

function RescuePageInner() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const initialAgent = params.get("agent") ?? "";
  const [selectedAgent, setSelectedAgent] = React.useState<string>(initialAgent);
  const [tab, setTab] = React.useState<string>("diagnostics");

  const handleAgentChange = (ids: string[]) => {
    const id = ids[0] ?? "";
    setSelectedAgent(id);
    if (id) {
      setParams({ agent: id }, { replace: true });
    } else {
      setParams({}, { replace: true });
    }
  };

  React.useEffect(() => {
    const queryAgent = params.get("agent") ?? "";
    if (queryAgent !== selectedAgent) setSelectedAgent(queryAgent);
  }, [params, selectedAgent]);

  return (
    <div className="max-w-3xl mx-auto p-6 flex flex-col gap-6">
      <Flex align="center" gap="2">
        <ShieldAlert size={20} />
        <Text size="5" weight="bold">{t("rescue.page_title")}</Text>
      </Flex>

      <div className="rounded-md border p-4">
        <NodeSelector
          value={selectedAgent ? [selectedAgent] : []}
          onChange={handleAgentChange}
        />
      </div>

      {selectedAgent && (
        <Tabs.Root value={tab} onValueChange={setTab}>
          <Tabs.List>
            <Tabs.Trigger value="diagnostics">
              <Flex align="center" gap="1">
                <Activity size={14} />
                {t("rescue.diagnostics")}
              </Flex>
            </Tabs.Trigger>
            <Tabs.Trigger value="rescue">
              <Flex align="center" gap="1">
                <ShieldAlert size={14} />
                {t("rescue.title")}
              </Flex>
            </Tabs.Trigger>
          </Tabs.List>

          <Tabs.Content value="diagnostics" className="mt-4">
            <PerformanceDiagnostics agentId={selectedAgent} />
          </Tabs.Content>

          <Tabs.Content value="rescue" className="mt-4">
            <RescueConsole agentId={selectedAgent} />
          </Tabs.Content>
        </Tabs.Root>
      )}

      {!selectedAgent && (
        <Text size="2" color="gray">{t("rescue.choose_machine")}</Text>
      )}
    </div>
  );
}

export default function RescuePage() {
  return (
    <NodeDetailsProvider>
      <RescuePageInner />
    </NodeDetailsProvider>
  );
}
