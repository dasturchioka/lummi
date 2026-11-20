/** Public product photos through the admin's `/api` proxy (the API serves `/media/public` in dev). */
export const photoUrl = (hash: string, width: 400 | 800 | 1200 = 400) =>
  `/api/media/public/${hash}-${width}.webp`;
