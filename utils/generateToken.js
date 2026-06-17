import jwt from "jsonwebtoken";

export const generateTokenAndSetCookie = (user, res) => {
    const accessToken = jwt.sign({
        UserInfo: {
            id: user._id,
            tokenVersion: user.tokenVersion
        },
    }, process.env.JWT_Access_Token, { expiresIn: "5m", });

    const refreshToken = jwt.sign({
        UserInfo: {
            id: user._id,
            tokenVersion: user.tokenVersion
        },
    }, process.env.JWT_Refresh_Token, { expiresIn: "15d", });

    // set the refresh token in cookies for web
    res.cookie("jwt", refreshToken, {
        httpOnly: true, //accessible only by web server
        secure: true, //https
        sameSite: 'None', //cross-site cookie
        maxAge: 7 * 24 * 60 * 60 * 1000,
    })
    return { accessToken, refreshToken };
}