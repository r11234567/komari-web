import { Flex } from "@radix-ui/themes";

import ColorSwitch from "./ColorSwitch";
import LanguageSwitch from "./Language";
import ThemeSwitch from "./ThemeSwitch";
import KomariBrand from "./KomariBrand";
import { getAppAssetUrl } from "@/utils/assetUrl";

export default function GuideHeader() {
  return (
    <Flex justify="between" align="center" gap="4" className="w-full">
      <Flex align="center" gap="2">
        <img
          src={getAppAssetUrl("assets/pwa-icon.png")}
          alt="Komari"
          className="size-9 object-contain"
        />
        <KomariBrand size="sm" />
      </Flex>
      <Flex gap="2">
        <LanguageSwitch />
        <ThemeSwitch />
        <ColorSwitch />
      </Flex>
    </Flex>
  );
}
