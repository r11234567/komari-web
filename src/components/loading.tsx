import { type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import "./Loading.css";

type LoadingProps = {
  text?: string;
  children?: ReactNode;
  size?: number;
  compact?: boolean;
};

const Loading = ({ text, children, size, compact = false }: LoadingProps) => {
  const { t } = useTranslation();
  const diameter = compact ? 16 : Math.max(16, (size ?? 5) * 10);

  return (
    <span
      role="status"
      aria-live="polite"
      className={`km-loading ${compact ? "inline-flex items-center gap-2 align-middle" : "flex flex-col items-center justify-center gap-2 py-4"}`}
    >
      <span
        className="loader shrink-0"
        style={{ width: diameter, height: diameter }}
        aria-hidden="true"
      >
        <svg className="circular" viewBox="25 25 50 50">
          <circle
            className="path"
            cx="50"
            cy="50"
            r="20"
            fill="none"
            strokeWidth="2"
            strokeMiterlimit="10"
          />
        </svg>
      </span>
      <span className={compact ? "text-sm" : "text-lg font-bold"}>
        {t("loading")}
      </span>
      {text && <span className="text-sm text-muted-foreground text-center">{text}</span>}
      {children}
    </span>
  );
};

export default Loading;
