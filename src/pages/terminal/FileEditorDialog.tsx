import TerminalDialog from "./TerminalDialog";
import { useTranslation } from "react-i18next";
import type { RemoteFileInfo } from "./fileManagerApi";

export interface FileEditorDialogProps {
  open: boolean;
  uuid: string;
  initialFile?: RemoteFileInfo | null;
  initialLine?: number;
  refreshToken?: number;
  fontFamily?: string;
  onOpenChange: (open: boolean) => void;
  onSaved?: () => void;
  onChanged?: () => void;
}

export const FileEditorDialog = ({
  open,
  initialFile,
  onOpenChange,
}: FileEditorDialogProps) => {
  const { t } = useTranslation();
  if (!open) return null;

  return (
    <TerminalDialog
      open={open}
      title={
        initialFile?.name
          ? `${t("file_manager.edit", "编辑")}: ${initialFile.name}`
          : t("operations.workbench", "远程工作台")
      }
      description={t(
        "terminal.editor_p6_notice",
        "Monaco 文件编辑器将在 P6 阶段完整开放。当前工作台终端、多标签会话及文件服务已就绪。",
      )}
      confirmLabel={t("common.ok", "确定")}
      onSubmit={() => onOpenChange(false)}
      onCancel={() => onOpenChange(false)}
    />
  );
};

export default FileEditorDialog;
