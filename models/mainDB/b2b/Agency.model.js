import mongoose from 'mongoose';


const agencySchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        unique: true,
        trim: true
    },
    vatNumber: {
        type: String,
        required: true,
        unique: true
    },
    address: {
        street: String,
        city: String,
        country: String,
        zipCode: String
    },
    phone: {
        type: String,
        required: true,
        unique: true
    },
    email: {
        type: String,
        required: true,
        lowercase: true,
        unique: true,
        trim: true
    },

    // Admin reference (one-to-one relationship)
    admin: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    // Wallet for B2B payments
    walletBalance: {
        type: Number,
        default: 0,
        min: 0
    },
    walletHistory: [{
        amount: Number,
        type: {
            type: String,
            enum: ['credit', 'debit']
        },
        balanceBefore: Number,
        balanceAfter: Number,
        date: {
            type: Date,
            default: Date.now
        },
        description: String,
        bookingId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Booking'
        },
        performedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User'
        }
    }],

    // Agency status
    status: {
        type: String,
        enum: ['active', 'suspended', 'pending'],
        default: 'pending'
    },
}, {
    timestamps: true
})

// Virtual for users (one agency has multiple users)
agencySchema.virtual('users', {
    ref: 'User',
    localField: '_id',
    foreignField: 'agency'
});

// Virtual for bookings
agencySchema.virtual('bookings', {
    ref: 'Booking',
    localField: '_id',
    foreignField: 'agency'
});

// Ensure virtuals are included in JSON
agencySchema.set('toJSON', { virtuals: true });
agencySchema.set('toObject', { virtuals: true });

const Agency = mongoose.model("Agency", agencySchema);

export default Agency;