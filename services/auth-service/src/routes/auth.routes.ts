import { Router } from "express";
import { ok, validateBody } from "@notepad/shared";
import * as authService from "../services/auth.service";
import { requireAuth } from "../middleware";
import { loginSchema, refreshTokenSchema, registerSchema } from "../validation";

export const authRouter = Router();

authRouter.post("/register", validateBody(registerSchema), async (req, res) => {
    const { user, tokens } = await authService.register(req.body.email, req.body.password);
    res.status(201).json(ok({ user, ...tokens }, "Account created"));
});

authRouter.post("/login", validateBody(loginSchema), async (req, res) => {
    const { user, tokens } = await authService.login(req.body.email, req.body.password);
    res.json(ok({ user, ...tokens }));
});

authRouter.post("/refresh", validateBody(refreshTokenSchema), async (req, res) => {
    const tokens = await authService.refresh(req.body.refreshToken);
    res.json(ok(tokens));
});

authRouter.post("/logout", validateBody(refreshTokenSchema), async (req, res) => {
    await authService.logout(req.body.refreshToken);
    res.json(ok(undefined, "Logged out"));
});

authRouter.get("/me", requireAuth, async (req, res) => {
    const user = await authService.getUserById(req.user!.id);
    res.json(ok({ user }));
});
