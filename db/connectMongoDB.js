import dotenv from 'dotenv';
dotenv.config(); // This MUST come before any other imports that use process.env
// connections.js
import mongoose from "mongoose";

// Create connections for different databases
export const mainConnection = mongoose.createConnection(process.env.MONGO_URL);
// export const hotelsConnection = mongoose.createConnection(process.env.MONGO_HOTELS_URL);

// Optional: Connect all at once
export const connectAllDatabases = async () => {
  try {
    await mainConnection.asPromise();
    console.log("Main database connected");
    
    // await hotelsConnection.asPromise();
    console.log("Hotels database connected");
  } catch (error) {
    console.error("Error connecting to databases:", error.message);
    process.exit(1);
  }
};