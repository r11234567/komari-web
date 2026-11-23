import { Box, Callout } from "@radix-ui/themes";
import { useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { buildPluginPageSrc } from "@/utils/pluginPage";

// 插件注入的管理页面：iframe 内嵌插件目录里的静态 HTML。
export default function PluginPage() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const short = params.get("short");
  const file = params.get("file");
  const src = buildPluginPageSrc("/api/admin/plugin", short, file);
  if (!src || !short || !file) {
    return (
      <Callout.Root>
        <Callout.Text>{t("plugin.page_missing_params", "Missing plugin page parameters")}</Callout.Text>
      </Callout.Root>
    );
  }
  return (
    <Box className="km-page-admin-plugin h-full min-h-[calc(100vh-96px)]">
      <iframe
        title={`${short}/${file}`}
        src={src}
        sandbox="allow-forms allow-modals allow-popups allow-scripts"
        referrerPolicy="no-referrer"
        className="km-plugin-frame h-full min-h-[calc(100vh-96px)] w-full border-0"
      />
    </Box>
  );
}
