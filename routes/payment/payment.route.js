import express from "express";
import { InitiateSession, ExecutePayment, GetPaymentStatus, GetBookingStatus, captureAuthorizedPayment, releaseAuthorizedPayment, PaymentWebhook, saveDataToDb } from "../../controllers/payment/payment.controller.js";
import { optionalAuth } from "../../middlewares/optionalAuth.js";
const router = express.Router();


router.post("/initiateSession", InitiateSession);
router.post("/execute-payment", optionalAuth, ExecutePayment);
router.post("/paymentWebhook", PaymentWebhook);
router.post("/paymentStatus", GetPaymentStatus);
router.post("/bookingStatus", GetBookingStatus);
router.post("/captureAmount", captureAuthorizedPayment);
router.post("/releaseAmount", releaseAuthorizedPayment);
router.post("/saveData", optionalAuth, saveDataToDb);



export default router;