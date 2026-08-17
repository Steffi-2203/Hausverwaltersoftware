/**
 * Generates a signed URL for a document stored in storage.
 * Signed URLs expire after 1 hour for security.
 * 
 * @param bucket - The storage bucket name
 * @param filePath - The path to the file within the bucket
 * @returns The signed URL or null if generation fails
 */
export async function getSignedDocumentUrl(
  bucket: string,
  filePath: string
): Promise<string | null> {
  try {
    const response = await fetch(`/api/storage/signed-url`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ bucket, filePath, expiresIn: 3600 }),
    });

    if (!response.ok) {
      console.error('Error creating signed URL:', await response.text());
      return null;
    }

    const data = await response.json();
    return data.signedUrl;
  } catch (error) {
    console.error('Error in getSignedDocumentUrl:', error);
    return null;
  }
}

/**
 * Extracts the file path from a storage URL for a given prefix.
 * 
 * @param fileUrl - The full URL of the file
 * @param prefix - The prefix to look for (e.g., 'property-docs/', 'unit-docs/')
 * @returns The file path including the prefix, or null if not found
 */
export function extractFilePath(fileUrl: string, prefix: string): string | null {
  const parts = fileUrl.split(`/${prefix}`);
  if (parts.length > 1) {
    return `${prefix}${parts[1]}`;
  }
  return null;
}
