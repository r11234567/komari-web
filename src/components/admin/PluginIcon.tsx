import { useState, type CSSProperties } from "react";
import { Blocks } from "lucide-react";
import type { PluginInfo } from "@/types/plugin";
import { getBuiltInIcon, resolvePluginIcon } from "@/utils/iconHelper";

export default function PluginIcon({ plugin, size, className, style }: {
  plugin: Pick<PluginInfo, "short" | "icon">;
  size: number;
  className?: string;
  style?: CSSProperties;
}) {
  const src = resolvePluginIcon(plugin.short, plugin.icon);
  const [failedSrc, setFailedSrc] = useState<string>();
  const BuiltIn = getBuiltInIcon(src);
  if (BuiltIn) return <BuiltIn size={size} className={className} style={style} aria-hidden />;
  if (!src || failedSrc === src) {
    return <Blocks size={size} className={className} style={style} aria-hidden />;
  }
  return <img src={src} alt="" className={`${className ?? ""} object-contain`}
    width={size} height={size} style={style} onError={() => setFailedSrc(src)} />;
}
