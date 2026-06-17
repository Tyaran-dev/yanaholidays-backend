import { Schema } from 'mongoose';
import { mainConnection  } from "../../db/connectMongoDB.js"; // Import your specific connection

const userSchema = new Schema({
    first_name: {
        type: String,
        required: true,
        trim: true,
    },
    last_name: {
        type: String,
        required: true,
        trim: true,
    },
    email: {
        type: String,
        required: true,
        unique: true,
        lowercase: true,
        trim: true
    },
    password: {
        type: String,
        required: true,
        minlength: 6
    },
    passwordChangedAt: Date,
    passwordResetCode: String,
    passwordResetExpires: Date,
    passwordResetVerified: Boolean,
    role: {
        type: String,
        enum: ['admin', 'member'],
        required: true,
        default: 'member'
    },
    emailVerified: {
        type: Boolean,
        default: false
    },
    emailVerificationCode: String,
    emailVerificationExpiry: Date,
    profileImg: String,
    personalInfo: {
        title: { type: String, enum: ['Mr', 'Ms', 'Mrs'], default: null },
        middle_name: { type: String, default: "" },
        dateOfBirth: {
            day: Number,
            month: Number,
            year: Number
        },
        nationality: { type: String, default: null },
        passport: {
            number: { type: String, default: null },
            issuingCountry: { type: String, default: null },
            expiryDate: {
                day: Number,
                month: Number,
                year: Number
            }
        },
        contact: {
            phoneCode: { type: String, default: null },
            phoneNumber: { type: String, default: null },
            email: { type: String, default: null }
        }
    },
    membershipStatus: {
        type: String,
        enum: ['pending', 'active', 'suspended'],
        default: 'pending',
        required: function () {
            return this.role === 'member';
        }
    },
    registrationPaymentId: {
        type: String,
        default: null
    },
    discountPercentage: {
        type: Number,
        default: 5,
        required: function () {
            return this.role === 'member';
        }
    },
    points: {
        type: Number,
        default: 0
    },
    tokenVersion: { type: Number, default: 1 },
    pointsHistory: [{
        miles: Number,
        points: Number,
        date: {
            type: Date,
            default: Date.now
        },
        bookingId: {
            type: Schema.Types.ObjectId,
            ref: 'FinalBooking'
        }
    }],
    // guestEmail: String, // For tracking pre-registration orders
    bookings: [
        {
            type: Schema.Types.ObjectId,
            ref: "FinalBookingTicket" // Change to match your model name
        }
    ],

}, {
    timestamps: true,
})

// Create the model on the mainConnection instead of default mongoose
const User = mainConnection.model("User", userSchema);

export default User;
