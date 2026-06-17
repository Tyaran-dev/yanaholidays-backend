import mongoose from "mongoose";
import User from "./User.model";


const b2bBookingSchema = new mongoose.Schema({
    // USER & AGENCY IDENTIFICATION
    // ========================================
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    agency: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Agency',
        required: true,
        index: true
    },
    userType: {
        type: String,
        enum: ['b2b_admin', 'b2b_user'],
        required: true,
        index: true
    },

    // ========================================
    // BOOKING DETAILS
    // ========================================
    bookingType: {
        type: String,
        enum: ['flight', 'hotel'],
        required: true,
        index: true
    },
    bookingReference: {
        type: String,
        unique: true,
        required: true,
        index: true
    },
    // ========================================
    // APPROVAL WORKFLOW (Only for B2B User bookings)
    // ========================================
    approvalStatus: {
        type: String,
        enum: ['pending', 'approved', 'rejected', 'not_required'],
        default: function () {
            // B2B users need approval, admins don't
            return this.userType === 'b2b_user' ? 'pending' : 'not_required';
        },
        index: true
    },
    approvedAt: Date,
    rejectionReason: String,
    status: {
        type: String,
        enum: ['pending_approval', 'approved', 'confirmed', 'cancelled', 'failed', 'refunded'],
        default: function () {
            return this.userType === 'b2b_user' ? 'pending_approval' : 'pending';
        },
        index: true
    },
    // ========================================
    // PAYMENT DETAILS - Wallet Only
    // ========================================
    paymentMethod: {
        type: String,
        default: 'wallet' // Always wallet for B2B
    },
    // ========================================
    // AMOUNTS & WALLET TRACKING
    // ========================================
    originalAmount: {
        type: Number,
        required: true,
        min: 0
    },

    finalAmount: {
        type: Number,
        required: true,
        min: 0
    },

    currency: {
        type: String,
        default: 'SAR'
    },
})