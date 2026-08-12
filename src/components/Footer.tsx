import { Flex, Text } from "@radix-ui/themes";
import { usePublicInfo } from "@/contexts/PublicInfoContext";

const Footer = () => {
  //const currentYear = new Date().getFullYear();

  // 格式化 build 时间
  const formatBuildTime = (isoString: string) => {
    const date = new Date(isoString);
    return (
      date.toLocaleString("zh-CN", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        timeZone: "Asia/Shanghai",
      }) + " (GMT+8)"
    );
  };

  const buildTime =
    typeof __BUILD_TIME__ !== "undefined" ? __BUILD_TIME__ : null;
  const { publicInfo } = usePublicInfo();
  const customFooterHtml = publicInfo?.theme_settings?.customFooterHtml || "";

  return (
    <div className="km-footer footer p-2 border-t-1 border-t-[var(--gray-7)]">
      {/* Copyright and ICP Filing */}

      {customFooterHtml ? (
        <Text
          size="1"
          color="gray"
          className="flex flex-col justify-center items-center"
        >
          <span
            dangerouslySetInnerHTML={{
              __html: customFooterHtml,
            }}
          ></span>
          <Text size="2" color="gray">
            Powered by Komari Monitor.
          </Text>
        </Text>
      ) : (
        <Flex
          direction={{ initial: "column", md: "row" }}
          justify="between"
          align={{ initial: "center", md: "start" }}
          gap="4"
          style={{
            maxWidth: "1200px",
            margin: "0 auto",
          }}
        >
          <Flex
            direction="column"
            gap="2"
            align={{ initial: "center", md: "start" }}
          >
            <Text size="2" color="gray">
              Powered by Komari Monitor.
            </Text>
            {buildTime && (
              <Text size="1" color="gray">
                Build Time: {formatBuildTime(buildTime)}
              </Text>
            )}
            <Text size="1" color="gray">
              {publicInfo?.version ?? ""}
            </Text>
          </Flex>
        </Flex>
      )}
    </div>
  );
};

export default Footer;
