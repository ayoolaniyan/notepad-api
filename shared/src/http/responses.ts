import { ApiResponse } from "../types";

export function ok<T>(data?: T, message?: string): ApiResponse<T> {
    return { success: true, data, message };
}

export function fail(error: string, errors?: Record<string, string[]>): ApiResponse<never> {
    return { success: false, error, errors };
}
