export const defaultStorageQuota = 10 * 1024 ** 3;

const units: Record<string, number> = {
    B: 1,
    K: 1024,
    KB: 1024,
    KIB: 1024,
    M: 1024 ** 2,
    MB: 1024 ** 2,
    MIB: 1024 ** 2,
    G: 1024 ** 3,
    GB: 1024 ** 3,
    GIB: 1024 ** 3,
    T: 1024 ** 4,
    TB: 1024 ** 4,
    TIB: 1024 ** 4,
};

export function parseByteSize(value: string, settingName: string): number {
    const match = /^(\d+(?:\.\d+)?)\s*([KMGT]B?|[KMGT]IB?|B)?$/i.exec(value.trim());
    if (!match) {
        throw new Error(`${settingName} inválido. Use formatos como 512M, 10G ou 104857600B.`);
    }

    const amount = Number(match[1]);
    const unit = (match[2] || 'B').toUpperCase();
    const multiplier = units[unit];
    const bytes = amount * multiplier;
    if (!Number.isFinite(bytes) || bytes <= 0 || bytes > Number.MAX_SAFE_INTEGER) {
        throw new Error(`${settingName} está fora do intervalo permitido.`);
    }

    return Math.floor(bytes);
}

export function getStorageQuota(): number {
    const configuredValue = process.env.STORAGE_QUOTA_BYTES?.trim();
    return configuredValue
        ? parseByteSize(configuredValue, 'STORAGE_QUOTA_BYTES')
        : defaultStorageQuota;
}

export function parseWorkspaceQuota(value: string, totalBytes = getStorageQuota()): number {
    const normalizedValue = value.trim();
    const percentageMatch = /^(\d+(?:\.\d+)?)\s*%$/.exec(normalizedValue);
    if (percentageMatch) {
        const percentage = Number(percentageMatch[1]);
        if (!Number.isFinite(percentage) || percentage <= 0 || percentage > 100) {
            throw new Error('A porcentagem da quota deve estar entre 0% e 100%.');
        }
        return Math.max(1, Math.floor((totalBytes * percentage) / 100));
    }

    const bytes = parseByteSize(normalizedValue, 'A quota do workspace');
    if (bytes > totalBytes) {
        throw new Error('A quota do workspace não pode ser maior que o armazenamento total.');
    }
    return bytes;
}
