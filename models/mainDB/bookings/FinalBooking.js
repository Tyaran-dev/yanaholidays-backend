// models/FinalBooking.js
import { Schema } from 'mongoose';
import { mainConnection  } from "../../../db/connectMongoDB.js"; // Import your specific connection

const FinalBookingSchema = new Schema({
  invoiceId: { type: String, required: true, unique: true },
  paymentId: { type: String }, // optional, only available on confirmed payments
  status: {
    type: String,
    enum: ["CONFIRMED", "FAILED"],
    required: true,
  },
  InvoiceValue: { type: Number }, // store invoice total
  bookingType: { type: String }, // flight, hotel, etc.
  orderData: { type: Object }, // Amadeus order response if success
  bookingPayload: { type: Object }, // raw booking payload if failed or for debugging
  user: {
    type: Schema.Types.ObjectId,
    ref: "User",
    required: false,
  },
  createdAt: { type: Date, default: Date.now },
});

// const booking = await FinalBooking.findById(id).populate("user");


// Register the model on the same connection as User
const FinalBookingTicket = mainConnection.model('FinalBookingTicket', FinalBookingSchema);

export default FinalBookingTicket;
