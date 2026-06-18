export type OpenGraphData = {
  title?: string;
  description?: string;
  image?: string;
  siteName?: string;
};

type YoutubeMetadata = OpenGraphData & {
  title: string;
  authorName?: string;
  siteName: string;
};

const cache = new Map<string, OpenGraphData | null>();
const inflight = new Map<string, Promise<OpenGraphData | null>>();
const cacheLimit = 200;
const timeoutMs = 6000;

const ogTagRegex =
  /<meta[^>]+property\s*=\s*["']og:(\w+)["'][^>]+content\s*=\s*["']([^"']*)["'][^>]*\/?>|<meta[^>]+content\s*=\s*["']([^"']*)["'][^>]+property\s*=\s*["']og:(\w+)["'][^>]*\/?>/gi;
const titleTagRegex = /<title[^>]*>([^<]+)<\/title>/i;
const youtubeRegex =
  /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:watch\?.*v=|shorts\/|embed\/|live\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/i;

export function cachedLinkPreview(url: string) {
  return cache.get(url);
}

export function prefetchLinkPreview(url: string) {
  fetchLinkPreview(url).catch(() => {});
}

export function fetchLinkPreview(url: string): Promise<OpenGraphData | null> {
  if (cache.has(url)) return Promise.resolve(cache.get(url) ?? null);

  const existing = inflight.get(url);
  if (existing) return existing;

  const task = fetchInternal(url)
    .then(result => {
      store(url, result);
      return result;
    })
    .finally(() => {
      inflight.delete(url);
    });

  inflight.set(url, task);
  return task;
}

function store(url: string, data: OpenGraphData | null) {
  if (cache.size >= cacheLimit) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  cache.set(url, data);
}

async function fetchInternal(urlString: string): Promise<OpenGraphData | null> {
  const youtubeVideoId = getYoutubeVideoId(urlString);
  if (youtubeVideoId) {
    const youtube = await fetchYoutubeOembed(urlString, youtubeVideoId);
    if (youtube) return youtube;
  }

  const fetchUrlString = sanitizeForFetch(urlString);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(fetchUrlString, {
      signal: controller.signal,
      headers: {
        Accept: 'text/html,application/xhtml+xml',
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
      },
    });

    if (!response.ok) return synthesizeYoutubeChannelPreview(urlString);

    const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
    if (contentType && !contentType.includes('text/html')) {
      return synthesizeYoutubeChannelPreview(urlString);
    }

    const html = await response.text();
    return (
      parseOgTags(html.slice(0, 256 * 1024), urlString) ??
      synthesizeYoutubeChannelPreview(urlString)
    );
  } catch {
    return synthesizeYoutubeChannelPreview(urlString);
  } finally {
    clearTimeout(timeout);
  }
}

function getYoutubeVideoId(url: string) {
  const match = normalizeLinkUrl(url).match(youtubeRegex);
  return match?.[1] ?? null;
}

async function fetchYoutubeOembed(
  url: string,
  videoId: string,
): Promise<YoutubeMetadata | null> {
  const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(
    normalizeLinkUrl(url),
  )}&format=json`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(oembedUrl, {signal: controller.signal});
    if (!response.ok) return null;

    const data = await response.json();
    if (!data || typeof data.title !== 'string') return null;

    return {
      title: data.title,
      description: typeof data.author_name === 'string' ? data.author_name : undefined,
      authorName: typeof data.author_name === 'string' ? data.author_name : undefined,
      image: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
      siteName: 'YouTube',
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function parseOgTags(html: string, fallbackUrl: string): OpenGraphData | null {
  const props: Record<string, string> = {};
  ogTagRegex.lastIndex = 0;

  for (const match of html.matchAll(ogTagRegex)) {
    const prop = (match[1] || match[4] || '').toLowerCase();
    const content = match[2] || match[3] || '';
    if (prop && content && props[prop] === undefined) {
      props[prop] = content;
    }
  }

  let title: string | undefined = props.title;
  if (!title) {
    const titleMatch = html.match(titleTagRegex);
    title = titleMatch?.[1]?.trim();
  }

  const result: OpenGraphData = {
    title: title ? unescapeHtml(title) : undefined,
    description: props.description ? unescapeHtml(props.description) : undefined,
    image: props.image
      ? resolveOgUrl(unescapeHtml(props.image), fallbackUrl) ?? undefined
      : undefined,
    siteName: props.site_name ? unescapeHtml(props.site_name) : undefined,
  };

  return result.title || result.image ? result : null;
}

function synthesizeYoutubeChannelPreview(urlString: string): OpenGraphData | null {
  try {
    const url = new URL(normalizeLinkUrl(urlString));
    const host = url.hostname.toLowerCase();
    if (!['youtube.com', 'www.youtube.com', 'm.youtube.com'].includes(host)) {
      return null;
    }

    const path = url.pathname;
    let title: string | undefined;
    if (path.includes('/@')) {
      title = path.replace(/^\/+/, '').split('/')[0];
    } else if (path.startsWith('/c/')) {
      title = `@${path.slice(3).split('/')[0]}`;
    } else if (path.startsWith('/channel/')) {
      title = path.slice(9).split('/')[0];
    } else if (path.startsWith('/user/')) {
      title = `@${path.slice(6).split('/')[0]}`;
    }

    return title
      ? {title, description: 'YouTube channel', siteName: 'YouTube'}
      : null;
  } catch {
    return null;
  }
}

function sanitizeForFetch(urlString: string) {
  try {
    const url = new URL(normalizeLinkUrl(urlString));
    const host = url.hostname.toLowerCase();
    const isYoutube = ['youtube.com', 'www.youtube.com', 'm.youtube.com'].includes(host);
    const path = url.pathname;

    if (
      isYoutube &&
      (path.includes('/@') ||
        path.startsWith('/c/') ||
        path.startsWith('/channel/') ||
        path.startsWith('/user/'))
    ) {
      return `${url.protocol}//${url.host}${url.pathname}`;
    }

    return url.toString();
  } catch {
    return urlString;
  }
}

function resolveOgUrl(raw: string, pageUrl: string) {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;

  try {
    const page = new URL(normalizeLinkUrl(pageUrl));
    if (trimmed.startsWith('//')) return `${page.protocol}${trimmed}`;
    return new URL(trimmed, page).toString();
  } catch {
    return null;
  }
}

function normalizeLinkUrl(url: string) {
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}

function unescapeHtml(value: string) {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'");
}
