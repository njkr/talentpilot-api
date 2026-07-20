export interface Cursor {
  createdAt: Date;
  id: string;
}

// Opaque cursor = base64url(JSON({createdAt, id})) of the last row on the
// previous page. Using (createdAt, id) rather than an offset means pagination
// stays correct even if rows are inserted/deleted between pages.
export const encodeCursor = (row: { createdAt: Date; id: string }): string =>
  Buffer.from(
    JSON.stringify({ createdAt: row.createdAt.toISOString(), id: row.id }),
  ).toString('base64url');

export const decodeCursor = (cursor?: string | null): Cursor | null => {
  if (!cursor) return null;
  try {
    const parsed = JSON.parse(
      Buffer.from(cursor, 'base64url').toString('utf8'),
    );
    if (!parsed?.createdAt || !parsed?.id) return null;
    return { createdAt: new Date(parsed.createdAt), id: parsed.id };
  } catch {
    return null; // malformed cursor → treat as "start from the top", not a 500
  }
};
