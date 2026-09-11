import { parseByteSize } from '../../storage/storage-quota';

export const defaultMaxFileSize = 10 * 1024 * 1024 * 1024;

export function getMaxFileSize(): number {
    const configuredValue = process.env.MAX_FILE_SIZE_BYTES?.trim();
    if (!configuredValue) {
        return defaultMaxFileSize;
    }

    return parseByteSize(configuredValue, 'MAX_FILE_SIZE_BYTES');
}
