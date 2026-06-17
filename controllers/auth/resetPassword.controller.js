import User from "../../models/mainDB/User.model.js";
import crypto from "crypto";
import { ApiError } from "../../utils/apiError.js";
import sendEmail from "../../utils/sendEmail.js";
import bcrypt from "bcrypt"


export const forgotPassword = async (req, res, next) => {
    const codeValidityMinutes = 10;
    const { email } = req.body;

    if (!email) {
        return next(new ApiError(400, "Email is required"));
    }

    // 1) Get user by email
    const user = await User.findOne({ email }).exec();
    if (!user) {
        return next(new ApiError(404, "User not found"));
    }

    // ==== CHECK IF USER MUST WAIT ====
    if (user.passwordResetExpires && user.passwordResetExpires > Date.now()) {
        const remainingMs = user.passwordResetExpires - Date.now();
        const remainingMin = Math.ceil(remainingMs / 1000 / 60);

        return next(
            new ApiError(
                429,
                `You must wait ${remainingMin} minute(s) before requesting another reset code`
            )
        );
    }

    // 2) Generate reset code
    const resetCode = Math.floor(100000 + Math.random() * 900000).toString();
    const hashedResetCode = crypto
        .createHash("sha256")
        .update(resetCode)
        .digest("hex");

    // 3) Save reset data
    user.passwordResetCode = hashedResetCode;
    user.passwordResetExpires = Date.now() + codeValidityMinutes * 60 * 1000;
    user.passwordResetVerified = false;

    await user.save();

    // 4) Send email
    const message = `
        <h2>Hello ${user.first_name}</h2>
        <p>We received a request to reset your password.</p>
        <h1 style="letter-spacing: 4px">${resetCode}</h1>
        <p>This code expires in ${codeValidityMinutes} minutes.</p>
    `;

    try {
        await sendEmail({
            email: user.email,
            subject: `Your password reset code (valid for ${codeValidityMinutes} min)`,
            message,
        });
    } catch (error) {
        // rollback on failure
        user.passwordResetCode = undefined;
        user.passwordResetExpires = undefined;
        user.passwordResetVerified = undefined;
        await user.save();

        return next(new ApiError(500, error.message));
    }

    res.status(200).json({
        status: "Success",
        message: "Reset code sent to email",
    });
};

export const verifyResetCode = async (req, res, next) => {

    const resetCode = req.body.resetCode;
    if (!resetCode) {
        return next(new ApiError(400, "Reset code is required"));
    }

    const hashedResetCode = crypto.createHash("sha256").update(resetCode).digest("hex");;

    const user = await User.findOne({
        passwordResetCode: hashedResetCode,
        passwordResetExpires: { $gt: Date.now() }
    }).exec();

    if (!user) {
        return next(new ApiError(400, "Invalid or expired reset code"));
    }

    // 2) Reset code valid
    user.passwordResetVerified = true;
    await user.save();

    res.status(200).json({
        status: 'Success',
    });
}

export const resetPaassword = async (req, res, next) => {
    const { email, newPassword } = req.body;

    if (!email || !newPassword) {
        return next(new ApiError(400, "Email and new password are required"));
    }
    // 1) Get user based on email
    const user = await User.findOne({ email }).exec();
    if (!user) {
        return next(new ApiError(404, "User not found"));
    };


    // 2) Check if reset code verified
    if (!user.passwordResetVerified) {
        return next(new ApiError(400, "Reset code not verified"));
    }


    const hashedPassword = await bcrypt.hash(newPassword, 10);

    user.password = hashedPassword;
    user.passwordChangedAt = Date.now();
    user.passwordResetCode = undefined;
    user.passwordResetExpires = undefined;
    user.passwordResetVerified = undefined;

    await user.save();

    res.status(200).json({
        status: 'Success',
        message: 'Password reset successful'
    });

}