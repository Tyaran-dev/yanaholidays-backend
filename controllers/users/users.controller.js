import User from "../../models/mainDB/User.model.js";
import bcrypt from "bcrypt"
import { ApiError } from "../../utils/apiError.js";



export const getUser = async (req, res, next) => {
    try {
        const { id } = req.body;

        if (!id) {
            return next(new ApiError(400, "User ID is required"));
        }

        // Logged-in user
        const requester = req.user;

        // 1️⃣ If not admin, user must be requesting HIS OWN data
        if (requester.role !== "admin" && requester._id.toString() !== id) {
            return next(new ApiError(403, "Forbidden: Not allowed to access this user"));
        }

        // 2️⃣ Fetch user data
        const user = await User.findById(id)
            .select("-password")
            .populate("bookings");

        if (!user) {
            return next(new ApiError(404, "User not found"));
        }

        // 3️⃣ Success
        res.status(200).json(user);

    } catch (error) {
        return next(new ApiError(500, error.message));
    }
};

export const getAllUsers = async (req, res, next) => {
    try {
        const requester = req.user;

        // Only admin can get all users
        if (requester.role !== "admin") {
            return next(new ApiError(403, "Forbidden: Not allowed to access all users"));
        };
        const users = await User.find().select("-password").populate("bookings");

        res.status(200).json(users);
    } catch (error) {
        return next(new ApiError(500, error.message));

    }
}

export const updateUser = async (req, res, next) => {
    try {
        const userId = req.user._id;
        const { first_name, last_name, personalInfo } = req.body;

        if (!userId) {
            return next(new ApiError(400, "User ID is required"));
        }

        const user = await User.findById(userId);
        if (!user) {
            return next(new ApiError(404, "User not found"));
        }

        // Build update object
        const updateData = {};

        // Update basic fields if provided
        if (first_name !== undefined) updateData.first_name = first_name;
        if (last_name !== undefined) updateData.last_name = last_name;

        // Handle personalInfo update
        if (personalInfo && typeof personalInfo === "object") {
            // Get existing personalInfo or initialize if it doesn't exist
            const existingPersonalInfo = user.personalInfo ?
                user.personalInfo.toObject() :
                {
                    dateOfBirth: {},
                    passport: { expiryDate: {}, number: null, issuingCountry: null },
                    contact: { phoneCode: null, phoneNumber: null, email: null },
                    title: null,
                    middle_name: "",
                    nationality: null
                };

            // Create a deep merge function for nested objects
            const deepMerge = (target, source) => {
                for (const key in source) {
                    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
                        // If it's a nested object (like contact, passport, dateOfBirth)
                        if (key === 'contact' || key === 'passport' || key === 'dateOfBirth') {
                            target[key] = target[key] || {};
                            target[key] = deepMerge({ ...target[key] }, source[key]);
                        } else {
                            // For other fields (title, middle_name, nationality)
                            target[key] = source[key];
                        }
                    } else {
                        // For primitive values or arrays
                        target[key] = source[key];
                    }
                }
                return target;
            };

            // Merge existing personalInfo with new personalInfo
            updateData.personalInfo = deepMerge({ ...existingPersonalInfo }, personalInfo);

            // Ensure nested objects exist even if they weren't in the request
            updateData.personalInfo.passport = updateData.personalInfo.passport || { expiryDate: {}, number: null, issuingCountry: null };
            updateData.personalInfo.contact = updateData.personalInfo.contact || { phoneCode: null, phoneNumber: null, email: null };
            updateData.personalInfo.dateOfBirth = updateData.personalInfo.dateOfBirth || {};
        }

        // Update user in DB
        const updatedUser = await User.findByIdAndUpdate(
            userId,
            { $set: updateData },
            { new: true, runValidators: true }
        ).select("-password");

        if (!updatedUser) {
            return next(new ApiError(500, "Failed to update user"));
        }

        return res.status(200).json({
            success: true,
            message: "User updated successfully",
            user: updatedUser
        });

    } catch (error) {
        console.error("Update user error:", error);
        return next(new ApiError(500, error.message));
    }
};

export const deleteUser = async (req, res, next) => {
    try {
        const { id } = req.body;

        if (!id) {
            return next(new ApiError(400, "User ID is required"));
        }

        const requester = req.user;
        // 1️⃣ If not admin, user must be deleting HIS OWN account
        if (requester.role !== "admin" && requester._id.toString() !== id) {
            return next(new ApiError(403, "Forbidden: Not allowed to delete this user"));
        }

        // 2️⃣ Delete user
        const deletedUser = await User.findByIdAndDelete(id);
        if (!deletedUser) {
            return next(new ApiError(404, "User not found"));
        }

        res.status(200).json({ message: "User deleted successfully" });

    } catch (error) {
        return next(new ApiError(500, error.message));
    }
}
