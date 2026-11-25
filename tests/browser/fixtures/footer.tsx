import { create } from "@bufbuild/protobuf";
import { GetPublicInfoResponseSchema } from "@komari/proto/komari/browser/v1/browser_pb";
import { Theme } from "@radix-ui/themes";
import { createRoot } from "react-dom/client";
import { connectClients } from "../../../src/api/connect/client";
import Footer from "../../../src/components/Footer";
import { ConnectProvider } from "../../../src/contexts/ConnectContext";
import { PublicInfoProvider } from "../../../src/contexts/PublicInfoContext";

connectClients.browser.getPublicInfo = async () => create(GetPublicInfoResponseSchema, {
  themeSettings: {
    customFooterHtml: '<strong style="display:none">Local footer</strong> <a href="/about" onclick="">About</a><form><input name="example"></form><svg></svg>',
  },
});

createRoot(document.getElementById("root")!).render(
  <Theme><ConnectProvider><PublicInfoProvider><Footer /></PublicInfoProvider></ConnectProvider></Theme>,
);
