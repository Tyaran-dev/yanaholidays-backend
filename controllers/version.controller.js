import { ApiError } from "../utils/apiError.js";
import AppVersion from "../models/mainDB/Version.model.js";

export const getVersion = async (req, res, next) => {
  try {
    const version = await AppVersion.findOne().sort({ createdAt: -1 });
    if (!version) return res.status(404).json({ message: "Version not found" });
    res.json(version);
  } catch (error) {
    console.error("Version Error :", error.response?.data || error.message);
    next(
      new ApiError(
        error.response?.status || 500,
        error.response?.data?.errors?.[0]?.detail || "Error Get Version"
      )
    );
  }
};

export const updateVersion = async (req, res, next) => {
  try {
    const updateData = req.body;

    // Find the single document and update it
    const version = await AppVersion.findOneAndUpdate({}, updateData, {
      new: true,
      upsert: true, // in case it doesn't exist yet
    });

    res.json({
      message: "✅ Version updated successfully",
      version,
    });
  } catch (error) {
    console.error("Version Error :", error.response?.data || error.message);
    next(
      new ApiError(
        error.response?.status || 500,
        error.response?.data?.errors?.[0]?.detail || "Error Update Version"
      )
    );
  }
};
