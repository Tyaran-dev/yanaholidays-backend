import User from "../models/mainDB/User.model.js";
import jwt from "jsonwebtoken";


export const optionalAuth = async (req, res, next) => {
    let token;
    const authHeader = req.headers.authorization || req.headers.Authorization;

    
    if (authHeader) {
        token = authHeader.split(" ")[1];
    }
    
    console.log(token, "token")
    if (!token) {
        req.user = null;
        return next();
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_Access_Token);

        const user = await User.findById(decoded.UserInfo.id).select("-password");

        req.user = user || null;
        next();
    } catch (err) {
        // Invalid token → treat as guest
        req.user = null;
        next();
    }
};
