import { prisma } from "../database";
import { config } from "../config";
import { AppError } from "@notepad/shared";
import { Prisma } from "../generated/prisma/client";
import { burnPasswordCheck, hashPassword, verifyPassword } from "../utils/password";
import { generateRefreshToken, hashRefreshToken, signAccessToken } from "../utils/tokens";

export interface PublicUser {
    id: string;
    email: string;
    createdAt: Date;
    updatedAt: Date;
}

export interface AuthTokens {
    accessToken: string;
    refreshToken: string;
    tokenType: "Bearer";
    expiresIn: number;
}

const publicUserSelect = { id: true, email: true, createdAt: true, updatedAt: true } as const;

async function issueTokens(user: { id: string; email: string }): Promise<AuthTokens> {
    const refreshToken = generateRefreshToken();
    await prisma.refreshToken.create({
        data: {
            userId: user.id,
            tokenHash: hashRefreshToken(refreshToken),
            expiresAt: new Date(Date.now() + config.refreshTokenTtlDays * 24 * 60 * 60 * 1000),
        },
    });

    return {
        accessToken: signAccessToken({ sub: user.id, email: user.email }),
        refreshToken,
        tokenType: "Bearer",
        expiresIn: config.jwt.accessTtlSeconds,
    };
}

export async function register(email: string, password: string) {
    const passwordHash = await hashPassword(password);

    let user: PublicUser;
    try {
        user = await prisma.user.create({
            data: { email, password: passwordHash },
            select: publicUserSelect,
        });
    } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
            throw new AppError(409, "An account with this email already exists");
        }
        throw err;
    }

    return { user, tokens: await issueTokens(user) };
}

export async function login(email: string, password: string) {
    const user = await prisma.user.findUnique({ where: { email } });

    if (!user) {
        await burnPasswordCheck(password);
        throw new AppError(401, "Invalid email or password");
    }
    if (!(await verifyPassword(password, user.password))) {
        throw new AppError(401, "Invalid email or password");
    }

    const { password: _, ...publicUser } = user;
    return { user: publicUser, tokens: await issueTokens(user) };
}

// Rotates the refresh token: the presented token is revoked and a new pair is issued.
// Presenting an already-revoked token means it was stolen or replayed, so every
// session for that user is revoked.
export async function refresh(refreshToken: string): Promise<AuthTokens> {
    const stored = await prisma.refreshToken.findUnique({
        where: { tokenHash: hashRefreshToken(refreshToken) },
        include: { user: { select: { id: true, email: true } } },
    });

    if (!stored) {
        throw new AppError(401, "Invalid refresh token");
    }
    if (stored.revokedAt) {
        await revokeAllForUser(stored.userId);
        throw new AppError(401, "Invalid refresh token");
    }
    if (stored.expiresAt <= new Date()) {
        throw new AppError(401, "Refresh token expired");
    }

    // Conditional update makes rotation atomic: of two concurrent requests with
    // the same token, only one can flip revokedAt from null.
    const { count } = await prisma.refreshToken.updateMany({
        where: { id: stored.id, revokedAt: null },
        data: { revokedAt: new Date() },
    });
    if (count === 0) {
        await revokeAllForUser(stored.userId);
        throw new AppError(401, "Invalid refresh token");
    }

    return issueTokens(stored.user);
}

// Idempotent: unknown or already-revoked tokens are silently ignored
export async function logout(refreshToken: string): Promise<void> {
    await prisma.refreshToken.updateMany({
        where: { tokenHash: hashRefreshToken(refreshToken), revokedAt: null },
        data: { revokedAt: new Date() },
    });
}

export async function getUserById(id: string): Promise<PublicUser> {
    const user = await prisma.user.findUnique({ where: { id }, select: publicUserSelect });
    if (!user) {
        throw new AppError(404, "User not found");
    }
    return user;
}

async function revokeAllForUser(userId: string): Promise<void> {
    await prisma.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
    });
}
