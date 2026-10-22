import { Router } from "express";
import * as authService from "../services/auth.service";
import { validateBody } from "../middleware/validate";
import { requireAuth } from "../middleware/requireAuth";
import { loginSchema, refreshTokenSchema, registerSchema } from "../validation";

export const authRouter = Router();

authRouter.post("/register", validateBody(registerSchema), async (req, res) => {
    const { user, tokens } = await authService.register(req.body.email, req.body.password);
    res.status(201).json({ success: true, data: { user, ...tokens }, message: "Account created" });
});

authRouter.post("/login", validateBody(loginSchema), async (req, res) => {
    const { user, tokens } = await authService.login(req.body.email, req.body.password);
    res.json({ success: true, data: { user, ...tokens } });
});

authRouter.post("/refresh", validateBody(refreshTokenSchema), async (req, res) => {
    const tokens = await authService.refresh(req.body.refreshToken);
    res.json({ success: true, data: tokens });
});

authRouter.post("/logout", validateBody(refreshTokenSchema), async (req, res) => {
    await authService.logout(req.body.refreshToken);
    res.json({ success: true, message: "Logged out" });
});

authRouter.get("/me", requireAuth, async (req, res) => {
    const user = await authService.getUserById(req.user!.id);
    res.json({ success: true, data: { user } });
});
