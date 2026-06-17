import express from "express";
import { updateUser, getUser, deleteUser, getAllUsers } from "../../controllers/users/users.controller.js";
import { protectedRoute } from "../../middlewares/protectedRoute.js";
const router = express.Router();


router.post("/getUser", protectedRoute, getUser);
router.get("/getAllUsers", protectedRoute, getAllUsers);
router.put("/updateUser", protectedRoute, updateUser);
router.delete("/deleteUser", protectedRoute, deleteUser);


export default router;