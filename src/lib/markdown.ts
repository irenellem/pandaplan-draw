import { Marked, type Tokens } from 'marked';

/**
 * Markdown → HTML for the notes drawer.
 * - Raw HTML in the source is escaped and shown as text, never rendered.
 * - Link targets are limited to http(s), mailto, #anchors and relative paths. javascript:, data: and
 *   other schemes become plain text.
 * - Images render only from data:image/*. Remote images show as a labelled link, because the CSP
 *   blocks them anyway.
 */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function safeHref(href: string): string | null {
  const h = href.trim();
  // Strip whitespace/control chars browsers ignore when parsing a scheme.
  const probe = h.replace(/[\u0000- ]/g, '').toLowerCase();
  if (/^(https?:|mailto:)/.test(probe)) return h;
  if (/^[a-z][a-z0-9+.-]*:/.test(probe)) return null; // any other scheme (javascript:, data:, vbscript:, file:)
  return h; // relative, #anchor, ?query
}

const marked = new Marked({
  gfm: true,
  breaks: true,
  async: false,
  renderer: {
    html({ text }: Tokens.HTML | Tokens.Tag): string {
      return escapeHtml(text);
    },
    link({ href, title, tokens }: Tokens.Link): string {
      const inner = this.parser.parseInline(tokens);
      const safe = safeHref(href);
      if (!safe) return inner;
      const t = title ? ` title="${escapeHtml(title)}"` : '';
      const external = /^https?:/i.test(safe) ? ' target="_blank" rel="noopener noreferrer"' : '';
      return `<a href="${escapeHtml(safe)}"${t}${external}>${inner}</a>`;
    },
    image({ href, title, text }: Tokens.Image): string {
      const alt = escapeHtml(text);
      if (/^data:image\/(png|jpe?g|gif|webp);base64,[a-z0-9+/=\s]+$/i.test(href.trim())) {
        const t = title ? ` title="${escapeHtml(title)}"` : '';
        return `<img src="${escapeHtml(href.trim())}" alt="${alt}"${t}>`;
      }
      const safe = safeHref(href);
      return safe ? `<span class="md-img-blocked" title="Remote images are blocked">[image: ${alt || escapeHtml(safe)}]</span>` : alt;
    },
  },
});

export function renderMarkdown(src: string): string {
  return marked.parse(src, { async: false });
}

export function wordCount(src: string): number {
  const words = src
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[#>*_`~\-[\]()!|]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return words.length;
}
