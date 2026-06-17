// models/TempBooking.js
import { Schema } from 'mongoose';
import { mainConnection } from "../../../db/connectMongoDB.js"; // Import your specific connection


const TempBookingSchema = new Schema(
  {
    invoiceId: {
      type: String,
      required: true,
      unique: true,
    },
    // 🔑 VERY IMPORTANT
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: false, // allow guest checkout
    },
    bookingType: {
      type: String,
      enum: ["flight", "hotel"],
      required: true,
    },
    bookingData: {
      type: Object, // can store either flightData or hotelData
      required: true,
    },
    status: {
      type: String,
      enum: ["pending", "authorized", "failed"],
      default: "pending",
    },
    createdAt: {
      type: Date,
      default: Date.now,
      expires: 60 * 60, // Auto-delete after 1 hour
    },
  },
  { timestamps: true }
);

const TempBookingTicket = mainConnection.model('TempBookingTicket', TempBookingSchema);


export default TempBookingTicket;
