import { Cross1Icon, ExitIcon } from "@radix-ui/react-icons";
import {
  Button,
  Callout,
  Dialog,
  Flex,
  Grid,
  IconButton,
  Text,
} from "@radix-ui/themes";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import ColorSwitch from "../ColorSwitch";
import LanguageSwitch from "../Language";
import ThemeSwitch from "../ThemeSwitch";
import KomariBrand from "../KomariBrand";
import { useIsMobile } from "@/hooks/use-mobile";
import menuConfig from "../../config/menuConfig.json";
import type { MenuItem } from "../../types/menu";
import { iconMap } from "../../utils/iconHelper";
import { ChevronDownIcon } from "@radix-ui/react-icons";
import { TablerMenu2 } from "../Icones/Tabler";
import { usePublicInfo } from "@/contexts/PublicInfoContext";
import {
  ArrowRight,
  CircleFadingArrowUp,
  Download,
  ExternalLink,
  Github,
  LoaderCircle,
} from "lucide-react";
import { toast } from "sonner";
import { useRPC2Call } from "@/contexts/RPC2Context";
import { resolveI18nText } from "@/utils/i18nText";
import {
  getThemeConfigurationType,
  normalizeThemeRedirectTarget,
  THEME_CONFIGURATION_MANAGED,
  THEME_CONFIGURATION_RAW,
  THEME_CONFIGURATION_REDIRECT,
} from "@/utils/themeConfiguration";
import {
  buildAdminMenuItems,
  toggleSingleSubMenu,
} from "@/utils/adminMenu";
import { useSettings } from "@/lib/api";
import { preloadAdminRoute } from "@/routes";

// 将JSON配置转换为类型安全的菜单项数组 (基础静态菜单)
const parsedMenuConfig = menuConfig as {
  menu: MenuItem[];
  footer?: MenuItem[];
};
const baseMenuItems = parsedMenuConfig.menu;
const footerMenuItems = parsedMenuConfig.footer ?? [];
const DESKTOP_SIDEBAR_WIDTH = 212;
const MOBILE_SIDEBAR_WIDTH = "clamp(184px, 42vw, 244px)";
const MOBILE_SIDEBAR_OPEN_TRANSITION = {
  duration: 0.22,
  ease: [0.22, 1, 0.36, 1],
} as const;
const MOBILE_SIDEBAR_CLOSE_TRANSITION = {
  duration: 0.18,
  ease: [0.4, 0, 1, 1],
} as const;
interface AdminPanelBarProps {
  content: ReactNode;
}

interface GithubReleaseInfo {
  tag_name: string;
  name?: string;
  body?: string;
  html_url: string;
  published_at?: string;
  draft?: boolean;
  prerelease?: boolean;
}

interface VersionInfo {
  hash: string;
  version: string;
  deployment: "docker" | "linux" | "windows" | "unknown";
}

interface SelfUpdateCapability {
  deployment: string;
  distribution?: string;
  distribution_version?: string;
  supported: boolean;
  reason?: string;
  last_result?: {
    status: string;
    target_version: string;
    target_hash: string;
    message?: string;
  };
}

type UpdatePhase = "idle" | "preparing" | "restarting";

function parseSemver(input?: string | null): number[] | null {
  if (!input) return null;
  const normalized = String(input).trim().replace(/^v/i, "");
  const match = normalized.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compareSemver(left?: string | null, right?: string | null) {
  const a = parseSemver(left);
  const b = parseSemver(right);
  if (!a || !b) return null;
  for (let i = 0; i < 3; i++) {
    if (a[i] > b[i]) return 1;
    if (a[i] < b[i]) return -1;
  }
  return 0;
}

function parseReleaseVersionHash(body?: string | null) {
  const match = body?.match(
    /<!--\s*komari-version-hash:\s*([a-z0-9]{7})\s*-->/i,
  );
  return match?.[1]?.toLowerCase() ?? null;
}

function formatVersion(version?: string | null, hash?: string | null) {
  if (!version) return "";
  const normalizedHash = hash?.trim();
  return normalizedHash && normalizedHash !== "unknown"
    ? `${version} (${normalizedHash})`
    : version;
}

function SidebarVersionLabel({
  version,
  hash,
}: {
  version: string;
  hash?: string | null;
}) {
  const snapshot = version.match(/^snapshot-(.+)$/i);
  const normalizedHash = hash?.trim();
  const visibleHash =
    normalizedHash && normalizedHash !== "unknown" ? normalizedHash : null;

  if (snapshot) {
    return (
      <span className="min-w-0 text-sm font-normal leading-5">
        <span className="block">Snapshot</span>
        <span className="block break-words">
          {snapshot[1]}
          {visibleHash ? ` · ${visibleHash}` : ""}
        </span>
      </span>
    );
  }

  return (
    <span className="min-w-0 whitespace-nowrap text-base font-normal leading-5">
      {formatVersion(version, hash)}
    </span>
  );
}

function formatReleaseVersion(release?: GithubReleaseInfo | null) {
  if (!release) return "";
  return formatVersion(
    release.tag_name || release.name,
    parseReleaseVersionHash(release.body),
  );
}

function visibleReleaseBody(body?: string | null) {
  return (body ?? "")
    .replace(/<!--\s*komari-version-hash:\s*[a-z0-9]{7}\s*-->/i, "")
    .trim();
}

function ReleaseMarkdown({ body }: { body?: string | null }) {
  return (
    <div className="mt-3 break-words text-[var(--gray-11)]">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => (
            <h1 className="mb-3 mt-5 border-b pb-2 text-xl font-semibold leading-7 text-foreground first:mt-0">
              {children}
            </h1>
          ),
          h2: ({ children }) => (
            <h2 className="mb-2 mt-5 border-b pb-2 text-lg font-semibold leading-7 text-foreground first:mt-0">
              {children}
            </h2>
          ),
          h3: ({ children }) => (
            <h3 className="mb-2 mt-4 text-base font-semibold leading-6 text-foreground first:mt-0">
              {children}
            </h3>
          ),
          h4: ({ children }) => (
            <h4 className="mb-2 mt-4 text-sm font-semibold text-foreground first:mt-0">
              {children}
            </h4>
          ),
          p: ({ children }) => <p className="my-3 leading-6">{children}</p>,
          ul: ({ children }) => (
            <ul className="my-3 list-disc space-y-1 pl-6 leading-6">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="my-3 list-decimal space-y-1 pl-6 leading-6">{children}</ol>
          ),
          li: ({ children }) => <li className="pl-1">{children}</li>,
          strong: ({ children }) => (
            <strong className="font-semibold text-foreground">{children}</strong>
          ),
          a: ({ children, href }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-[var(--accent-11)] underline underline-offset-2"
            >
              {children}
            </a>
          ),
          blockquote: ({ children }) => (
            <blockquote className="my-3 border-l-4 border-[var(--gray-a6)] pl-4 text-muted-foreground">
              {children}
            </blockquote>
          ),
          hr: () => <hr className="my-5 border-[var(--gray-a5)]" />,
          table: ({ children }) => (
            <div className="my-4 overflow-x-auto rounded-md border border-[var(--gray-a5)] bg-[var(--color-panel-solid)]">
              <table className="w-full min-w-max border-collapse text-left text-sm">
                {children}
              </table>
            </div>
          ),
          th: ({ children }) => (
            <th className="border-b border-r border-[var(--gray-a5)] bg-[var(--gray-a2)] px-3 py-2 font-semibold text-foreground last:border-r-0">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="border-b border-r border-[var(--gray-a5)] px-3 py-2 align-top last:border-r-0">
              {children}
            </td>
          ),
          code: ({ children }) => (
            <code className="rounded bg-[var(--gray-a3)] px-1.5 py-0.5 font-mono text-[0.9em] text-foreground">
              {children}
            </code>
          ),
          pre: ({ children }) => (
            <pre className="my-4 overflow-x-auto rounded-md bg-[var(--gray-a3)] p-3 leading-6">
              {children}
            </pre>
          ),
        }}
      >
        {visibleReleaseBody(body)}
      </ReactMarkdown>
    </div>
  );
}

function isReleaseNewer(
  release: GithubReleaseInfo,
  currentVersion?: string | null,
  currentHash?: string | null,
) {
  const comparison = compareSemver(
    release.tag_name || release.name,
    currentVersion,
  );
  if (comparison === null) return false;
  if (comparison !== 0) return comparison > 0;

  const releaseHash = parseReleaseVersionHash(release.body);
  const normalizedCurrentHash = currentHash?.trim().toLowerCase();
  return Boolean(
    releaseHash &&
      normalizedCurrentHash &&
      normalizedCurrentHash !== "unknown" &&
      releaseHash !== normalizedCurrentHash,
  );
}

const AdminPanelBar = ({ content }: AdminPanelBarProps) => {
  const { call, callViaHTTP } = useRPC2Call();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [openSubMenus, setOpenSubMenus] = useState<{ [key: string]: boolean }>({
    // 默认所有子菜单关闭
  });
  const isMobile = useIsMobile();
  const ishttps = window.location.protocol === "https:";
  const [t, i18n] = useTranslation();
  const location = useLocation();
  const { settings } = useSettings();
  const reduceMotion = Boolean(settings.reduce_motion);
  const { publicInfo } = usePublicInfo();
  //const navigate = useNavigate();
  // 获取版本信息
  const [versionInfo, setVersionInfo] = useState<VersionInfo | null>(null);
  const [selfUpdate, setSelfUpdate] = useState<SelfUpdateCapability | null>(
    null,
  );
  const [updatePhase, setUpdatePhase] = useState<UpdatePhase>("idle");
  const currentLanguage =
    i18n.resolvedLanguage ||
    i18n.language ||
    (typeof navigator !== "undefined" ? navigator.language : "");
  // GitHub 最新发布信息与更新检测
  const [latestRelease, setLatestRelease] = useState<GithubReleaseInfo | null>(
    null,
  );
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [releasesSince, setReleasesSince] = useState<GithubReleaseInfo[]>([]);
  const [updateDialogOpen, setUpdateDialogOpen] = useState(false);

  const currentTheme = publicInfo?.theme;
  const currentVersion =
    (publicInfo as any)?.version || versionInfo?.version;
  const currentReleaseURL = currentVersion
    ? `https://github.com/nuomiiiii/komari/releases/tag/${encodeURIComponent(currentVersion)}`
    : undefined;

  const [extraMenuItems, setExtraMenuItems] = useState<MenuItem[]>([]);
  const menuItems = useMemo(
    () => buildAdminMenuItems(baseMenuItems, extraMenuItems),
    [extraMenuItems],
  );

  useEffect(() => {
    document.documentElement.dataset.reduceMotion = reduceMotion ? "true" : "false";
    document.documentElement.dataset.adminShellActive = "true";
    return () => {
      delete document.documentElement.dataset.reduceMotion;
      delete document.documentElement.dataset.adminShellActive;
    };
  }, [reduceMotion]);

  useEffect(() => {
    const shell = document.querySelector<HTMLElement>("[data-admin-shell]");
    if (!shell || reduceMotion) return;

    const tabLists = new Set<HTMLElement>();
    const scheduledFrames = new Map<HTMLElement, number>();

    const updateIndicator = (list: HTMLElement) => {
      scheduledFrames.delete(list);
      const activeTab = list.querySelector<HTMLElement>(
        '.rt-TabsTrigger[data-state="active"], [role="tab"][aria-selected="true"]',
      );
      if (!activeTab) return;

      const listRect = list.getBoundingClientRect();
      const tabRect = activeTab.getBoundingClientRect();
      list.style.setProperty(
        "--admin-tab-highlight-x",
        `${tabRect.left - listRect.left + list.scrollLeft}px`,
      );
      list.style.setProperty("--admin-tab-highlight-width", `${tabRect.width}px`);
      if (!list.hasAttribute("data-admin-tab-motion-ready")) {
        window.requestAnimationFrame(() => {
          if (list.isConnected) list.setAttribute("data-admin-tab-motion-ready", "true");
        });
      }
    };

    const scheduleIndicator = (list: HTMLElement) => {
      const currentFrame = scheduledFrames.get(list);
      if (currentFrame) window.cancelAnimationFrame(currentFrame);
      scheduledFrames.set(
        list,
        window.requestAnimationFrame(() => updateIndicator(list)),
      );
    };

    const resizeObserver = new ResizeObserver((entries) => {
      entries.forEach((entry) => scheduleIndicator(entry.target as HTMLElement));
    });

    const registerTabList = (list: HTMLElement) => {
      if (tabLists.has(list)) return;
      tabLists.add(list);
      resizeObserver.observe(list);
      list.addEventListener("scroll", handleTabListScroll, { passive: true });
      updateIndicator(list);
    };

    function handleTabListScroll(event: Event) {
      scheduleIndicator(event.currentTarget as HTMLElement);
    }

    const registerTabListsWithin = (root: ParentNode) => {
      root.querySelectorAll<HTMLElement>(".rt-TabsList").forEach(registerTabList);
    };

    registerTabListsWithin(shell);
    const mutationObserver = new MutationObserver((records) => {
      records.forEach((record) => {
        if (record.type === "attributes") {
          const list = (record.target as HTMLElement).closest<HTMLElement>(".rt-TabsList");
          if (list) scheduleIndicator(list);
          return;
        }
        record.addedNodes.forEach((node) => {
          if (!(node instanceof HTMLElement)) return;
          if (node.matches(".rt-TabsList")) registerTabList(node);
          registerTabListsWithin(node);
        });
      });
    });
    mutationObserver.observe(shell, {
      attributes: true,
      attributeFilter: ["data-state", "aria-selected"],
      childList: true,
      subtree: true,
    });

    const handleResize = () => tabLists.forEach(scheduleIndicator);
    window.addEventListener("resize", handleResize, { passive: true });
    return () => {
      mutationObserver.disconnect();
      resizeObserver.disconnect();
      window.removeEventListener("resize", handleResize);
      scheduledFrames.forEach((frame) => window.cancelAnimationFrame(frame));
      tabLists.forEach((list) => {
        list.removeEventListener("scroll", handleTabListScroll);
        list.removeAttribute("data-admin-tab-motion-ready");
        list.style.removeProperty("--admin-tab-highlight-x");
        list.style.removeProperty("--admin-tab-highlight-width");
      });
    };
  }, [reduceMotion]);

  const getAdminLinkTarget = (target: EventTarget | null) => {
    if (!(target instanceof Element)) return null;
    const anchor = target.closest<HTMLAnchorElement>("a[href]");
    if (!anchor || anchor.target === "_blank" || anchor.hasAttribute("download")) {
      return null;
    }
    if (anchor.dataset.adminReloadDocument === "true") return null;
    const url = new URL(anchor.href, window.location.href);
    if (url.origin !== window.location.origin) return null;
    if (url.pathname !== "/admin" && !url.pathname.startsWith("/admin/")) {
      return null;
    }
    return `${url.pathname}${url.search}${url.hash}`;
  };

  const preloadAdminLink = (target: EventTarget | null) => {
    const href = getAdminLinkTarget(target);
    if (href) void preloadAdminRoute(href);
  };

  useEffect(() => {
    let ignore = false;

    async function loadThemeMenu() {
      if (!currentTheme) {
        setExtraMenuItems([]);
        return;
      }

      try {
        const response = await fetch(
          `/themes/${encodeURIComponent(currentTheme)}/komari-theme.json`,
          { cache: "no-cache" },
        );
        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const metadata = await response.json();
        if (ignore) return;
        const configuration = metadata?.configuration;
        if (!configuration) {
          setExtraMenuItems([]);
          return;
        }

        const configurationType = getThemeConfigurationType(configuration);
        let itemPath: string | null = null;
        if (
          configurationType === THEME_CONFIGURATION_MANAGED &&
          Array.isArray(configuration.data) &&
          configuration.data.length > 0
        ) {
          itemPath = "/admin/theme_managed";
        } else if (configurationType === THEME_CONFIGURATION_RAW) {
          itemPath = "/admin/theme_raw";
        } else if (configurationType === THEME_CONFIGURATION_REDIRECT) {
          itemPath = normalizeThemeRedirectTarget(configuration.data);
        }

        if (!itemPath) {
          setExtraMenuItems([]);
          return;
        }

        const rawLabel =
          resolveI18nText(configuration.name, currentLanguage) ??
          t("theme.manage_with_name", {
            name:
              resolveI18nText(metadata?.name, currentLanguage) ?? currentTheme,
          });
        setExtraMenuItems([
          {
            labelKey: rawLabel,
            rawLabel,
            path: itemPath,
            icon: configuration.icon || "Palette",
            reloadDocument:
              configurationType === THEME_CONFIGURATION_REDIRECT,
          },
        ]);
      } catch (error) {
        console.warn("Failed to load the active theme configuration menu:", error);
        if (!ignore) setExtraMenuItems([]);
      }
    }

    loadThemeMenu();
    return () => {
      ignore = true;
    };
  }, [currentLanguage, currentTheme, t]);

  useEffect(() => {
    const fetchVersionInfo = async () => {
      try {
        //const response = await fetch("/api/version");
        const data = await call("common:getVersion");
        setVersionInfo({
          hash: data.hash?.slice(0, 7),
          version: data.version,
          deployment: data.deployment || "unknown",
        });
      } catch (error) {
        console.error("Failed to fetch version info:", error);
      }
    };

    fetchVersionInfo();
  }, [call]);

  useEffect(() => {
    if (versionInfo?.deployment !== "linux") {
      setSelfUpdate(null);
      return;
    }
    let ignore = false;
    call("admin:getSelfUpdateStatus")
      .then((status: SelfUpdateCapability) => {
        if (!ignore) setSelfUpdate(status);
      })
      .catch((error) => {
        console.warn("Failed to load self-update capability:", error);
        if (!ignore) setSelfUpdate(null);
      });
    return () => {
      ignore = true;
    };
  }, [call, versionInfo?.deployment]);

  // 获取 GitHub releases 列表，并筛选出“比当前版本新的所有 release”
  useEffect(() => {
    let ignore = false;
    const currentVersion = (publicInfo as any)?.version || versionInfo?.version;
    const currentHash = versionInfo?.hash;
    if (!currentVersion) return;

    async function loadReleases() {
      try {
        const resp = await fetch(
          "https://api.github.com/repos/nuomiiiii/komari/releases?per_page=100",
          {
            headers: {
              Accept: "application/vnd.github+json",
            },
            cache: "no-cache",
          },
        );
        if (!resp.ok) throw new Error(`GitHub HTTP ${resp.status}`);
        const data: GithubReleaseInfo[] = await resp.json();
        if (ignore) return;
        const valid = (data || [])
          .filter((r) => !r.draft && !r.prerelease)
          .filter((r) => isReleaseNewer(r, currentVersion, currentHash));
        setReleasesSince(valid);
        setLatestRelease(valid.length ? valid[0] : null);
        setUpdateAvailable(valid.length > 0);
      } catch (e) {
        console.warn("加载 GitHub 最新发布失败:", e);
        if (!ignore) {
          setLatestRelease(null);
          setReleasesSince([]);
          setUpdateAvailable(false);
        }
      }
    }

    loadReleases();
    return () => {
      ignore = true;
    };
  }, [publicInfo, versionInfo]);
  // Handle responsive behavior
  useEffect(() => {
    const handleResize = () => setSidebarOpen(!isMobile);
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [isMobile]);

  // 根据路径自动展开子菜单（包含动态扩展项）
  useEffect(() => {
    const newState: { [key: string]: boolean } = {};
    menuItems.forEach((item) => {
      if (item.children) {
        newState[item.path] = item.children.some(
          (child: MenuItem) =>
            location.pathname === child.path ||
            location.pathname.startsWith(child.path),
        );
      }
    });
    setOpenSubMenus(newState);
  }, [location.pathname, menuItems]);

  // 侧边栏动画变体
  const sidebarVariants = reduceMotion
    ? {
        open: { x: 0, opacity: 1, transition: { duration: 0 } },
        closed: {
          x: isMobile ? "-100%" : 0,
          opacity: 1,
          transition: { duration: 0 },
        },
      }
    : isMobile
    ? {
        open: {
          x: 0,
          transition: MOBILE_SIDEBAR_OPEN_TRANSITION,
        },
        closed: {
          x: "-100%",
          transition: MOBILE_SIDEBAR_CLOSE_TRANSITION,
        },
      }
    : {
        open: {
          x: 0,
          opacity: 1,
          transition: {
            type: "spring",
            stiffness: 300,
            damping: 30,
          },
        },
        closed: {
          x: 0,
          opacity: 1,
          transition: {
            type: "spring",
            stiffness: 300,
            damping: 30,
          },
        },
      } as const;

  // 内容区域动画变体
  const contentVariants = {
    open: {
      opacity: 1,
      x: 0,
      transition: {
        duration: reduceMotion ? 0 : 0.3,
      },
    },
    closed: {
      opacity: 1,
      x: 0,
      transition: {
        duration: reduceMotion ? 0 : 0.3,
      },
    },
  };

  async function waitForUpdatedService(targetVersion: string, targetHash: string) {
    const deadline = Date.now() + 150_000;
    while (Date.now() < deadline) {
      await new Promise((resolve) => window.setTimeout(resolve, 2_000));
      try {
        const response = await fetch("/api/version", { cache: "no-store" });
        if (!response.ok) continue;
        const body = await response.json();
        const observed = body?.data ?? body;
        if (
          observed?.version === targetVersion &&
          String(observed?.hash || "").toLowerCase() ===
            targetHash.toLowerCase()
        ) {
          toast.success(t("common.self_update_succeeded", "更新成功，正在刷新页面"));
          window.setTimeout(() => window.location.reload(), 800);
          return;
        }
        const status = await callViaHTTP<unknown, SelfUpdateCapability>(
          "admin:getSelfUpdateStatus",
          {},
          { timeout: 5_000 },
        );
        if (
          status.last_result?.target_version === targetVersion &&
          ["rolled_back", "rollback_failed", "failed"].includes(
            status.last_result.status,
          )
        ) {
          const terminalError = new Error(
            status.last_result.status === "rolled_back"
              ? t(
                  "common.self_update_rolled_back",
                  "新版本未通过健康检查，已自动恢复原版本和数据",
                )
              : status.last_result.message ||
                  t("common.self_update_failed", "自动更新失败"),
          );
          terminalError.name = "SelfUpdateTerminalError";
          throw terminalError;
        }
      } catch (error) {
        if (error instanceof Error && error.name === "SelfUpdateTerminalError") {
          throw error;
        }
      }
    }
    throw new Error(
      t(
        "common.self_update_timeout",
        "更新状态确认超时，请稍后刷新页面查看当前版本",
      ),
    );
  }

  async function startSelfUpdate() {
    if (!latestRelease || updatePhase !== "idle") return;
    const targetVersion = latestRelease.tag_name || latestRelease.name || "";
    const targetHash = parseReleaseVersionHash(latestRelease.body);
    if (!targetVersion || !targetHash) {
      toast.error(t("common.self_update_metadata_missing", "发布版本缺少自动更新校验信息"));
      return;
    }
    setUpdatePhase("preparing");
    try {
      await callViaHTTP(
        "admin:startSelfUpdate",
        { version: targetVersion, version_hash: targetHash },
        { timeout: 360_000 },
      );
      setUpdatePhase("restarting");
      toast.info(t("common.self_update_restarting", "更新已校验，服务正在重启"));
      await waitForUpdatedService(targetVersion, targetHash);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : t("common.self_update_failed", "自动更新失败");
      toast.error(message);
      setUpdatePhase("idle");
    }
  }

  function logout() {
    window.open("/api/logout", "_self");
  }

  const renderIcon = (
    icon: string,
    labelKey: string,
    className?: string,
    active?: boolean,
  ) => {
    const link = /^(https?:\/\/|\/|\.\/|\.\.\/)/.test(icon);
    if (link) {
      return (
        <img
          src={icon}
          alt={t(labelKey)}
          style={{
            width: 16,
            height: 16,
            objectFit: "contain",
            opacity: active ? 1 : 0.7,
            filter: active ? "none" : "grayscale(20%)",
          }}
          className={className}
          loading="lazy"
        />
      );
    }
    const Icon = iconMap[icon];
    if (Icon) {
      return (
        <Icon
          className={className}
          style={{
            color: active ? "var(--accent-10)" : "var(--gray11)",
          }}
        />
      );
    }
    return (
      <span
        className={className}
        style={{
          width: 16,
          height: 16,
          display: "inline-block",
          borderRadius: 4,
          background: "var(--accent-8)",
        }}
      />
    );
  };

  const renderMenuItems = (items: MenuItem[]) =>
    items.map((item) => {
      const isOpen = openSubMenus[item.path];
      if (item.children?.length) {
        const submenu = (
          <Flex direction="column" className="ml-4 gap-1">
            {item.children.map((child) => (
              <SidebarItem
                key={child.path}
                to={child.path}
                icon={renderIcon(
                  child.icon,
                  child.labelKey,
                  "flex w-4 h-5 items-center justify-center",
                )}
                onClick={() => isMobile && setSidebarOpen(false)}
                newTab={child.newTab}
                reloadDocument={child.reloadDocument}
              >
                {child.rawLabel || t(child.labelKey)}
              </SidebarItem>
            ))}
          </Flex>
        );

        return (
          <div key={item.path}>
            <Flex
              className="p-2 gap-2 border-l-[4px] border-transparent cursor-pointer hover:bg-accent-3 rounded-md"
              align="center"
              onClick={() => {
                setOpenSubMenus((current) =>
                  toggleSingleSubMenu(current, item.path),
                );
              }}
            >
              {renderIcon(
                item.icon,
                item.labelKey,
                "flex w-4 h-5 items-center justify-center",
              )}
              <Text className="text-base" weight="medium" style={{ flex: 1 }}>
                {item.rawLabel || t(item.labelKey)}
              </Text>
              <ChevronDownIcon
                style={{
                  transform: isOpen ? "rotate(180deg)" : "rotate(0deg)",
                  transition: "transform 0.2s",
                }}
              />
            </Flex>
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={
                isOpen
                  ? { height: "auto", opacity: 1 }
                  : { height: 0, opacity: 0 }
              }
              transition={reduceMotion ? { duration: 0 } : { duration: 0.14 }}
              style={{ overflow: "hidden" }}
            >
              {submenu}
            </motion.div>
          </div>
        );
      }
      return (
        <SidebarItem
          key={item.path}
          to={item.path}
          icon={renderIcon(
            item.icon,
            item.labelKey,
            "flex w-4 h-5 items-center justify-center",
          )}
          onClick={() => isMobile && setSidebarOpen(false)}
          newTab={item.newTab}
          reloadDocument={item.reloadDocument}
        >
          {item.rawLabel || t(item.labelKey)}
        </SidebarItem>
      );
    });

  return (
    <>
      <Grid
        data-admin-shell
        onPointerOverCapture={(event) => preloadAdminLink(event.target)}
        onFocusCapture={(event) => preloadAdminLink(event.target)}
        onTouchStartCapture={(event) => preloadAdminLink(event.target)}
        columns={{
          initial: "1fr",
          md: sidebarOpen
            ? `${DESKTOP_SIDEBAR_WIDTH}px 1fr`
            : "0px 1fr",
        }} // 动态调整网格列
        rows={{
          initial: "auto minmax(0, 1fr)",
          md: "auto minmax(0, 1fr)",
        }}
        style={{
          height: "var(--app-viewport-height, 100vh)",
          width: "100%",
          overflow: "hidden",
          overscrollBehavior: "none",
          backgroundColor: "var(--accent-1)",
          position: "relative",
        }}
      >
        {/* Navbar */}
        <motion.nav
          className="md:col-span-2"
          initial={{ y: 0 }}
          animate={{ y: 0 }}
          transition={{ duration: 0.5, ease: "easeOut" }}
        >
          <Flex
            gap={isMobile ? "1" : "3"}
            p="2"
            justify="between"
            align="center"
            className="border-b-1"
          >
            <Flex
              gap={isMobile ? "2" : "3"}
              align="end"
              style={{ minHeight: "calc(32px * var(--scaling))" }}
            >
              <IconButton
                size="2"
                variant="ghost"
                data-testid="mobile-sidebar-trigger"
                aria-label={t("navigation.open")}
                onClick={() => setSidebarOpen(!sidebarOpen)}
                className="shrink-0"
                style={{
                  display: isMobile && sidebarOpen ? "none" : "flex",
                  color: "var(--gray-11)",
                }}
              >
                <TablerMenu2 className="h-6 w-6" />
              </IconButton>
              <a
                href="/"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-end leading-none"
              >
                <KomariBrand size={isMobile ? "sm" : "md"} />
              </a>
              {updateAvailable && releasesSince.length > 0 && (
                <Dialog.Root open={updateDialogOpen} onOpenChange={setUpdateDialogOpen}>
                  <Dialog.Trigger>
                    <button
                      type="button"
                      className="check-update flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--red-a3)] text-[var(--red-11)] transition-colors hover:bg-[var(--red-a4)]"
                      aria-label={t("common.update_available")}
                      title={t("common.update_available")}
                    >
                      <CircleFadingArrowUp
                        className="block h-5 w-5"
                        aria-hidden="true"
                      />
                    </button>
                  </Dialog.Trigger>
                  <Dialog.Content
                    className="max-h-[calc(100dvh-1.5rem)] overflow-hidden p-0"
                    style={{
                      width: isMobile
                        ? "calc(100vw - 1.5rem)"
                        : "min(920px, calc(100vw - 3rem))",
                      maxWidth: "none",
                    }}
                  >
                    <header className="border-b px-4 py-4 md:px-6 md:py-5">
                      <Dialog.Title className="flex items-center gap-2 text-lg font-semibold">
                        <CircleFadingArrowUp
                          className="h-5 w-5 shrink-0 text-[var(--red-11)]"
                          aria-hidden="true"
                        />
                        {t("common.update_available")}
                      </Dialog.Title>
                      <Dialog.Description className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                        <span>
                        {formatVersion(
                          (publicInfo as any)?.version || versionInfo?.version,
                          versionInfo?.hash,
                        )}
                      </span>
                        <ArrowRight className="h-4 w-4 shrink-0" aria-hidden="true" />
                        <span className="font-medium text-foreground">
                          {formatReleaseVersion(latestRelease)}
                        </span>
                      </Dialog.Description>
                    </header>

                    <div className="max-h-[min(62dvh,620px)] overflow-y-auto px-4 py-1 md:px-6">
                      <div className="divide-y text-sm">
                        {releasesSince.map((r) => (
                          <section key={r.html_url} className="py-5 first:pt-4">
                            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                              <h3 className="font-semibold text-foreground">
                                {formatReleaseVersion(r)}
                              </h3>
                              {r.published_at && (
                                <div className="text-xs text-muted-foreground">
                                  {new Date(r.published_at).toLocaleString()}
                                </div>
                              )}
                            </div>
                            <ReleaseMarkdown body={r.body} />
                          </section>
                        ))}
                      </div>
                    </div>

                    <footer className="flex items-center justify-end gap-2 border-t bg-[var(--gray-a2)] px-4 py-3 md:px-6 md:py-4">
                      <Dialog.Close>
                        <Button variant="soft" color="gray">
                          {t("cancel", "取消")}
                        </Button>
                      </Dialog.Close>
                      {versionInfo?.deployment === "linux" &&
                      selfUpdate?.supported &&
                      parseReleaseVersionHash(latestRelease?.body) ? (
                        <Button
                          color="red"
                          onClick={startSelfUpdate}
                          disabled={updatePhase !== "idle"}
                        >
                          {updatePhase === "idle" ? (
                            <Download size={16} />
                          ) : (
                            <LoaderCircle size={16} className="animate-spin" />
                          )}
                          {updatePhase === "preparing"
                            ? t("common.self_update_preparing", "正在下载并校验")
                            : updatePhase === "restarting"
                              ? t("common.self_update_restarting_short", "正在更新")
                              : t("common.update_now", "立即更新")}
                        </Button>
                      ) : (
                        <a
                          href={latestRelease?.html_url}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          <Button variant="soft">
                            <ExternalLink size={16} />
                            GitHub
                          </Button>
                        </a>
                      )}
                    </footer>
                  </Dialog.Content>
                </Dialog.Root>
              )}
            </Flex>
            <Flex
              gap={isMobile ? "1" : "3"}
              align="center"
              overflowX="auto"
              className="shrink-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            >
              <ThemeSwitch />
              <ColorSwitch />
              <LanguageSwitch />
              <IconButton variant="soft" color="orange" onClick={logout}>
                <ExitIcon />
              </IconButton>
            </Flex>
          </Flex>
        </motion.nav>

        {/* Sidebar */}
        <AnimatePresence>
          {isMobile && sidebarOpen && (
            <motion.button
              key="mobile-sidebar-backdrop"
              type="button"
              aria-label={t("close", "关闭导航")}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: reduceMotion ? 0 : 0.2 }}
              onClick={() => setSidebarOpen(false)}
              className="absolute inset-0 z-[49] touch-none cursor-default border-0 bg-[var(--black-a6)] p-0"
            />
          )}
          <motion.div
            key="admin-sidebar"
            variants={sidebarVariants}
            initial={false}
            animate={sidebarOpen ? "open" : "closed"}
            exit="closed"
            style={{
              backgroundColor: "var(--accent-1)",
              width: isMobile
                ? MOBILE_SIDEBAR_WIDTH
                : sidebarOpen
                  ? `${DESKTOP_SIDEBAR_WIDTH}px`
                  : "0px",
              height: "100%",
              position: isMobile ? "absolute" : "relative",
              top: isMobile ? 0 : undefined,
              left: isMobile ? 0 : undefined,
              zIndex: isMobile ? 50 : 1,
              overflowY: "auto",
              overflowX: "hidden",
              overscrollBehaviorY: "contain",
              WebkitOverflowScrolling: "touch",
              willChange: isMobile ? "transform" : undefined,
              backfaceVisibility: isMobile ? "hidden" : undefined,
              pointerEvents: isMobile && !sidebarOpen ? "none" : "auto",
            }}
          >
            <Flex
              gap="3"
              className="p-2 border-r-1"
              direction="column"
              justify="start"
              align="start"
              style={{
                height: "100%",
                minWidth: isMobile ? "100%" : `${DESKTOP_SIDEBAR_WIDTH}px`,
              }}
            >
              {/* 关闭按钮 */}
              <IconButton
                variant="soft"
                data-testid="mobile-sidebar-close"
                aria-label={t("close", "关闭导航")}
                style={{
                  display: isMobile ? "flex" : "none",
                  margin: "8px 0px 0px 8px",
                }}
                onClick={() => setSidebarOpen(false)}
              >
                <Cross1Icon />
              </IconButton>
              {/* 侧边连链接 */}
              <Flex
                direction="column"
                gap="1"
                className="h-full md:mt-0 mt-6"
                style={{ width: "100%" }}
              >
                <Flex direction="column" gap="1" style={{ width: "100%" }}>
                  {renderMenuItems(menuItems)}
                </Flex>
                <Flex
                  direction="column"
                  gap="1"
                  className="mt-auto border-t border-[var(--gray-a5)] pt-2"
                  style={{ width: "100%" }}
                >
                  {renderMenuItems(footerMenuItems)}
                  {currentVersion && currentReleaseURL && (
                      <a
                        data-testid="sidebar-version"
                        href={currentReleaseURL}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="group flex min-h-10 w-full items-center gap-2 rounded-md border-l-[4px] border-transparent p-2 text-[var(--gray-12)] transition-colors duration-200 hover:bg-[var(--accent-a3)] hover:text-[var(--accent-11)] focus-visible:bg-[var(--accent-a3)] focus-visible:text-[var(--accent-11)]"
                        title={`${t("common.version", "版本")}：${formatVersion(
                          currentVersion,
                          versionInfo?.hash,
                        )}`}
                      >
                        <span className="flex h-5 w-4 shrink-0 items-center justify-center">
                          <Github
                            className="h-4 w-4"
                            strokeWidth={1.5}
                            aria-hidden="true"
                          />
                        </span>
                        <SidebarVersionLabel
                          version={currentVersion}
                          hash={versionInfo?.hash}
                        />
                      </a>
                    )}
                </Flex>
              </Flex>
            </Flex>
          </motion.div>
        </AnimatePresence>

        {/* Main Content */}
        <motion.div
          variants={contentVariants}
          animate={sidebarOpen ? "open" : "closed"}
          style={{
            backgroundColor: "var(--accent-3)",
            display: "block",
            height: "100%", // Ensure the container takes full height
            minHeight: 0,
            minWidth: 0,
            maxWidth: "100%",
            overflow: "hidden", // Prevent this container from scrolling
          }}
        >
          <div
            data-admin-scroll-container
            style={{
              backgroundColor: "var(--accent-1)",
              height: "100%",
              borderRadius: "0",
              padding: isMobile ? "8px" : "16px",
              overflowY: isMobile && sidebarOpen ? "hidden" : "auto",
              overscrollBehaviorY: "contain",
              WebkitOverflowScrolling: "touch",
              boxSizing: "border-box",
            }}
          >
            <Callout.Root mb="2" hidden={ishttps} color="red">
              <Callout.Icon>
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="24"
                  viewBox="0 0 24 24"
                >
                  <path
                    fill="currentColor"
                    d="M10.03 3.659c.856-1.548 3.081-1.548 3.937 0l7.746 14.001c.83 1.5-.255 3.34-1.969 3.34H4.254c-1.715 0-2.8-1.84-1.97-3.34zM12.997 17A.999.999 0 1 0 11 17a.999.999 0 0 0 1.997 0m-.259-7.853a.75.75 0 0 0-1.493.103l.004 4.501l.007.102a.75.75 0 0 0 1.493-.103l-.004-4.502z"
                  />
                </svg>
              </Callout.Icon>
              <Callout.Text>
                <Text size="2" weight="medium">
                  {t("warn_https")}
                </Text>
              </Callout.Text>
            </Callout.Root>
            <div data-admin-page-content style={{ minHeight: "100%" }}>
              {content}
            </div>
          </div>
        </motion.div>
      </Grid>
    </>
  );
};

export default AdminPanelBar;

// 侧边栏项目组件
const SidebarItem = ({
  to,
  onClick,
  icon,
  children,
  newTab,
  reloadDocument,
}: {
  to: string;
  onClick: () => void;
  icon: ReactNode;
  children: ReactNode;
  newTab?: boolean;
  reloadDocument?: boolean;
}) => {
  const location = useLocation();
  const isExternalLink = to.startsWith("http://") || to.startsWith("https://");
  const isActive =
    !isExternalLink &&
    to !== "/" &&
    (location.pathname === to ||
      (to !== "/admin" && location.pathname.startsWith(to)));
  const openInNewTab = newTab === true || (isExternalLink && newTab !== false);
  const preload = () => {
    if (!isExternalLink && !reloadDocument) void preloadAdminRoute(to);
  };

  if (openInNewTab || reloadDocument) {
    return (
      <a
        href={to}
        data-admin-reload-document={reloadDocument ? "true" : undefined}
        onClick={onClick}
        target={openInNewTab ? "_blank" : undefined}
        rel={openInNewTab ? "noopener noreferrer" : undefined}
        className="group transition-colors duration-200 hover:bg-accent-3 rounded-md"
      >
        <Flex
          className="p-2 gap-2 h-full"
          align="center"
          style={{
            borderLeft: "4px solid transparent",
            borderRadius: "6px",
            backgroundColor: "transparent",
            color: "inherit",
            transition: "background-color 0.2s, border-color 0.2s",
          }}
        >
          <span
            style={{
              color: "inherit",
              opacity: 0.7,
            }}
            className="flex w-4 h-5 items-center justify-center"
          >
            {icon}
          </span>
          <Text className="text-base" weight="medium" style={{ flex: 1 }}>
            {children}
          </Text>
        </Flex>
      </a>
    );
  }

  return (
    <Link
      to={to}
      onPointerEnter={preload}
      onFocus={preload}
      onTouchStart={preload}
      onClick={onClick}
      className="group transition-colors duration-200 hover:bg-accent-3 rounded-md"
    >
      <Flex
        className="p-2 gap-2"
        align="center"
        style={{
          borderLeft: isActive
            ? "4px solid var(--accent-8)"
            : "4px solid transparent",
          borderRadius: "6px",
          backgroundColor: isActive ? "var(--accent-4)" : "transparent",
          color: isActive ? "var(--accent-10)" : "inherit",
          transition: "background-color 0.2s, border-color 0.2s",
        }}
      >
        <span
          style={{
            color: isActive ? "var(--accent-10)" : "inherit",
            opacity: isActive ? 1 : 0.7,
          }}
          className="flex w-4 h-5 items-center justify-center"
        >
          {icon}
        </span>
        <Text
          className="text-base"
          weight={isActive ? "bold" : "medium"}
          style={{ flex: 1 }}
        >
          {children}
        </Text>
      </Flex>
    </Link>
  );
};
