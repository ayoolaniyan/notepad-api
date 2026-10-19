export interface User {
    id: string;
    email: string;
    createdAt: Date;
    updateAt: Date;
}

export interface ApiResponse<T = any> {
    success: boolean;
    data?: T;
    message?: string;
    error?: string;
    errors?: Record<string, string[]>;
}
