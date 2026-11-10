import { useSyncExternalStore } from "react";

const subscribe = (listener: () => void) => {
  document.addEventListener("visibilitychange", listener);
  return () => document.removeEventListener("visibilitychange", listener);
};
const visible = () => typeof document === "undefined" || document.visibilityState !== "hidden";

export const usePageVisible = () => useSyncExternalStore(subscribe, visible, () => true);
