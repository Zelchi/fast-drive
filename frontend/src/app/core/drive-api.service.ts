import { HttpClient, type HttpEvent } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import {
    createFolderInputSchema,
    type FileListing,
    type FileResponse,
    type FileShareResponse,
    type FolderResponse,
    type FoldersResponse,
    fileListingSchema,
    fileResponseSchema,
    fileShareResponseSchema,
    folderResponseSchema,
    foldersResponseSchema,
    type PublicShareMetadata,
    publicShareMetadataSchema,
    updateFileInputSchema,
    updateFileShareInputSchema,
    updateFolderInputSchema,
} from '@fast-drive/file-models';
import {
    addWorkspaceMemberInputSchema,
    createWorkspaceInputSchema,
    type MemberResponse,
    type MembersResponse,
    memberResponseSchema,
    membersResponseSchema,
    type SuccessResponse,
    successResponseSchema,
    updateWorkspaceInputSchema,
    type WorkspaceMutationResponse,
    type WorkspacesResponse,
    workspaceMutationResponseSchema,
    workspacesResponseSchema,
} from '@fast-drive/shared-types';
import type { Observable } from 'rxjs';
import { parseRequest, validateHttpEvent, validateResponse } from './api-validation';
import { ServerConfigService } from './server-config.service';

export type {
    DriveFile,
    FileListing,
    FileShare,
    Folder,
    PublicShareMetadata,
} from '@fast-drive/file-models';
export type { StorageOverview, Workspace, WorkspaceMember } from '@fast-drive/shared-types';

@Injectable({ providedIn: 'root' })
export class DriveApiService {
    private readonly serverConfig = inject(ServerConfigService);

    constructor(private readonly http: HttpClient) {}

    listWorkspaces(): Observable<WorkspacesResponse> {
        return this.http
            .get<unknown>('/api/workspaces', { withCredentials: true })
            .pipe(validateResponse(workspacesResponseSchema));
    }

    createWorkspace(name: string, quota: string): Observable<WorkspaceMutationResponse> {
        return this.http
            .post<unknown>(
                '/api/workspaces',
                parseRequest(createWorkspaceInputSchema, { name, quota }),
                {
                    withCredentials: true,
                },
            )
            .pipe(validateResponse(workspaceMutationResponseSchema));
    }

    updateWorkspaceQuota(
        workspaceId: string,
        quota: string,
    ): Observable<WorkspaceMutationResponse> {
        return this.http
            .patch<unknown>(
                `/api/workspaces/${workspaceId}`,
                parseRequest(updateWorkspaceInputSchema, { quota }),
                { withCredentials: true },
            )
            .pipe(validateResponse(workspaceMutationResponseSchema));
    }

    renameWorkspace(workspaceId: string, name: string): Observable<WorkspaceMutationResponse> {
        return this.http
            .patch<unknown>(
                `/api/workspaces/${workspaceId}`,
                parseRequest(updateWorkspaceInputSchema, { name }),
                { withCredentials: true },
            )
            .pipe(validateResponse(workspaceMutationResponseSchema));
    }

    listWorkspaceMembers(workspaceId: string): Observable<MembersResponse> {
        return this.http
            .get<unknown>(`/api/workspaces/${workspaceId}/members`, { withCredentials: true })
            .pipe(validateResponse(membersResponseSchema));
    }

    addWorkspaceMember(workspaceId: string, nick: string): Observable<MemberResponse> {
        return this.http
            .post<unknown>(
                `/api/workspaces/${workspaceId}/members`,
                parseRequest(addWorkspaceMemberInputSchema, { nick }),
                { withCredentials: true },
            )
            .pipe(validateResponse(memberResponseSchema));
    }

    removeWorkspaceMember(workspaceId: string, userId: string): Observable<SuccessResponse> {
        return this.http
            .delete<unknown>(`/api/workspaces/${workspaceId}/members/${userId}`, {
                withCredentials: true,
            })
            .pipe(validateResponse(successResponseSchema));
    }

    updateFolder(folderId: string, name: string): Observable<FolderResponse> {
        return this.http
            .patch<unknown>(
                `/api/folders/${folderId}`,
                parseRequest(updateFolderInputSchema, { name }),
                {
                    withCredentials: true,
                },
            )
            .pipe(validateResponse(folderResponseSchema));
    }

    deleteFolder(folderId: string, recursive = false): Observable<SuccessResponse> {
        const query = recursive ? '?recursive=true' : '';
        return this.http
            .delete<unknown>(`/api/folders/${folderId}${query}`, { withCredentials: true })
            .pipe(validateResponse(successResponseSchema));
    }

    listFiles(workspaceId: string, folderId: string | null): Observable<FileListing> {
        const query = folderId ? `?folderId=${encodeURIComponent(folderId)}` : '';
        return this.http
            .get<unknown>(`/api/workspaces/${workspaceId}/files${query}`, { withCredentials: true })
            .pipe(validateResponse(fileListingSchema));
    }

    listFolders(workspaceId: string): Observable<FoldersResponse> {
        return this.http
            .get<unknown>(`/api/workspaces/${workspaceId}/folders`, { withCredentials: true })
            .pipe(validateResponse(foldersResponseSchema));
    }

    createFolder(
        workspaceId: string,
        name: string,
        parentId: string | null,
    ): Observable<FolderResponse> {
        return this.http
            .post<unknown>(
                `/api/workspaces/${workspaceId}/folders`,
                parseRequest(createFolderInputSchema, { name, parentId }),
                { withCredentials: true },
            )
            .pipe(validateResponse(folderResponseSchema));
    }

    upload(
        workspaceId: string,
        folderId: string | null,
        file: File,
    ): Observable<HttpEvent<FileResponse>> {
        const form = new FormData();
        form.append('file', file, file.name);
        const suffix = folderId ? `?folderId=${encodeURIComponent(folderId)}` : '';
        return this.http
            .post<unknown>(`/api/workspaces/${workspaceId}/files${suffix}`, form, {
                withCredentials: true,
                observe: 'events',
                reportProgress: true,
            })
            .pipe(validateHttpEvent(fileResponseSchema));
    }

    moveFile(fileId: string, folderId: string | null): Observable<FileResponse> {
        return this.http
            .patch<unknown>(
                `/api/files/${fileId}`,
                parseRequest(updateFileInputSchema, { folderId }),
                {
                    withCredentials: true,
                },
            )
            .pipe(validateResponse(fileResponseSchema));
    }

    renameFile(fileId: string, name: string, extension: string): Observable<FileResponse> {
        return this.http
            .patch<unknown>(
                `/api/files/${fileId}`,
                parseRequest(updateFileInputSchema, { name, extension }),
                { withCredentials: true },
            )
            .pipe(validateResponse(fileResponseSchema));
    }

    deleteFile(fileId: string): Observable<SuccessResponse> {
        return this.http
            .delete<unknown>(`/api/files/${fileId}`, { withCredentials: true })
            .pipe(validateResponse(successResponseSchema));
    }

    getFileShare(fileId: string): Observable<FileShareResponse> {
        return this.http
            .get<unknown>(`/api/files/${fileId}/share`, { withCredentials: true })
            .pipe(validateResponse(fileShareResponseSchema));
    }

    updateFileShare(fileId: string, isPublic: boolean): Observable<FileShareResponse> {
        return this.http
            .patch<unknown>(
                `/api/files/${fileId}/share`,
                parseRequest(updateFileShareInputSchema, { isPublic }),
                { withCredentials: true },
            )
            .pipe(validateResponse(fileShareResponseSchema));
    }

    getPublicShareMetadata(token: string): Observable<PublicShareMetadata> {
        return this.http
            .get<unknown>(`/api/shares/${encodeURIComponent(token)}/metadata`)
            .pipe(validateResponse(publicShareMetadataSchema));
    }

    getPublicShareContent(token: string): Observable<string> {
        return this.http.get(this.publicShareContentUrl(token), { responseType: 'text' });
    }

    publicShareContentUrl(token: string): string {
        return this.serverConfig.apiUrl(`/api/shares/${encodeURIComponent(token)}/content`);
    }

    publicShareDownloadUrl(token: string): string {
        return this.serverConfig.apiUrl(`/api/shares/${encodeURIComponent(token)}`);
    }

    downloadUrl(fileId: string): string {
        return this.serverConfig.apiUrl(`/api/files/${fileId}/download`);
    }
}
