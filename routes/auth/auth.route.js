import express from "express";
import { register, reSendVerificationCode, verifyEmail, login, refreshToken, logout, getMe } from "../../controllers/auth/auth.controller.js";
import { forgotPassword, verifyResetCode, resetPaassword } from "../../controllers/auth/resetPassword.controller.js";
import { protectedRoute } from "../../middlewares/protectedRoute.js";
const router = express.Router();


router.post("/register", register);
router.post("/verifyEmail", verifyEmail);
router.post("/reSendVerificationCode", reSendVerificationCode);
router.post("/login", login);
router.post("/refreshToken", refreshToken);
router.post("/logout", protectedRoute, logout);
router.get("/me", protectedRoute, getMe);

// reset password 
router.post("/forgotPassword", forgotPassword);
router.post("/verifyResetCode", verifyResetCode);
router.post("/resetPaassword", resetPaassword);

export default router;