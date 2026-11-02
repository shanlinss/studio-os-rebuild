// Offline identification only. Never expand short links or infer an unknown ID.
export function materialSource(value: string | null) {
  if (!value) return { platform: 'unknown', noteId: null as string | null };
  try {
    const url = new URL(value);
    if (
      ['www.xiaohongshu.com', 'xiaohongshu.com'].includes(
        url.hostname.toLowerCase(),
      )
    ) {
      const match = url.pathname.match(
        /^\/(?:explore|discovery\/item)\/([a-f0-9]{24})\/?$/i,
      );
      return {
        platform: 'xiaohongshu',
        noteId: match?.[1].toLowerCase() ?? null,
      };
    }
    if (url.hostname.toLowerCase() === 'xhslink.com')
      return { platform: 'xiaohongshu', noteId: null };
  } catch {
    /* Invalid historical URLs remain unknown. */
  }
  return { platform: 'unknown', noteId: null };
}
