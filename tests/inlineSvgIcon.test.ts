import assert from "node:assert/strict";
import test from "node:test";
import {
  isAllowedInlineSvgUrl,
  isSafeIconImageUrl,
  sanitizeSvg,
} from "../src/utils/inlineSvgSanitizer.ts";

interface MockAttr {
  name: string;
  localName: string;
  prefix: string | null;
  value: string;
}

class MockElement {
  nodeType = 1;
  tagName: string;
  localName: string;
  prefix: string | null;
  namespaceURI: string | null;
  attributes: MockAttr[] = [];
  childNodes: Array<MockElement | MockText> = [];

  constructor(
    namespaceURI: string | null,
    qualifiedName: string,
    localName?: string,
    prefix?: string | null,
  ) {
    this.namespaceURI = namespaceURI;
    this.tagName = qualifiedName;
    this.localName = localName ?? qualifiedName;
    this.prefix = prefix ?? null;
  }

  setAttribute(name: string, value: string): void {
    const colon = name.indexOf(":");
    const prefix = colon > 0 ? name.slice(0, colon) : null;
    const localName = colon > 0 ? name.slice(colon + 1) : name;
    const existing = this.attributes.find((attr) => attr.name === name);
    if (existing) {
      existing.value = value;
      return;
    }
    this.attributes.push({ name, localName, prefix, value });
  }

  appendChild(node: MockElement | MockText): void {
    this.childNodes.push(node);
  }

  get outerHTML(): string {
    const attrs = this.attributes
      .map((attr) => ` ${attr.name}="${escapeXml(attr.value)}"`)
      .join("");
    const children = this.childNodes.map((child) => child.outerHTML).join("");
    return `<${this.tagName}${attrs}>${children}</${this.tagName}>`;
  }
}

class MockText {
  nodeType = 3;
  textContent: string;
  constructor(text: string) {
    this.textContent = text;
  }
  get outerHTML(): string {
    return escapeXml(this.textContent);
  }
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function decodeXmlEntities(raw: string): string {
  return raw.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|amp|lt|gt|quot|apos);/g, (_, entity: string) => {
    if (entity.startsWith("#x")) return String.fromCodePoint(parseInt(entity.slice(2), 16));
    if (entity.startsWith("#")) return String.fromCodePoint(parseInt(entity.slice(1), 10));
    switch (entity) {
      case "amp": return "&";
      case "lt": return "<";
      case "gt": return ">";
      case "quot": return '"';
      case "apos": return "'";
      default: return `&${entity};`;
    }
  });
}

function parseXmlSvg(source: string): { documentElement: MockElement | null; querySelector: (sel: string) => MockElement | null } {
  const tokenRe = /<(\/?)([A-Za-z_][\w:.-]*)([^>]*?)(\/?)>|([^<]+)/g;
  const stack: Array<{ el: MockElement; nsMap: Record<string, string> }> = [];
  let root: MockElement | null = null;
  let parserError: MockElement | null = null;

  for (const match of source.matchAll(tokenRe)) {
    if (match[5] !== undefined) {
      if (stack.length > 0) {
        stack[stack.length - 1].el.appendChild(new MockText(decodeXmlEntities(match[5])));
      }
      continue;
    }
    const isClosing = match[1] === "/";
    const qname = match[2];
    const attrRaw = match[3] || "";
    const selfClosing = match[4] === "/";
    if (isClosing) {
      const top = stack.pop();
      if (!top || top.el.tagName !== qname) {
        parserError = new MockElement(null, "parsererror");
        break;
      }
      continue;
    }

    const parentNs = stack.length > 0 ? { ...stack[stack.length - 1].nsMap } : {};
    const parsedAttrs: MockAttr[] = [];
    const attrRe = /([A-Za-z_][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
    for (const aMatch of attrRaw.matchAll(attrRe)) {
      const name = aMatch[1];
      const value = decodeXmlEntities(aMatch[2] ?? aMatch[3] ?? "");
      if (name === "xmlns") {
        parentNs[""] = value;
      } else if (name.startsWith("xmlns:")) {
        parentNs[name.slice(6)] = value;
        parsedAttrs.push({ name, localName: name.slice(6), prefix: "xmlns", value });
        continue;
      }
      const colon = name.indexOf(":");
      const prefix = colon > 0 ? name.slice(0, colon) : null;
      const localName = colon > 0 ? name.slice(colon + 1) : name;
      parsedAttrs.push({ name, localName, prefix, value });
    }

    const colon = qname.indexOf(":");
    const prefix = colon > 0 ? qname.slice(0, colon) : null;
    const localName = colon > 0 ? qname.slice(colon + 1) : qname;
    const ns = prefix ? (parentNs[prefix] ?? null) : (parentNs[""] ?? null);
    const el = new MockElement(ns, qname, localName, prefix);
    el.attributes = parsedAttrs;

    if (stack.length === 0) {
      root = el;
    } else {
      stack[stack.length - 1].el.appendChild(el);
    }
    if (!selfClosing) {
      stack.push({ el, nsMap: parentNs });
    }
  }

  return {
    documentElement: root,
    querySelector: (selector: string) => (selector === "parsererror" ? parserError : null),
  };
}

function makeEnv() {
  return {
    DOMParserCtor: class {
      parseFromString(source: string) {
        return parseXmlSvg(source);
      }
    } as unknown as typeof DOMParser,
    XMLSerializerCtor: class {
      serializeToString(node: MockElement) {
        return node.outerHTML;
      }
    } as unknown as typeof XMLSerializer,
    doc: {
      createElementNS(ns: string, tag: string) {
        return new MockElement(ns, tag, tag, null);
      },
      createTextNode(text: string) {
        return new MockText(text);
      },
    } as unknown as Document,
  };
}

test("isAllowedInlineSvgUrl enforces same-origin HTTP(S) SVG URLs only", () => {
  const origin = "https://panel.example.com";
  assert.equal(isAllowedInlineSvgUrl("/api/admin/plugin/demo/icon.svg", origin), true);
  assert.equal(isAllowedInlineSvgUrl("https://panel.example.com/assets/icon.svg?v=1", origin), true);
  assert.equal(isAllowedInlineSvgUrl("https://evil.example.net/icon.svg", origin), false);
  assert.equal(isAllowedInlineSvgUrl("//evil.example.net/icon.svg", origin), false);
  assert.equal(isAllowedInlineSvgUrl("data:image/svg+xml,<svg/>", origin), false);
  assert.equal(isAllowedInlineSvgUrl("javascript:alert(1)//.svg", origin), false);
  assert.equal(isAllowedInlineSvgUrl("/api/admin/plugin/demo/icon.png", origin), false);

  assert.equal(isSafeIconImageUrl("javascript:alert(1)", origin), false);
  assert.equal(isSafeIconImageUrl("data:text/html,<script>", origin), false);
  assert.equal(isSafeIconImageUrl("/api/admin/plugin/demo/icon.png", origin), true);
});

test("sanitizeSvg blocks namespace-prefixed href, entity whitespace, style escapes, foreignObject, and unsafe url()", () => {
  const env = makeEnv();
  const hostile = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:x="http://www.w3.org/1999/xlink" xmlns:html="http://www.w3.org/1999/xhtml" viewBox="0 0 24 24" onclick="alert(1)" style="background:\\75 rl(https://evil.test)">
    <script>alert(1)</script>
    <style>path { fill: url(https://evil.test/leak); }</style>
    <a x:href="java&#x0a;script:alert(1)"><path d="M0 0"/></a>
    <use x:href="data:image/svg+xml,#x"/>
    <foreignObject><html:script>alert(1)</html:script></foreignObject>
    <animate attributeName="href" to="javascript:alert(1)"/>
    <html:img src="x" onerror="alert(1)"/>
    <path d="M1 1 L10 10" x:href="java&#x09;script:alert(2)" fill="url(\\75 rl(https://evil.test))" stroke="url(#grad-1)" clip-path="url(https://evil.test/#clip)"/>
    <defs><linearGradient id="grad-1"><stop offset="0%" stop-color="#112233"/></linearGradient></defs>
  </svg>`;

  const cleaned = sanitizeSvg(hostile, env);
  assert.ok(cleaned);
  assert.doesNotMatch(cleaned, /script|style=|onclick|onerror|href|foreignObject|animate|<use|<a[\s>]|evil\.test|javascript:|data:/i);
  assert.match(cleaned, /<path[^>]*d="M1 1 L10 10"/);
  assert.match(cleaned, /stroke="url\(#grad-1\)"/);
  assert.match(cleaned, /<linearGradient id="grad-1">/);
  assert.match(cleaned, /stop-color="#112233"/);
});

test("sanitizeSvg preserves clean SVG icons and local gradient/clip references", () => {
  const env = makeEnv();
  const valid = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none">
    <title>Demo Icon</title>
    <defs><clipPath id="clip_0"><rect x="0" y="0" width="24" height="24"/></clipPath></defs>
    <g clip-path="url(#clip_0)"><path d="M4 12 L20 12" stroke="currentColor" stroke-width="2"/></g>
  </svg>`;

  const cleaned = sanitizeSvg(valid, env);
  assert.ok(cleaned);
  assert.match(cleaned, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 24 24" fill="none" width="100%" height="100%"/);
  assert.match(cleaned, /<title>Demo Icon<\/title>/);
  assert.match(cleaned, /<clipPath id="clip_0">/);
  assert.match(cleaned, /clip-path="url\(#clip_0\)"/);
  assert.match(cleaned, /stroke="currentColor"/);
});
