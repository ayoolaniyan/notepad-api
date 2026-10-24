import Joi from "joi";

export const registerSchema = Joi.object({
    email: Joi.string().trim().lowercase().max(254).email().required().messages({
        "string.email": "Email must be a valid email address",
        "any.required": "Email is required",
    }),
    password: Joi.string()
        .min(8)
        .max(128)
        .pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
        .required()
        .messages({
            "string.min": "Password must be at least 8 characters long",
            "string.max": "Password must be at most 128 characters long",
            "string.pattern.base":
                "Password must contain at least one uppercase letter, one lowercase letter, and one number",
            "any.required": "Password is required",
        }),
});

export const loginSchema = Joi.object({
    email: Joi.string().trim().lowercase().max(254).email().required().messages({
        "string.email": "Email must be a valid email address",
        "any.required": "Email is required",
    }),
    password: Joi.string().max(128).required().messages({
        "any.required": "Password is required",
    }),
});

export const refreshTokenSchema = Joi.object({
    refreshToken: Joi.string().required().messages({
        "any.required": "Refresh token is required",
    }),
});
