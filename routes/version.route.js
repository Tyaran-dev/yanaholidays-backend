import express from "express";
import {
  getVersion,
  updateVersion,
} from "../controllers/version.controller.js";

const router = express.Router();

router.get("/get-version", getVersion);
router.patch("/update-version", updateVersion);

export default router;

// router.post("/store-version/init", async (req, res) => {
//   try {
//     const exists = await AppVersion.findOne();
//     if (exists)
//       return res.status(400).json({ message: "Version already exists" });

//     const version = await AppVersion.create({
//       ios_storeVersion: "1.0.0",
//       android_storeVersion: "1.0.0",
//       ios_storeLink: "https://apps.apple.com/app",
//       android_storeLink: "https://play.google.com/store/apps",
//     });

//     res.status(201).json(version);
//   } catch (error) {
//     res.status(500).json({ error: error.message });
//   }
// });
