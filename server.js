import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import bodyParser from "body-parser";

import authRoute from "./routes/auth/auth.route.js";
import usersRoute from "./routes/users/users.route.js";
import paymentRoute from "./routes/payment/payment.route.js";
import hotelsRoute from "./routes/hotels/hotels.route.js";
import versionRoute from "./routes/version.route.js";
import { connectAllDatabases } from './db/connectMongoDB.js';
import { ApiError } from "./utils/apiError.js";
import cookieParser from "cookie-parser";


const app = express();
dotenv.config();
const allowedOrigins = [
  'http://localhost:4025',  // development
  'https://yanaholidays.com'     // production
];

app.use(cors({
  origin: function (origin, callback) {
    // allow requests with no origin like mobile apps or curl
    if (!origin) return callback(null, true);
    if (allowedOrigins.indexOf(origin) === -1) {
      const msg = 'The CORS policy for this site does not allow access from the specified Origin.';
      return callback(new Error(msg), false);
    }
    return callback(null, true);
  },
  credentials: true,  // <-- allow cookies
}));
const PORT = process.env.PORT || 3000;

// Capture raw body for signature verification
app.use(
  bodyParser.json({
    verify: (req, res, buf) => {
      req.rawBody = buf.toString();
    },
  })
);

app.use(cookieParser());

app.use(express.json());

// user routes
app.use("/auth", authRoute);
app.use("/users", usersRoute);


app.use("/hotels", hotelsRoute);
app.use("/payment", paymentRoute);
app.use("/version", versionRoute);


app.use((err, req, res, next) => {
  console.error("🔥 ERROR:", err);

  if (err instanceof ApiError) {
    return res.status(err.statusCode).json({
      status: err.status,
      message: err.message,
    });
  }

  // Unexpected error (not ApiError)
  return res.status(500).json({
    status: "error",
    message: "Something went wrong on the server",
  });
});


// Connect to databases
await connectAllDatabases();


  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
