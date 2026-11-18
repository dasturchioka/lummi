import { customers, eq, staff, type Db } from '@lummi/db';
import type { FileStore } from '../edges';
import { deleteAvatarFiles } from './avatar-pipeline';

/** Delete a photo's renditions unless a customer or a staff member still points at the hash. */
export async function deleteAvatarIfUnused(db: Db, files: FileStore, hash: string): Promise<void> {
  const [c] = await db
    .select({ id: customers.id })
    .from(customers)
    .where(eq(customers.photoHash, hash))
    .limit(1);
  const [s] = await db
    .select({ id: staff.id })
    .from(staff)
    .where(eq(staff.photoHash, hash))
    .limit(1);
  if (!c && !s) await deleteAvatarFiles(files, hash);
}
