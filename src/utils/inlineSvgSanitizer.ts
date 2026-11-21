const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

const ALLOWED_ELEMENTS: ReadonlyMap<string, string> = new Map([
  ["svg", "svg"],
  ["g", "g"],
  ["path", "path"],
  ["circle", "circle"],
  ["ellipse", "ellipse"],
  ["rect", "rect"],
  ["line", "line"],
  ["polyline", "polyline"],
  ["polygon", "polygon"],
  ["defs", "defs"],
  ["clippath", "clipPath"],
  ["mask", "mask"],
  ["lineargradient", "linearGradient"],
  ["radialgradient", "radialGradient"],
  ["stop", "stop"],
  ["title", "title"],
  ["desc", "desc"],
]);

const ALLOWED_ATTRIBUTES: ReadonlyMap<string, string> = new Map([
  ["viewbox", "viewBox"],
  ["fill", "fill"],
  ["fill-rule", "fill-rule"],
  ["fill-opacity", "fill-opacity"],
  ["stroke", "stroke"],
  ["stroke-width", "stroke-width"],
  ["stroke-linecap", "stroke-linecap"],
  ["stroke-linejoin", "stroke-linejoin"],
  ["stroke-opacity", "stroke-opacity"],
  ["stroke-dasharray", "stroke-dasharray"],
  ["stroke-dashoffset", "stroke-dashoffset"],
  ["stroke-miterlimit", "stroke-miterlimit"],
  ["opacity", "opacity"],
  ["d", "d"],
  ["cx", "cx"],
  ["cy", "cy"],
  ["r", "r"],
  ["rx", "rx"],
  ["ry", "ry"],
  ["x", "x"],
  ["y", "y"],
  ["x1", "x1"],
  ["y1", "y1"],
  ["x2", "x2"],
  ["y2", "y2"],
  ["width", "width"],
  ["height", "height"],
  ["points", "points"],
  ["transform", "transform"],
  ["id", "id"],
  ["offset", "offset"],
  ["stop-color", "stop-color"],
  ["stop-opacity", "stop-opacity"],
  ["gradientunits", "gradientUnits"],
  ["gradienttransform", "gradientTransform"],
  ["clip-path", "clip-path"],
  ["clip-rule", "clip-rule"],
  ["mask", "mask"],
  ["color", "color"],
  ["preserveaspectratio", "preserveAspectRatio"],
  ["aria-hidden", "aria-hidden"],
  ["focusable", "focusable"],
  ["role", "role"],
]);

const FRAGMENT_URL_RE = /^url\(#[-a-zA-Z0-9_:.]+\)$/;
const SAFE_ID_RE = /^[A-Za-z_][-A-Za-z0-9_:.]*$/;
const SAFE_COLOR_FUNC_RE = /^(?:rgba?|hsla?)\([0-9.,%\s/+-]+\)$/i;
const SAFE_NAMED_OR_HEX_RE = /^(?:#[0-9a-fA-F]{3,8}|[a-zA-Z]{1,32})$/;

function hasDisallowedControlOrEscape(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (
      code <= 0x08 ||
      code === 0x0b ||
      code === 0x0c ||
      (code >= 0x0e && code <= 0x1f) ||
      code === 0x7f ||
      code === 0x5c /* \ */ ||
      code === 0x3c /* < */ ||
      code === 0x3e /* > */
    ) {
      return true;
    }
  }
  return false;
}

function stripAsciiWhitespaceAndControl(value: string): string {
  let out = "";
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code <= 0x20 || code === 0x7f) continue;
    out += value[i];
  }
  return out;
}

export interface SvgSanitizerEnv {
  DOMParserCtor?: typeof DOMParser;
  XMLSerializerCtor?: typeof XMLSerializer;
  doc?: Pick<Document, "createElementNS" | "createTextNode">;
}

export const isSvgUrl = (src: string): boolean => /\.svg$/i.test(src.split(/[?#]/, 1)[0]);

export const isSafeIconImageUrl = (src: string, pageOrigin?: string): boolean => {
  const origin = pageOrigin ?? (typeof window !== "undefined" ? window.location.origin : "");
  const trimmed = src.trim();
  if (!trimmed || !origin) return false;
  try {
    const parsed = new URL(trimmed, origin);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
};

export const isAllowedInlineSvgUrl = (src: string, pageOrigin?: string): boolean => {
  const origin = pageOrigin ?? (typeof window !== "undefined" ? window.location.origin : "");
  const trimmed = src.trim();
  if (!trimmed || !origin) return false;
  try {
    const parsed = new URL(trimmed, origin);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return false;
    }
    return parsed.origin === origin && /\.svg$/i.test(parsed.pathname);
  } catch {
    return false;
  }
};

function sanitizeAttributeValue(attrName: string, rawValue: string): string | null {
  if (hasDisallowedControlOrEscape(rawValue)) {
    return null;
  }
  const trimmed = rawValue.trim();
  // Strip all ASCII whitespace/control characters so scheme or url() checks
  // cannot be evaded with embedded tabs, newlines, or character references.
  const compact = stripAsciiWhitespaceAndControl(trimmed);
  const lowerCompact = compact.toLowerCase();

  if (
    lowerCompact.includes("javascript:") ||
    lowerCompact.includes("vbscript:") ||
    lowerCompact.includes("data:") ||
    lowerCompact.includes("expression(")
  ) {
    return null;
  }

  if (attrName === "id") {
    return SAFE_ID_RE.test(trimmed) ? trimmed : null;
  }

  if (attrName === "clip-path" || attrName === "mask") {
    if (lowerCompact === "none") return "none";
    return FRAGMENT_URL_RE.test(compact) ? compact : null;
  }

  if (attrName === "fill" || attrName === "stroke" || attrName === "stop-color" || attrName === "color") {
    if (lowerCompact === "") return null;
    if (FRAGMENT_URL_RE.test(compact)) {
      return attrName === "fill" || attrName === "stroke" ? compact : null;
    }
    if (SAFE_NAMED_OR_HEX_RE.test(trimmed) || SAFE_COLOR_FUNC_RE.test(trimmed)) {
      return trimmed;
    }
    return null;
  }

  if (lowerCompact.includes("url(") || lowerCompact.includes(":")) {
    return null;
  }

  return trimmed;
}

function copySafeChildren(
  sourceParent: Element,
  targetParent: Element,
  targetDoc: Pick<Document, "createElementNS" | "createTextNode">,
): void {
  const sourceTag = sourceParent.localName?.toLowerCase();
  const isTextOnlyTag = sourceTag === "title" || sourceTag === "desc";

  for (const child of Array.from(sourceParent.childNodes)) {
    if (child.nodeType === 3 /* TEXT_NODE */) {
      if (isTextOnlyTag && child.textContent) {
        targetParent.appendChild(targetDoc.createTextNode(child.textContent));
      }
      continue;
    }
    if (child.nodeType !== 1 /* ELEMENT_NODE */) {
      continue;
    }
    const childEl = child as Element;
    if (childEl.namespaceURI && childEl.namespaceURI !== SVG_NAMESPACE) {
      continue;
    }
    const tagLower = childEl.localName?.toLowerCase();
    const canonicalTag = tagLower ? ALLOWED_ELEMENTS.get(tagLower) : undefined;
    if (!canonicalTag || canonicalTag === "svg") {
      // Disallowed elements (e.g. script, style, a, use, foreignObject, SMIL)
      // are dropped along with their entire subtree.
      continue;
    }
    const cleanChild = targetDoc.createElementNS(SVG_NAMESPACE, canonicalTag);
    copySafeAttributes(childEl, cleanChild);
    copySafeChildren(childEl, cleanChild, targetDoc);
    targetParent.appendChild(cleanChild);
  }
}

function copySafeAttributes(source: Element, target: Element): void {
  for (const attribute of Array.from(source.attributes)) {
    // Reject all namespace-prefixed attributes (e.g. xlink:href, x:href, xmlns:*)
    if (attribute.prefix || attribute.name.includes(":")) {
      continue;
    }
    const local = (attribute.localName || attribute.name).toLowerCase();
    const canonicalAttr = ALLOWED_ATTRIBUTES.get(local);
    if (!canonicalAttr) {
      continue;
    }
    const safeValue = sanitizeAttributeValue(canonicalAttr, attribute.value);
    if (safeValue !== null) {
      target.setAttribute(canonicalAttr, safeValue);
    }
  }
}

export const sanitizeSvg = (source: string, env: SvgSanitizerEnv = {}): string | null => {
  const ParserCtor = env.DOMParserCtor ?? (typeof DOMParser !== "undefined" ? DOMParser : undefined);
  const targetDoc = env.doc ?? (typeof document !== "undefined" ? document : undefined);
  if (!ParserCtor || !targetDoc) {
    return null;
  }

  const parsed = new ParserCtor().parseFromString(source, "image/svg+xml");
  const root = parsed.documentElement;
  if (
    !root ||
    root.localName?.toLowerCase() !== "svg" ||
    (root.namespaceURI && root.namespaceURI !== SVG_NAMESPACE) ||
    parsed.querySelector("parsererror")
  ) {
    return null;
  }

  const cleanRoot = targetDoc.createElementNS(SVG_NAMESPACE, "svg");
  cleanRoot.setAttribute("xmlns", SVG_NAMESPACE);
  copySafeAttributes(root, cleanRoot);
  copySafeChildren(root, cleanRoot, targetDoc);

  cleanRoot.setAttribute("width", "100%");
  cleanRoot.setAttribute("height", "100%");

  const SerializerCtor =
    env.XMLSerializerCtor ?? (typeof XMLSerializer !== "undefined" ? XMLSerializer : undefined);
  if (SerializerCtor) {
    return new SerializerCtor().serializeToString(cleanRoot);
  }
  return cleanRoot.outerHTML ?? null;
};
