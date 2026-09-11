const inlineMimeTypes = new Set([
    'application/pdf',
    'audio/mp4',
    'audio/mpeg',
    'audio/ogg',
    'audio/wav',
    'audio/webm',
    'image/avif',
    'image/bmp',
    'image/gif',
    'image/jpeg',
    'image/png',
    'image/webp',
    'text/markdown',
    'text/plain',
    'video/mp4',
    'video/ogg',
    'video/webm',
]);

export interface SafePublicContentType {
    inline: boolean;
    mimeType: string;
}

export function getSafePublicContentType(mimeType: string): SafePublicContentType {
    const normalizedMimeType =
        mimeType.split(';', 1)[0]?.trim().toLowerCase() || 'application/octet-stream';
    if (inlineMimeTypes.has(normalizedMimeType)) {
        return { inline: true, mimeType: normalizedMimeType };
    }
    return { inline: false, mimeType: 'application/octet-stream' };
}
