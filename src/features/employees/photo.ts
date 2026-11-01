/** Photo upload rules shared by the upload component (pre-checks) and the server (enforcement). */
export const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const PHOTO_MAX_BYTES = 5 * 1024 * 1024;
export const PHOTO_MIN_SIDE = 128;
export const PHOTO_MAX_SIDE = 8000;
/** Stored sizes (square). */
export const PHOTO_SIZE = 512;
export const PHOTO_THUMB_SIZE = 96;

export function photoTypeAllowed(type: string): boolean {
  return (PHOTO_TYPES as readonly string[]).includes(type);
}

/** Same-origin URL for an employee's photo; `v` busts caches after each upload. */
export function employeePhotoUrl(id: string, photoUpdatedAt: string | Date | null | undefined, size: "full" | "thumb" = "thumb"): string {
  const v = photoUpdatedAt ? new Date(photoUpdatedAt).getTime() : 0;
  return `/api/employees/${id}/photo?size=${size}&v=${v}`;
}
