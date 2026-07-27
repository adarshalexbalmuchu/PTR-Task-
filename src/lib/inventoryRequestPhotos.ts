import imageCompression from 'browser-image-compression';
import { supabase } from './supabase';

// Must stay in sync with the inventory-request-photos bucket's
// file_size_limit in supabase/schema.sql. Same convention as
// incidentPhotos.ts — photos are compressed client-side first, so
// anything still over this cap likely means compression failed rather
// than the photo being legitimately huge.
export const MAX_REQUEST_PHOTO_BYTES = 5 * 1024 * 1024;
export const MAX_REQUEST_PHOTOS = 5;

// Same settings as incidentPhotos.ts's compressPhoto — kept as a separate
// copy (not a shared utility) because the two upload targets have
// different tables/buckets and there's nothing else to share yet; worth
// factoring out if a third photo-attachment feature shows up.
async function compressPhoto(file: File): Promise<File> {
  try {
    return await imageCompression(file, {
      maxSizeMB: 1,
      maxWidthOrHeight: 1600,
      useWebWorker: false,
      initialQuality: 0.75,
    });
  } catch {
    return file;
  }
}

export async function uploadInventoryRequestPhoto(requestId: string, userId: string, file: File): Promise<void> {
  const compressed = await compressPhoto(file);
  if (compressed.size > MAX_REQUEST_PHOTO_BYTES) {
    throw new Error(`"${file.name}" is too large even after compression — try a smaller photo`);
  }

  const path = `${requestId}/${crypto.randomUUID()}.jpg`;
  const { error: uploadErr } = await supabase.storage
    .from('inventory-request-photos')
    .upload(path, compressed, { contentType: compressed.type || 'image/jpeg' });
  if (uploadErr) throw uploadErr;

  const { error } = await supabase.from('inventory_request_photos').insert({
    request_id: requestId,
    uploaded_by: userId,
    path,
    size: compressed.size,
    mime_type: compressed.type || 'image/jpeg',
  });
  if (error) throw error;
}
