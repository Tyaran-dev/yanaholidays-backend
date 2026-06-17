import User from "../../models/mainDB/User.model.js";
import bcrypt from "bcrypt"
import { ApiError } from "../../utils/apiError.js";
import jwt from "jsonwebtoken";
import sendEmail from "../../utils/sendEmail.js";
import crypto from "crypto";
import { generateTokenAndSetCookie } from "../../utils/generateToken.js";


const generateVerificationCode = () => {
    const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();
    const hashedVerifyCode = crypto.createHash("sha256").update(verificationCode).digest("hex");
    return { verificationCode, hashedVerifyCode };
};

export const register = async (req, res, next) => {
    const { first_name, last_name, email, password } = req.body;
    const verificationTimeMinutes = 10;

    if (!first_name || !last_name || !email || !password) {
        throw new ApiError(400, "All fields are required");
    }

    const foundUser = await User.findOne({ email }).exec();

    if (foundUser) {
        throw new ApiError(409, "User with this email already exists");
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    // generate 6-digit OTP
    const { verificationCode, hashedVerifyCode } = generateVerificationCode();
    const expiry = Date.now() + 1000 * 60 * verificationTimeMinutes; // 10 minutes;


    const user = await User.create({
        first_name,
        last_name,
        email,
        password: hashedPassword,
        emailVerificationCode: hashedVerifyCode,
        emailVerificationExpiry: expiry,
    });

    // send email
    await sendEmail({
        email: user.email,
        subject: "Verify your email",
        message: `
            <h2>Hello ${user.first_name}</h2>
            <p>Your verification code is:</p>
            <h1 style="letter-spacing: 4px">${verificationCode}</h1>
            <p>This code expires in ${verificationTimeMinutes} minutes.</p>
        `
    });

    const { accessToken, refreshToken } = generateTokenAndSetCookie(user, res);

    res.status(201).json({
        accessToken,
        refreshToken,  // mobile uses this
        email: user.email,
        first_name: user.first_name,
        last_name: user.last_name,
    });
}

export const verifyEmail = async (req, res, next) => {
    const { verifyCode } = req.body;
    if (!verifyCode) {
        return next(new ApiError(400, "Verification code is required"));
    }

    const hashedCode = crypto
        .createHash("sha256")
        .update(verifyCode)
        .digest("hex");

    console.log(hashedCode, "HASHED CODE");

    const user = await User.findOne({
        emailVerificationCode: hashedCode,
        emailVerificationExpiry: { $gt: Date.now() }
    }).exec();
    console.log(user, "USER IN VERIFY EMAIL");
    if (!user) {
        return next(new ApiError(400, "Invalid or expired verification code"));
    }

    // Mark email as verified
    user.emailVerified = true;
    user.emailVerificationCode = undefined;
    user.emailVerificationExpiry = undefined;

    await user.save();

    res.status(200).json({
        status: "Success",
        message: "Email verified successfully"
    });
};

export const login = async (req, res, next) => {
    const { email, password } = req.body;

    if (!email || !password) {
        throw new ApiError(400, "Email and password are required");
    }

    const foundUser = await User.findOne({ email }).exec();

    if (!foundUser) {
        throw new ApiError(401, "User does not exist'");
    };

    const match = await bcrypt.compare(password, foundUser.password);

    if (!match) {
        throw new ApiError(401, "Invalid credentials");
    }

    const { accessToken, refreshToken } = generateTokenAndSetCookie(foundUser, res);
    res.json({
        accessToken,
        refreshToken,  // mobile uses this
        email: foundUser.email,
        emailVerified: foundUser.emailVerified,
    });
};

export const logout = async (req, res, next) => {
    await User.findOneAndUpdate(
        { _id: req.user._id },
        { $inc: { tokenVersion: 1 } },   // increase token version by 1
        { new: true }
    );

    res.clearCookie("jwt", {
        httpOnly: true,
        secure: true,
        sameSite: "None"
    });

    res.json({ message: "Logged out successfully" });
}

export const refreshToken = async (req, res, next) => {
    try {
        // 1️⃣ Get refresh token from Cookie (Web)
        const cookieToken = req.cookies?.jwt;

        // 2️⃣ From Authorization Header (Mobile)
        const authHeader = req.headers.authorization;
        const headerToken =
            authHeader && authHeader.startsWith("Bearer ")
                ? authHeader.split(" ")[1]
                : null;


        // 3️⃣  from JSON Body (Mobile)
        const bodyToken = req.body?.refreshToken;

        const refreshToken = cookieToken || headerToken || bodyToken;

        if (!refreshToken) {
            throw new ApiError(401, "Unauthorized - Refresh token is required");
        }

        // 4️⃣ Verify refresh token
        jwt.verify(
            refreshToken,
            process.env.JWT_Refresh_Token,
            async (err, decoded) => {
                if (err) {
                    return next(new ApiError(403, "Forbidden - Invalid refresh token"));
                }

                const foundUser = await User.findById(decoded.UserInfo.id).exec();

                if (!foundUser) {
                    throw new ApiError(401, "Unauthorized ");
                }

                // 6️⃣ Create a new access token
                const accessToken = jwt.sign(
                    {
                        UserInfo: {
                            id: foundUser._id,
                            tokenVersion: foundUser.tokenVersion
                        },
                    },
                    process.env.JWT_Access_Token,
                    { expiresIn: "10m" } // recommended
                );

                // 7️⃣ Return access token (same for Web + Mobile)
                return res.json({ accessToken });
            }
        )

    } catch (error) {
        console.error(error);
        throw new ApiError(500, error.message);
    }
}

export const getMe = async (req, res, next) => {
    const user = req.user
    if (!user) {
        throw new ApiError(401, "Not authorized");
    }

    res.json({ user });
}

export const reSendVerificationCode = async (req, res, next) => {
    const { email } = req.body;
    if (!email) {
        return next(new ApiError(400, "Email is required"));
    }
    const verificationTimeMinutes = 10;

    const user = await User.findOne({ email }).exec();
    if (!user) {
        return next(new ApiError(404, "User with this email does not exist"));
    }
    if (user.emailVerified) {
        return next(new ApiError(400, "Email is already verified"));
    }
    // ==== CHECK IF USER MUST WAIT ====
    if (user.emailVerificationExpiry && user.emailVerificationExpiry > Date.now()) {
        const remainingMs = user.emailVerificationExpiry - Date.now();
        const remainingMin = Math.ceil(remainingMs / 1000 / 60);

        return next(
            new ApiError(
                429,
                `You must wait ${remainingMin} minute(s) before requesting a new verification code`
            )
        );
    }


    const { verificationCode, hashedVerifyCode } = generateVerificationCode();
    user.emailVerificationCode = hashedVerifyCode;
    user.emailVerificationExpiry = Date.now() + 1000 * 60 * verificationTimeMinutes; // 10 minutes 

    await user.save();

    // send email
    const response = await sendEmail({
        email,
        subject: "Verify your email",
        message: `
            <h2>Hello ${user.first_name}</h2>
            <p>Your verification code is:</p>
            <h1 style="letter-spacing: 4px">${verificationCode}</h1>
            <p>This code expires in ${verificationTimeMinutes} minutes.</p>
        `
    });

    res.status(200).json({
        status: "Success",
        message: "Verification code sent successfully",
        info: response
    });
}