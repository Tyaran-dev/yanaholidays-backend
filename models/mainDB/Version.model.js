import { Schema } from 'mongoose';
import { mainConnection  } from "../../db/connectMongoDB.js"; // Import your specific connection

const appVersionSchema = new Schema(
  {
    ios_storeVersion: { type: String, required: true },
    android_storeVersion: { type: String, required: true },
    ios_storeLink: { type: String },
    android_storeLink: { type: String },
  },
  { timestamps: true }
);


const appVersion = mainConnection.model('AppVersion', appVersionSchema);

export default appVersion;


