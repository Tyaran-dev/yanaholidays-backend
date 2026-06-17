import axios from "axios";
import { ApiError } from "../../utils/apiError.js";
import TempBookingTicket from "../../models/mainDB/bookings/TempBooking.js";
import FinalBooking from "../../models/mainDB/bookings/FinalBooking.js";
import crypto from "crypto";

export const InitiateSession = async (req, res, next) => {
  try {
    const paymentBaseUrl = process.env.MYFATOORAH_API_URL;
    const token = process.env.MYFATOORAH_TEST_TOKEN;
    const resposne = await axios.post(
      `${paymentBaseUrl}/v2/InitiateSession`,
      {},
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      }
    );
    res.status(200).json({ data: resposne.data, status: resposne.status });
  } catch (error) {
    console.error("My Fatoorah InitiateSession Error:", error.message);
    return next(new ApiError(500, "Internal Server Error"));
  }
};

export const ExecutePayment = async (req, res, next) => {
  try {
    const { sessionId, invoiceValue, flightData, travelers, hotelData } =
      req.body;
    const userId = req.user?._id || null;

    console.log(userId, "here")


    const apiBase = process.env.MYFATOORAH_API_URL;
    const token = process.env.MYFATOORAH_TEST_TOKEN;

    // ✅ FIXED: Proper validation for both flight and hotel bookings
    if (!sessionId || !invoiceValue) {
      return next(new ApiError(400, "Missing sessionId or invoiceValue"));
    }

    // Validate that we have either flight data or hotel data (but not both)
    const hasFlightData = flightData && travelers;
    const hasHotelData = hotelData;

    if (!hasFlightData && !hasHotelData) {
      return next(
        new ApiError(
          400,
          "Missing booking data: either flightData+travelers or hotelData required"
        )
      );
    }

    if (hasFlightData && hasHotelData) {
      return next(
        new ApiError(400, "Cannot have both flightData and hotelData")
      );
    }

    // ✅ Tell MyFatoorah where to redirect after payment
    const successUrl = `${process.env.FRONTEND_URL}/thank-you`;
    const errorUrl = `${process.env.FRONTEND_URL}/payment-failed`;

    // Call MyFatoorah to execute the payment
    const { data } = await axios.post(
      `${apiBase}/v2/ExecutePayment`,
      {
        SessionId: sessionId,
        InvoiceValue: invoiceValue, //invoiceValue,
        ProcessingDetails: {
          AutoCapture: false, // We will capture in webhook after booking success
        },
        CallBackUrl: successUrl,
        WebhookUrl: "https://api.yanaholidays.com/payment/paymentWebhook",
        ErrorUrl: errorUrl,
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      }
    );

    const invoiceId = data?.Data?.InvoiceId;
    if (!invoiceId) {
      return next(new ApiError(500, "No InvoiceId returned from MyFatoorah"));
    }

    // 📝 Save either flight or hotel booking data
    const bookingType = flightData ? "flight" : "hotel";

    await TempBookingTicket.create({
      invoiceId,
      bookingType: bookingType,
      bookingData: {
        hotelData,
        bookingType: "hotel", // Explicitly set for clarity
      },
      user: userId || null, // req.user comes from auth middleware
    });

    // Send Payment URL back to frontend
    res.status(200).json({
      success: true,
      paymentUrl: data?.Data?.PaymentURL,
      invoiceId,
      bookingType: bookingType, // Send back for frontend confirmation
    });
  } catch (err) {
    console.error("ExecutePayment error:", err?.response?.data || err.message);
    next(new ApiError(500, "ExecutePayment failed"));
  }
};

// ---------------- Helper ----------------
function formatDate(dateObj) {
  if (!dateObj) return null;

  // If already a string, try normal parsing
  if (typeof dateObj === "string") {
    const d = new Date(dateObj);
    return isNaN(d.getTime()) ? null : d.toISOString().split("T")[0];
  }

  // Handle object { day, month, year }
  if (
    typeof dateObj === "object" &&
    dateObj.day &&
    dateObj.month &&
    dateObj.year
  ) {
    const { day, month, year } = dateObj;
    // Pad month/day with leading zeros
    const isoStr = `${year}-${String(month).padStart(2, "0")}-${String(
      day
    ).padStart(2, "0")}`;
    const d = new Date(isoStr);
    return isNaN(d.getTime()) ? null : d.toISOString().split("T")[0];
  }

  return null;
}


// ---------------- Helper: Build Hotel Booking Payload ----------------
export function buildHotelBookingPayload({ hotelData, travelers, finalPrice }) {
  if (!hotelData || !Array.isArray(travelers)) {
    throw new Error("Missing hotelData or travelers array");
  }

  return {
    BookingCode: hotelData.BookingCode, // comes from your hotel data
    BookingReferenceId: "TBO-BOOK-" + Date.now(),
    BookingType: "Voucher",
    ClientReferenceId: "BOOK-" + Date.now(),
    CustomerDetails: [
      {
        RoomIndex: 0,
        CustomerNames: travelers.map(function (traveler) {
          return {
            Title: traveler.title,
            FirstName: traveler.firstName,
            LastName: traveler.lastName,
            Type: traveler.travelerType || "Adult",
          };
        }),
      },
    ],
    EmailId: (travelers[0] && travelers[0].email) || "",
    PhoneNumber: (
      ((travelers[0] && travelers[0].phoneCode) || "") +
      ((travelers[0] && travelers[0].phoneNumber) || "")
    ).replace(/\s/g, ""),
    PaymentMode: "Limit",
    TotalFare: finalPrice,
  };
}

export const PaymentWebhook = async (req, res) => {
  try {
    const secret = process.env.MYFATOORAH_WEBHOOK_SECRET;
    const signature = req.headers["myfatoorah-signature"];
    const { Data } = req.body;

    if (!signature) {
      return res.status(400).json({ error: "Missing signature" });
    }
    if (!Data?.Invoice || !Data?.Transaction) {
      return res.status(400).json({ error: "Invalid payload" });
    }

    const fields = [
      `Invoice.Id=${Data.Invoice.Id || ""}`,
      `Invoice.Status=${Data.Invoice.Status || ""}`,
      `Transaction.Status=${Data.Transaction.Status || ""}`,
      `Transaction.PaymentId=${Data.Transaction.PaymentId || ""}`,
      `Invoice.ExternalIdentifier=${Data.Invoice.ExternalIdentifier || ""}`,
    ];
    const dataString = fields.join(",");

    const expectedSignature = crypto
      .createHmac("sha256", Buffer.from(secret, "utf8"))
      .update(dataString, "utf8")
      .digest("base64");

    if (signature !== expectedSignature) {
      console.error("⚠️ Invalid webhook signature");
      return res.status(401).json({ error: "Invalid signature" });
    }
    console.log("✅ Webhook verified 2 from yanaholidays");

    const InvoiceId = Data.Invoice.Id;
    const TransactionStatus = Data.Transaction.Status;
    const PaymentId = Data.Transaction.PaymentId;
    const InvoiceValue = Number(Data.Amount?.ValueInPayCurrency);

    const existing = await FinalBooking.findOne({ invoiceId: InvoiceId });
    if (existing) {
      console.log(`⚠️ Skipping duplicate invoice ${Data.Invoice.Id}`);
      return res.status(200).json({ message: "Already processed" });
    }

    console.log(InvoiceValue, "invoice value from yanaholidays");

    if (!InvoiceId) {
      return res.status(400).json({ error: "Missing InvoiceId" });
    }

    if (
      TransactionStatus === "AUTHORIZE" ||
      TransactionStatus === "Authorize"
    ) {
      // Idempotency guard: atomically claim this invoice to avoid duplicate processing on webhook retries
      const claimedBooking = await TempBookingTicket.findOneAndUpdate(
        { invoiceId: InvoiceId, status: { $in: ["pending"] } },
        { $set: { status: "authorized" } },
        { new: true }
      );

      const userId = claimedBooking.user || null;


      // If already processed or not found, exit early (either another retry claimed it, or it was already deleted)
      if (!claimedBooking) {
        const alreadyFinalized = await FinalBooking.findOne({
          invoiceId: InvoiceId,
        });
        if (alreadyFinalized) {
          console.log(
            `⚠️ Duplicate webhook for ${InvoiceId} ignored (already finalized)`
          );
          return res.status(200).json({ message: "Already processed" });
        }
        console.log(
          `⚠️ No temp booking to process for ${InvoiceId}; ignoring retry`
        );
        return res.status(200).json({ message: "No action" });
      }

      const rawBooking = claimedBooking.bookingData;
      const bookingType = rawBooking.bookingType; // "flight" or "hotel"

      try {


        // --------- Hotels ----------
        // rawBooking.hotelData already includes CustomerDetails, EmailId, PhoneNumber, etc.
        const hotelPayload = rawBooking.hotelData;


        const response = await axios.post(
          `${process.env.BASE_URL}/hotels/BookRoom`,
          hotelPayload
        );

        console.log(response.data.data, "reponse.data.data from yana holidays");
        console.log(response.data, "reponse.data from yana holidays")

        console.log(response.data?.data.Status?.Code, "Hotel reponse Status from yanaholidays ")

        if (response.data?.data.Status?.Code === 200) {
          await FinalBooking.create({
            invoiceId: InvoiceId,
            paymentId: PaymentId,
            status: "CONFIRMED",
            InvoiceValue,
            bookingType,
            bookingPayload: rawBooking,
            user: userId,
            orderData: response.data.order,
          });

          await axios.post(`${process.env.BASE_URL}/payment/captureAmount`, {
            Key: InvoiceId,
            KeyType: "InvoiceId",
            InvoiceValue,
          });
          console.log(
            "✅ Hotel booking success, payment captured:",
            InvoiceId
          );
        } else {
          await FinalBooking.create({
            invoiceId: InvoiceId,
            paymentId: PaymentId,
            status: "FAILED",
            InvoiceValue,
            bookingType,
            bookingPayload: rawBooking,
            user: userId,
            orderData: response.data || null,
          });

          await axios.post(`${process.env.BASE_URL}/payment/releaseAmount`, {
            Key: InvoiceId,
            KeyType: "InvoiceId",
            InvoiceValue,
          });
          console.log(
            "❌ Hotel booking failed, payment released:",
            InvoiceId
          );
        }

      } catch (err) {
        console.error(
          "Booking API failed:",
          err?.response?.data || err.message
        );
        await FinalBooking.create({
          invoiceId: InvoiceId,
          paymentId: PaymentId,
          status: "FAILED",
          InvoiceValue,
          orderData: null,
          bookingType,
          user: userId,
          bookingPayload: rawBooking,
        });
        await axios.post(`${process.env.BASE_URL}/payment/releaseAmount`, {
          Key: InvoiceId,
          KeyType: "InvoiceId",
          InvoiceValue,
        });
      }

      await TempBookingTicket.deleteOne({ invoiceId: InvoiceId });
    }

    if (TransactionStatus === "FAILED") {
      console.log("❌ Payment failed for invoice:", InvoiceId);
      // Optionally update FinalBooking status here for failed payments
    }

    return res.status(200).json({ message: "Webhook processed" });
  } catch (err) {
    console.error("Webhook error:", err?.response?.data || err.message);
    return res.status(500).json({ error: "Server error" });
  }
};


export const GetPaymentStatus = async (req, res, next) => {
  try {
    const { key, keyType } = req.body; // keyType can be 'InvoiceId' or 'PaymentId'
    const apiBase = process.env.MYFATOORAH_API_URL;
    const token = process.env.MYFATOORAH_TEST_TOKEN;

    const { data } = await axios.post(
      `${apiBase}/v2/GetPaymentStatus`,
      {
        Key: key,
        keyType: keyType,
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      }
    );

    res.status(200).json(data);
  } catch (err) {
    console.error(
      "GetPaymentStatus error:",
      err?.response?.data || err.message
    );
    next(new ApiError(500, "GetPaymentStatus failed"));
  }
};

export const GetBookingStatus = async (req, res) => {
  try {
    const { paymentId, invoiceId } = req.body;

    // 🟢 Decide which key to use for MyFatoorah call
    let Key, KeyType;
    if (invoiceId) {
      Key = invoiceId;
      KeyType = "InvoiceId";
    } else if (paymentId) {
      Key = paymentId;
      KeyType = "PaymentId";
    } else {
      return res.status(400).json({ error: "Missing paymentId or invoiceId" });
    }

    const apiBase = process.env.MYFATOORAH_API_URL;
    const token = process.env.MYFATOORAH_TEST_TOKEN;

    // 🟢 Call MyFatoorah with dynamic KeyType
    const { data } = await axios.post(
      `${apiBase}/v2/GetPaymentStatus`,
      { Key, KeyType },
      { headers: { Authorization: `Bearer ${token}` } }
    );

    // 🟢 Always extract InvoiceId from response
    const resolvedInvoiceId = data?.Data?.InvoiceId || invoiceId;
    const transactions = data?.Data?.InvoiceTransactions || [];

    if (!resolvedInvoiceId) {
      return res.json({ status: "PENDING" });
    }

    // 🔹 Check if already saved in DB
    const booking = await FinalBooking.findOne({
      invoiceId: resolvedInvoiceId,
    });
    if (booking) {
      return res.json({
        status: booking.status,
        order: booking || null,
      });
    }

    // 🔹 Extract transaction statuses
    const statuses = transactions.map((t) => t.TransactionStatus);

    // 🚨 Priority 1: Failure cases
    if (
      statuses.includes("Failed") ||
      statuses.includes("Canceled") ||
      statuses.includes("Expired")
    ) {
      return res.json({ status: "FAILED" });
    }

    // ✅ Priority 2: Success cases
    if (statuses.includes("Paid") || statuses.includes("Captured")) {
      return res.json({ status: "CONFIRMED" });
    }

    // ⏳ Priority 3: Authorized but not yet captured
    if (statuses.includes("Authorize")) {
      return res.json({ status: "AUTHORIZED" });
    }

    // ⏳ Default fallback → still pending
    return res.json({ status: "PENDING" });
  } catch (err) {
    console.error(
      "GetBookingStatus error:",
      err?.response?.data || err.message
    );
    return res.status(500).json({ error: "Server error" });
  }
};

export const captureAuthorizedPayment = async (req, res, next) => {
  try {
    const { Key, KeyType, InvoiceValue } = req.body; // keyType can be 'InvoiceId' or 'PaymentId' => Amount

    const apiBase = process.env.MYFATOORAH_API_URL;
    const token = process.env.MYFATOORAH_TEST_TOKEN;

    const { data } = await axios.post(
      `${apiBase}/v2/UpdatePaymentStatus`,
      {
        Operation: "capture",
        Amount: InvoiceValue,
        Key: Key,
        KeyType: KeyType,
      },
      { headers: { Authorization: `Bearer ${token}` } }
    );

    res.status(200).json(data);
  } catch (err) {
    console.error(
      "captureAuthorizedPayment error:",
      err?.response?.data || err.message
    );
    next(new ApiError(500, "captureAuthorizedPayment failed"));
  }
};

export const releaseAuthorizedPayment = async (req, res, next) => {
  try {
    const { Key, KeyType, InvoiceValue } = req.body; // keyType can be 'InvoiceId' or 'PaymentId'ك

    console.log(Key, KeyType);

    const apiBase = process.env.MYFATOORAH_API_URL;
    const token = process.env.MYFATOORAH_TEST_TOKEN;

    const { data } = await axios.post(
      `${apiBase}/v2/UpdatePaymentStatus`,
      {
        Operation: "release",
        Amount: InvoiceValue,
        Key: Key,
        KeyType: KeyType,
      },
      { headers: { Authorization: `Bearer ${token}` } }
    );
    console.log("released", data);
    res.status(200).json(data);
  } catch (err) {
    console.error(
      "releaseAuthorizedPayment error:",
      err?.response?.data || err.message
    );
    next(new ApiError(500, "releaseAuthorizedPayment failed"));
  }
};

export const saveDataToDb = async (req, res, next) => {
  try {
    const { invoiceId, bookingType, flightData, hotelData } = req.body;

    const userId = req.user?._id || null;



    // ✅ Validate required fields
    if (!invoiceId || (!flightData && !hotelData)) {
      return next(new ApiError(400, "Missing required fields"));
    }
    let hotelBookingData = {};


    if (hotelData) {

      // --- Generate random unique refs (same as website logic) ---
      const date = new Date();
      const dateStr = date.toISOString().split("T")[0].replace(/-/g, "");
      const randomNum = Math.floor(1000 + Math.random() * 9000);
      const rawHotel = hotelData.hotelData; // This is where the real data lives

      hotelBookingData = {
        // data from mobile
        BookingCode: rawHotel.BookingCode,
        CustomerDetails: rawHotel.CustomerDetails,
        TotalFare: rawHotel.TotalFare,
        EmailId: rawHotel.EmailId,
        PhoneNumber: rawHotel.PhoneNumber,

        // static fields from backend
        ClientReferenceId: `BOOK-${dateStr}${randomNum}`,
        BookingReferenceId: `TBO-BOOK-${dateStr}${randomNum}`,
        BookingType: "Voucher",
        PaymentMode: "Limit",

      };

    }

    // 📝 Save either flight or hotel booking data
    await TempBookingTicket.create({
      invoiceId,
      bookingType: bookingType,
      bookingData: {
        hotelData: hotelBookingData,
        bookingType: "hotel"
      },
      user: userId || null, // req.user comes from auth middleware
    });

    res.status(201).json({
      success: true,
      message: "Booking data saved successfully",
    });
  } catch (error) {
    console.error("saveDataToDb error:", error);
    next(new ApiError(500, "Failed to save booking data"));
  }
};
