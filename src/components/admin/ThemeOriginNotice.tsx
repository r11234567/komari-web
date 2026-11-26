import { Callout } from "@radix-ui/themes";
import { useTranslation } from "react-i18next";

export default function ThemeOriginNotice({ split, shared }: { split: boolean; shared: boolean }) {
  const { t } = useTranslation();
  return (
    <Callout.Root color={split ? "green" : "amber"} size="1">
      <Callout.Text>
        {split ? t(
          "theme.split_origin_notice",
          "Split Panel listener (KOMARI_PANEL_LISTEN) is active: third-party themes run exclusively on the public status origin.",
        ) : (
          <>
            {t(shared ? "theme.shared_origin_enabled" : "theme.shared_origin_notice")}{" "}
            <a
              href="https://github.com/r11234567/komari/blob/main/docs/security/public-theme-origin.md"
              target="_blank"
              rel="noreferrer"
              className="underline"
            >
              {t("common.documentation")}
            </a>
          </>
        )}
      </Callout.Text>
    </Callout.Root>
  );
}
