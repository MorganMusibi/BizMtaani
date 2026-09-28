import { useEffect } from "react";

// Set to your real production domain, no trailing slash.
export const SITE_URL = "https://bizmtaani.com";

export interface PageMeta {
  title: string;
  description: string;
  canonicalPath?: string;
  image?: string;
  noindex?: boolean;
  jsonLd?: Record<string, unknown> | null;
}

function setMeta(attr: "name" | "property", key: string, content: string): () => void {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
  const created = !el;
  const previous = el ? el.getAttribute("content") : null;
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute("content", content);
  return () => {
    if (!el) return;
    if (created) el.remove();
    else if (previous !== null) el.setAttribute("content", previous);
  };
}

function setCanonical(href: string): () => void {
  let el = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  const created = !el;
  const previous = el ? el.getAttribute("href") : null;
  if (!el) {
    el = document.createElement("link");
    el.setAttribute("rel", "canonical");
    document.head.appendChild(el);
  }
  el.setAttribute("href", href);
  return () => {
    if (!el) return;
    if (created) el.remove();
    else if (previous !== null) el.setAttribute("href", previous);
  };
}

function setJsonLd(data: Record<string, unknown>): () => void {
  const el = document.createElement("script");
  el.type = "application/ld+json";
  el.text = JSON.stringify(data);
  document.head.appendChild(el);
  return () => el.remove();
}

export function usePageMeta(meta: PageMeta | null) {
  const key = meta ? JSON.stringify(meta) : "";

  useEffect(() => {
    if (!meta) return;
    const previousTitle = document.title;
    document.title = meta.title;

    const undo: Array<() => void> = [
      setMeta("name", "description", meta.description),
      setMeta("name", "robots", meta.noindex ? "noindex, follow" : "index, follow"),
      setMeta("property", "og:title", meta.title),
      setMeta("property", "og:description", meta.description),
      setMeta("name", "twitter:title", meta.title),
      setMeta("name", "twitter:description", meta.description),
    ];
    if (meta.image) {
      undo.push(
        setMeta("property", "og:image", meta.image),
        setMeta("name", "twitter:image", meta.image)
      );
    }
    if (meta.canonicalPath) {
      const url = `${SITE_URL}${meta.canonicalPath}`;
      undo.push(setCanonical(url), setMeta("property", "og:url", url));
    }
    if (meta.jsonLd) undo.push(setJsonLd(meta.jsonLd));

    return () => {
      document.title = previousTitle;
      undo.forEach((fn) => fn());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
      }
