export interface User {
    id: string;
    email: string;
    createdAt: Date;
    updatedAt: Date;
}

export interface ApiResponse<T = unknown> {
    success: boolean;
    data?: T;
    message?: string;
    error?: string;
    errors?: Record<string, string[]>;
}

// The authenticated caller, as attached to req.user by requireAuth
export interface AuthUser {
    id: string;
    email: string;
}

// Claims carried in an access token (sub is the user id)
export interface AccessTokenPayload {
    sub: string;
    email: string;
}
