import * as React from "react";
import { z } from "zod";
import { schema } from "@/components/admin/NodeTable/schema/node";
import { DataTableRefreshContext } from "@/components/admin/NodeTable/schema/DataTableRefreshContext";
import { Terminal, Trash2, DollarSign } from "lucide-react";
import { t } from "i18next";
import type { Row } from "@tanstack/react-table";
import { EditDialog } from "./NodeEditDialog";
import {
  Button,
  Dialog,
  Flex,
  IconButton,
} from "@radix-ui/themes";
import { AgentDeploymentDialog } from "@/components/admin/AgentDeploymentDialog";

async function removeClient(uuid: string) {
  await fetch(`/api/admin/client/${uuid}/remove`, {
    method: "POST",
  });
}

export function ActionsCell({ row }: { row: Row<z.infer<typeof schema>> }) {
  const refreshTable = React.useContext(DataTableRefreshContext);
  const [removing, setRemoving] = React.useState(false);

  return (
    <div className="km-node-function flex gap-3 justify-center">
      <AgentDeploymentDialog
        agentId={row.original.uuid}
        title="一键部署与配置下发"
        iconClassName="p-1"
      />
      <a href={`/terminal?uuid=${row.original.uuid}`} target="_blank">
        <IconButton
          variant="ghost"
          title={t("terminal.title", "Terminal")}
          aria-label={t("terminal.title", "Terminal")}
        >
          <Terminal className="p-1" />
        </IconButton>
      </a>
      {/** Edit Button */}
      <EditDialog item={row.original} />
      {/** Edit Money */}
      <Dialog.Root> 
        <Dialog.Trigger>
          <IconButton
            variant="ghost"
            title={t("admin.nodeTable.editNodePrice", "Edit Price")}
            aria-label={t("admin.nodeTable.editNodePrice", "Edit Price")}
          >
           <DollarSign className="p-1" />
          </IconButton>
        </Dialog.Trigger>
        <Dialog.Content>
          <Dialog.Title>{t("admin.nodeTable.editNodePrice")}</Dialog.Title>
          <label>
            123
          </label>
        </Dialog.Content>
      </Dialog.Root>
      {/** Delete Button */}
      <Dialog.Root>
        <Dialog.Trigger>
          <IconButton
            variant="ghost"
            color="red"
            className="text-destructive"
            title={t("common.delete", "Delete")}
            aria-label={t("common.delete", "Delete")}
          >
            <Trash2 className="p-1" />
          </IconButton>
        </Dialog.Trigger>
        <Dialog.Content>
          <Dialog.Title>{t("common.confirm_delete")}</Dialog.Title>
          <Dialog.Description>
            {t("admin.nodeTable.cannotUndo")}
          </Dialog.Description>
          <Flex gap="2" justify={"end"}>
            <Dialog.Close>
              <Button variant="soft">{t("common.cancel")}</Button>
            </Dialog.Close>
            <Dialog.Trigger>
              <Button
                disabled={removing}
                color="red"
                onClick={async () => {
                  setRemoving(true);
                  await removeClient(row.original.uuid);
                  setRemoving(false);
                  if (refreshTable) refreshTable();
                }}
              >
                {removing
                  ? t("admin.nodeTable.deleting")
                  : t("common.confirm")}
              </Button>
            </Dialog.Trigger>
          </Flex>
        </Dialog.Content>
      </Dialog.Root>
    </div>
  );
}
