import User from "../models/mainDB/User.model.js";
import jwt from "jsonwebtoken";
import { ApiError } from "../utils/apiError.js";

export const protectedRoute = async (req, res, next) => {
    try {
        // Get token from Authorization Header
        const authHeader = req.headers.authorization || req.headers.Authorization;
        
        if (!authHeader?.startsWith("Bearer ")) {
            return next(new ApiError(401, "Unauthorized: No token provided"));
        }

        const token = authHeader.split(" ")[1];
        
        if (!token) {
            return next(new ApiError(401, "Unauthorized: Invalid token format"));
        }

        // Verify token
        let decoded;
        try {
            decoded = jwt.verify(token, process.env.JWT_Access_Token);
        } catch (jwtError) {
            // Handle different JWT errors specifically
            if (jwtError.name === "TokenExpiredError") {
                return next(new ApiError(401, "Token expired"));
            } else if (jwtError.name === "JsonWebTokenError") {
                return next(new ApiError(401, "Invalid token"));
            } else {
                return next(new ApiError(401, "Token verification failed"));
            }
        }

        // Check if decoded token has required data
        if (!decoded?.UserInfo?.id) {
            return next(new ApiError(401, "Unauthorized: Invalid token structure"));
        }

        // Fetch user from database
        const user = await User.findById(decoded.UserInfo.id).select("-password");
        
        if (!user) {
            return next(new ApiError(401, "User not found"));
        }

        // Check token version (for logout all devices feature)
        if (decoded.UserInfo.tokenVersion !== user.tokenVersion) {
            return next(new ApiError(401, "Token invalidated"));
        }

        // Attach user to request
        req.user = user;
        next();

    } catch (error) {
        // This catch block is for database errors or other unexpected errors
        console.error("Protected route error:", error);
        
        // Check if it's already an ApiError with 401 status
        if (error instanceof ApiError && error.statusCode === 401) {
            return next(error);
        }
        
        // For other errors, return 500
        return next(new ApiError(500, "Internal server error"));
    }
}