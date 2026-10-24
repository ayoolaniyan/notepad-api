import { AppError } from "@notepad/shared";
import { prisma } from "../database";
import { Prisma } from "../generated/prisma/client";

// userId is never returned: the caller already knows who they are
const publicNoteSelect = {
    id: true,
    title: true,
    content: true,
    isPinned: true,
    createdAt: true,
    updatedAt: true,
} as const;

export type PublicNote = Prisma.NoteGetPayload<{ select: typeof publicNoteSelect }>;

export interface ListNotesOptions {
    limit: number;
    cursor?: string;
    q?: string;
    pinned?: boolean;
}

export interface NoteChanges {
    title?: string;
    content?: string;
    isPinned?: boolean;
}

const notFound = () => new AppError(404, "Note not found");

// Sort order: pinned first, then most recently updated; id breaks ties so the order is total
const orderBy: Prisma.NoteOrderByWithRelationInput[] = [{ isPinned: "desc" }, { updatedAt: "desc" }, { id: "desc" }];

// Keyset cursor: the sort position of the last note on the previous page.
// Unlike offsets, it doesn't shift when notes are added or edited between pages.
interface Cursor {
    p: boolean;
    u: string;
    i: string;
}

function encodeCursor(note: PublicNote): string {
    const cursor: Cursor = { p: note.isPinned, u: note.updatedAt.toISOString(), i: note.id };
    return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

function decodeCursor(raw: string): Cursor {
    try {
        const c = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
        if (typeof c.p === "boolean" && typeof c.i === "string" && !Number.isNaN(Date.parse(c.u))) {
            return c;
        }
    } catch {
        // fall through
    }
    throw new AppError(400, "Invalid cursor");
}

// Notes strictly after the cursor in (isPinned desc, updatedAt desc, id desc) order
function afterCursor({ p, u, i }: Cursor): Prisma.NoteWhereInput {
    const updatedAt = new Date(u);
    const sameGroup: Prisma.NoteWhereInput[] = [
        { isPinned: p, updatedAt: { lt: updatedAt } },
        { isPinned: p, updatedAt, id: { lt: i } },
    ];
    // Pinned notes come first, so after a pinned cursor every unpinned note follows
    return { OR: p ? [...sameGroup, { isPinned: false }] : sameGroup };
}

export async function listNotes(userId: string, { limit, cursor, q, pinned }: ListNotesOptions) {
    const where: Prisma.NoteWhereInput[] = [{ userId }];
    if (pinned !== undefined) where.push({ isPinned: pinned });
    if (q) {
        where.push({
            OR: [{ title: { contains: q, mode: "insensitive" } }, { content: { contains: q, mode: "insensitive" } }],
        });
    }
    if (cursor) where.push(afterCursor(decodeCursor(cursor)));

    // Fetch one extra row to know whether another page exists
    const rows = await prisma.note.findMany({
        where: { AND: where },
        orderBy,
        take: limit + 1,
        select: publicNoteSelect,
    });

    const notes = rows.slice(0, limit);
    const nextCursor = rows.length > limit ? encodeCursor(notes[notes.length - 1]) : null;
    return { notes, nextCursor };
}

export async function getNote(userId: string, id: string): Promise<PublicNote> {
    const note = await prisma.note.findFirst({ where: { id, userId }, select: publicNoteSelect });
    if (!note) throw notFound();
    return note;
}

export function createNote(userId: string, data: Required<NoteChanges>): Promise<PublicNote> {
    return prisma.note.create({ data: { ...data, userId }, select: publicNoteSelect });
}

// Ownership check and write happen in one statement, so there's no window
// where another user's note could be modified
export async function updateNote(userId: string, id: string, changes: NoteChanges): Promise<PublicNote> {
    const [note] = await prisma.note.updateManyAndReturn({
        where: { id, userId },
        data: changes,
        select: publicNoteSelect,
    });
    if (!note) throw notFound();
    return note;
}

export async function deleteNote(userId: string, id: string): Promise<void> {
    const { count } = await prisma.note.deleteMany({ where: { id, userId } });
    if (count === 0) throw notFound();
}
